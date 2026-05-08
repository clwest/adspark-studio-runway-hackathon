# AdSpark Studio — Hackathon Submission

## Project name
**AdSpark Studio**

## One-line pitch
Type a business idea, get a Runway-powered Campaign Pack **and a
reusable Runway Avatar spokesperson that presents it** — concept,
reference image, video, three platform-tuned MP4s (16:9 / 9:16 / 1:1),
plus a Brand Spokesperson Avatar Host Clip — in under five minutes.

## Why this matters

Brands don't just need ads. They need **campaign assets and reusable
spokespeople** — the kind of presence a small founder can't afford to
shoot, and the kind of multi-format coverage a Premiere Pro round trip
can't keep up with. AdSpark Studio turns one campaign brief into both:
**platform-ready creative** (Landscape / Reels / Square) **and a
speaking AI presenter** (a Runway Avatar created from the same
campaign reference image), in a single click-driven session.

## Problem

Indie founders and small marketing teams need short-form ads in 2026 —
*plural*, because the same campaign has to ship as a 16:9 YouTube spot,
a 9:16 TikTok/Reels cut, and a 1:1 Instagram square. They also need a
recognisable narrator to introduce, recap, or pitch the campaign across
social, email, and storefront — without booking a talent shoot. Even
when they adopt a single AI video tool they're left with one clip,
no spokesperson, and a Premiere session ahead of them. The friction
kills the AI velocity story.

## Solution

AdSpark Studio collapses the entire creative loop — concept → reference
image → video → platform-tuned outputs → **brand spokesperson →
spokesperson presents the campaign** — into a single click-driven flow.
The user types a business name, picks a concept, optionally generates
a Runway reference image from that concept, fires a Runway video task,
saves the campaign (which downloads and locally caches the MP4 so it
survives presigned URL expiry), and clicks three buttons to finish a
*Campaign Pack* with title + CTA overlays at every required aspect
ratio. Then with two more clicks the same campaign image becomes a
**reusable Runway Avatar Brand Spokesperson** that records an **Avatar
Host Clip** speaking the campaign pitch. The whole thing runs locally
with no external services beyond Runway and ffmpeg.

## What AdSpark generates per campaign

- ✅ **Ad concepts** — three options with hook, caption, CTA, visual direction
- ✅ **Reference image** — Runway `gen4_image_turbo` from the recommended concept
- ✅ **Runway video** — `gen4.5` text-or-image, or `gen4_turbo` image-to-video
- ✅ **Platform Campaign Pack** — Landscape 1280×720, Reels 720×1280, Square 960×960
- ✅ **Brand Spokesperson Avatar** — reusable Runway Avatar created from the campaign image (or a stock portrait fallback)
- ✅ **Avatar Host Clip** — short spoken pitch via Runway `avatar_videos`

## How Runway is used (end-to-end)

| Stage | Endpoint | Model | Notes |
|---|---|---|---|
| Reference image | `POST /v1/text_to_image` | `gen4_image_turbo` | Seeds with a flat-colour reference (Runway requires ≥1); prompt remains the dominant signal |
| Video — image-to-video | `POST /v1/image_to_video` | `gen4_turbo` (default) or `gen4.5` | 5 s for Gen-4 Turbo; 5 / 8 / 10 s for Gen-4.5 |
| Video — text-to-video | `POST /v1/text_to_video` | `gen4.5` | When the user enables "Use text-only video" |
| **Brand Spokesperson Avatar** | `POST /v1/avatars` | — | Per-campaign Runway Avatar; reference image source falls back campaign → stock portrait. 30 universal voice presets. Polls `PROCESSING → READY` (~30–45 s, cached on the campaign record afterwards). |
| **Avatar Host Clip** | `POST /v1/avatar_videos` | `gwm1_avatars` | `avatar: {type: "custom", avatarId}` + `speech: {type: "text", text}`. ~10 s for an 8-word pitch. h264 1088×704 + AAC. |
| Status polling | `GET /v1/tasks/{id}` | — | ≥5 s interval + jitter, capped at 5 min, terminal-status short-circuit. Same shape across image / video / avatar tasks. |
| Org metadata | `GET /v1/organization` | — | Read once on page load via a defensive backend proxy. Returns `monthly_credit_cap` chip; `credits` returns null because Runway's org endpoint exposes a cap, not a balance |

All requests carry `Authorization: Bearer <RUNWAY_API_KEY>` and
`X-Runway-Version: 2024-11-06`. Local cached `/api/runway/image/<id>`
URLs are converted to base64 data URIs server-side before posting to
Runway, so generated reference images flow through to the video step
without needing to be publicly hosted.

## Key differentiators

1. **End-to-end Runway pipeline.** AdSpark generates the reference image
   *in the same session*, animates it, and turns the same image into a
   **reusable Runway Avatar spokesperson** that speaks the campaign
   pitch. No "upload your own photo" prerequisite, no separate avatar
   tool, no human voiceover booking.
2. **Campaign Pack output.** One click per format produces three
   platform-tuned MP4s with the correct aspect ratio, burned-in title +
   CTA overlays, and `+faststart` for streaming friendliness. Most AI
   video tools stop at the raw clip.
3. **Brand Spokesperson capability is visible, not hidden.** The flow
   is intentionally split into two clicks judges can see: *Create Brand
   Spokesperson* creates the Runway Avatar identity (with the avatar
   id, processed thumbnail, and image source label persisted on the
   campaign), and *Present Campaign* records the Avatar Host Clip
   using that identity. AdSpark does not just record a host — it
   creates a reusable AI presenter for the campaign.
4. **Honest fallbacks.** Runway rejects the campaign reference image
   for avatar use when it has no recognisable face (e.g., a coffee-shop
   scene). AdSpark surfaces the failure honestly and offers a
   one-click "Retry with stock portrait" instead of silently swapping
   sources. Image-source labels (`campaign` / `override` / `stock`)
   stay on the campaign record so the demo story stays accurate.
5. **Demoable without keys.** Mock mode runs the same UI flow with
   deterministic concepts, a stdlib-generated reference PNG, an
   in-memory "task" that succeeds in ~12 s with a public sample MP4,
   a synthetic mock avatar, and an ffmpeg-only host placeholder. This
   is what Playwright drives in CI and what we recommend judges try
   first.
6. **Credit-safe.** A model-aware policy validates every request and
   returns `HTTP 400` *before* any outbound HTTP. We caught a real
   `text_to_image` schema mismatch (Runway requires ≥1 reference) once
   during the hero-run and an undocumented `avatar.type: "custom"`
   discriminator during the avatar probe — both surfaced in
   milliseconds via Runway's validator without spending credits.
7. **Local cache.** Saved campaigns survive presigned URL expiry. The
   gallery prefers cached files; finished Campaign Pack files and
   Avatar Host Clips are independent of the source clip once built.

## Demo script (≈4–5 minutes live)

Full ordered click-by-click guide lives in [`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md)
(four paths: mock, live, fallback, **and the new live Avatar Host
demo**). Short version:

1. **Mode banner check** — readiness chip should read `demo ready · concepts mocked` (typical) or `demo ready · all live`.
2. **Form** — `Donkey Betz Coffee` / `Reels-ready cold brew` / `warm cinematic` / `morning commuters`.
3. **Generate Ad Concepts** → pick the recommended `Daily Ritual` card.
4. **Settings** — Model `Gen-4.5`, Source ratio `Reels / TikTok 720×1280`, Duration `5 s`.
5. **Generate Reference Image** — ~25 s, real `gen4_image_turbo` call, image renders inline.
6. **Generate Video** — ~2 min for Gen-4.5, status pill animates, inline `<video>` on `SUCCEEDED`.
7. **Save campaign card** — cache pill flips to `cached locally`, gallery card materializes.
8. **Build Reels → Build Landscape → Build Square** — pack pill 1/3 → 2/3 → 3/3, each format streams at the right dimensions.
9. **Create Brand Spokesperson** — Runway Avatar phase. If the campaign image lacks a face, the avatar fails honestly; click "Retry with stock portrait." On success the gallery shows the avatar thumbnail, id, and source label.
10. **Present Campaign** — Avatar Host Clip records via `avatar_videos`. ~10 s upstream. Inline `<video>` plays the spokesperson speaking the campaign pitch.

## Technical architecture

```
Frontend (React 18 + Vite 5 + Tailwind 3, single-page, /api + /health proxy → :8000)
  ↕
Backend (FastAPI 0.115 + Pydantic v2 + httpx, single uvicorn worker)
  ├── concept_service        OpenAI gpt-4o-mini (optional) + deterministic mock fallback
  ├── image_client           Runway text_to_image (real path) + stdlib zlib PNG (mock path)
  ├── runway_client          Per-model GENERATION_POLICY; routes image_to_video / text_to_video
  ├── finisher_service       Local ffmpeg scale-cover + crop + drawtext for the Campaign Pack
  └── storage                JSON campaign store + atomic video cache (100 MB cap, content-type guard)
  ↕
Runway API (api.dev.runwayml.com)  +  Local filesystem (backend/data/*, gitignored)
```

Stack choices: FastAPI for fast iteration + automatic OpenAPI; Pydantic
v2 for strict request validation; httpx for streaming downloads with
content-type checks; React + Vite for the polished demo surface;
Tailwind 3 for the visual system; Playwright + Chromium for a
single-shot end-to-end smoke that gates every commit; ffmpeg 7.1 (system
binary) for finishing **and** the mock host placeholder.

Service modules:

| Module | Responsibility |
|---|---|
| `concept_service.py` | OpenAI gpt-4o-mini (optional) + deterministic mock fallback |
| `image_client.py` | Runway `text_to_image` (real) + stdlib zlib PNG (mock) |
| `runway_client.py` | Per-model `GENERATION_POLICY`; routes `image_to_video` / `text_to_video` |
| `finisher_service.py` | Local ffmpeg Campaign Pack (3 formats) |
| `character_host_client.py` | Runway Avatars + `avatar_videos` two-phase host |
| `storage.py` | JSON campaign store + atomic video & host caches |

## Safety / cost controls

- **No auto-generation.** Every Runway call (image gen, video gen) fires
  on an explicit user click. Page load makes zero outbound calls beyond
  `/v1/organization` for the optional credits chip.
- **Pre-flight `400`s.** The backend's `validate_generation_settings()`
  rejects unsupported model / ratio / duration / missing-image
  combinations before any HTTP is dispatched. Verified end-to-end with
  curl during PR C — even with a fake key, an invalid combo returns 400
  in milliseconds.
- **Polling caps.** 60 attempts × 5 s + jitter ≈ 5 min hard ceiling.
  Terminal status (`SUCCEEDED` / `FAILED` / `CANCELED`) short-circuits.
- **Local cache is gitignored.** `backend/data/{images,videos,finished}`
  never enters version control.
- **API key never leaves the backend.** The React app talks only to
  FastAPI. Generated reference images that originate as
  `/api/runway/image/<id>` URLs are converted to data URIs *server-side*
  before posting to Runway.
- **`provider-status` is secret-free.** Returns the policy table the UI
  uses for chip rendering, with no key or org info.
- **`/api/runway/organization` is non-blocking.** Failures land in the
  response body; the credits chip renders only when a numeric balance
  is recognised. Worst case the chip is silent.

## Known limitations

1. **Runway image generation needs a seed reference.** `gen4_image_turbo`
   rejects requests without ≥1 `referenceImages` entry. We seed a
   320×320 flat charcoal PNG so the prompt remains dominant; this is
   the documented workaround.
2. **No real credit balance.** Runway's `/v1/organization` exposes a
   monthly cap (`maxMonthlyCreditSpend: 200000`) but no per-account
   balance, so the Mode banner shows `cap: 200,000` instead of a
   live remaining number. `_extract_credits()` checks seven common
   field paths and will pick up a balance the moment Runway exposes
   one.
3. **Single-process JSON file storage.** Fine for a hackathon; not a
   production substrate.
4. **Center-crop on aspect change drops edge content.** A 9:16 source
   center-crops cleanly to landscape and to square; a 16:9 source loses
   ~43% horizontal content when re-cut to Reels. The on-screen help
   text recommends matching the source ratio to the headline output
   format. Smart-framing is future work.
5. **Polling state is browser-side only.** Closing the tab during a
   ~2.5 min Gen-4.5 render abandons local task tracking. The Runway
   task still completes upstream; the user can verify via the Runway
   dashboard or rely on the campaign save workflow once status flips.
6. **Concept generation is mocked unless you set `OPENAI_API_KEY`.** Mock
   concepts are deterministic and good enough for the demo; live
   concepts require GPT-4o-mini and are out of the Runway hackathon
   scope.

## Future roadmap (post-hackathon, not built)

- **Smart-framing for cross-aspect crops.** Detect subject placement so
  16:9 → 9:16 doesn't cut someone in half.
- **Audio + music bed.** Runway sound effects + ElevenLabs voice via
  ffmpeg `amix`.
- **Public deployment.** Vercel for the frontend, Render/Fly with ffmpeg
  in the runtime image for the backend, Runway key as platform env var.
- **Background-task finishing.** ffmpeg in `BackgroundTasks` so a Build
  click returns immediately and the gallery polls.
- **Per-format error tracking.** A small `finish_errors[fmt]` map so
  Reels failures don't hide a successful Landscape build.
- **Usage telemetry.** Once Runway's `/v1/organization` exposes a real
  balance, light up the credits chip and add a per-task spend
  estimator.
- **Cancellation.** `DELETE /v1/tasks/{id}` button next to the task
  pill; minor scope but skipped for the hackathon since 5 s clips
  finish before users want to cancel.

## Verified end-to-end against real Runway

A credit-spend hero-run was performed for PR D (campaign creation +
Pack), and a second pass for PR F V2 (spokesperson + host clip) on
the same campaign id `9a717c675ec6`:

**PR D verification (campaign creation + Pack):**
- Concept (mock OpenAI): "Daily Ritual — Donkey Betz Coffee"
- Reference image: `gen4_image_turbo` @ 720:1280, ~28 s upstream,
  720×1280 PNG
- Video: `gen4.5` image-to-video @ 720:1280 / 5 s, ~145 s upstream,
  `SUCCEEDED`, real CloudFront artifact downloaded
- Campaign saved + cached: 2.5 MB, h264 720×1280 5.04 s
- Campaign Pack — three formats finish_status: `ok`:
    - Landscape `1280×720` (847,907 B)
    - Reels `720×1280` (944,158 B; no crop — source already 9:16)
    - Square `960×960` (869,805 B)
- All three serve via `GET /api/campaigns/{id}/finished-video[/{fmt}]`
  with `content-type: video/mp4` and the expected dimensions.

**PR F V2 verification (Brand Spokesperson + Avatar Host Clip):**
- **Phase 1 default source** (campaign reference image, a coffee-shop
  scene): `host_avatar_status: failed`, `host_avatar_image_source:
  campaign`, error: *"Runway rejected the reference image — typically
  because it does not contain a recognisable face."* Faithful demo of
  the honest-failure UX path.
- **Phase 1 retry with explicit Unsplash portrait override**:
  `host_avatar_id: 6f18ad26-5976-4891-b085-61c1646c1251`,
  `host_avatar_status: ready`, `host_avatar_image_source: override`,
  processed thumbnail URL populated.
- **Phase 2 Avatar Host Clip**: `avatar_videos` task
  `6c69f5a6-8d35-4c40-a986-359c0e9ee546` →  `SUCCEEDED`,
  output cached at `backend/data/host/9a717c675ec6.mp4` —
  h264 1088×704 11.17 s + AAC, 2,800,392 bytes.
- HTTP serve: `GET /api/campaigns/9a717c675ec6/host-video` → 200
  `video/mp4`.

The full hero-run traces live in
`docs/handoffs/SESSION_005_PR_A-D_*.md` (PR A–D),
`docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` §12 (PR F probe), and
the corresponding PR commit messages.

## Repository

- GitHub (private): https://github.com/clwest/adspark-studio-runway-hackathon
- Branches per PR — A (text-to-video + reference image gen) → B (Campaign
  Pack) → C (settings validation) → D (demo hardening + hero-run) → E
  (submission polish, tagged `hackathon-submission`) → F (Brand
  Spokesperson Avatar + Avatar Host Clip) → G (this docs update).
- **Submission tags**:
  - `hackathon-submission` at PR-E commit `7ed949e` — pre-avatar
    baseline (Concept → Image → Video → Campaign Pack).
  - `hackathon-submission-v2` (recommended) at PR-G commit `e55af2f`
    — adds Brand Spokesperson Avatar + Avatar Host Clip. Both tags are
    intended to coexist so each version is reproducible from `git
    checkout`.
