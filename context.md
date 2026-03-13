# Fixit Lens

AI-powered AR repair assistant using camera + mic + Gemini 2.0 Flash Live.

## Architecture
- **Backend**: FastAPI (Python) at `backend/main.py` - WebSocket `/ws` endpoint, serves built frontend
- **Frontend**: React 19 + TypeScript + Tailwind v4 + Vite 8 at `backend/frontend/`
- **AI**: Google Gemini 2.0 Flash Live API with audio + video real-time streaming
- **Build**: `npm run build` in `backend/frontend/` outputs to `backend/` (index.html + assets/)

## Running
```bash
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```
Needs `GOOGLE_API_KEY` in `backend/.env`

## Key Files
- `backend/main.py` - FastAPI server, WebSocket, Gemini integration (audio+video+text)
- `backend/frontend/src/App.tsx` - Main camera/mic/WebSocket/HUD/chat component
- `backend/frontend/src/components/LandingPage.tsx` - Landing page with loading state
- `backend/frontend/src/index.css` - Tailwind v4 (`@import "tailwindcss"`)
- `backend/frontend/vite.config.ts` - Builds to `../` (backend dir)

## Interaction Model
- User shows camera + speaks → Gemini sees video + hears audio → responds with voice + text transcript
- User can also type text messages
- Photo capture/freeze for detailed analysis
- Safety alerts for hazards (prefixed with `[SAFETY_ALERT]`)

## WebSocket Protocol
- **Text JSON types**: `video_frame`, `text_message`, `transcript`, `user_transcript`, `safety_alert`, `error`
- **Binary**: raw PCM audio bytes (mic→backend at 16kHz, backend→speaker at 24kHz)

## Notes
- Tailwind v4: uses `@import "tailwindcss"` not `@tailwind` directives
- HTML files use `class` not `className` (only JSX uses className)
- WebSocket URL is dynamic based on `location.host`
- `.env` file contains API key - do not commit
- Rate limiting: max 3 connections per IP, max 2 video frames/sec
- Gemini voice: Aoede with input/output audio transcription
