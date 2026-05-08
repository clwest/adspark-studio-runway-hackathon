# AdSpark Studio — Inventory

Snapshot of what is real, mocked, incomplete, and key-dependent.

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, router registration, `/health` |
| `app/config.py` | real | pydantic-settings, derives `openai_mock` / `runway_mock` from env |
| `app/models.py` | real | Pydantic schemas (concept, runway, campaign) |
| `app/services/concept_service.py` | real + mock fallback | OpenAI JSON-mode call with deterministic mock fallback |
| `app/services/runway_client.py` | real + mock | `httpx` against `api.dev.runwayml.com`; in-memory mock store with time-based progress |
| `app/services/storage.py` | real | JSON-file campaign store, threading.Lock |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | `POST /api/runway/generate`, `GET /api/runway/task/{id}` |
| `app/routers/campaigns.py` | real | `POST /api/campaigns`, `GET /api/campaigns` |
| `requirements.txt` | real | fastapi, uvicorn, pydantic, httpx, openai, python-dotenv |
| `.env.example` | real | `RUNWAY_API_KEY`, `RUNWAY_API_BASE`, `RUNWAY_API_VERSION`, `RUNWAY_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`, `DATA_DIR` |
| `data/campaigns.json` | real | Created lazily on first save |

## Frontend (`frontend/`)

| Path | Status | Notes |
|---|---|---|
| `vite.config.js` | real | Proxies `/api` and `/health` → `http://localhost:8000` |
| `tailwind.config.js`, `postcss.config.js`, `index.html` | real | Tailwind wired |
| `src/api.js` | real | Thin fetch wrapper |
| `src/App.jsx` | real | Orchestrates form → concepts → prompt → runway → save |
| `src/components/CampaignForm.jsx` | real | Inputs |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | Editable Runway prompt + Generate Video button |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>` preview, download link, save button |
| `src/components/CampaignGallery.jsx` | real | List of saved campaigns |
| MOCK MODE badge | real | Shown when `/health.any_mock === true` |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | Mock task store; success after ~12s; output is a public sample MP4 | Real Runway image-to-video task |

## Incomplete / out of scope

- No tests yet (verified manually via curl + browser).
- Single-process JSON storage only — fine for hackathon, not for concurrent deploys.
- No image upload UI; `promptImage` is wired in the request model but the form
  collects text only. Add an image input if Runway path requires an image input.
- No auth.
- Polling is client-side only; if the page is refreshed the task id is lost.
