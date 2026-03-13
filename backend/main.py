import os
import json
import asyncio
import base64
from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google import genai
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Absolute path to the current directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize GenAI Client
api_key = os.environ.get("GOOGLE_API_KEY")
if not api_key:
    print("Warning: GOOGLE_API_KEY not found in environment")

client = genai.Client(
    api_key=api_key,
    http_options={'api_version': 'v1alpha'}
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connected")
    
    config = {"generation_config": {"response_modalities": ["TEXT"]}}
    
    try:
        async with client.live.connect(model="gemini-2.0-flash-live", config=config) as session:
            
            async def receive_from_client():
                try:
                    while True:
                        data = await websocket.receive_text()
                        msg = json.loads(data)
                        if msg['type'] == 'video_frame':
                            await session.send(input={"mime_type": "image/jpeg", "data": msg['data']}, end_of_turn=True)
                except Exception as e:
                    print(f"Receive from client error: {e}")

            async def send_to_client():
                try:
                    async for response in session.receive():
                        if response.text:
                            analysis = response.text
                            print(f"Analysis: {analysis[:50]}...")
                            
                            if "water" in analysis.lower() and "outlet" in analysis.lower():
                                await websocket.send_json({
                                    "type": "safety_alert",
                                    "message": "STOP! Water detected near an electrical outlet."
                                })

                            await websocket.send_json({
                                "type": "transcript",
                                "text": analysis
                            })
                except Exception as e:
                    print(f"Send to client error: {e}")

            await asyncio.gather(receive_from_client(), send_to_client())

    except Exception as e:
        print(f"WS Session Error: {e}")
    finally:
        await websocket.close()
        print("WebSocket closed")

# Serve assets explicitly
assets_path = os.path.join(BASE_DIR, "assets")
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

# Catch-all route for the frontend (SPA)
@app.get("/{rest_of_path:path}")
async def serve_frontend(rest_of_path: str):
    # If the path looks like a file (has an extension), try to serve it from root
    file_path = os.path.join(BASE_DIR, rest_of_path)
    if rest_of_path and os.path.isfile(file_path):
        return FileResponse(file_path)
    
    # Otherwise, serve index.html
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    raise HTTPException(status_code=404, detail="Index file not found")
