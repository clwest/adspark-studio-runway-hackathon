# AdSpark Studio — What It Is

A same-day RunwayML hackathon build. A user enters a business / product / tone /
audience and gets a cinematic short-ad package:

1. **3 ad concepts** (title, hook, visual, caption, CTA)
2. **One recommended Runway video prompt** (editable before submission)
3. **Runway generation task** created on demand (only on user click)
4. **Polled task status** with progress + final video preview
5. **Saved campaign card** (concept + prompt + video URL + social post copy)

## Stack
- Backend: FastAPI + Pydantic + httpx
- Frontend: React + Vite + Tailwind
- Storage: JSON file (`backend/data/campaigns.json`)
- External APIs (optional):
  - OpenAI (concept generation, gpt-4o-mini default)
  - Runway (`api.dev.runwayml.com`, model `gen4_turbo`, version header `2024-11-06`)

## Mock vs Real
The app **runs without any keys** in deterministic mock mode:

| Service | Without key | With key |
|---|---|---|
| OpenAI | Deterministic mock concepts derived from inputs | `gpt-4o-mini` JSON-mode response |
| Runway | In-memory mock task; "succeeds" after ~12s with a public sample MP4 | Real `POST /v1/image_to_video` + `GET /v1/tasks/{id}` |

Mock state surfaces in `GET /health` (`openai_mock`, `runway_mock`, `any_mock`)
and the frontend renders a **MOCK MODE** badge whenever `any_mock` is true.

## Behavioral guardrails
- No third-party calls fire on page load — only on explicit user actions.
- Polling: 5s interval + jitter, capped at 60 attempts (~5 min); terminal states
  (`SUCCEEDED | FAILED | CANCELED`) stop polling immediately.
- Keys live only in `backend/.env`; the React app talks to FastAPI through the
  Vite dev proxy. No keys ever ship to the browser.
- CORS allowlist defaults to `http://localhost:5173`.
