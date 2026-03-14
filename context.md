# Fixit Lens

AI-powered AR home repair assistant using camera + mic + Gemini 2.0 Flash Live.

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

Optional env vars for full features:
- `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID` — Parts buy links + repair guide search
- `YOUTUBE_API_KEY` — YouTube video guide search (falls back to GOOGLE_API_KEY)

## Key Files
- `backend/main.py` - FastAPI server, WebSocket, Gemini integration, marker parsing
- `backend/api_helpers.py` - Google CSE + YouTube API async helpers
- `backend/frontend/src/App.tsx` - Main camera/mic/WebSocket/HUD/chat/panels component
- `backend/frontend/src/components/LandingPage.tsx` - Landing page with loading state
- `backend/frontend/src/components/PanelSwitcher.tsx` - Bottom tab bar (Chat/Steps/Parts/Resources)
- `backend/frontend/src/components/StepTracker.tsx` - Step-by-step repair tracker + mini indicator
- `backend/frontend/src/components/PartCard.tsx` - Part identification cards + toast
- `backend/frontend/src/components/ResourcePanel.tsx` - YouTube + repair guide results
- `backend/frontend/src/index.css` - Tailwind v4 (`@import "tailwindcss"`)
- `backend/frontend/vite.config.ts` - Builds to `../` (backend dir)

## Interaction Model
- User shows camera + speaks → Gemini sees video + hears audio → responds with voice + text transcript
- User can also type text messages
- Photo capture/freeze for detailed analysis
- Safety alerts for hazards (prefixed with `[SAFETY_ALERT]`)
- AI emits inline markers for: step definitions, step status, part IDs, repair topics
- Markers are stripped from transcript before display; trigger async API lookups

## WebSocket Protocol
- **Text JSON types**: `video_frame`, `text_message`, `voice_command`, `transcript`, `user_transcript`, `safety_alert`, `error`, `status`, `interrupted`, `step_update`, `part_identified`, `resources`
- **Binary**: raw PCM audio bytes (mic→backend at 16kHz, backend→speaker at 24kHz)

## Features
- **Voice Interruption**: Gemini's interrupted signal flushes frontend audio queue instantly
- **Step Tracking**: AI identifies repair steps, tracks completion via live video
- **Parts Finder**: Identifies parts → Google CSE buy links (async, non-blocking)
- **Video Guides**: YouTube + repair guide search triggered by repair topic detection
- **Home Repair Specialization**: Appliances, plumbing, electrical, HVAC, furniture, general

## Notes
- Tailwind v4: uses `@import "tailwindcss"` not `@tailwind` directives
- HTML files use `class` not `className` (only JSX uses className)
- WebSocket URL is dynamic based on `location.host`
- `.env` file contains API key - do not commit
- Rate limiting: max 3 connections per IP, max 2 video frames/sec
- Gemini voice: Aoede with input/output audio transcription
- Marker-based architecture: markers inline with speech, stripped before display, API lookups never block audio
