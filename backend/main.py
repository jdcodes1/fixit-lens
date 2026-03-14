import os
import json
import asyncio
import base64
import time
from collections import defaultdict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Gemini Setup ---

api_key = os.environ.get("GOOGLE_API_KEY")
if not api_key:
    raise RuntimeError("GOOGLE_API_KEY not set in environment")

client = genai.Client(api_key=api_key)

SYSTEM_PROMPT = """You are Fixit Lens, an expert AR repair assistant. The user is showing you a live camera feed of something they want to fix or understand.

Your role:
- Identify what the user is showing you (appliance, electronics, plumbing, furniture, vehicle part, etc.)
- Provide clear, step-by-step repair guidance based on what you see
- Call out specific parts, screws, connectors, or components visible in the frame
- Suggest tools needed for the repair
- If you can't see clearly, ask the user to adjust the camera angle

Safety rules (CRITICAL):
- If you see ANY safety hazard (water near electricity, exposed wires, gas leaks, structural danger, sharp edges near hands, etc.), you MUST prefix your response with exactly [SAFETY_ALERT] followed by a clear warning
- Always warn before the user could hurt themselves
- Prioritize safety over repair advice

Keep responses concise and conversational since you are speaking aloud. Use short sentences."""

LIVE_CONFIG = types.LiveConnectConfig(
    response_modalities=["AUDIO"],
    system_instruction=types.Content(
        parts=[types.Part(text=SYSTEM_PROMPT)]
    ),
    speech_config=types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
        )
    ),
    input_audio_transcription=types.AudioTranscriptionConfig(),
    output_audio_transcription=types.AudioTranscriptionConfig(),
)

# --- Rate limiting ---

connections_per_ip: dict[str, int] = defaultdict(int)
MAX_CONNECTIONS_PER_IP = 3
MAX_FRAMES_PER_SEC = 2


async def _drain_ws(websocket: WebSocket, ready: asyncio.Event):
    """Read and discard WS messages until Gemini is ready."""
    try:
        while not ready.is_set():
            await websocket.receive()
    except Exception:
        pass


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_ip = websocket.client.host if websocket.client else "unknown"

    if connections_per_ip[client_ip] >= MAX_CONNECTIONS_PER_IP:
        await websocket.close(code=1008, reason="Too many connections")
        return

    await websocket.accept()
    connections_per_ip[client_ip] += 1
    print(f"WebSocket connected from {client_ip}", flush=True)

    last_frame_time = 0.0
    gemini_ready = asyncio.Event()

    async def send_error(msg: str):
        try:
            await websocket.send_json({"type": "error", "message": msg})
        except Exception:
            pass

    async def send_status(status: str):
        try:
            await websocket.send_json({"type": "status", "status": status})
        except Exception:
            pass

    try:
        # Drain WS messages while Gemini connects (so the WS doesn't die)
        drain_task = asyncio.create_task(_drain_ws(websocket, gemini_ready))

        await send_status("connecting")

        # Retry loop for Gemini connection
        gemini = None
        for attempt in range(3):
            try:
                session = client.aio.live.connect(
                    model="gemini-2.5-flash-native-audio-preview-12-2025", config=LIVE_CONFIG
                )
                gemini = await session.__aenter__()
                break
            except Exception as e:
                print(f"Gemini connect attempt {attempt + 1} failed: {type(e).__name__}: {e}", flush=True)
                if attempt == 2:
                    await send_error(f"Failed to connect to AI service after 3 attempts: {e}")
                    return
                await asyncio.sleep(1)

        # Stop draining, start real processing
        gemini_ready.set()
        drain_task.cancel()
        try:
            await drain_task
        except asyncio.CancelledError:
            pass

        await send_status("ready")
        print("Gemini session ready", flush=True)

        try:

            async def receive_from_client():
                nonlocal last_frame_time
                try:
                    while True:
                        raw = await websocket.receive()

                        try:
                            if "bytes" in raw and raw["bytes"]:
                                # Binary = audio from mic
                                await gemini.send_realtime_input(
                                    audio=types.Blob(
                                        data=raw["bytes"],
                                        mime_type="audio/pcm;rate=16000",
                                    )
                                )

                            elif "text" in raw and raw["text"]:
                                msg = json.loads(raw["text"])

                                if msg["type"] == "video_frame":
                                    now = time.time()
                                    if now - last_frame_time < 1.0 / MAX_FRAMES_PER_SEC:
                                        continue
                                    last_frame_time = now

                                    await gemini.send_realtime_input(
                                        media=types.Blob(
                                            data=base64.b64decode(msg["data"]),
                                            mime_type="image/jpeg",
                                        )
                                    )

                                elif msg["type"] == "text_message":
                                    await gemini.send_client_content(
                                        turns=types.Content(
                                            role="user",
                                            parts=[types.Part(text=msg["text"])],
                                        ),
                                        turn_complete=True,
                                    )
                        except Exception as e:
                            # Log but keep the loop alive
                            print(f"Error forwarding to Gemini: {e}", flush=True)
                            continue

                except WebSocketDisconnect:
                    print("Client disconnected")
                except Exception as e:
                    print(f"Receive loop error: {e}", flush=True)

            async def send_to_client():
                try:
                    async for response in gemini.receive():
                        # Audio data
                        if response.data:
                            try:
                                await websocket.send_bytes(response.data)
                            except Exception:
                                break

                        # Server transcript (AI speech)
                        server_text = (
                            response.server_content
                            and response.server_content.model_turn
                            and response.server_content.model_turn.parts
                        )
                        if server_text:
                            for part in server_text:
                                if part.text:
                                    text = part.text
                                    if text.startswith("[SAFETY_ALERT]"):
                                        alert_msg = text[len("[SAFETY_ALERT]"):].strip()
                                        await websocket.send_json(
                                            {"type": "safety_alert", "message": alert_msg}
                                        )
                                    else:
                                        await websocket.send_json(
                                            {"type": "transcript", "text": text}
                                        )

                        # Output audio transcription
                        if (
                            response.server_content
                            and response.server_content.output_transcription
                            and response.server_content.output_transcription.text
                        ):
                            text = response.server_content.output_transcription.text
                            if text.startswith("[SAFETY_ALERT]"):
                                alert_msg = text[len("[SAFETY_ALERT]"):].strip()
                                await websocket.send_json(
                                    {"type": "safety_alert", "message": alert_msg}
                                )
                            else:
                                await websocket.send_json(
                                    {"type": "transcript", "text": text}
                                )

                        # Input audio transcription (user speech)
                        if (
                            response.server_content
                            and response.server_content.input_transcription
                            and response.server_content.input_transcription.text
                        ):
                            await websocket.send_json(
                                {
                                    "type": "user_transcript",
                                    "text": response.server_content.input_transcription.text,
                                }
                            )

                except Exception as e:
                    print(f"Send error: {e}")

            await asyncio.gather(receive_from_client(), send_to_client())
        finally:
            await session.__aexit__(None, None, None)

    except Exception as e:
        print(f"WS session error: {e}", flush=True)
        await send_error(f"Session error: {e}")
    finally:
        connections_per_ip[client_ip] = max(0, connections_per_ip[client_ip] - 1)
        try:
            await websocket.close()
        except Exception:
            pass
        print(f"WebSocket closed for {client_ip}")


# --- Static file serving ---

assets_path = os.path.join(BASE_DIR, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.get("/{rest_of_path:path}")
async def serve_frontend(rest_of_path: str):
    file_path = os.path.join(BASE_DIR, rest_of_path)
    if rest_of_path and os.path.isfile(file_path):
        return FileResponse(file_path)

    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)

    return {"error": "Index file not found"}
