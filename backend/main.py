import os
import json
from fastapi import FastAPI, WebSocket
from google_adk import LlmAgent, tools

app = FastAPI()

# Initialize the ADK Agent with Search Grounding
agent = LlmAgent(
    model="gemini-2.0-flash-live",
    persona="Lens: A calm, safety-conscious shop teacher.",
    tools=[tools.google_search],
    proactive_audio=True
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message['type'] == 'video_frame':
                # Process 1 FPS Frame
                analysis = await agent.process_vision(message['data'])
                
                # Hardcoded Safety Trigger
                if "water" in analysis.lower() and "outlet" in analysis.lower():
                    await websocket.send_json({
                        "type": "safety_alert",
                        "message": "STOP! Water detected near an electrical outlet."
                    })

                await websocket.send_json({
                    "type": "transcript",
                    "text": analysis.get('diagnosis', "Analyzing...")
                })
    except Exception as e:
        print(f"Connection closed: {e}")
    finally:
        await websocket.close()
