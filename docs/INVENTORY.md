# AdSpark Studio — Inventory

Snapshot of what is real, mocked, and key-dependent as of PR J
(submission docs refresh for `hackathon-submission-v4`).

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, `/health` (with `image_gen_mock`), router registration |
| `app/config.py` | real | pydantic-settings; PR-A vars + PR-F `runway_host_voice_preset` / `runway_host_portrait_url` |
| `app/models.py` | real | Pydantic schemas including `Campaign` with all PR-A → PR-I fields (Pack, Spokesperson, Audio Pack, Avatar Picker selection) |
| `app/services/concept_service.py` | real + mock fallback | OpenAI `gpt-4o-mini` JSON-mode call; deterministic mock |
| `app/services/runway_client.py` | real + mock | `image_to_video` / `text_to_video` routing; `GENERATION_POLICY` validation |
| `app/services/image_client.py` | real + mock | `/v1/text_to_image` (`gen4_image_turbo`); seeded `referenceImages`; stdlib zlib PNG mock |
| `app/services/finisher_service.py` | real | Local ffmpeg Campaign Pack (Landscape / Reels / Square) |
| `app/services/character_host_client.py` | real + mock | Phase 1 `/v1/avatars` + Phase 2 `/v1/avatar_videos`; image-source fallback chain; `active_avatar_id()` helper that prefers picker selection over `host_avatar_id` |
| `app/services/avatar_listing_client.py` | real + mock | `GET /v1/avatars` curation; 4 hard-coded mock presets with stdlib data-URI thumbnails (PR I+) |
| `app/services/realtime_avatar_client.py` | real + mock | `/v1/realtime_sessions` broker (PR I); creates + polls READY + returns client-safe `sessionKey`; mock raises `RealtimeUnavailableError` mapped to 503 |
| `app/services/audio_client.py` | real + mock | `/v1/voices` text design (Phase 1) + `/v1/voice_dubbing` (Phase 2); 29-language `SUPPORTED_DUB_LANGS`; ffmpeg lavfi mock MP3s |
| `app/services/storage.py` | real | JSON-file campaign store; threading.Lock; per-feature update helpers (cache / finish / host avatar / host video / brand voice / dub / selected avatar) |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | All `/api/runway/*` routes including `provider-status`, `organization`, `avatars` (list), `image`, `generate`, `task` |
| `app/routers/campaigns.py` | real | All `/api/campaigns/*` routes (16 of them, see endpoint table below) |
| `requirements.txt` | real | fastapi, uvicorn, pydantic, pydantic-settings, httpx, openai, python-dotenv |
| `.env.example` | real | All PR-A → PR-I knobs documented |
| `data/campaigns.json` | real | Created lazily on first save |
| `data/{images,videos,finished,host,audio}/` | real | Per-feature local caches, all gitignored via `backend/.gitignore: data/` |

## Frontend (`frontend/`)

| Path | Status | Notes |
|---|---|---|
| `vite.config.js` | real | Proxies `/api` and `/health` → `http://localhost:8000` |
| `tailwind.config.js`, `postcss.config.js`, `index.html` | real | Tailwind wired |
| `package.json` | real | Adds `@runwayml/avatars-react ^0.15.0` for realtime |
| `src/api.js` | real | Thin fetch wrapper; helpers for every backend route incl. `createSpokesperson`, `presentCampaign`, `designBrandVoice`, `dubBrandVoice`, `listAvatars`, `selectAvatar`, `startSpokespersonSession`, `endSpokespersonSession` |
| `src/settings.js` | real | localStorage persistence with safety clamps; `STORAGE_KEY = 'adspark.settings.v1'` |
| `src/errors.js` | real | `friendlyError(e, hint)` + `ERROR_HINTS` per call site (concepts / image / video / poll / save / finish / realtime) |
| `src/App.jsx` | real | Orchestrates form → concepts → image → video → save; loads + persists settings; wires ModeBanner with provider-status + organization |
| `src/components/CampaignForm.jsx` | real | Inputs |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | Editable prompt + model / ratio / duration selectors + text-only checkbox + Generate Reference Image button + settings chip row |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>`, save button |
| `src/components/CampaignGallery.jsx` | real | Cached MP4 preview, Campaign Pack section, **Brand Spokesperson** subsection (Avatar Picker + Create / Retry / Re-create), **Avatar Host Clip** subsection, **Audio Pack** subsection (Brand Voice + 10 dub languages exposed in UI), **Talk to Brand Spokesperson** subsection mounting `RealtimeSpokesperson.jsx` |
| `src/components/AvatarPicker.jsx` | real | PR I+ — fetches `/api/runway/avatars` on mount; 4-up grid of thumbnails; click → `POST /select-avatar` |
| `src/components/RealtimeSpokesperson.jsx` | real | PR I — lazy-loaded `<AvatarCall>` wrapper; idle / creating / live / ending / failed / gated states; mic-only V1; 5-min countdown |
| `src/components/ModeBanner.jsx` | real | Readiness chip, per-provider pills, optional credits/cap chip |
| `tests/adspark-smoke.spec.js` | real | Playwright single-shot mock-mode end-to-end; covers PR A–I assertions |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | All Runway flows mocked: image (stdlib PNG), video (in-memory task with sample MP4), avatar create (synthetic READY), avatar list (4 mock presets), host (ffmpeg lavfi placeholder), brand voice (silent MP3), dub (silent MP3 per lang), realtime (HTTP 503 with explanatory copy) | Real Runway end-to-end across all 11 endpoints |

`RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` are
*optional* PR-F knobs — defaults are `vincent` and a curated
Unsplash portrait URL.

## Endpoints (28 total)

```
GET    /health
GET    /api/runway/provider-status
GET    /api/runway/organization
GET    /api/runway/avatars                                  (PR I+)
POST   /api/concepts
POST   /api/runway/image
GET    /api/runway/image/{image_id}
POST   /api/runway/generate
GET    /api/runway/task/{task_id}
POST   /api/campaigns
GET    /api/campaigns
GET    /api/campaigns/{id}/video
POST   /api/campaigns/{id}/finish              (?format=landscape|reels|square)
GET    /api/campaigns/{id}/finished-video
GET    /api/campaigns/{id}/finished-video/{fmt}
POST   /api/campaigns/{id}/avatar                          (PR F — Phase 1 custom create)
POST   /api/campaigns/{id}/select-avatar                   (PR I+ — picker)
POST   /api/campaigns/{id}/host-video                      (PR F — Phase 2)
GET    /api/campaigns/{id}/host-video
POST   /api/campaigns/{id}/brand-voice                     (PR H — Audio Phase 1)
POST   /api/campaigns/{id}/dub                             (PR H — Audio Phase 2)
GET    /api/campaigns/{id}/audio/{kind}
POST   /api/campaigns/{id}/spokesperson-session            (PR I — realtime broker)
DELETE /api/campaigns/{id}/spokesperson-session/{session_id}
plus /openapi.json, /docs, /docs/oauth2-redirect, /redoc
```

## Out of scope (intentionally not implemented)

- WebRTC features beyond the V1 mic-only spokesperson call (webcam
  toggle, screen share, multi-participant rooms).
- Act-Two `/v1/character_performance` (wrong primitive — needs a
  driving performance video).
- Multi-character dialogue / avatar conversations.
- Custom voice cloning (`/v1/voices` audio-clone path) — voice text
  design covers the demo cleanly.
- Direct text-to-speech narration (`/v1/text_to_speech`) — gated
  `voice.type` discriminator. The Brand Voice + dub pipeline covers
  multilingual voice delivery instead.
- Audio mixing into ad clips. Host clip + voice MP3s stay sibling
  artefacts.
- Server-side `/v1/uploads` — public URL + data URI cover current
  paths.
- Stability.ai integration (`gen4_image_turbo` already covers
  reference image generation; documented in PR F session notes).
- Auth, multi-user, public deploy.
- Real-time refresh of `/provider-status` (read once on page load).
- Smart-framing for cross-aspect Pack crops.
- Background-task finishing (synchronous today, ~1–3 s per format).
- Avatar marketplace (only account-created customs are listable).
- Knowledge documents (`/v1/documents`) for grounded realtime
  conversation.
- Conversation transcripts (`/v1/avatar_conversations`).

See `SUBMISSION.md` "Future roadmap" and the PR-F / PR-H / PR-I
spike notes + capability map appendices for full deferred list.
