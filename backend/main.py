import os
import re
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
from api_helpers import search_parts, search_youtube, search_guides

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

SYSTEM_PROMPT = """You are Fixit Lens, an expert AR home repair assistant. The user is showing you a live camera feed of something they want to fix.

Your expertise covers:
- Appliances: washers, dryers, dishwashers, refrigerators, ovens, microwaves
- Plumbing: faucets, toilets, pipes, water heaters, drains
- Electrical: outlets, switches, fixtures (always emphasize safety — recommend a licensed electrician for panel/wiring work)
- HVAC: thermostats, filters, vents, condensers
- Furniture: hinges, drawer slides, joints, upholstery
- General: drywall, paint, caulking, weather stripping

Your role:
- Identify what the user is showing you (appliance, electronics, plumbing, furniture, etc.)
- Provide clear, step-by-step repair guidance based on what you see
- Call out specific parts, screws, connectors, or components visible in the frame
- Suggest tools needed for the repair
- If you can't see clearly, ask the user to adjust the camera angle

## Step-by-Step Tracking
When you identify a multi-step repair procedure, emit structured step markers INLINE with your speech:

[STEPS_START] total=N
[STEP 1] Description of step 1
[STEP 2] Description of step 2
...
[STEPS_END]

As you watch the user perform steps and observe completion, emit:
[STEP_STATUS] current=N status="completed" message="Great, that's done!" [/STEP_STATUS]

Proactively confirm when you see the user complete a step. Be encouraging.

## Parts Identification
When you identify a specific part the user needs, emit:
[PART_ID] name="Part Name" model="ModelNumber" query="search query for buying this part" [/PART_ID]

Include the model number if visible on the part. Use a descriptive search query.

## Repair Topic
When you identify what the user is trying to repair, emit once:
[REPAIR_TOPIC] query="description of the repair" category="appliance|plumbing|electrical|hvac|furniture|general" [/REPAIR_TOPIC]

Safety rules (CRITICAL):
- If you see ANY safety hazard (water near electricity, exposed wires, gas leaks, structural danger, sharp edges near hands, etc.), you MUST prefix your response with exactly [SAFETY_ALERT] followed by a clear warning
- Always warn before the user could hurt themselves
- Prioritize safety over repair advice
- For electrical work beyond basic outlet/switch replacement, recommend a licensed electrician

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

# --- Marker parsing regexes ---
RE_STEPS = re.compile(
    r'\[STEPS_START\]\s*total=(\d+)(.*?)\[STEPS_END\]',
    re.DOTALL
)
RE_STEP_LINE = re.compile(r'\[STEP\s+(\d+)\]\s*(.*?)(?=\[STEP\s+\d+\]|\Z)', re.DOTALL)
RE_STEP_STATUS = re.compile(
    r'\[STEP_STATUS\]\s*current=(\d+)\s+status="([^"]+)"\s+message="([^"]+)"\s*\[/STEP_STATUS\]'
)
RE_PART_ID = re.compile(
    r'\[PART_ID\]\s*name="([^"]+)"\s*model="([^"]*)"\s*query="([^"]+)"\s*\[/PART_ID\]'
)
RE_REPAIR_TOPIC = re.compile(
    r'\[REPAIR_TOPIC\]\s*query="([^"]+)"\s*category="([^"]+)"\s*\[/REPAIR_TOPIC\]'
)
# Combined pattern to strip all markers from transcript
RE_ALL_MARKERS = re.compile(
    r'\[STEPS_START\].*?\[STEPS_END\]'
    r'|\[STEP_STATUS\].*?\[/STEP_STATUS\]'
    r'|\[PART_ID\].*?\[/PART_ID\]'
    r'|\[REPAIR_TOPIC\].*?\[/REPAIR_TOPIC\]',
    re.DOTALL
)

# --- Rate limiting ---

connections_per_ip: dict[str, int] = defaultdict(int)
MAX_CONNECTIONS_PER_IP = 3
MAX_FRAMES_PER_SEC = 2


async def parse_and_strip_markers(text: str, step_state: dict, searched_topics: set, websocket):
    """Parse markers from text, fire async tasks, return cleaned text."""
    # Parse step definitions
    steps_match = RE_STEPS.search(text)
    if steps_match:
        try:
            total = int(steps_match.group(1))
            body = steps_match.group(2)
            steps = []
            for m in RE_STEP_LINE.finditer(body):
                steps.append({
                    "number": int(m.group(1)),
                    "text": m.group(2).strip(),
                    "status": "pending",
                })
            if steps:
                steps[0]["status"] = "active"
                step_state["steps"] = steps
                step_state["current_step"] = 1
                step_state["total_steps"] = total
                await websocket.send_json({
                    "type": "step_update",
                    "steps": steps,
                    "current_step": 1,
                    "total_steps": total,
                    "message": "Repair steps identified",
                })
        except Exception:
            pass

    # Parse step status updates
    for m in RE_STEP_STATUS.finditer(text):
        try:
            current = int(m.group(1))
            status = m.group(2)
            message = m.group(3)
            if step_state.get("steps"):
                for s in step_state["steps"]:
                    if s["number"] == current:
                        s["status"] = status
                    elif s["number"] == current + 1 and status == "completed":
                        s["status"] = "active"
                if status == "completed":
                    step_state["current_step"] = current + 1
                await websocket.send_json({
                    "type": "step_update",
                    "steps": step_state["steps"],
                    "current_step": step_state["current_step"],
                    "total_steps": step_state["total_steps"],
                    "message": message,
                })
        except Exception:
            pass

    # Parse part identification — non-blocking
    for m in RE_PART_ID.finditer(text):
        try:
            name, model, query = m.group(1), m.group(2), m.group(3)
            asyncio.create_task(_send_part_info(websocket, name, model, query))
        except Exception:
            pass

    # Parse repair topic — non-blocking, deduplicated
    for m in RE_REPAIR_TOPIC.finditer(text):
        try:
            query = m.group(1)
            if query not in searched_topics:
                searched_topics.add(query)
                asyncio.create_task(_send_resources(websocket, query))
        except Exception:
            pass

    # Strip all markers from text
    cleaned = RE_ALL_MARKERS.sub('', text).strip()
    return cleaned


async def _send_part_info(websocket, name: str, model: str, query: str):
    """Look up buy links for a part and send to client."""
    try:
        buy_links = await search_parts(query)
        await websocket.send_json({
            "type": "part_identified",
            "name": name,
            "model_number": model,
            "buy_links": buy_links,
        })
    except Exception:
        pass


async def _send_resources(websocket, query: str):
    """Look up YouTube videos and repair guides, send to client."""
    try:
        youtube_results, guide_results = await asyncio.gather(
            search_youtube(query),
            search_guides(query),
        )
        await websocket.send_json({
            "type": "resources",
            "query": query,
            "youtube": youtube_results,
            "guides": guide_results,
        })
    except Exception:
        pass


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
    step_state: dict = {"steps": [], "current_step": 0, "total_steps": 0}
    searched_topics: set = set()
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

                                elif msg["type"] == "voice_command":
                                    command = msg.get("command", "")
                                    command_prompts = {
                                        "next": "I've completed this step. Let's move to the next one.",
                                        "back": "Can you go back to the previous step?",
                                        "repeat": "Can you repeat the current step instructions?",
                                    }
                                    prompt_text = command_prompts.get(command)
                                    if prompt_text:
                                        await gemini.send_client_content(
                                            turns=types.Content(
                                                role="user",
                                                parts=[types.Part(text=prompt_text)],
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
                        try:
                            # Audio data
                            if response.data:
                                await websocket.send_bytes(response.data)

                            # Detect interruption
                            if response.server_content and response.server_content.interrupted:
                                await websocket.send_json({"type": "interrupted"})

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
                                        cleaned = await parse_and_strip_markers(
                                            text, step_state, searched_topics, websocket
                                        )
                                        if not cleaned:
                                            continue
                                        if cleaned.startswith("[SAFETY_ALERT]"):
                                            alert_msg = cleaned[len("[SAFETY_ALERT]"):].strip()
                                            await websocket.send_json(
                                                {"type": "safety_alert", "message": alert_msg}
                                            )
                                        else:
                                            await websocket.send_json(
                                                {"type": "transcript", "text": cleaned}
                                            )

                            # Output audio transcription
                            if (
                                response.server_content
                                and response.server_content.output_transcription
                                and response.server_content.output_transcription.text
                            ):
                                text = response.server_content.output_transcription.text
                                cleaned = await parse_and_strip_markers(
                                    text, step_state, searched_topics, websocket
                                )
                                if cleaned:
                                    if cleaned.startswith("[SAFETY_ALERT]"):
                                        alert_msg = cleaned[len("[SAFETY_ALERT]"):].strip()
                                        await websocket.send_json(
                                            {"type": "safety_alert", "message": alert_msg}
                                        )
                                    else:
                                        await websocket.send_json(
                                            {"type": "transcript", "text": cleaned}
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

                        except WebSocketDisconnect:
                            print("Client disconnected during send", flush=True)
                            return
                        except Exception as e:
                            print(f"Error in send iteration: {e}", flush=True)
                            continue

                except Exception as e:
                    print(f"Gemini receive stream ended: {e}", flush=True)

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
