# AdSpark Studio — Inventory

Snapshot of what is real, mocked, and key-dependent as of PR G
(Brand Spokesperson Avatar + Avatar Host Clip submission docs).

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, `/health` (now includes `image_gen_mock`), router registration |
| `app/config.py` | real | pydantic-settings; derives `openai_mock` / `runway_mock`; PR F vars `runway_host_voice_preset`, `runway_host_portrait_url` |
| `app/models.py` | real | Pydantic schemas including `RunwayGenerateRequest` (with `model` field), `Campaign` (with `finished_videos` + `host_*` fields) |
| `app/services/concept_service.py` | real + mock fallback | OpenAI `gpt-4o-mini` JSON-mode call; deterministic mock fallback |
| `app/services/runway_client.py` | real + mock | `image_to_video` / `text_to_video` routing; `GENERATION_POLICY` validation; local image URL → data URI conversion |
| `app/services/image_client.py` | real + mock | `/v1/text_to_image` (`gen4_image_turbo`); seeded `referenceImages` (≥1 entry required); stdlib zlib PNG mock |
| `app/services/finisher_service.py` | real | Local ffmpeg Campaign Pack (Landscape 1280×720, Reels 720×1280, Square 960×960); `scale=W:H:force_original_aspect_ratio=increase,crop=W:H` + drawtext |
| `app/services/character_host_client.py` | real + mock | Phase 1: `/v1/avatars` with image-source fallback chain (override → campaign → stock). Phase 2: `/v1/avatar_videos` with `model:gwm1_avatars`, `avatar:{type:custom,avatarId}`, `speech:{type:text,text}`. Mock: stdlib PNG + ffmpeg lavfi MP4. |
| `app/services/storage.py` | real | JSON-file campaign store; threading.Lock; helpers `update_cache_fields`, `update_finish_fields`, `update_host_avatar_fields`, `update_host_video_fields` |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | `POST /api/runway/generate`, `GET /api/runway/task/{id}`, `POST /api/runway/image`, `GET /api/runway/image/{id}`, `GET /api/runway/provider-status`, `GET /api/runway/organization` |
| `app/routers/campaigns.py` | real | `POST /api/campaigns`, `GET /api/campaigns`, `GET /{id}/video`, `POST /{id}/finish?format=…`, `GET /{id}/finished-video`, `GET /{id}/finished-video/{fmt}`, `POST /{id}/avatar`, `POST /{id}/host-video`, `GET /{id}/host-video` |
| `requirements.txt` | real | fastapi, uvicorn, pydantic, pydantic-settings, httpx, openai, python-dotenv |
| `.env.example` | real | `RUNWAY_API_KEY`, `RUNWAY_API_BASE`, `RUNWAY_API_VERSION`, `RUNWAY_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ALLOWED_ORIGINS`, `DATA_DIR` (PR F also reads `RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` if set) |
| `data/campaigns.json` | real | Created lazily on first save |
| `data/{images,videos,finished,host}/` | real | Local caches, all gitignored via `backend/.gitignore: data/` |

## Frontend (`frontend/`)

| Path | Status | Notes |
|---|---|---|
| `vite.config.js` | real | Proxies `/api` and `/health` → `http://localhost:8000` |
| `tailwind.config.js`, `postcss.config.js`, `index.html` | real | Tailwind wired |
| `src/api.js` | real | Thin fetch wrapper; helpers for every backend route incl. `createSpokesperson`, `presentCampaign` |
| `src/settings.js` | real | localStorage persistence with safety clamps; `STORAGE_KEY = 'adspark.settings.v1'` |
| `src/errors.js` | real | `friendlyError(e, hint)` + `ERROR_HINTS` per call site |
| `src/App.jsx` | real | Orchestrates form → concepts → image → video → save; loads + persists settings; wires ModeBanner with provider-status + organization |
| `src/components/CampaignForm.jsx` | real | Inputs |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | Editable prompt + model / ratio / duration selectors + text-only checkbox + Generate Reference Image button + settings chip row |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>`, save button (`Saved · cached locally`) |
| `src/components/CampaignGallery.jsx` | real | Cached MP4 preview, Campaign Pack section (3 build buttons), **Brand Spokesperson** subsection (Create / Retry / Re-create + thumbnail + id + source label), **Avatar Host Clip** subsection (Present Campaign + inline preview) |
| `src/components/ModeBanner.jsx` | real | Readiness chip, per-provider pills, optional credits/cap chip |
| `tests/adspark-smoke.spec.js` | real | Playwright single-shot mock-mode end-to-end |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | All Runway flows mocked: image (stdlib PNG), video (in-memory task with sample MP4), avatar (synthetic READY), host (ffmpeg lavfi placeholder) | Real Runway end-to-end across all five surfaces |

`RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` are
*optional* PR-F knobs — defaults are `vincent` and a curated
Unsplash portrait URL.

## Endpoints (21 total)

```
GET  /health
GET  /api/runway/provider-status
GET  /api/runway/organization
POST /api/concepts
POST /api/runway/image
GET  /api/runway/image/{image_id}
POST /api/runway/generate
GET  /api/runway/task/{task_id}
POST /api/campaigns
GET  /api/campaigns
GET  /api/campaigns/{id}/video
POST /api/campaigns/{id}/finish              (?format=landscape|reels|square)
GET  /api/campaigns/{id}/finished-video
GET  /api/campaigns/{id}/finished-video/{fmt}
POST /api/campaigns/{id}/avatar              (PR F — Phase 1)
POST /api/campaigns/{id}/host-video          (PR F — Phase 2)
GET  /api/campaigns/{id}/host-video
plus /openapi.json, /docs, /docs/oauth2-redirect, /redoc
```

## Out of scope (intentionally not implemented)

- WebRTC / `/v1/realtime_sessions` — async `avatar_videos` covers V1.
- Act-Two `/v1/character_performance` — wrong primitive (needs driving
  performance video).
- Multi-character dialogue / avatar conversations.
- Custom voice cloning (`/v1/voices`).
- Audio mixing (host clip stays a sibling artifact).
- Server-side `/v1/uploads` — public URL + data URI cover current paths.
- Stability.ai integration (`gen4_image_turbo` already covers reference
  image generation; documented in PR F session notes).
- Auth, multi-user, public deploy.
- Real-time refresh of `/provider-status` (read once on page load only).
- Smart-framing for cross-aspect Pack crops.
- Background-task finishing (synchronous today, ~1–3 s per format).

See `SUBMISSION.md` "Future roadmap" and the PR F spike note for full
deferred list.
