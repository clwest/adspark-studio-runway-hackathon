# AdSpark Studio — Hackathon Submission

## Project name
**AdSpark Studio**

## One-line pitch
Type a business idea, get a Runway-powered Campaign Pack **plus a
reusable AI Brand Spokesperson, a multilingual voice, and a live
"Talk to your spokesperson" call** — every artefact cached locally —
in under five minutes.

## Why this matters

Brands don't just need ads — they need **campaign assets, reusable
spokespeople, multilingual voice delivery, and an interactive
presence**. Production teams normally cobble these together from four
or five tools and a Premiere session. AdSpark Studio collapses them
into a single click-driven flow built on top of Runway's API:
campaign assets, platform-tuned creative, a custom Brand Voice with
29-language dubs, a reusable Brand Spokesperson Avatar, an Avatar
Host Clip, and a live realtime conversation surface — all from one
business brief.

## Problem

Indie founders and small marketing teams in 2026 need short-form ads
in **multiple aspect ratios**, in **multiple languages**, with a
**spokesperson** people remember, and with **interactive surfaces**
for sales calls and onboarding. Most AI video tools output a single
clip and stop. Voice tools, avatar tools, and dubbing tools each live
in their own silos. The friction of stitching them together kills
the AI-velocity story for the user.

## Solution

AdSpark Studio collapses the entire campaign loop — concept →
reference image → video → cache → platform pack → brand spokesperson
→ host clip → custom brand voice → multilingual dubs → live realtime
conversation — into a single click-driven flow. Every artefact lives
on the same campaign record. Every asset is cached locally so saved
campaigns survive Runway's URL expiry.

## What AdSpark generates per campaign

- ✅ **Ad concepts** — three options with hook, caption, CTA, visual direction
- ✅ **Reference image** — Runway `gen4_image_turbo` from the recommended concept
- ✅ **Runway video** — `gen4.5` text-or-image, or `gen4_turbo` image-to-video
- ✅ **Platform Campaign Pack** — Landscape 1280×720, Reels 720×1280, Square 960×960
- ✅ **Brand Spokesperson Avatar** — reusable Runway Avatar created from the campaign image (or stock portrait fallback)
- ✅ **Avatar Picker** — reuse any avatar your account has already created without paying for a new one
- ✅ **Avatar Host Clip** — short spoken pitch via Runway `avatar_videos`
- ✅ **Brand Voice** — custom voice designed via Runway `voices` text-design
- ✅ **Multilingual Dub Pack** — 29-language dubs via Runway `voice_dubbing`
- ✅ **Realtime Spokesperson** — live 5-min WebRTC conversation via Runway `realtime_sessions`

## How Runway is used (end-to-end)

| Stage | Endpoint | Model | Notes |
|---|---|---|---|
| Reference image | `POST /v1/text_to_image` | `gen4_image_turbo` | Seeds with a flat-colour reference (Runway requires ≥1); prompt is the dominant signal |
| Video — image-to-video | `POST /v1/image_to_video` | `gen4_turbo` (default) or `gen4.5` | 5 s for Gen-4 Turbo; 5/8/10 s for Gen-4.5 |
| Video — text-to-video | `POST /v1/text_to_video` | `gen4.5` | When the user enables "Use text-only video" |
| **Brand Spokesperson Avatar** | `POST /v1/avatars` | — | Per-campaign Runway Avatar; reference-image fallback (override → campaign → stock). 30 universal voice presets. PROCESSING → READY in ~30–45 s. |
| **Avatar list (picker)** | `GET /v1/avatars` | — | Lists the account's custom avatars. Curated to a safe shape (id, name, status, source, thumbnail, voice preset). 4 mock presets in mock mode. |
| **Avatar Host Clip** | `POST /v1/avatar_videos` | `gwm1_avatars` | `avatar:{type:"custom",avatarId}` + `speech:{type:"text",text}`. ~10 s for an 8-word pitch. h264 1088×704 + AAC. |
| **Brand Voice** | `POST /v1/voices` | `eleven_multilingual_ttv_v2` | Text-design produces a custom voice; CloudFront `previewUrl` MP3 cached locally. |
| **Multilingual Dub** | `POST /v1/voice_dubbing` | `eleven_voice_dubbing` | `audioUri` + 29-language `targetLang` enum. ~25 s per language. Source = Brand Voice preview MP3 as data URI. |
| **Realtime Spokesperson** | `POST /v1/realtime_sessions` | `gwm1_avatars` | `avatar:{type:"custom",avatarId}`. READY response carries `sessionKey` JWT directly (no separate consume endpoint). 5-min hard cap via `expiresAt`. |
| Status polling | `GET /v1/tasks/{id}` | — | ≥5 s + jitter, capped at 5 min, terminal-status short-circuit. Same shape across image / video / avatar / voice / dub tasks. |
| Org metadata | `GET /v1/organization` | — | Read once on page load via a defensive backend proxy. Returns `monthly_credit_cap`; `credits` returns null because Runway's org endpoint exposes a cap, not a balance |

All requests carry `Authorization: Bearer <RUNWAY_API_KEY>` and
`X-Runway-Version: 2024-11-06`. Local `/api/runway/image/<id>` URLs
are converted to base64 data URIs server-side before posting to
Runway. The realtime client connects directly to Runway via the
`@runwayml/avatars-react` SDK using only the short-lived `sessionKey`
— the API key never reaches the browser.

> **About Runway's preset characters:** the docs reference slug-style
> preset names (`music-superstar`, `cat-character`, `fashion-designer`,
> `cooking-teacher`). As of this build those are **not API-accessible**
> — `/v1/avatar_videos` validates `avatar.avatarId` as a UUID and
> rejects slugs with `Invalid UUID`, and there is no separate
> preset-listing endpoint. The Avatar Picker shows them as mock
> entries in mock mode and lists the account's own custom avatars in
> real mode. If Runway exposes preset characters via `GET /v1/avatars`
> later, the picker surfaces them automatically. Documented in
> `docs/research/RUNWAY_API_CAPABILITY_MAP.md` Appendix D.

## Key differentiators

1. **End-to-end Runway pipeline.** AdSpark generates the reference
   image, animates it, turns the same image into a reusable
   spokesperson, designs a custom brand voice, dubs it into 29
   languages, and offers a live conversation surface — *all in the
   same session, on the same campaign record*. No "upload your own
   photo," no separate avatar tool, no human voiceover booking, no
   separate dubbing service.
2. **Campaign Pack output.** One click per format produces three
   platform-tuned MP4s with the correct aspect ratio, burned-in
   title + CTA overlays, and `+faststart` for streaming friendliness.
3. **Avatar reuse.** The Avatar Picker (`GET /v1/avatars` proxy)
   lets users pick from any avatar their account has already paid to
   create — instead of forcing every campaign through a fresh
   `/v1/avatars` call.
4. **Brand Spokesperson capability is visible, not hidden.** The
   flow is split into two clicks judges can see: *Create Brand
   Spokesperson* creates the Runway Avatar identity (with the avatar
   id, processed thumbnail, and image source label persisted on the
   campaign), and *Present Campaign* records the Avatar Host Clip
   using that identity.
5. **Honest fallbacks.** Runway rejects the campaign reference image
   for avatar use when it has no recognisable face. AdSpark surfaces
   the failure honestly and offers a one-click "Retry with stock
   portrait" instead of silently swapping sources.
6. **Realtime is brokered, not bolted on.** A FastAPI broker mints a
   short-lived `sessionKey` server-side; the React app never sees
   the Runway API secret. The `<AvatarCall>` component is
   lazy-loaded so SDK errors stay isolated and the rest of the
   gallery keeps working.
7. **Demoable without keys.** Mock mode runs the same UI flow with
   deterministic concepts, stdlib-generated mock assets, in-memory
   tasks that succeed in seconds, ffmpeg-only audio placeholders, 4
   mock preset entries in the avatar picker, and a clearly disabled
   realtime button. This is what Playwright drives in CI.
8. **Credit-safe.** A model-aware policy validates every request and
   returns `HTTP 400` *before* any outbound HTTP. We caught real
   schema mismatches during PR-A, PR-F, PR-H, and PR-I probes
   (text_to_image's required `referenceImages`, avatars' `custom`
   discriminator, voice_dubbing's `audioUri`/`targetLang` shape,
   realtime sessions' `sessionKey`-in-GET pattern) — each surfaced
   in milliseconds via Runway's validator without spending credits
   twice.
9. **Local cache.** Saved campaigns survive presigned URL expiry.
   The gallery prefers cached files; finished Campaign Pack files,
   host clips, voice previews, and dubs are independent of the
   source clip once built.

## Demo script (≈4–5 minutes live)

Full ordered click-by-click guide lives in
[`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md) (five paths: mock, live,
fallback, **realtime spokesperson**, and **avatar picker + realtime**).
Short version:

1. **Mode banner check** — readiness chip should read `demo ready ·
   concepts mocked` (typical) or `demo ready · all live`.
2. **Form** — `Donkey Betz Coffee` / `Reels-ready cold brew` / `warm
   cinematic` / `morning commuters`.
3. **Generate Ad Concepts** → pick the recommended `Daily Ritual`.
4. **Settings** — Model `Gen-4.5`, Source ratio `Reels / TikTok
   720×1280`, Duration `5 s`.
5. **Generate Reference Image** — ~25 s real `gen4_image_turbo`.
6. **Generate Video** — ~2 min for Gen-4.5, status pill animates.
7. **Save campaign card** — cache pill flips to `cached locally`.
8. **Build Reels → Build Landscape → Build Square** — pack pill 1/3
   → 2/3 → 3/3.
9. **Choose Existing Runway Avatar** OR **Create Brand Spokesperson** —
   either pick from the avatar picker or create a fresh per-campaign
   spokesperson with the stock portrait fallback.
10. **Present Campaign** — Avatar Host Clip records via
    `avatar_videos`. ~10 s. Inline `<video>` plays the spokesperson
    speaking the campaign pitch.
11. **Design Brand Voice** — Runway `/v1/voices` text-design produces
    a custom voice; preview MP3 plays inline.
12. **Dub** — Spanish + French (or any of the 29 supported languages)
    in ~25 s each.
13. **Talk to Brand Spokesperson** — Start Conversation → mic
    permission → live WebRTC call with the avatar speaking your
    chosen voice. End Conversation tears down cleanly.

## Technical architecture

```
Frontend (React 18 + Vite 5 + Tailwind 3, single-page,
          /api + /health proxy → :8000,
          @runwayml/avatars-react lazy-loaded for realtime)
  ↕
Backend (FastAPI 0.115 + Pydantic v2 + httpx, single uvicorn worker,
         28 routes total)
  ├── concept_service               OpenAI gpt-4o-mini (optional) + deterministic mock fallback
  ├── image_client                  Runway text_to_image (real path) + stdlib zlib PNG (mock path)
  ├── runway_client                 Per-model GENERATION_POLICY; routes image_to_video / text_to_video
  ├── finisher_service              Local ffmpeg scale-cover + crop + drawtext for the Campaign Pack
  ├── character_host_client         Runway Avatars + avatar_videos two-phase host
  ├── avatar_listing_client         Curated GET /v1/avatars proxy + 4 mock presets
  ├── realtime_avatar_client        /v1/realtime_sessions broker (sessionKey only)
  ├── audio_client                  Runway voices + voice_dubbing two-phase audio
  └── storage                       JSON campaign store + atomic local caches per artefact type
  ↕
Runway API (api.dev.runwayml.com)  +  Local filesystem (backend/data/*, gitignored)
```

Stack choices: FastAPI for fast iteration + automatic OpenAPI;
Pydantic v2 for strict request validation; httpx for streaming
downloads with content-type checks; React + Vite for the polished
demo surface; Tailwind 3 for the visual system; Playwright + Chromium
for a single-shot end-to-end smoke that gates every commit; ffmpeg
7.1 (system binary) for finishing **and** mock audio/video
placeholders.

## Safety / cost controls

- **No auto-generation.** Every Runway call (image gen, video gen,
  avatar create, host clip, brand voice, dub, realtime session) fires
  on an explicit user click. Page load makes zero outbound calls
  beyond `/v1/organization` for the optional credits chip.
- **Pre-flight `400`s.** The backend's `validate_generation_settings`
  rejects unsupported model / ratio / duration / missing-image
  combinations before any HTTP is dispatched. `/v1/voices` text
  prompt validation, `/v1/voice_dubbing` `targetLang` enum, and
  `/v1/realtime_sessions` avatar id validation all happen against
  the same gate.
- **Polling caps.** 60 attempts × 5 s + jitter ≈ 5 min hard ceiling.
  Avatar processing has its own 90 s cap. Realtime READY poll has a
  30 s cap before the broker gives up.
- **Realtime session 5-min hard cap.** Runway's `expiresAt` is the
  ceiling; the frontend countdown surfaces it.
- **Local cache is gitignored.** `backend/data/{images,videos,
  finished,host,audio}/*` never enter version control.
- **API key never leaves the backend.** The React app talks only to
  FastAPI. Generated reference images that originate as
  `/api/runway/image/<id>` URLs are converted to data URIs server-side
  before posting to Runway. Realtime credentials use a one-shot
  `sessionKey` JWT minted by the broker; the secret never reaches the
  browser.
- **`provider-status` is secret-free.** Returns the policy table the
  UI uses for chip rendering, with no key or org info.
- **`/api/runway/organization` is non-blocking.** Failures land in
  the response body; the credits chip renders only when a numeric
  balance is recognised.

## Known limitations

1. **Runway image generation needs a seed reference.** `gen4_image_turbo`
   rejects requests without ≥1 `referenceImages` entry. We seed a
   320×320 flat charcoal PNG so the prompt remains dominant.
2. **No real credit balance.** Runway's `/v1/organization` exposes a
   monthly cap, not a per-account balance, so the Mode banner shows
   `cap: 200,000` instead of a live remaining number.
3. **Direct text-to-speech narration is deferred.** Runway's
   `/v1/text_to_speech` requires a `voice.type` discriminator that's
   gated; 30+ probe attempts couldn't unlock it. The Brand Voice
   preview + dub pipeline gives full multilingual voice delivery
   despite this.
4. **Preset characters not API-accessible.** `music-superstar`,
   `cat-character`, etc. are Runway-web-app product features today.
   The picker surfaces them as mock entries; the real list shows
   account-created custom avatars only.
5. **Single-process JSON file storage.** Fine for a hackathon; not
   a production substrate.
6. **Center-crop on aspect change drops edge content.** Reels and
   Square cuts of a 16:9 source lose ~43% horizontal content.
   Smart-framing is future work.
7. **Realtime polling state is browser-side only.** Closing the tab
   during a session abandons local state; the Runway session
   continues until `expiresAt`.
8. **Realtime SDK is 562 KB.** Lazy-loaded so initial bundle stays
   at ~190 KB JS / ~58 KB gzip; only downloads when the user clicks
   Start Conversation.

## Future roadmap (post-hackathon, not built)

- **Smart-framing for cross-aspect crops.** Detect subject placement
  so 16:9 → 9:16 doesn't cut someone in half.
- **Audio + video mix.** Layer the Brand Voice / dub MP3 over the
  finished Pack MP4s via ffmpeg `amix`.
- **Public deployment.** Vercel for the frontend, Render/Fly with
  ffmpeg in the runtime image for the backend, Runway key as platform
  env var.
- **Background-task finishing.** ffmpeg + audio in `BackgroundTasks`
  so a click returns immediately and the gallery polls.
- **Per-format error tracking.** A small `finish_errors[fmt]` map.
- **Direct TTS narration** once Runway documents the
  `/v1/text_to_speech` `voice.type` discriminator.
- **Webcam toggle** on the realtime session UI (mic-only is V1).
- **Knowledge documents** (`/v1/documents`) so the realtime
  spokesperson can answer brand FAQ questions with grounded retrieval.
- **Cancellation** (`DELETE /v1/tasks/{id}`).

## Verified end-to-end against real Runway

Multiple credit-spend hero-runs across PR-D / PR-F V2 / PR-H / PR-I
were performed during development, all on campaign `9a717c675ec6`:

**PR-D verification (campaign creation + Pack):**
- Reference image (`gen4_image_turbo` @ 720:1280) → 720×1280 PNG
- Video (`gen4.5` image-to-video @ 720:1280 / 5 s) → SUCCEEDED
- Campaign saved + cached at 2.5 MB, h264 720×1280 5.04 s
- Campaign Pack three formats `ok`: 1280×720, 720×1280, 960×960

**PR-F V2 verification (Brand Spokesperson + Avatar Host Clip):**
- Phase 1 default (campaign image) → `failed` with "no recognisable
  face"
- Phase 1 retry with stock portrait → `host_avatar_id
  6f18ad26-…`, status `ready`
- Phase 2 Avatar Host Clip → 1088×704 h264 + AAC, 11.17 s, 2.8 MB

**PR-H verification (Brand Voice + Dub Pack):**
- Phase 1 → `brand_voice_id 72296398-…`, preview MP3 1.88 MB,
  117 s mono 44.1 kHz
- Phase 2 Spanish dub → distinct MP3 by md5, 117 s
- Phase 2 French dub → distinct MP3 by md5, 117 s

**PR-I verification (Realtime Spokesperson):**
- Realtime session created → `session_id 6a0783f3-…`, 248-char
  `sessionKey` JWT, 5-min `expiresAt`
- Backend log audit: zero `rwk_`, zero `stk_`, zero `sessionKey`
  bytes leaked
- DELETE returned `{ok: true}` after Runway 204
- WebRTC handshake from `<AvatarCall>` requires a real browser; the
  manual click-test is part of the demo recording check.

**Avatar Picker verification:**
- Real `GET /v1/avatars` returned 7 custom avatars
- `POST /select-avatar` persisted a different avatar than
  `host_avatar_id`
- Realtime broker afterwards returned the **selected** avatar id, not
  the campaign's `host_avatar_id` — confirming picker selection wins
- Selection cleared at end of probe so canonical demo state is
  preserved

## Repository

- GitHub (private): https://github.com/clwest/adspark-studio-runway-hackathon
- Branches per PR — A (text-to-video + reference image gen) → B
  (Campaign Pack) → C (settings validation) → D (demo hardening +
  hero-run) → E (submission polish, tagged `hackathon-submission`) →
  F (Brand Spokesperson Avatar + Avatar Host Clip,
  `hackathon-submission-v2`) → G (docs refresh) → H (Brand Voice +
  Dubs, `hackathon-submission-v3`) → I (Realtime Spokesperson +
  Avatar Picker, **`hackathon-submission-v4`**) → J (this docs
  refresh).
- **Submission tags** (all on origin):
  - `hackathon-submission` at `7ed949e` — pre-avatar baseline.
  - `hackathon-submission-v2` at `e6ca02b` — adds Brand Spokesperson
    Avatar + Avatar Host Clip.
  - `hackathon-submission-v3` at `515701f` — adds Brand Voice + 29-
    language Multilingual Dubs.
  - **`hackathon-submission-v4`** at `89918c3` — **canonical full
    submission.** Adds Realtime Brand Spokesperson + Avatar Picker.
    `git checkout hackathon-submission-v4` reproduces the entire
    feature stack.
