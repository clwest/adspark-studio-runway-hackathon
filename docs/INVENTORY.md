# AdSpark Studio — Inventory

Snapshot of what is real, mocked, and key-dependent as of the
context-kit refresh after PR Y (newest-saved focus + card clarity).
Latest tag is `hackathon-submission-v6` at `50c2f8d`; main is six
commits ahead at `0e9391b` with PR V → PR W → PR X → PR Y merged.

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, `/health` (with `image_gen_mock`), router registration (incl. `characters_router`) |
| `app/config.py` | real | pydantic-settings; PR-A vars + PR-F `runway_host_voice_preset` / `runway_host_portrait_url` |
| `app/models.py` | real | Pydantic schemas including `Campaign` with all PR-A → PR-K fields (Pack, Spokesperson, Audio Pack, Avatar Picker selection, **`character_id` + `generated_character_prompt`**), and the new `Character`, `CharacterCreate`, `CharacterList` models with `template`, `voice_preset`, `portrait_url`, `runway_avatar_id`, `runway_avatar_status`, `runway_avatar_thumbnail_url`, `mock_mode`, `metadata` |
| `app/services/concept_service.py` | real + mock fallback | OpenAI `gpt-4o-mini` JSON-mode call; deterministic mock |
| `app/services/runway_client.py` | real + mock | `image_to_video` / `text_to_video` routing; `GENERATION_POLICY` validation |
| `app/services/image_client.py` | real + mock | `/v1/text_to_image` (`gen4_image_turbo`); seeded `referenceImages`; stdlib zlib PNG mock |
| `app/services/finisher_service.py` | real | Local ffmpeg Campaign Pack (Landscape / Reels / Square) **+ PR S/X Voiced Commercial mux** (`-stream_loop -1 -shortest` loops visual under host audio) |
| `app/services/character_host_client.py` | real + mock | Phase 1 `/v1/avatars` + Phase 2 `/v1/avatar_videos`; image-source fallback chain; **`active_avatar_id(campaign, settings)` resolves character > selected > host** (lazy-imports `CharacterStore` to avoid circular dependency) |
| `app/services/avatar_listing_client.py` | real + mock | `GET /v1/avatars` curation; 4 hard-coded mock presets with stdlib data-URI thumbnails (PR I+) |
| `app/services/realtime_avatar_client.py` | real + mock | `/v1/realtime_sessions` broker (PR I); creates + polls READY + returns client-safe `sessionKey`; uses `active_avatar_id`/`active_avatar_status` so character avatars win; mock raises `RealtimeUnavailableError` mapped to 503 |
| `app/services/audio_client.py` | real + mock | `/v1/voices` text design (Phase 1) + `/v1/voice_dubbing` (Phase 2); 29-language `SUPPORTED_DUB_LANGS`; ffmpeg lavfi mock MP3s |
| `app/services/character_studio_client.py` | real + mock | **PR K** — `PORTRAIT_TEMPLATES` (4 locked: mascot, founder, coach, local_guide); `build_prompt()`; `generate_portrait()` calls `/v1/text_to_image` w/ `gen4_image_turbo`; `create_avatar()` reads cached portrait → data URI → `POST /v1/avatars` → poll READY; mock writes stdlib zlib PNG + synthetic READY avatar reusing portrait as thumbnail; result dataclasses (`PortraitResult`, `AvatarBindingResult`) never raise |
| `app/services/character_store.py` | real | **PR K** — JSON-file Character store at `backend/data/characters.json`; threading.Lock; atomic writes via `.tmp` suffix + `replace`; `_slugify()` for human-readable slugs; portrait/thumbnail file path helpers |
| `app/services/storage.py` | real | JSON-file campaign store; threading.Lock; per-feature update helpers (cache / finish / host avatar / host video / brand voice / dub / selected avatar / **`update_character_attachment`**) |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | All `/api/runway/*` routes including `provider-status`, `organization`, `avatars` (list), `image`, `generate`, `task` |
| `app/routers/campaigns.py` | real | All `/api/campaigns/*` routes (19 now — adds `attach-character` PR K + `commercial-with-voice` POST/GET PR S/X + DELETE campaign PR N) |
| `app/routers/runway.py` | real (refreshed) | `/api/runway/*` — adds `POST /upload-image` for the PR R Visual Source upload path |
| `app/routers/characters.py` | real | **PR K** — 7 character routes: list, create, get, generate-portrait, create-avatar, portrait stream, delete; validates template against `PORTRAIT_TEMPLATES` and voice preset against `SUPPORTED_VOICE_PRESETS`; 409 when create-avatar fires before generate-portrait |
| `requirements.txt` | real | fastapi, uvicorn, pydantic, pydantic-settings, httpx, openai, python-dotenv |
| `.env.example` | real | All PR-A → PR-I knobs documented |
| `data/campaigns.json` | real | Created lazily on first save |
| `data/characters.json` | real | **PR K** — created lazily on first character create |
| `data/{images,videos,finished,host,audio,characters}/` | real | Per-feature local caches, all gitignored via `backend/.gitignore: data/` |

## Frontend (`frontend/`)

| Path | Status | Notes |
|---|---|---|
| `vite.config.js` | real | Proxies `/api` and `/health` → `http://localhost:8000` |
| `tailwind.config.js`, `postcss.config.js`, `index.html` | real | Tailwind wired |
| `package.json` | real | Adds `@runwayml/avatars-react ^0.15.0` for realtime |
| `src/api.js` | real | Thin fetch wrapper; helpers for every backend route incl. `createSpokesperson`, `presentCampaign`, `designBrandVoice`, `dubBrandVoice`, `listAvatars`, `selectAvatar`, `startSpokespersonSession`, `endSpokespersonSession`, **`listCharacters`, `createCharacter`, `generateCharacterPortrait`, `createCharacterAvatar`, `deleteCharacter`, `attachCharacter`** (PR K) |
| `src/settings.js` | real | localStorage persistence with safety clamps; `STORAGE_KEY = 'adspark.settings.v1'` |
| `src/errors.js` | real | `friendlyError(e, hint)` + `ERROR_HINTS` per call site (concepts / image / video / poll / save / finish / realtime) |
| `src/App.jsx` | real | Orchestrates form → concepts → image → video → save; loads + persists settings; wires ModeBanner with provider-status + organization; **mounts `<CharacterStudio onCharactersChanged={refreshCampaigns}/>` between RunwayPanel and CampaignGallery** (PR K) |
| `src/components/CampaignForm.jsx` | real | Inputs |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | Editable prompt + model / ratio / duration selectors + text-only checkbox + Generate Reference Image button + settings chip row |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>`, save button |
| `src/components/CampaignGallery.jsx` | real | Cached MP4 preview, Campaign Pack section, **Brand Spokesperson** subsection (Avatar Picker + Create / Retry / Re-create + **PR K Attach Character affordance + Attached Character display + lazy-loaded character library** + hides Avatar Picker / Create Custom while a character is bound), **Avatar Host Clip** subsection, **Audio Pack** subsection, **Talk to Brand Spokesperson** subsection mounting `RealtimeSpokesperson.jsx`. `avatarReady` derives from `characterAvatarReady \|\| hasSelection \|\| customReady`. |
| `src/components/AvatarPicker.jsx` | real | PR I+ — fetches `/api/runway/avatars` on mount; 4-up grid of thumbnails; click → `POST /select-avatar` |
| `src/components/RealtimeSpokesperson.jsx` | real | PR I — lazy-loaded `<AvatarCall>` wrapper; idle / creating / live / ending / failed / gated states; mic-only V1; 5-min countdown |
| `src/components/CharacterStudio.jsx` | real | **PR K** — top-level studio panel: header + `+ Create Character` toggle, inline create form (name / template / subject / style / voice_preset / personality), auto-runs portrait generation immediately after create, character library grid (`CharacterCard` instances), per-character `busyByChar` action map |
| `src/components/CharacterCard.jsx` | real | **PR K** — single tile component reused in studio library and per-campaign attach picker; portrait → name → template/voice → status pill (`avatar ready` / `mock` / `failed` / `pending`) → context-aware action row (Generate Portrait / Create Avatar / Use Character / Detach / delete); `compact` mode for inline picker |
| `src/components/ModeBanner.jsx` | real | Readiness chip, per-provider pills, optional credits/cap chip |
| `tests/adspark-smoke.spec.js` | real | Playwright single-shot mock-mode end-to-end; covers PR A–K assertions including **Character Studio panel + `+ Create Character` button render** |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | All Runway flows mocked: image (stdlib PNG), video (in-memory task with sample MP4), avatar create (synthetic READY), avatar list (4 mock presets), host (ffmpeg lavfi placeholder), brand voice (silent MP3), dub (silent MP3 per lang), **character portrait (stdlib PNG), character avatar (synthetic READY reusing portrait as thumbnail)**, realtime (HTTP 503 with explanatory copy) | Real Runway end-to-end across all 11 endpoints (Character Studio shares `gen4_image_turbo` and `/v1/avatars` with the existing pipeline) |

`RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` are
*optional* PR-F knobs — defaults are `vincent` and a curated
Unsplash portrait URL.

## Endpoints (36 application + 4 FastAPI built-ins = 40 total)

```
GET    /health
GET    /api/runway/provider-status
GET    /api/runway/organization
GET    /api/runway/avatars                                  (PR I+)
POST   /api/concepts
POST   /api/runway/image
GET    /api/runway/image/{image_id}
POST   /api/runway/upload-image                             (PR R — Visual Source upload path; multipart)
POST   /api/runway/generate
GET    /api/runway/task/{task_id}
POST   /api/campaigns
GET    /api/campaigns
DELETE /api/campaigns/{id}                                  (PR N — local delete + cache cleanup)
GET    /api/campaigns/{id}/video
POST   /api/campaigns/{id}/finish              (?format=landscape|reels|square)
GET    /api/campaigns/{id}/finished-video
GET    /api/campaigns/{id}/finished-video/{fmt}
POST   /api/campaigns/{id}/commercial-with-voice            (PR S + PR X — auto-host + loop visual + mux)
GET    /api/campaigns/{id}/commercial-with-voice            (FileResponse for the cached MP4)
POST   /api/campaigns/{id}/avatar                          (PR F — Phase 1 custom create)
POST   /api/campaigns/{id}/select-avatar                   (PR I+ — picker)
POST   /api/campaigns/{id}/attach-character                (PR K — null detaches)
POST   /api/campaigns/{id}/host-video                      (PR F — Phase 2; uses character > selected > host)
GET    /api/campaigns/{id}/host-video
POST   /api/campaigns/{id}/brand-voice                     (PR H — Audio Phase 1)
POST   /api/campaigns/{id}/dub                             (PR H — Audio Phase 2)
GET    /api/campaigns/{id}/audio/{kind}
POST   /api/campaigns/{id}/spokesperson-session            (PR I — realtime broker)
DELETE /api/campaigns/{id}/spokesperson-session/{session_id}
GET    /api/characters                                     (PR K)
POST   /api/characters                                     (PR K — create record)
GET    /api/characters/{id}                                (PR K)
POST   /api/characters/{id}/generate-portrait              (PR K + PR V — gen4_image_turbo with editable Portrait Prompt)
POST   /api/characters/{id}/create-avatar                  (PR K — /v1/avatars)
GET    /api/characters/{id}/portrait                       (PR K — FileResponse)
DELETE /api/characters/{id}                                (PR K — local delete only)
plus /openapi.json, /docs, /docs/oauth2-redirect, /redoc
```

## Avatar resolution chain (PR K)

When Avatar Host Clip, Audio Pack delivery, or Realtime Spokesperson
fires, the active avatar id is resolved in this order:

```
character.runway_avatar_id   ─ wins when a character is attached
  > selected_avatar_id        ─ wins when picker selection exists
    > host_avatar_id           ─ falls back to per-campaign custom avatar
```

Implemented in `character_host_client.active_avatar_id(campaign,
settings)` and `active_avatar_status(campaign, settings)`. Both are
called by host-video and `realtime_avatar_client.create_session`.

## Feature stack since v5

| PR | Title | Surface |
|---|---|---|
| PR R | Visual Source flow | `/api/runway/upload-image`; explicit Generate / Upload / Use Character / Text-only radios in PromptPreview; CharacterStudio reachable via "Open Character Studio" CTA inside the picker. |
| PR S | Commercial with Voice | `POST + GET /api/campaigns/{id}/commercial-with-voice`; ffmpeg loops cached visual under host audio; `voiced_commercial_url` persisted on campaign. |
| PR T | Structured Runway Prompt Builder | Frontend `promptBuilder.simplifyFromConcept`; "structured prompt" hint chip + Simplify Prompt button in `PromptPreview`. |
| PR U | Spokesperson-first flow | Stage 1 = Spokesperson, Stage 2 = Brief, Stage 3 = Visual, Stage 4 = Saved. `loadActiveSpokespersonId` persists choice; `handleSaveCampaign` auto-attaches active character. |
| PR V | Portrait Prompt control | `CharacterStudio.jsx` create form exposes the structured Portrait Prompt textarea with reset-to-default + dirty mark + helper text. |
| PR W | Character visual-source bugfix | `runway.py` generate route now actually receives the character portrait when "Use Character" is the visual source. |
| PR X | Auto-voiced commercial | `commercial-with-voice` POST auto-creates Avatar Host Clip when missing if a spokesperson is ready; ffmpeg uses `-stream_loop -1 -shortest` so visual loops under audio (no early cutoff). |
| PR Y | Newest saved campaign focus + card clarity | `App.jsx` tracks `newestSavedId`; `CampaignGallery` renders "just saved" pill + ring/glow + scrolls into view + opens on Visuals; Overview body adds short campaign id, spokesperson name, 80-char `runway_prompt` preview. |

## Known limitations (current main)

- **Video duration:** single Runway visual cut at 5 s (`gen4_turbo`)
  or 5–10 s (`gen4.5`). The Voiced Commercial loops that cut for the
  duration of the host clip narration (~8–12 s typical), so the
  final ad is locked to ~12 s max.
- **`-stream_loop -1 -shortest` artefact:** observed on a hero run
  the video stream ran ~2 s past audio (13.08 s vs 10.94 s) due to
  libx264 GOP boundary alignment. Acceptable for V1 demo; documented
  as a known limitation, not a blocker.
- **Single locked aspect:** the Voiced Commercial inherits the source
  aspect; the Campaign Pack's Reels / Square crops are not yet wired
  through the voiced-commercial mux.
- **Audio narration is the host clip only.** Brand Voice + dubs are
  shipped as sibling samples, not the ad voice track.
- **No multi-shot generation, no character continuity across shots,
  no audio-first timeline, no storyboard UI** — these are exactly
  what the longer-video research phase will explore. See
  `docs/handoffs/SESSION_010_LONGER_VIDEO_PREP.md`.

## Current demo path (post PR Y)

1. Stage 1 — pick or create a Character (Brewster the Raccoon ships
   as the canonical demo identity).
2. Stage 2 — fill the brief; concepts auto-generate and the structured
   prompt opens in the textarea.
3. Stage 3 — pick Visual Source = Use Character (so the portrait
   becomes the `prompt_image`); click Generate Video; wait for
   SUCCEEDED (~12 s mock / 60–90 s real).
4. Click Save Campaign Card — the saved campaign card now scrolls
   into view, opens on Visuals, and renders a "just saved" pill +
   ring/glow.
5. Click Build Voiced Commercial — host clip auto-generates, ffmpeg
   muxes loop + audio, the final voiced ad MP4 plays inline.
6. Optional: Build Campaign Pack (Landscape / Reels / Square),
   Design Brand Voice, sample dubs, Talk to Brand Spokesperson.

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
- **Character Studio K.5 polish** — PATCH character (rename / change
  voice / edit personality), `replace-avatar` route (DELETE old
  Runway avatar + create new), "Create Character from this
  Campaign" gallery affordance.
- **Character Studio Phase L** — character-driven campaign generation
  (start a campaign pre-attached to a character; use the character
  image as the reference image for video generation).
- **Character Studio Phase M** — character pack export/import,
  marketplace, public sharing.

See `SUBMISSION.md` "Future roadmap" and the PR-F / PR-H / PR-I /
PR-K spike notes + capability map appendices for full deferred list.
