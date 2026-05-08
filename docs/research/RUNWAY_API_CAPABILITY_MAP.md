# Runway API Capability Map for AdSpark Studio

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Repo state:** `main` at `cf0ab49`, tags `hackathon-submission` (7ed949e)
and `hackathon-submission-v2` (e6ca02b).
**Status:** RESEARCH ONLY — no real Runway API calls were made and no
product code is changed by this document.

> Two prior Runway research notes already exist:
> `RUNWAY_CHARACTER_HOST_SPIKE.md` is the Avatars/avatar_videos
> deep-dive that powered PR F. This document is the broader **post-
> hackathon product expansion** map — what Runway can do, what we
> already do, and what's next if AdSpark becomes a real product.

---

## 1. Executive Summary

**What we already nailed.** AdSpark uses six Runway endpoints in
production today — `text_to_image`, `image_to_video`, `text_to_video`,
`tasks/{id}`, `avatars`, `avatar_videos` — plus a defensive
`organization` proxy. Every call goes through a typed FastAPI service
layer with a generation-policy validator that returns `400` before any
outbound HTTP. Local cache survives presigned URL expiry; mock paths
exist for every external surface; Playwright drives the full mock flow
on every commit. **For an entry hackathon scope, this is best-in-class
coverage.**

**What we should add next** (post-hackathon, in this order):

1. **Phase H — Voiceover + Multilingual Dub** (`text_to_speech` +
   `voice_dubbing`). Bundles cleanly with the existing host clip.
   Async HTTP, no new SDKs, instant commercial value, every
   campaign-pack pipeline benefits.
2. **Phase I — "Talk to your Brand Spokesperson" V1** (`realtime_sessions`
   + `@runwayml/avatars-react`). Smallest viable: a single `<AvatarCall>`
   drop-in + a backend session-broker route. Showcases what the avatar
   capability actually unlocks.
3. **Phase J — Aleph "Style Variant" remix** (`video_to_video`). One
   click on a saved campaign produces an alt-style cut for A/B testing.

**What to avoid for now.** Two-avatar dialogue (Act-Two multi-character
appears web-only), custom voice cloning gates that block the demo,
Runway Workflows (different mental model — closer to no-code flows
than developer API), and any auth/payment system on AdSpark itself.
Those are post-MVP product moves, not features.

**Realtime/webcam IS feasible**, even on localhost. Mic is required,
webcam is optional. The official `@runwayml/sdk` (server) +
`@runwayml/avatars-react` (client) packages drop in with a documented
credential-brokering flow that keeps the API key server-side. Smallest
V1 is roughly 200 LOC and one `<AvatarCall>` component. Detailed in §4.

---

## 2. Current AdSpark Runway Usage

| AdSpark feature | Runway endpoint(s) | Status | Where it lives |
|---|---|---|---|
| Reference image generation | `POST /v1/text_to_image` (`gen4_image_turbo`) | ✅ shipped | `services/image_client.py` |
| Image-to-video | `POST /v1/image_to_video` (`gen4_turbo` / `gen4.5`) | ✅ shipped | `services/runway_client.py` |
| Text-to-video | `POST /v1/text_to_video` (`gen4.5`) | ✅ shipped | `services/runway_client.py` |
| Task polling | `GET /v1/tasks/{id}` | ✅ shipped | `services/runway_client.get_task` + Phase 2 helpers |
| Brand Spokesperson Avatar | `POST /v1/avatars`, `GET /v1/avatars/{id}` | ✅ shipped (PR F) | `services/character_host_client.create_or_reuse_avatar` |
| Avatar Host Clip | `POST /v1/avatar_videos` | ✅ shipped (PR F) | `services/character_host_client.generate_host_video` |
| Plan / cap chip | `GET /v1/organization` | ✅ shipped (PR D, defensive) | `routers/runway.get_organization` |
| Local cache (presigned-URL durability) | `httpx.stream` + atomic write | ✅ shipped | `services/storage.VideoCache`, `image_client._download_image`, `character_host_client._download` |
| Campaign Pack finishing | local ffmpeg (no Runway call) | ✅ shipped (PR B) | `services/finisher_service.py` |

**That's 6 of ~25 production Runway endpoints actively used, plus 1
read-only metadata proxy.** Implementation is async-HTTP-only — zero
WebRTC, zero browser SDK, zero Runway-side workflows. Every call is
mock-backed.

What we **don't** do today (the rest of §3 catalogues these):

- Video-to-video (Aleph), character_performance (Act-Two)
- text_to_speech, speech_to_speech, voice_dubbing, voice_isolation, sound_effect
- Voices CRUD, voices/preview
- realtime_sessions, avatar_conversations, avatar_usage
- documents (RAG), workflows, workflow_invocations
- uploads, task DELETE (cancellation)

---

## 3. Full API Surface Matrix

| Capability | Endpoint | What it does | In AdSpark? | Product value | Demo value | Risk | Notes |
|---|---|---|---|---|---|---|---|
| **Reference image** | `POST /v1/text_to_image` | Synthesize an image from a prompt + ≥1 reference image | ✅ yes | high | high | low | We seed with a flat charcoal PNG; prompt remains dominant signal |
| **Image-to-video** | `POST /v1/image_to_video` | Animate a reference image with a prompt | ✅ yes | high | high | low | Backbone of the campaign clip |
| **Text-to-video** | `POST /v1/text_to_video` | Generate a clip from a prompt only (Gen-4.5) | ✅ yes | high | high | low | Routes from same UI when text-only checkbox is set |
| **Video-to-video / Aleph** | `POST /v1/video_to_video` | Style/edit transfer onto a source video | ❌ no | **high** (style variants, A/B) | medium | medium | Strong post-hackathon win for "pro-tier" plan |
| **Character Performance / Act-Two** | `POST /v1/character_performance` | Drive a character image/video with a performance video | ❌ no | medium | medium | medium | Wrong primitive for "host reads a script" — useful for "founder appears as a stylised character" |
| **Image generation (multi-ref)** | `POST /v1/text_to_image` with multiple `referenceImages` | Multi-image grounding (e.g. brand guidelines + product) | partial | high | medium | low | We pass 1 reference today; supporting up to 16 (GPT Image 2 limit) is a one-prop change |
| **Avatar create** | `POST /v1/avatars` | Create a persistent persona from one image | ✅ yes (PR F) | high | high | low | Per-campaign avatar identity; image-source fallback chain |
| **Avatar update / list / delete** | `PATCH/GET/DELETE /v1/avatars/{id}` | CRUD for avatars | ❌ no | medium (multi-campaign) | low | low | Useful when one brand has many campaigns and wants a single shared mascot |
| **Avatar usage** | `GET /v1/avatar_usage` | Per-account avatar quota / usage telemetry | ❌ no | medium | low | low | Could surface beside the org cap chip |
| **Avatar video** | `POST /v1/avatar_videos` | Async clip of an avatar speaking a script | ✅ yes (PR F) | high | high | low | "Avatar Host Clip" |
| **Avatar conversations** | `GET / DELETE /v1/avatar_conversations` | List/delete recorded session transcripts | ❌ no | medium | low | low | Only meaningful once realtime_sessions exists |
| **Realtime sessions** | `POST/GET/DELETE /v1/realtime_sessions` | Live WebRTC avatar conversation (≤5 min) | ❌ no | **highest** (Talk to your Brand Spokesperson) | **highest** | medium | Three-party broker via `@runwayml/sdk` + `@runwayml/avatars-react`. See §4. |
| **Voices CRUD** | `POST/GET/PATCH/DELETE /v1/voices` | Custom voice design (text→voice) or clone (audio→voice) | ❌ no | high (brand voice) | medium | low | 30 presets cover the demo; cloning is a "pro-tier" feature |
| **Voice preview** | `POST /v1/voices/preview` | Listen to a voice without committing | ❌ no | medium | medium | low | Pairs with a voice-picker UI |
| **Text-to-speech** | `POST /v1/text_to_speech` | Pure narration audio from text + voice id | ❌ no | high (voiceover) | high | low | Bundles cleanly with the existing video pipeline; ffmpeg amix |
| **Speech-to-speech** | `POST /v1/speech_to_speech` | Transform an audio file into a different voice | ❌ no | medium | low | low | Brand-voice rewrite of user-provided narration |
| **Voice dubbing** | `POST /v1/voice_dubbing` | Replace audio in a video with a target language (29 langs) | ❌ no | **high** (multilingual ads) | high | medium | Most direct enterprise differentiator |
| **Voice isolation** | `POST /v1/voice_isolation` | Strip background noise / extract voice | ❌ no | medium | low | low | Mostly post-production cleanup |
| **Sound effect** | `POST /v1/sound_effect` | Generate SFX from a text description | ❌ no | medium | medium | low | Pairs with TTS for full audio bed |
| **Uploads** | `POST /v1/uploads` | Server-side asset upload for downstream tasks | ❌ no | low–medium | low | low | Public URL + data URI cover current paths; useful for large user assets |
| **Task fetch** | `GET /v1/tasks/{id}` | Poll status of any async task | ✅ yes | n/a | n/a | n/a | Universal across endpoints |
| **Task cancel** | `DELETE /v1/tasks/{id}` | Cancel a running task | ❌ no | medium | low | low | Low value at our 5–10 s clip durations; useful at multi-minute Aleph |
| **Documents** | `POST/GET/PATCH/DELETE /v1/documents` | RAG knowledge base for avatars (grounding) | ❌ no | high (when realtime lands) | medium | low | Avatar can answer FAQs about the brand from grounded documents |
| **Workflows** | `POST /v1/workflows/{id}`, `GET /v1/workflow_invocations/{id}` | Run pre-published Runway Workflows | ❌ no | unclear | low | medium | More no-code marketplace than developer API; uncertain fit |
| **Organization metadata** | `GET /v1/organization` | Plan info / monthly cap | ✅ yes (defensive) | low | low (chip only) | low | Today exposes only `monthly_credit_cap`, not balance |

Active endpoint coverage today: **6/25** capabilities.
Asynchronously addressable post-hackathon: **22/25** with no new
infrastructure (everything except realtime_sessions, workflows, and
the WebRTC pieces).

---

## 4. Webcam / Realtime Character Research

### What Runway exposes

`/v1/realtime_sessions` is a documented WebRTC pipeline that creates a
live audio-(and-optional-video) conversation with an Avatar. The
documented integration pattern is a **three-party broker**:

```
Browser (React app)                Your server (FastAPI)            Runway
───────────────────                ──────────────────────           ──────
1. POST /api/avatar/session ─────► 2. realtimeSessions.create({avatar})
                                   3. poll until status === READY
                                   4. POST /v1/realtime_sessions/{id}/consume
5. ◄──── {sessionId, serverUrl,    ────────────► returns one-shot credentials
         token, roomName} ◄────── 4. (server returns to browser)
6. WebRTC connect (room+token) ─────────────────────────────────────► live A/V
                                       (mic required, cam optional, screen opt.)
                                       max ~5 min per session
```

Key facts (from `docs.dev.runwayml.com/characters/integration/`):

- Server SDK: **`@runwayml/sdk`** (npm). Polls `realtimeSessions` to
  `READY` and consumes one-shot credentials.
- Client SDK: **`@runwayml/avatars-react`** (npm). Provides
  `<AvatarCall>` (drop-in UI), `<AvatarSession>` (context provider),
  `useAvatarSession` (state + `end()`), `useLocalMedia`
  (`isMicEnabled`, `toggleMic()`), `<AvatarVideo>`, `<UserVideo>`,
  `<ControlBar>`.
- Mic permission is **required**; cam is **optional**; screen-share is
  optional.
- Session credentials can be retrieved **once** and the WebRTC
  connection must complete within ~60 seconds before they're voided.
- **5-minute max session duration.**
- Audio-only sessions are supported (no webcam needed).

### Localhost feasibility

WebRTC over `localhost:5173` should work for a development demo —
modern browsers allow `getUserMedia` over `http://localhost` (no HTTPS
needed) and the WebRTC handshake itself is to Runway's servers, not
to AdSpark's backend, so we don't need to terminate WebRTC ourselves.
Practical caveats:

- `getUserMedia` is gated behind a browser permission prompt the first
  time per origin.
- Vite's dev server is fine; production builds also fine if served
  from `localhost` or a real HTTPS origin.
- We don't have to run our own STUN/TURN servers — Runway provides
  them as part of the `serverUrl` in the broker payload.

### Auth / security

The broker pattern is the entire security model:

- `RUNWAYML_API_SECRET` lives only on FastAPI; the React app never
  sees it.
- Session credentials are short-lived, single-room, per-user.
- The 60-second consume-and-connect window means a stolen token is
  near-immediately useless.

Our PR D infrastructure (`/api/runway/provider-status` + secret-free
metadata + JSON config + httpx) maps cleanly. Adding a session-broker
route is structurally identical to adding `/api/runway/image`.

### Mock strategy

Two viable approaches:

1. **Disable feature in mock mode.** `runway_mock = True` →
   `provider-status.realtime_available = false`; UI hides the "Talk to
   your Brand Spokesperson" button with an amber "available in real
   mode only" hint. Cleanest for CI; zero new mock infra.
2. **Mock with a placeholder MP4 loop.** `runway_mock = True` → backend
   returns a fake session with a local MP4 URL the avatars-react
   component can theoretically consume as `<AvatarVideo>`. Higher
   complexity; only worth it if Playwright needs to drive the flow.

**Recommended:** start with (1). The Playwright smoke can assert the
button + mode-conditional hint. (2) only adds value if a future
acceptance test must exercise live A/V plumbing.

### Two avatars talking to each other

Runway's "Multi-Character Dialogues with Act-Two" appears to be a
**web-only** Runway feature today (the help page returned 403 on
direct fetch; mentions of it surface in product changelog notes
rather than `docs.dev.runwayml.com`). The API surface for Act-Two is
`character_performance` which expects a *driving performance video*,
not a script. **Two-avatar conversation via API is not currently
documented as a first-class flow.**

Workarounds for "two avatars talking" if pursued:

- **Sequential `avatar_videos` per turn**, stitched with ffmpeg
  `concat`. Each turn is one async task; turns are ordered by a
  script. This is hackable today with PR F's primitives.
- **Two parallel `realtime_sessions`** with one human in each room
  acting as relay. Brittle, not recommended.

### Can AdSpark add "Talk to your AI Brand Spokesperson"?

**Yes — feasible in roughly 1 day of focused work.** Smallest V1:

- New `services/realtime_session_broker.py`: `create_session(avatar_id)`
  → `realtimeSessions.create()` → poll READY → consume → return
  `{sessionId, serverUrl, token, roomName}` to the frontend.
- New route `POST /api/campaigns/{id}/avatar-call` returning the
  broker payload (gated on `host_avatar_status === "ready"` like
  Phase 2 today).
- Frontend gallery card adds a "Talk to your Brand Spokesperson"
  button next to "Present Campaign". Click → broker call → mount
  `<AvatarCall>` in an overlay. The component handles WebRTC,
  mic permission, the call UI, and tear-down.
- npm install `@runwayml/avatars-react` (~200 KB tree-shakable).

Product-grade version (post-V1) would add:

- Documents (`/v1/documents`) for grounded responses about the
  campaign, brand voice, and product details.
- Conversation transcript surfacing via `/v1/avatar_conversations`.
- Persona editor — `personality` system prompt per campaign.
- Cost-aware UI: 5-min cap visible, "minutes remaining today" pulled
  from `avatar_usage`.
- Audio-only mode toggle so no-camera demos still work.
- Custom branded voice (`POST /v1/voices` design or clone) used by
  the avatar.

Realtime is the single highest-leverage post-hackathon feature for
AdSpark's "AI ad studio" positioning.

---

## 5. Product Expansion Opportunities

Ranked by AdSpark fit + effort. Tier 1 = strong fit, likely worth
building soon. Tier 4 = do not build yet.

### Tier 1 — Strong fit, likely worth building soon

| Feature | Effort | Endpoints | Why |
|---|---|---|---|
| **Voiceover + Multilingual Dub Pack** | ~1 day | `text_to_speech`, `voice_dubbing`, `voices` | Bundles directly with finished Pack MP4s; zero WebRTC; produces 5–29 language variants per campaign. Massive enterprise differentiator. |
| **Talk to Brand Spokesperson V1** | ~1 day | `realtime_sessions`, `avatars`, npm `@runwayml/avatars-react` | Showcases what the Avatar capability is actually for. Sells the "AI presenter" story live. Localhost-feasible. |
| **Aleph Style Variants** | ~1 day | `video_to_video` | One-click style-variant remixes for A/B testing. Real Runway capability we don't currently use. |
| **Campaign Export Bundle** | ~3 hours | local only | Zip of: original ad, three Pack MP4s, host clip, voiceover audio, social copy JSON, brand spokesperson thumbnail. Lets users walk away with a deliverable. |

### Tier 2 — Good idea, but after the demo recording lands

| Feature | Effort | Endpoints | Why |
|---|---|---|---|
| **Multi-reference image gen** | ~3 hours | `text_to_image` (multi-ref) | Brand-guideline image + product image → on-brand reference. Tiny code change. |
| **Sound-effect bed** | ~half day | `sound_effect` + ffmpeg amix | Per-campaign SFX layer mixed into finished Pack. |
| **Voice cloning (brand voice)** | ~half day | `voices` (clone), `text_to_speech` | Asks user for 10 s–5 min audio sample → custom brand voice used by avatar + voiceover. Onboarding flow. |
| **Documents / RAG grounding** | ~half day | `documents` | Upload brand FAQ, the avatar can cite it during realtime conversations. Pairs with Tier 1 #2. |
| **Avatar usage dashboard** | ~3 hours | `avatar_usage`, `organization` | Daily / monthly avatar-minutes consumed; budgeting story. |
| **Public hosted demo** | ~half day | n/a (Vercel + Render/Fly + ffmpeg image) | Removes "you have to clone the repo" friction. |

### Tier 3 — Cool but risky / unclear ROI

| Feature | Effort | Endpoints | Why |
|---|---|---|---|
| **Two-avatar campaign debate** | ~1.5 days | sequential `avatar_videos` + ffmpeg concat | Cute, but Runway's first-class multi-character flow is web-only. Hackable but not a clear product win. |
| **Live webcam campaign coach** | ~1.5 days | `realtime_sessions` with cam on | Avatar gives feedback on the user's camera-rehearsed pitch. UX is fragile mid-demo. |
| **Speech-to-speech brand voice rewrite** | ~half day | `speech_to_speech` | User uploads voiceover, gets it in the brand voice. Better as a sub-feature of the dub pack than its own thing. |
| **Workflows** | ~1 day | `/v1/workflows/{id}` | Treats Runway like a no-code automation marketplace. Doesn't fit AdSpark's developer-tool positioning yet. |
| **Server-side `uploads`** | ~3 hours | `/v1/uploads` | Useful for very large user assets that can't fit in a JSON body. Niche. |

### Tier 4 — Do not build yet

- Cancellation (`DELETE /v1/tasks/{id}`) — low value at our clip durations.
- Voice isolation as a top-level feature — pure post-prod utility, no story.
- Avatar CRUD UI for "manage many avatars" — only relevant once we have multi-campaign / multi-brand workflows.
- Auth / multi-user / payment / billing on AdSpark — premature; the current local-first model is the differentiator.
- Stability.ai / OpenAI image fallback paths — `gen4_image_turbo` covers the demo and Stability is parked as production insurance only.

---

## 6. Recommended Next 3 Phases

### Phase H — Voiceover + Multilingual Dub Pack

**Goal**: Add a campaign-level "Voiceover" + "Dub Pack" feature so
each saved campaign can ship with narrated audio in any of 29
languages.

**User story**: *"After my Campaign Pack is built, I want one click
that produces an English voiceover for the campaign and a Reels-cut
dubbed into Spanish, French, and Mandarin. AdSpark gives me a folder
of regional variants for the same ad."*

**Endpoints used**:
- `POST /v1/text_to_speech` — one TTS task per language (script
  templated from the saved concept's hook + caption + CTA).
- `POST /v1/voice_dubbing` — re-voices the finished Pack MP4 in each
  target language.
- `GET /v1/voices`, `POST /v1/voices/preview` — voice picker UI.
- `GET /v1/tasks/{id}` — same polling we already do.

**Backend changes**:
- New `services/audio_client.py` — TTS + dub helpers, mock-safe.
- New `services/storage.update_audio_fields` for per-language URLs.
- New routes `POST /api/campaigns/{id}/voiceover`, `POST
  /api/campaigns/{id}/dub?lang=es-MX`, `GET /api/campaigns/{id}/audio/{kind}`.
- Optional ffmpeg pass: `amix` voiceover into the finished Pack
  MP4s. (Reuses `finisher_service` patterns.)

**Frontend changes**:
- New "Audio" subsection on saved cards: voice picker, "Generate
  voiceover" button, language chips ("EN done · ES building · FR
  pending"), inline `<audio controls>` previews.

**Mock strategy**:
- TTS mock: stdlib WAV header + 1 s silent PCM, written to
  `backend/data/audio/<id>-<lang>.wav`. Same dependency-free pattern as
  the existing PNG mock.
- Dubbing mock: ffmpeg `amix` of TTS output onto the cached Pack MP4 —
  stays local, no third-party calls.

**Verification**: same as PR B/F — mock end-to-end via curl, real
hero-run on campaign `9a717c675ec6`, ffprobe of audio streams,
Playwright assertion that the Audio subsection renders.

**Estimated risk**: low. Async HTTP, no WebRTC, fits the existing
Phase-style storage and routing.

---

### Phase I — Talk to Your Brand Spokesperson V1

**Goal**: Let users (and judges) hold a 5-minute live audio
conversation with the campaign's Brand Spokesperson Avatar.

**User story**: *"After I create my campaign and Brand Spokesperson,
I want to click 'Talk to your Spokesperson' and ask them to pitch
the brand to me in real time. I get a 60-second sales-ready demo I
can record and ship to the team."*

**Endpoints used**:
- `POST /v1/realtime_sessions` — server-side session creation.
- `POST /v1/realtime_sessions/{id}/consume` — server-side credential
  consume.
- `GET /v1/realtime_sessions/{id}` — server-side READY polling.
- `@runwayml/avatars-react` `<AvatarCall>` for the client UI.

**Backend changes**:
- New `services/realtime_session_broker.py` — three-party broker
  helpers; never logs the API key, returns only the four fields
  `{sessionId, serverUrl, token, roomName}` to the client.
- New route `POST /api/campaigns/{id}/avatar-call` (gated on
  `host_avatar_status in {ready, mock}`).
- Add `realtime_available` boolean to `/api/runway/provider-status`
  so the UI can hide the button in mock mode.

**Frontend changes**:
- npm install `@runwayml/avatars-react` and `@runwayml/sdk` (the
  client component depends on it).
- New "Talk to your Brand Spokesperson" button on the saved card,
  next to "Present Campaign".
- New `<AvatarCallOverlay>` modal mounting `<AvatarCall>` once the
  broker returns. Includes a 5-min countdown and an end-call button.
- Mode banner picks up a fourth pill: `Realtime (Runway): real|mock`.

**Mock strategy**:
- Mock mode: `provider-status.realtime_available = false` →
  frontend shows the button disabled with an amber "available in real
  mode only" hint. Playwright asserts the button + hint are present.
- No WebRTC plumbing in the mock path. Real call only happens when
  `RUNWAY_API_KEY` is set.

**Verification**:
- Mock: button visible + disabled + tooltip; Playwright asserts.
- Real: short live call against the existing PR F V2 avatar
  (`6f18ad26-5976-4891-b085-61c1646c1251`). Confirm mic permission
  prompt, audio round-trip, end-call cleanup, no API key in
  network tab.
- Doc update to README "Demo flow" + DEMO_SCRIPT new Path E.

**Estimated risk**: medium. WebRTC adds a new dependency surface; the
60 s consume-and-connect window means slow networks can fail. Mic
permission prompt is the single biggest mid-demo failure point.
Mitigation: pre-warm the prompt before recording.

---

### Phase J — Aleph Style Variant Remix

**Goal**: One click on a saved campaign produces a stylised remix of
the finished Pack via Runway Aleph (`video_to_video`).

**User story**: *"I have a finished campaign and I want to A/B test
two different visual styles for the Reels cut. AdSpark gives me a
'Remix as cinematic noir' button and a second variant appears next to
the original."*

**Endpoints used**:
- `POST /v1/video_to_video` (Aleph) — new task taking the cached
  Reels MP4 + a style prompt.
- `GET /v1/tasks/{id}` polling.

**Backend changes**:
- Extend `runway_client.create_task` (or a new `aleph_client.py`) to
  route `video_to_video` requests. Same task/poll/download pipeline.
- New storage field `Campaign.style_variants: dict[str, str]` mirroring
  `finished_videos`.
- New route `POST /api/campaigns/{id}/remix?style=<noir|chrome|sepia>`,
  `GET /api/campaigns/{id}/remix/{style}`.

**Frontend changes**:
- New "Style Variants" subsection on saved cards beneath Campaign
  Pack: 3–5 named style buttons. Clicking builds a remix; ready
  variants show inline players.

**Mock strategy**:
- ffmpeg `lutyuv` / `hue` filter passes on the cached Pack MP4 produce
  visually-distinct mock variants (noir → desaturate, chrome →
  hue-shift). Stays local; same ffmpeg dependency.

**Verification**:
- Mock: ffprobe each variant stays at the source dimensions.
- Real: one credit-spend remix on campaign `9a717c675ec6` against
  Aleph's "noir" style. Confirms task completes and downloads.

**Estimated risk**: low–medium. Aleph runtime is longer than other
tasks (~minutes for 5 s clips) — needs the same patient polling
pattern as Gen-4.5. Cost per remix is non-trivial.

---

## 7. Commercial Product Angle

### Target users

1. **Indie founders / small DTC brands** — already AdSpark's hackathon
   target. They need ads + spokespeople and can't afford agencies.
2. **Solo marketers at Series-A startups** — same shape, different
   buying authority. Pay-per-month works. Higher LTV.
3. **Affiliate / creator economy** — folks who launch lots of
   small ad variants and need rapid iteration. Volume-friendly.
4. **Enterprise marketing teams running multilingual campaigns** —
   the dub-pack feature alone justifies a seat license.

### Use cases that the existing flow + Phase H/I/J would cover

- **Launch ad assembly**: business idea → 3 concepts → reference
  image → video → Campaign Pack → voiceover + dub → host clip → talk
  to spokesperson on a sales call. Single tool, one afternoon.
- **A/B style testing**: one campaign, three Aleph remixes. Compare
  conversion across visual treatments without re-shooting.
- **Multilingual rollout**: same campaign in 5+ languages with
  consistent brand voice. Faster than any human dub workflow.
- **Always-on brand presenter**: realtime spokesperson available
  during demos, sales calls, customer onboarding.
- **Asset hand-off**: export bundle includes everything a downstream
  team would need (raw, finished, audio, transcripts).

### Pricing ideas

| Tier | Price | What's included | Constraint |
|---|---|---|---|
| **Free** | $0 | Mock mode, 1 saved campaign | No real Runway calls |
| **Creator** | $29/mo | 5 campaigns/mo, all Pack formats, host clip | English-only voiceover |
| **Brand** | $99/mo | 25 campaigns/mo, voiceover + dub up to 5 languages, 30 min/day realtime spokesperson | Custom voice cloning included |
| **Enterprise** | $499/mo + Runway pass-through | Unlimited campaigns, 29-language dub, multi-brand avatar library, RAG documents, transcript archive | API access for integration |

These are illustrative — the actual moat is that AdSpark wraps Runway
with a *campaign-shaped* mental model, not a generic asset model.
Everything ties back to the saved campaign record.

### Minimum product needed (post-hackathon)

- **Phases H + I + J** as scoped above (~3 focused days).
- Public hosted deploy (Vercel + Render/Fly with ffmpeg in the runtime
  image, Runway key as platform env var).
- Auth (single-user per workspace; magic link is enough at first).
- Basic billing (Stripe per-tier).
- Per-user campaign isolation (today's single-process JSON store
  becomes per-user JSON or Postgres; this is the only place where the
  current architecture has to grow).

### Differentiator vs simple AI video tools

Most "AI video" tools today output **a single clip and stop.**
AdSpark's positioning: **"AI ads — but you also get the spokesperson,
the platform pack, the multilingual dub, and a permanent local copy
of every asset."** The Campaign concept is the moat — every Runway
capability becomes a button on the same card, glued by ffmpeg, never
losing the artefact when Runway URLs expire.

### Where Runway is the core value

- Reference image quality at speed (`gen4_image_turbo` <10 s).
- Best-in-class video diffusion (Gen-4.5 / Gen-4 Turbo).
- The only avatar API that lets us turn a *campaign image* into a
  reusable spokesperson — not an upload-your-photo flow.
- Realtime voice + video conversations with a custom avatar — the
  most novel + commercially valuable surface in this map.

Runway provides the AI horsepower; AdSpark provides the campaign-shaped
product surface around it.

---

## 8. Hard Guardrails

Things to **not** do, even if it seems obvious or quick:

- **No replacing the existing working flow.** Phase H/I/J are strictly
  additive. The Concept → Image → Video → Save → Pack → Spokesperson
  → Host Clip pipeline must keep working unchanged.
- **No breaking local-only storage** for the hackathon scope. Postgres
  / Supabase / cloud KV is a *post*-MVP migration.
- **No committing media.** `backend/data/` stays gitignored. Every
  new feature adds its own gitignored subdirectory (`data/audio/`,
  `data/realtime/`, `data/style/`).
- **No exposing the Runway API key to the frontend.** Realtime
  sessions specifically must use the broker pattern.
- **No coupling to `unified-donkey-betz`.** Read-only inspection only;
  any pattern borrowing requires explicit per-call approval.
- **No large auth/payment system yet.** Single-user, single-machine is
  fine for the hackathon. Auth comes after the recording lands.
- **No enterprise rewrite** — keep FastAPI single-process. Performance
  is fine at hackathon-scale.
- **No Stability.ai integration** unless Runway specifically can't
  meet a need. Documented in PR F session notes.
- **No additional tags before merging Phase H** — `hackathon-submission`
  and `hackathon-submission-v2` cover the current dual baseline.

---

## Appendix A — Sources

Public Runway documentation read during this audit, all treated as
untrusted external content (any embedded prompt-injection ignored):

- API Reference index — `docs.dev.runwayml.com/api/`
- Characters integration guide — `docs.dev.runwayml.com/characters/integration/`
- Characters core concepts — `docs.dev.runwayml.com/characters/concepts/`
- Custom voices — `docs.dev.runwayml.com/characters/custom-voice/`
- SDKs — `docs.dev.runwayml.com/api-details/sdks/`
- Inputs — `docs.dev.runwayml.com/assets/inputs/`
- Changelog — `docs.dev.runwayml.com/api-details/api_changelog/`
- Help: Creating with Gen-4 Video, Gen-4.5, Act-Two
  (`help.runwayml.com/hc/en-us/articles/...`)

Plus the prior probes recorded in
`docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` (avatars + avatar_videos
schema) and the PR D `/v1/organization` proxy verification.

**No real Runway API calls were made for this document.** **No code
was modified.** **No `unified-donkey-betz` runtime references
introduced.** The 50 k credit pool is untouched by this research.

---

## Appendix B — Recommended next implementation prompt

If approving Phase H next, the prompt to give a future session is:

> "AdSpark Studio — Phase H: Voiceover + Multilingual Dub Pack.
> Build on `main` at `cf0ab49`. Branch:
> `feature/pr-h-voiceover-and-dub`. Add `services/audio_client.py`
> wrapping `/v1/text_to_speech` (real + stdlib WAV mock) and
> `/v1/voice_dubbing` (real + ffmpeg amix mock). New routes
> `POST /api/campaigns/{id}/voiceover`, `POST /{id}/dub?lang=...`,
> `GET /{id}/audio/{kind}`. Persist on Campaign:
> `voiceover_audio_url`, `dubbed_audio_urls: dict[str, str]`. Frontend
> Audio subsection on saved card. Mock-safe. Single real verification
> on campaign `9a717c675ec6`. Existing Spokesperson + Host Clip +
> Campaign Pack flow untouched. See
> `docs/research/RUNWAY_API_CAPABILITY_MAP.md` §6 Phase H for the
> full scope."

For Phase I / J the same shape applies — see §6 for endpoint lists,
backend/frontend diffs, and verification scope.

---

## Appendix C — Phase H Live Probe (2026-05-08)

A small credit-spend probe ran against `/v1/voices`,
`/v1/text_to_speech`, and `/v1/voice_dubbing` to lock the audio
schemas. Findings:

### `POST /v1/voices` — works

Body shape:
```jsonc
{
  "name": "AdSpark Brand Voice (probe)",
  "from": {
    "type": "text",
    "prompt": "<≥20 char description>",
    "model": "eleven_multilingual_ttv_v2"
  }
}
```

Returns `{id: "<uuid>"}`. Poll `GET /v1/voices/{id}` until
`status == "READY"` (~10 s). Response shape:
```jsonc
{
  "id": "...",
  "name": "...",
  "status": "READY",
  "previewUrl": "https://d2jqrm6oza8nb6.cloudfront.net/.../voice_sample_*.mp3?_jwt=…",
  "createdAt": "..."
}
```

The `previewUrl` is a presigned CloudFront MP3 we can download and
cache locally (~250 KB).

### `POST /v1/voice_dubbing` — works

Body shape:
```jsonc
{
  "model": "eleven_voice_dubbing",
  "audioUri": "<public URL or data: URI>",
  "targetLang": "<one of 29 lang codes>"
}
```

Returns `{id: "<task uuid>"}`. Same `/v1/tasks/{id}` polling shape.
Output `["<presigned mp3 URL>"]`. ~25 s for a short voice sample.

The 29 documented language codes (validator-dumped on a bad
`targetLang`):

> en, hi, pt, zh, es, fr, de, ja, ar, ru, ko, id, it, nl, tr, pl, sv, fil, ms, ro, uk, …
> (the validator truncated at 21; the page doc says 29 total)

### `POST /v1/text_to_speech` — schema gated

Confirmed:
- `model: "eleven_multilingual_v2"` (single allowed value)
- `promptText: <string>` (the script)
- `voice` is a required object with a discriminated-union `type` field

**The `voice.type` discriminator is gated.** Runway's validator does
not dump allowed values for this union (unlike avatars where the
allowed value `"custom"` did surface). Tried 30+ candidate
discriminator values (`custom`, `voiceId`, `voice`, `preset`, `text`,
`design`, `clone`, `library`, `system`, `default`,
`elevenlabs-preset`, etc.) — all rejected with the same "Invalid
input" without a `values` array.

**Phase H V1 ships voice creation + dubbing only.** Direct TTS
narration of a custom campaign script is deferred until the
discriminator is documented or surfaced through Runway support.

### `GET /v1/voices` — works (returns paginated list)

```jsonc
{ "data": [...], "hasMore": false, "nextCursor": null }
```

Useful for a future "manage your voices" UI.
