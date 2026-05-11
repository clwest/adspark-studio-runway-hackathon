# Character OS — What It Is

A RunwayML hackathon build. Character OS is **persistent AI spokesperson
infrastructure** — brands create reusable AI characters that can
star in cinematic ads, deliver lip-synced talking-head pitches,
hold real-time conversations, and headline multi-character
dialogue scenes. Each spokesperson lives across campaigns and ad
modes; campaigns are produced *for* a spokesperson, not as
one-off generations. Everything is powered by Runway's API.

## The frontend reset (PR CA)

The homepage at `/` is now the **Spokesperson Library**: a tile
grid of every saved AI spokesperson, with their Identity /
Knowledge / Appearances tabs and per-mode lanes for new
campaigns. The legacy 4-stage "fill a brief, get an ad" wizard
moved to `/legacy` and is reachable via the top-bar
**Legacy UI ↗** link for demo emergencies. PR CB+ will replace
the legacy click-through with a dedicated workspace per
spokesperson (Identity / Knowledge / Campaigns / Conversations
/ Outputs).

## The headline architecture: three ad modes

A saved campaign produces up to three sibling final outputs from the
same brief. The Overview tab's "Pick your ad mode" picker surfaces
all three side by side:

| Mode | Visual primitive | Audio | Lip sync | Best for |
|---|---|---|---|---|
| **Cinematic Commercial** (Visuals tab) | Runway `image_to_video` / `text_to_video` (silent) | Avatar Host Clip audio mux via ffmpeg | **No** — visual is unrelated to mouth movement | B-roll, atmosphere, product shots, brand visuals |
| **Spokesperson Ad** (Character tab + Overview) | Runway `avatar_videos` (avatar IS the visual) | Same render — speech is rendered with the visual | **Yes** | Mascot ads, founder explainers, talking-head campaigns (Brewster, Piper) |
| **Dialogue Scene** (Dialogue tab + Overview) | Sequential `avatar_videos` per line, ffmpeg concat | Per-line speech preserved across lines | **Yes per line** | Office-style skits, founder ↔ mascot reactions, fake podcasts, recurring social content |

Storyboard Commercial Builder (Visuals tab) is a fourth output that
sits inside the Cinematic family — three image-to-video shots
stitched into a longer (~15 s) silent or voiced cut.

## What Character OS generates per campaign

1. **3 ad concepts** — title, hook, visual direction, caption, CTA.
2. **Recommended Runway video prompt** — the structured
   single-character / single-action / single-camera-move builder
   (PR T) opens the textarea with `"A realistic …"` and a Simplify
   button.
3. **Editable Commercial Script** — saved on the campaign as
   `commercial_script`; downstream Spokesperson Ad / Voiced
   Commercial / Voiced Storyboard / Realtime session paths speak
   it verbatim. Lives inside the Stage 3 Creative Direction panel
   alongside the visual prompt.
4. **Runway reference image** — `gen4_image_turbo`; cached locally.
5. **Runway video** — `gen4.5` (text or image) or `gen4_turbo`
   (image-to-video), selectable model + ratio + duration with
   backend policy validation. **Silent.**
6. **Local video cache** — saved campaigns download the presigned
   MP4 to disk so they survive Runway's URL expiry.
7. **Campaign Pack** — three platform-tuned MP4s built by local
   ffmpeg: Landscape 1280×720, Reels 720×1280, Square 960×960.
8. **Reusable Brand Character (PR K + V + AN)** — first-class
   resource in `data/characters.json`. `gen4_image_turbo`
   generates a portrait from one of four locked templates
   (mascot / founder / coach / local_guide); `/v1/avatars` binds
   the cached portrait into a Runway Avatar. Editable Portrait
   Prompt textarea for advanced framing. **PR AN** — each
   character can also carry a cloned custom voice
   (`POST /v1/voices` `from.type=audio`); when set, new avatars
   bind to the cloned voice instead of the runway-live-preset.
9. **Brand Spokesperson resolution chain** —
   `character.runway_avatar_id > selected_avatar_id >
   host_avatar_id`. Drives Spokesperson Ad, Realtime session, and
   Dialogue Scene speakers.
10. **Avatar Picker** — `GET /v1/avatars` proxy (with 4 mock-mode
    presets) lets users reuse any avatar their account has already
    paid to create.
11. **Spokesperson Ad** (PR F + PR AB rename) — Runway
    `avatar_videos` clip of the avatar speaking the saved
    Commercial Script (or templated fallback). Lip-synced. The
    talking-head ad. Cached at `backend/data/host/<id>.mp4`.
12. **Final Voiced Cinematic Ad** (PR S + PR X + PR AB rename) —
    silent visual cut + Avatar Host Clip audio muxed via ffmpeg
    `-stream_loop -1 -shortest`. Cached at
    `data/finished/<id>-commercial-voice.mp4`.
13. **Storyboard Commercial** (PR Z + PR AC) — three editable shot
    prompts (Hook / Action / Payoff) → three cached `image_to_video`
    clips → ffmpeg concat into a ~15 s landscape MP4. Optional
    voiced storyboard pass loops the stitched visual under host
    audio.
14. **Dialogue Scene** (PR AF) — three editable lines (Hook /
    Beat / Closer) per saved campaign, each rendered as its own
    Runway `avatar_videos` clip targeted at a specific Character's
    avatar id. ffmpeg `concat=n=N:v=1:a=1` stitches with audio
    preserved. The multi-character branded skit primitive.
14b. **Vertical / Reels exports with burned-in captions and brand-
    themed backdrops** (PR AG + PR AH + PR AK) — every Spokesperson
    Ad and Dialogue Scene MP4 can be reframed into a 720×1280
    vertical clip via local ffmpeg
    (`scale=…:force_original_aspect_ratio=decrease` +
    `pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=<brand|default>`).
    PR AH chains `drawtext=…enable='between(t,a,b)'` filters on top
    so the saved Commercial Script (Spokesperson) or per-line
    dialogue text (Dialogue Scene, timed via ffprobe of the cached
    line clips) is burned in as a bottom-safe subtitle box. **PR AK**
    — the letterbox bars adopt a per-campaign `brand_color`
    (`#RRGGBB`, set via the compact picker on the saved-card
    header); falls back to dark slate (`#0b1220`) when unset.
    Audio is preserved end-to-end. Output lands at
    `data/finished/<id>-spokesperson-reels.mp4` /
    `data/finished/<id>-dialogue-scene-reels.mp4`. Distribution layer
    only — no new Runway calls and no extra credit cost.
15. **Brand Voice + Multilingual Dub Pack** — `/v1/voices`
    text-design + `/v1/voice_dubbing` into 29 languages. Sibling
    samples that demonstrate the brand voice; not the ad
    narration.
16. **Realtime Spokesperson** (PR I + PR AE + PR AI + PR AJ) —
    live 5-min WebRTC conversation with the active avatar via
    `/v1/realtime_sessions`. The broker injects campaign-aware
    `personality` + `startScript` so the avatar opens with brand
    context instead of a generic greeting. **PR AI** — when the
    operator attaches a grounding document, the broker also passes
    `documentIds=[id]` and swaps in a slimmer personality cue so
    the avatar grounds factual answers in the Markdown brand brief
    (`POST /v1/documents`). Two-tier 400-fallback: drops
    documentIds first, then drops the personality / startScript
    overrides; the bare-body path is the original PR-I behaviour.
    **PR AJ** — once a session ends, the same `sessionId` doubles
    as the conversation id, and `POST /api/campaigns/{id}/realtime-transcript`
    fetches `GET /v1/avatar_conversations/{id}` to populate the
    Realtime tab's replay card with structured per-turn transcript
    history. Mock mode renders a deterministic 3-turn replay for
    offline demos. **PR AL** — frontend-only Copy Markdown +
    Download TXT affordances on the replay card make those turns
    portable (operators can drop the Markdown into Notion / Slack
    or hand the TXT to a customer-success workflow without an
    extra round-trip).

## Audio model

The spoken voice track in every voiced Character OS output is the
**Avatar Host Clip** primitive (`/v1/avatar_videos`):

- **Spokesperson Ad** = the host clip itself.
- **Final Voiced Cinematic Ad** = silent Cinematic visual + host
  clip audio extracted and muxed.
- **Voiced Storyboard** = stitched storyboard visual + host audio
  muxed.
- **Dialogue Scene** = N host clips concatenated; audio preserved
  per line.

Brand Voice (`/v1/voices`) and multilingual dubs
(`/v1/voice_dubbing`) ship as **sibling samples**, not the ad
narration: they let users hear the brand voice itself in 29
languages. Direct text-to-speech (`/v1/text_to_speech`) is gated by
Runway and intentionally not used.

## Video duration model

V1 single-cut visual ads stay 5–10 seconds:

| Model | Mode | Allowed durations |
|---|---|---|
| `gen4_turbo` | image-to-video | 5 s |
| `gen4.5` | image-to-video / text-to-video | 5 s, 8 s, 10 s |

The **Spokesperson Ad** scales naturally to the spoken script
length (typical 8–15 s for short scripts, 15+ s for longer ones).
The **Storyboard Commercial Builder** stitches three 5-s clips into
a ~15 s landscape MP4. The **Dialogue Scene Builder** stitches per-
line `avatar_videos` clips with each line's natural duration —
typical 3-line scenes land around 12–25 s. **Voiced Cinematic Ad**
runs as long as the host clip audio (loops the visual under the
audio, so duration = audio length).

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
  - `backend/data/finished/` — Campaign Pack outputs + voiced
    commercials + stitched storyboards + voiced storyboards +
    stitched dialogue scenes
  - `backend/data/host/` — Avatar Host Clips / Spokesperson Ads
  - `backend/data/audio/` — Brand Voice previews + per-language
    dubs
  - `backend/data/characters/` — character portrait PNGs
    (`<id>-portrait.png`)
  - `backend/data/storyboard/` — per-shot cached MP4s
  - `backend/data/dialogue/` — per-line cached MP4s
  - `backend/data/finished/<id>-spokesperson-reels.mp4` — PR AG
    720×1280 vertical Spokesperson Ad
  - `backend/data/finished/<id>-dialogue-scene-reels.mp4` — PR AG
    720×1280 vertical Dialogue Scene Ad
- **Finishing**: ffmpeg 7.1 (scale-cover + crop + drawtext for
  Campaign Pack; `-stream_loop -1 -shortest` for Voiced Cinematic
  Ad; `filter_complex concat` for Storyboard + Dialogue stitches;
  lavfi-anullsrc / color + drawtext for mock host / shot / line
  placeholders)
- **Tests**: Playwright + Chromium, single-shot, single-worker
- **External APIs (optional)**:
  - OpenAI (concept generation, `gpt-4o-mini` default — defaults to
    deterministic mock when no key)
  - Runway (`api.dev.runwayml.com`, version header `2024-11-06`):
    - `/v1/text_to_image` (`gen4_image_turbo`)
    - `/v1/image_to_video`, `/v1/text_to_video`
    - `/v1/avatars` create + list + get
    - `/v1/avatar_videos`
    - `/v1/voices` (text design)
    - `/v1/voice_dubbing`
    - `/v1/realtime_sessions` create + poll READY + consume +
      delete (with **PR AE campaign-aware overrides**)
    - `/v1/tasks/{id}` (shared polling)
    - `/v1/organization` (read-only metadata)

## Mock vs Real

The app **runs without any keys** in deterministic mock mode:

| Stage | Without key | With key |
|---|---|---|
| Concepts | Deterministic mock derived from inputs | `gpt-4o-mini` JSON-mode response |
| Reference image | Stdlib zlib PNG written locally | `gen4_image_turbo` task + downloaded PNG |
| Video task | In-memory mock; ~12 s with public sample MP4 | Real `image_to_video` / `text_to_video` |
| Character portrait | Stdlib zlib PNG written locally | Real `gen4_image_turbo` 1280×720 portrait via locked template + editable Portrait Prompt |
| Character → Runway Avatar | Synthetic `mock_char_avatar_…` id | Real `POST /v1/avatars` from cached portrait, poll READY |
| Brand Spokesperson Avatar | Synthetic READY avatar | Real `/v1/avatars` create + processing-poll to READY |
| Avatar Picker | 4 hard-coded preset entries | Real `GET /v1/avatars` (account customs) |
| Spokesperson Ad | ffmpeg lavfi 5 s 1088×704 silent placeholder | Real `/v1/avatar_videos` + downloaded MP4 |
| Final Voiced Cinematic Ad | ffmpeg mux of mock visual + lavfi mock audio (silent) | Real visual + real host audio, mux preserved |
| Storyboard shot | ffmpeg lavfi 5 s 1280×720 placeholder per shot | Real `/v1/image_to_video` per shot |
| Storyboard stitch | ffmpeg concat of mock shots → real MP4 | ffmpeg concat of real shots → real MP4 |
| Voiced storyboard | ffmpeg loop + mock host audio | ffmpeg loop + real host audio |
| Dialogue line | ffmpeg lavfi 5 s 1088×704 placeholder w/ speaker label | Real `/v1/avatar_videos` targeted at speaker's avatar id |
| Dialogue stitch | ffmpeg concat of mock lines | ffmpeg concat of real lines (audio preserved) |
| Brand Voice | ffmpeg lavfi 3 s silent MP3 placeholder | Real `/v1/voices` text-design + downloaded preview MP3 |
| Multilingual Dub | ffmpeg lavfi 3 s silent MP3 placeholder per lang | Real `/v1/voice_dubbing` + downloaded MP3 |
| Realtime Spokesperson | HTTP 503 from broker; UI button disabled with copy | Real `/v1/realtime_sessions` broker w/ campaign-aware personality + startScript |
| Campaign Pack | Same local ffmpeg in both modes (no provider call) | Same |

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

- **No third-party calls fire on page load.** Real Runway calls
  only fire on explicit user click. The optional
  `/api/runway/organization` read-only metadata fetch is the sole
  exception, and it's non-blocking.
- **Pre-flight policy validation.** Backend rejects unsupported
  model / ratio / duration / missing-image / unsupported-language
  / unsupported-voice-preset combinations with `HTTP 400` *before*
  any outbound HTTP. See `runway_client.GENERATION_POLICY` and
  `audio_client.SUPPORTED_DUB_LANGS`.
- **Honest fallbacks.** Avatar processing fails openly when the
  campaign image has no face — UI offers "Retry with stock
  portrait". Image-source labels (`campaign` / `override` / `stock`)
  stay on the campaign record so the demo story stays accurate.
- **Polling**: 5 s interval + 0–800 ms jitter, capped at 60
  attempts (~5 min); terminal states (`SUCCEEDED | FAILED |
  CANCELED`) stop polling immediately. Avatar processing has its
  own 90 s cap. Realtime READY poll has a 30 s cap.
- **Realtime session 5-min hard cap.** Runway's `expiresAt` is the
  ceiling; the frontend countdown surfaces it.
- **Realtime broker injects campaign context** (PR AE) — every
  `/v1/realtime_sessions` create includes a personality string
  built from business / product / audience / tone / character
  voice + personality / hook / caption / CTA / commercial_script.
  Falls back to bare body on 400 + redacts secrets in any logged
  upstream response.
- **Commercial Script cap** = 300 chars (matches `avatar_videos`
  speech limit). Storyboard shot prompt cap = 1000 chars. Dialogue
  line cap = 300 chars per line.
- **Settings persistence**: model / ratio / duration / textOnly /
  imageUrl in `localStorage` under `adspark.settings.v1` —
  clamped on restore so old or invalid combinations never survive
  a restart. Active spokesperson persists at
  `adspark.spokesperson.v1`.
- **Keys live only in the repo-root `.env`** (gitignored). The
  React app has no key access — every Runway call goes through
  FastAPI. Local `/api/runway/image/<id>` and
  `/api/characters/<id>/portrait` URLs are converted to base64
  data URIs server-side before being posted to Runway. Realtime
  credentials use a one-shot `sessionKey` JWT minted by the
  broker; the secret never reaches the browser.
- **CORS allowlist** defaults to `http://localhost:5173`.
- **Standalone repo.** `unified-donkey-betz` was inspected
  read-only for ffmpeg subprocess pattern shape during PR-pre-A
  bootstrap; nothing was copied verbatim and no runtime import /
  dependency exists.
