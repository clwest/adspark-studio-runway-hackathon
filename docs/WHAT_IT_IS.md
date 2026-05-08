# AdSpark Studio — What It Is

A RunwayML hackathon build. AdSpark is **AI Campaign + Character
Studio** — a user enters a business / product / tone / audience and
gets a complete cinematic ad package, **plus a reusable AI brand
character** (mascot / founder / coach / local guide) that becomes a
Runway Avatar and can be reused across every campaign, host clip,
voiceover, and live "Talk to your spokesperson" call — all powered
by Runway's API.

## What AdSpark generates per campaign

1. **3 ad concepts** — title, hook, visual direction, caption, CTA.
2. **Recommended Runway prompt** — auto-derived from the chosen
   concept, editable before submission.
3. **Runway reference image** — `gen4_image_turbo` synthesised from
   the prompt; cached locally.
4. **Runway video** — `gen4.5` (text or image) or `gen4_turbo`
   (image-to-video), selectable model + ratio + duration with
   backend policy validation.
5. **Local cache** — saved campaigns download the presigned MP4 to
   disk so they survive Runway's URL expiry.
6. **Campaign Pack** — three platform-tuned MP4s built by local
   ffmpeg: Landscape 1280×720, Reels 720×1280, Square 960×960, with
   title + CTA overlays.
7. **Reusable Brand Character (PR K)** — first-class resource living
   in its own JSON store. `gen4_image_turbo` generates a portrait
   from one of four locked templates (`mascot`, `founder`, `coach`,
   `local_guide`); `/v1/avatars` binds the cached portrait into a
   Runway Avatar. Attach the same character to any campaign;
   detach is a single null-write.
8. **Brand Spokesperson Avatar** — per-campaign Runway Avatar
   created from the campaign's reference image (or stock-portrait
   fallback). Persisted on the campaign with thumbnail + image-source
   label. Falls back when no character is attached.
9. **Avatar Picker** — `GET /v1/avatars` proxy (with 4 mock-mode
   presets) lets users reuse any avatar their account has already
   paid to create — including the avatars created via Phase K
   characters. Selection wins over per-campaign custom avatars.
10. **Avatar Host Clip** — short MP4 of the spokesperson speaking the
    campaign pitch via Runway `avatar_videos`. Resolution chain:
    `character.runway_avatar_id > selected_avatar_id >
    host_avatar_id`. Cached locally.
11. **Brand Voice** — custom voice designed via Runway `voices`
    text-design. Preview MP3 cached locally.
12. **Multilingual Dub Pack** — Brand Voice preview re-voiced into
    one of 29 ISO 639-1 languages via Runway `voice_dubbing`.
13. **Realtime Spokesperson** — live 5-min WebRTC conversation with
    the active avatar (same resolution chain) via Runway
    `realtime_sessions`.

## Stack

- **Backend**: FastAPI + Pydantic v2 + httpx
- **Frontend**: React 18 + Vite 5 + Tailwind 3 +
  `@runwayml/avatars-react` (lazy-loaded) for realtime
- **Storage**: JSON files at `backend/data/campaigns.json` and
  `backend/data/characters.json` (single-process, threading.Lock,
  atomic writes via `.tmp` suffix + `replace`)
- **Local-only cache** (every artefact gitignored, never committed):
  - `backend/data/images/` — generated reference images
  - `backend/data/videos/` — saved campaign videos
  - `backend/data/finished/` — Campaign Pack outputs
  - `backend/data/host/` — Avatar Host Clips
  - `backend/data/audio/` — Brand Voice previews + per-language dubs
  - `backend/data/characters/` — character portrait PNGs
    (`<id>-portrait.png`)
- **Finishing**: ffmpeg 7.1 (scale-cover + crop + drawtext for the
  Campaign Pack; lavfi-anullsrc / color + drawtext for mock audio +
  host-video placeholders)
- **Tests**: Playwright + Chromium, single-shot, single-worker
- **External APIs (optional)**:
  - OpenAI (concept generation, `gpt-4o-mini` default — defaults to
    deterministic mock when no key)
  - Runway (`api.dev.runwayml.com`, version header `2024-11-06`):
    - `/v1/text_to_image` (`gen4_image_turbo`)
    - `/v1/image_to_video`, `/v1/text_to_video`
    - `/v1/avatars` create + list
    - `/v1/avatar_videos`
    - `/v1/voices` (text design)
    - `/v1/voice_dubbing`
    - `/v1/realtime_sessions` (WebRTC broker)
    - `/v1/tasks/{id}` (shared polling)
    - `/v1/organization` (read-only metadata)

## Mock vs Real

The app **runs without any keys** in deterministic mock mode:

| Stage | Without key | With key |
|---|---|---|
| Concepts | Deterministic mock derived from inputs | `gpt-4o-mini` JSON-mode response |
| Reference image | Stdlib zlib PNG written locally | `gen4_image_turbo` task + downloaded PNG |
| Video task | In-memory mock; succeeds in ~12 s with public sample MP4 | Real `image_to_video` / `text_to_video` |
| Character portrait | Stdlib zlib PNG written locally (sha256-derived flat colour) | Real `gen4_image_turbo` 1280×720 portrait via locked template prompt |
| Character → Runway Avatar | Synthetic `mock_char_avatar_…` id + cached portrait reused as thumbnail data URI | Real `POST /v1/avatars` from cached portrait (data URI, ≤5 MB), poll READY |
| Brand Spokesperson Avatar | Synthetic READY avatar + stdlib PNG thumbnail | Real `/v1/avatars` create + processing-poll to READY |
| Avatar Picker | 4 hard-coded preset entries with stdlib data-URI thumbnails | Real `GET /v1/avatars` (account customs incl. character avatars) |
| Avatar Host Clip | ffmpeg lavfi 5 s 720×720 silent placeholder | Real `/v1/avatar_videos` + downloaded MP4 (uses character > selected > host avatar) |
| Brand Voice | ffmpeg lavfi 3 s silent MP3 placeholder | Real `/v1/voices` text-design + downloaded preview MP3 |
| Multilingual Dub | ffmpeg lavfi 3 s silent MP3 placeholder per lang | Real `/v1/voice_dubbing` + downloaded MP3 |
| Realtime Spokesperson | HTTP 503 from broker; UI button disabled with copy | Real `/v1/realtime_sessions` broker; client-safe `sessionKey` returned (uses same resolution chain) |
| Campaign Pack | Same local ffmpeg in both modes (no provider call needed) | Same |

Mock state surfaces in `GET /health` (`openai_mock`, `runway_mock`,
`image_gen_mock`, `any_mock`) and `GET /api/runway/provider-status`.
The frontend renders a `MOCK MODE` chip whenever `any_mock` is true
and a Mode-banner readiness chip:

- `demo mode` (amber) — both providers mocked.
- `demo ready · concepts mocked` (emerald) — Runway live, OpenAI
  mocked.
- `demo ready · all live` (emerald) — both live.
- `backend down` (rose) — `/health` returned non-ok.

## Behavioral guardrails

- **No third-party calls fire on page load.** Real Runway calls only
  fire on explicit user click. The optional
  `/api/runway/organization` read-only metadata fetch is the sole
  exception, and it's non-blocking — failures land in the response
  body and the UI stays silent.
- **Pre-flight policy validation.** Backend rejects unsupported
  model / ratio / duration / missing-image / unsupported-language
  / unsupported-voice-preset combinations with `HTTP 400` *before*
  any outbound HTTP. See `runway_client.GENERATION_POLICY` and
  `audio_client.SUPPORTED_DUB_LANGS`.
- **Honest fallbacks.** Avatar processing fails openly when the
  campaign image has no face — UI offers "Retry with stock portrait"
  (which now correctly overrides the source — fixed in PR-I+ commit).
  Image-source labels (`campaign` / `override` / `stock`) stay on the
  campaign record so the demo story stays accurate.
- **Polling**: 5 s interval + 0–800 ms jitter, capped at 60 attempts
  (~5 min); terminal states (`SUCCEEDED | FAILED | CANCELED`) stop
  polling immediately. Avatar processing has its own 90 s cap.
  Realtime READY poll has a 30 s cap.
- **Realtime session 5-min hard cap.** Runway's `expiresAt` is the
  ceiling; the frontend countdown surfaces it.
- **Settings persistence**: model / ratio / duration / textOnly /
  imageUrl in `localStorage` under `adspark.settings.v1` — clamped
  on restore so old or invalid combinations never survive a restart.
- **Keys live only in the repo-root `.env`** (gitignored). The React
  app has no key access — every Runway call goes through FastAPI.
  Local `/api/runway/image/<id>` URLs are converted to base64 data
  URIs server-side before being posted to Runway. Realtime
  credentials use a one-shot `sessionKey` JWT minted by the broker;
  the secret never reaches the browser.
- **CORS allowlist** defaults to `http://localhost:5173`.
- **Standalone repo.** `unified-donkey-betz` was inspected read-only
  for ffmpeg subprocess pattern shape during PR-pre-A bootstrap;
  nothing was copied verbatim and no runtime import / dependency
  exists.
