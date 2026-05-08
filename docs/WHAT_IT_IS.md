# AdSpark Studio — What It Is

A RunwayML hackathon build. A user enters a business / product / tone /
audience and gets a complete cinematic ad package — **plus a reusable
Runway Avatar brand spokesperson that presents the campaign**.

## What AdSpark generates per campaign

1. **3 ad concepts** — title, hook, visual direction, caption, CTA.
2. **Recommended Runway prompt** — auto-derived from the chosen concept,
   editable before submission.
3. **Runway reference image** — `gen4_image_turbo` synthesised from the
   prompt; cached locally.
4. **Runway video** — `gen4.5` (text or image) or `gen4_turbo`
   (image-to-video), selectable model + ratio + duration with backend
   policy validation.
5. **Local cache** — saved campaigns download the presigned MP4 to disk
   so they survive Runway's URL expiry.
6. **Campaign Pack** — three platform-tuned MP4s built by local ffmpeg:
   Landscape 1280×720, Reels 720×1280, Square 960×960, with title +
   CTA overlays.
7. **Brand Spokesperson Avatar** — per-campaign Runway Avatar created
   from the campaign's reference image (or a stock-portrait fallback
   when the campaign image has no recognisable face). Persisted on the
   campaign record with a thumbnail and image-source label.
8. **Avatar Host Clip** — short MP4 of the spokesperson speaking the
   campaign pitch via Runway `avatar_videos`. Cached locally.

## Stack

- **Backend**: FastAPI + Pydantic v2 + httpx
- **Frontend**: React 18 + Vite 5 + Tailwind 3
- **Storage**: JSON file at `backend/data/campaigns.json` (single-process)
- **Local cache**: `backend/data/{images,videos,finished,host}/` (all gitignored)
- **Finishing**: ffmpeg 7.1 (scale-cover + crop + drawtext for the
  Campaign Pack; lavfi color + drawtext for the mock host placeholder)
- **Tests**: Playwright + Chromium, single-shot, single-worker
- **External APIs (optional)**:
  - OpenAI (concept generation, `gpt-4o-mini` default — defaults to
    deterministic mock when no key)
  - Runway (`api.dev.runwayml.com`, version header `2024-11-06`):
    - `/v1/text_to_image` (`gen4_image_turbo`)
    - `/v1/image_to_video`, `/v1/text_to_video`
    - `/v1/avatars`, `/v1/avatar_videos`
    - `/v1/tasks/{id}` (shared polling)
    - `/v1/organization` (read-only metadata)

## Mock vs Real

The app **runs without any keys** in deterministic mock mode:

| Stage | Without key | With key |
|---|---|---|
| Concepts | Deterministic mock derived from inputs | `gpt-4o-mini` JSON-mode response |
| Reference image | Stdlib zlib PNG written locally | `gen4_image_turbo` task + downloaded PNG |
| Video task | In-memory mock; succeeds in ~12 s with public sample MP4 | Real `image_to_video` / `text_to_video` |
| Brand Spokesperson Avatar | Synthetic READY avatar + stdlib PNG thumbnail | Real `/v1/avatars` create + processing-poll to READY |
| Avatar Host Clip | ffmpeg lavfi 5 s 720×720 silent placeholder | Real `/v1/avatar_videos` + downloaded MP4 |
| Campaign Pack | Same local ffmpeg in both modes (no provider call needed) | Same |

Mock state surfaces in `GET /health` (`openai_mock`, `runway_mock`,
`image_gen_mock`, `any_mock`) and `GET /api/runway/provider-status`.
The frontend renders a `MOCK MODE` chip whenever `any_mock` is true and
a Mode-banner readiness chip:

- `demo mode` (amber) — both providers mocked.
- `demo ready · concepts mocked` (emerald) — Runway live, OpenAI mocked.
- `demo ready · all live` (emerald) — both live.
- `backend down` (rose) — `/health` returned non-ok.

## Behavioral guardrails

- **No third-party calls fire on page load.** Real Runway calls only
  fire on explicit user click. The optional `/api/runway/organization`
  read-only metadata fetch is the sole exception, and it's
  non-blocking — failures land in the response body and the UI stays
  silent.
- **Pre-flight policy validation.** Backend rejects unsupported model /
  ratio / duration / missing-image combinations with `HTTP 400`
  *before* any outbound HTTP. See `runway_client.GENERATION_POLICY`.
- **Honest fallbacks.** Avatar processing fails openly when the
  campaign image has no face — UI offers "Retry with stock portrait"
  and labels the source (`campaign` / `override` / `stock`) on the
  campaign record.
- **Polling**: 5 s interval + 0–800 ms jitter, capped at 60 attempts
  (~5 min); terminal states (`SUCCEEDED | FAILED | CANCELED`) stop
  polling immediately.
- **Settings persistence**: model / ratio / duration / textOnly /
  imageUrl in `localStorage` under `adspark.settings.v1` — clamped on
  restore so old or invalid combinations never survive a restart.
- **Keys live only in the repo-root `.env`** (gitignored). The React
  app has no key access — every Runway call goes through FastAPI.
  Local `/api/runway/image/<id>` URLs are converted to base64 data
  URIs server-side before being posted to Runway, so generated
  reference images can drive both video and avatar tasks without
  needing public hosting.
- **CORS allowlist** defaults to `http://localhost:5173`.
- **Standalone repo.** `unified-donkey-betz` was inspected read-only
  for ffmpeg subprocess pattern shape during PR-pre-A bootstrap;
  nothing was copied verbatim and no runtime import / dependency exists.
