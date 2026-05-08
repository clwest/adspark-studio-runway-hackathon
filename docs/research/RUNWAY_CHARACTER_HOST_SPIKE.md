# Runway Character Host — Research Spike

**Branch:** `research/runway-character-host`
**Date:** 2026-05-08
**Status:** RESEARCH ONLY — no code changes, no real API calls.
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)

## TL;DR

> **Recommend GO on a *V1 "Present Campaign with AI Host"* using
> `POST /v1/avatar_videos` (scripted speech, async task, no WebRTC).
> Estimated 1–1.5 days of focused work. WebRTC `realtime_sessions` and
> Act-Two `character_performance` are out of scope for V1 because each
> doubles the frontend complexity and adds dependencies we don't need
> for a "host narrates the saved campaign" demo.**

The existing AdSpark pipeline (Concept → Reference Image → Video → Save
→ Campaign Pack) stays untouched. The host shows up as a separate,
opt-in card in the saved-campaign gallery — never on the main
generation flow.

---

## 1. Endpoint inventory (researched)

The Runway API exposes a *Characters* family that splits cleanly along
two axes: **scripted-async** (HTTP polling, like our existing flow) vs.
**realtime-WebRTC** (live peer-to-peer voice conversation).

| Endpoint | Purpose | Async task? | WebRTC? | V1 fit |
|---|---|---|---|---|
| `POST /v1/avatars` | Create an Avatar from a reference **image** + persona/voice config | sync (returns id) | no | ✅ core |
| `GET / PATCH / DELETE /v1/avatars/{id}` | CRUD for avatars | sync | no | as needed |
| `POST /v1/avatar_videos` | **Generate a video where avatar speaks a script** | async (`/v1/tasks/{id}` polling) | **no** | ✅ V1 hero |
| `GET /v1/avatar_usage` | Avatar usage telemetry | sync | no | nice-to-have |
| `POST /v1/realtime_sessions` | Live WebRTC conversation session (5 min cap) | poll-to-READY then WebRTC | **yes** | ❌ V2+ |
| `GET / DELETE /v1/realtime_sessions/{id}` | Session mgmt | sync | no | only with realtime |
| `GET / DELETE /v1/avatar_conversations` | Read/delete recorded session transcripts | sync | no | only with realtime |
| `POST /v1/character_performance` (Act-Two) | Animate a character image/video to a *driving performance video* | async | no | ❌ wrong primitive (no script input) |
| `POST /v1/text_to_speech` | TTS audio file from text + voice | async | no | optional building block |
| `POST /v1/voices` / `POST /v1/voices/preview` | Custom voice design or clone | async | no | optional V2 |
| `POST /v1/voice_dubbing` / `voice_isolation` / `sound_effect` / `speech_to_speech` | Various audio utilities | async | no | not needed |

### What an Avatar actually is

> "A persistent persona with a defined appearance, voice, and personality."
> — Runway Characters Core Concepts

- **Created from a single reference image.** "Any visual style works,
  from photorealistic humans to animated mascots to stylized brand
  characters." No video required at create time.
- **Persona** = system-prompt-style behavior description.
- **Voice** = preset (Clara / Victoria / Vincent via `runway-live-preset`)
  OR `custom` voice id (designed via text prompt or cloned from a
  10 s–5 min audio sample).
- **Both persona and voice can be overridden per-call** without
  modifying the Avatar object.

### Realtime vs. scripted — the key distinction

- **`realtime_sessions`** = live WebRTC connection between user and
  Avatar. 5-min cap. Requires browser SDK + mic/cam permissions +
  server-side credential brokering. Sessions progress
  `NOT_READY → READY → RUNNING → COMPLETED/FAILED/CANCELLED`. Per the
  Runway integration guide: "Webcam and screen share are part of the
  same realtime Session as audio (the usual WebRTC call)." The session
  credentials can only be retrieved once.
- **`avatar_videos`** = async task that produces a downloadable MP4 of
  the avatar speaking a script. Same task/polling pattern we already
  use for `image_to_video`. **No browser, no WebRTC, no mic/cam.**

This split is the entire reason V1 is feasible: AdSpark has nothing to
do with live conversation; we only need the avatar to *deliver a
scripted pitch over the saved campaign*. `avatar_videos` is the right
primitive.

### What Act-Two is *not* (ruling it out)

`POST /v1/character_performance` (Act-Two) takes a **driving performance
video** (someone acting/speaking on camera) plus a character image or
video, and transfers body+facial movement to the character. It is *not*
a text-to-speech-driven endpoint. To use it for a "host narrates the
campaign" demo we'd have to:
1. Record (or generate) a driving performance video — significant
   complexity and an additional Runway call we don't need.
2. Or pre-record a host video ourselves and ship it bundled —
   defeats the AI-generated story.

Act-Two is the right primitive for a future "user uploads themselves
acting and we stylize them as the spokesperson" feature. Not for V1.

---

## 2. Credentials / settings required

No new auth model. The existing `RUNWAY_API_KEY` already covers the
Characters family per the Runway docs. Concretely:

- Existing: `Authorization: Bearer ${RUNWAY_API_KEY}`,
  `X-Runway-Version: 2024-11-06`. Reused as-is.
- New backend setting (optional): `RUNWAY_HOST_VOICE_PRESET` (default
  `Vincent`) so the demo can choose Clara / Victoria / Vincent without
  shipping a custom voice.
- New backend setting (optional): `RUNWAY_DEFAULT_HOST_AVATAR_ID` —
  cached after first creation so we don't recreate the same Avatar
  every call.

No additional secrets, no third-party dependencies, no Stability.ai or
ElevenLabs keys (Runway hosts the voice presets internally and exposes
ElevenLabs as a custom-voice model behind their own API).

---

## 3. Q&A — the ten questions

### Q1. What endpoints are required?
**Minimum viable set for V1:**
1. `POST /v1/avatars` — create the host once, persist the id locally.
2. `POST /v1/avatar_videos` — fire one task per "Present Campaign"
   click, with `{avatarId, script}`.
3. `GET /v1/tasks/{id}` — poll (already implemented for video).
4. *(Optional)* `POST /v1/text_to_speech` if we want the audio
   independent of an avatar — out of V1 scope.

### Q2. What credentials/settings are required?
Reuse existing `RUNWAY_API_KEY`. No new env vars are *required*; two
optional ones are nice-to-have (host voice preset, cached avatar id).

### Q3. Can we create/reuse a character from the generated reference image?
**Yes** — `POST /v1/avatars` accepts a single reference image. We could
pass our own `gen4_image_turbo`-generated reference image (or any
public/data-URI image) as the avatar's appearance. **Risk**: avatar
fidelity from a non-portrait reference (e.g., a landscape coffee shop
hero image) is unproven and likely poor. Real human / mascot portraits
work better than scene shots.

**Recommended V1**: ship with a curated stock host (or one
AdSpark-branded mascot) created once at app boot, cached server-side.
Allow "use the campaign's reference image as the host" as a
one-checkbox V1.5 toggle once we've measured fidelity.

### Q4. Can the character speak a short generated campaign script?
**Yes** — that's exactly what `POST /v1/avatar_videos` does. Per the
Runway Avatar Videos endpoint description: "Generate avatar video from
audio or text." The script is the user-supplied text; the avatar speaks
it in the configured voice.

For AdSpark the script writes itself — we already have the saved
campaign's `selected_concept`, which includes `hook`, `caption`, `cta`,
plus the business name and product. A simple template like:

```
"{hook} ... {caption} ... {cta}"
```

produces a 10–25 s read that pairs naturally with the existing 5 s ad
clip.

### Q5. Can this work without WebRTC?
**Yes — completely.** `avatar_videos` is an async HTTP task. No browser
WebRTC, no mic/cam permissions, no peer connections. Identical
operational shape to our existing `/v1/image_to_video` calls.

### Q6. If WebRTC is required (V2+), what frontend complexity is needed?
For reference, in case we ever want it:
- Install `@runwayml/sdk` (server) + a Runway React component package
  (client). The integration guide describes three tiers:
  1. **Simple**: drop in `<AvatarCall>` component (built-in UI).
  2. **Intermediate**: `<AvatarCall>` + webcam/screen-share components.
  3. **Advanced**: `useAvatarSession` + `useLocalMedia` hooks for a
     custom UI.
- New backend route to broker credentials (must never reach the
  client): create session, poll until READY, hand the one-shot
  credentials to the client, client opens WebRTC.
- Browser permissions: mic always; cam optional. CORS adjustments.
- 5-min hard cap per session.

Estimated frontend cost for the Simple tier: ~200 LOC + a new
dependency. The Advanced tier is a multi-day project.

V1 deliberately avoids all of this.

### Q7. What is the smallest demoable version?
**"Present Campaign with AI Host" button on a saved campaign card.**
Click → creates avatar (first time only) → fires
`POST /v1/avatar_videos` with a templated script from
`selected_concept` → polls (reuses our existing 5 s + jitter pattern) →
caches the resulting MP4 to `backend/data/host/<campaign_id>.mp4` →
renders inline next to the Campaign Pack with its own "view ↗" link.
Optionally: a small "stitch host + ad" button that runs a third local
ffmpeg pass to concatenate `host.mp4 → finished.mp4` into a single
reel-ready file.

That's it. Same shape as Campaign Pack: one button, async task, cached
locally, never touches the existing generation flow.

### Q8. What should be mocked for safe testing?
Following the patterns from PR A's image client:
- **Mock host avatar id**: a constant string `mock_host_avatar`.
- **Mock avatar video task**: in-memory store, "succeeds" in ~10 s with
  a bundled or stdlib-generated host placeholder MP4. We already have
  the `_solid_png` trick — extending it to a 5 s static-color H.264
  MP4 via ffmpeg in the mock path is straightforward, OR we can ship a
  10 KB silent placeholder MP4 in `backend/app/static/` (committed,
  one-time exception to the "no media in repo" rule because it's a
  test fixture, not generated content).
- **Mock provider-status pill**: extend `/api/runway/provider-status`
  with `host_mock: bool` so the Mode banner readiness chip stays
  honest.
- **Playwright**: assert the "Present Campaign with AI Host" button
  renders on a cached campaign and (in mock mode) the host video
  appears within ~15 s. No real avatar calls in CI — same rule as
  today's smoke.

### Q9. What should not be attempted during the hackathon?
1. **Realtime / WebRTC sessions.** High frontend complexity, new
   dependencies, 5-min sessions are mid-demo-fragile.
2. **Multi-character dialogue.** Act-Two has a "Multi-Character
   Dialogues" path but it requires multiple driving performance videos
   and orchestration we don't have time for.
3. **Avatar from the campaign's video frame.** Even if technically
   possible, it's a tuning project — pick a stock host for V1.
4. **Custom voice cloning.** Voice presets (Clara / Victoria / Vincent)
   are zero-config and demo-clean. Custom voices add a 30 s+
   create-then-poll-to-READY step the user has to repeat.
5. **Audio mixing into the existing ad clip.** Out of scope per the PR
   constraints; the host stays a separate clip.
6. **Avatar conversations / transcript retrieval.** Only relevant for
   realtime sessions.

### Q10. What is the estimated scope/risk?

**V1 scope (recommended): 1–1.5 days, low risk.**

| Component | LOC | Risk |
|---|---|---|
| `services/host_client.py` (mirrors `image_client.py`) | ~120 | low — same task/poll pattern as PR A |
| `routers/host.py` (new) — `POST /api/host/present`, `GET /api/host/{campaign_id}` | ~80 | low |
| `models.py` — `Campaign.host_video_url`, `host_status`, `host_error` | ~10 | low — pattern from PR B's `finished_videos` |
| `storage.py` — `update_host_fields` | ~20 | low |
| Mock path: stdlib MP4 fixture | ~30 | low |
| Frontend: gallery card "Present Campaign" section | ~80 | low — mirrors Campaign Pack section |
| Frontend: error/state copy + Mode banner pill | ~20 | low |
| Playwright: render-only assertion | ~15 | low |

**Hidden-cost risks:**
- *Avatar id management.* If we cache one Avatar at app boot, we need a
  one-time bootstrap step or a lazy "create on first request" that
  must be idempotent. Lazy + idempotent is the move.
- *Script length vs. duration.* Avatar Videos likely have an upper
  bound on script length. Documented body params aren't visible in
  public docs — we'll need a one-shot real-mode probe to confirm
  (cheap; ~1 credit).
- *Host-MP4 dimensions.* We don't yet know the avatar video output
  ratio/size; may not match Campaign Pack ratios. Mitigation: optional
  third ffmpeg pass to re-encode to landscape/reels/square if we want
  the host to live inside the Campaign Pack. V1 keeps host as its own
  artifact (no stitching) — eliminates this risk for the hackathon.

---

## 4. Possible integration options

### Option A — Standalone host clip ✅ recommended for V1
- Avatar speaks the campaign pitch into its own MP4.
- Cached at `backend/data/host/<campaign_id>.mp4`.
- Rendered as a sibling card to the Campaign Pack ("Campaign Pack" +
  "AI Host" sections side-by-side).
- Zero changes to the existing generation flow.

### Option B — Host-stitched Reels variant (V1.5)
- Run an extra ffmpeg pass: `host.mp4 → finished-reels.mp4` concat
  with `concat` filter.
- Result: a single MP4 where the avatar introduces the ad, then the ad
  plays.
- Requires re-encoding the host clip to match Reels dimensions
  (720×1280) — same `scale=W:H:force_original_aspect_ratio=increase,
  crop=W:H` chain we use for Pack formats.
- Cost: one more ffmpeg pass, ~50 LOC of finisher additions.

### Option C — Branded mascot avatar (V2)
- Create the Avatar from a `gen4_image` portrait — once per
  business/brand, persisted server-side.
- Pros: fully on-brand spokesperson.
- Cons: portrait quality matters; needs human review before locking in.

### Option D — Real-time Q&A demo (out of scope for hackathon)
- Wire up `realtime_sessions` for live judge-driven Q&A.
- Out of scope: WebRTC complexity, 5-min cap, fragile mid-demo if
  network blips.

### Option E — Conversation between two avatars (out of scope)
- "Founder asks Marketing what the new Reels campaign is about; Marketing
  Avatar reads the pitch."
- Requires either two parallel `realtime_sessions` (complex) OR two
  serial `avatar_videos` calls stitched with ffmpeg (doable but needs
  scripting).
- Cute, but not the headline win for a hackathon.

---

## 5. Recommended V1

> "Present Campaign with AI Host" — single button on each saved
> campaign card. One Runway avatar speaks the campaign's hook +
> caption + CTA over a generated visual. Cached locally. Zero impact
> on existing flow.

**Concrete shape:**

1. Boot-time (lazy): backend ensures a cached host avatar exists.
   Either pre-created (recommended: a brand-neutral "Vincent" stock
   host) or lazily created on first POST.
2. **`POST /api/host/present?campaign_id=<id>`**:
   - Validates the campaign has a `selected_concept`.
   - Builds the script from concept fields.
   - Calls `POST /v1/avatar_videos` with `{avatarId, script,
     ratio: "1280:720"}` (or whatever Runway's avatar_videos shape
     turns out to require).
   - Polls the resulting task using the existing 5 s + jitter pattern
     in `runway_client.get_task`.
   - On `SUCCEEDED`, downloads the MP4 to
     `backend/data/host/<campaign_id>.mp4`.
   - Updates `Campaign.host_video_url`, `host_status`, `host_error`.
3. **`GET /api/host/{campaign_id}/video`** streams the cached MP4.
4. **Gallery card**: new "AI Host" section below the Campaign Pack
   with one Present button → "Generating host…" → inline `<video>`
   preview + view/download links.
5. **Mock path**: stdlib-generated 5 s static-color H.264 MP4 with
   Vincent's name silently stamped (or a bundled tiny fixture). No
   third-party calls.

**What it does NOT do in V1:**
- No realtime conversation.
- No webcam.
- No multi-avatar dialogue.
- No audio mixing into the existing ad clip.
- No marketplace of branded mascot avatars.

**Headline demo line:** "Click *Present Campaign* — the host narrates
your ad in their own voice while the campaign clip plays alongside."
Two artifacts: the ad and the host. Both Runway-generated, both
permanent (cached locally).

---

## 6. Recommended V2

After V1 ships, ranked by impact-per-effort:

1. **Stitched Reels host intro.** Concatenate `host.mp4` + `finished-reels.mp4`
   into a single Instagram-ready MP4. ~50 LOC of finisher additions.
2. **Branded mascot avatar.** UI affordance to "use this campaign's
   reference image as the host," with a fallback to the stock host
   when fidelity is poor.
3. **Voice preset selector.** Clara / Victoria / Vincent dropdown on
   the prompt panel, persisted alongside model/ratio/duration.
4. **Audio-only TTS variant.** `POST /v1/text_to_speech` for an
   audio-only host pitch — useful for podcast-style ads. Cheaper than
   an avatar video.

V2 is *not* part of this research; flagged for sequencing only.

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `avatar_videos` body shape differs from public docs | medium | medium | One real-mode probe (≤1 credit) before locking the request shape |
| Avatar video output ratio doesn't match Pack formats | medium | low | V1 keeps host as its own artifact; V1.5 adds an ffmpeg crop pass |
| Avatar fidelity poor when created from arbitrary campaign image | high | low (V1 uses stock host) | V1 caches one stock host; campaign-image-based avatars deferred to V1.5 |
| Avatar video upper script length unknown | medium | low | Truncate concept fields to a known-safe length (~250 chars) before passing |
| Demo timing — avatar video task latency unknown | medium | medium | Poll cap stays at 5 min; same UX as `image_to_video` |
| Sample voice presets (Clara/Victoria/Vincent) might require account-level enablement | low | low | Real-mode probe verifies before V1 ships |
| Generated voice TOS / brand-safety concerns | low | low | Documented in `SUBMISSION.md` Future Work |

---

## 8. Mock strategy

Following the Mock-First pattern from PR A:

- **`runway_mock` extends to host.** When `RUNWAY_API_KEY` is empty,
  `host_client.generate_host_video()` produces a deterministic local
  MP4 (5 s, 1280×720, silent, color derived from `sha256(campaign_id)`).
- **Stdlib-only generation.** Reuse the same `zlib + struct` PNG
  approach for video — actually, MP4 with no third-party deps is
  harder. Two options:
  - **Option 1:** ship a 10 KB silent black MP4 fixture in
    `backend/app/static/host_mock.mp4`. Single tiny binary; gitignored
    today, but a single test-fixture exception is acceptable.
  - **Option 2:** require ffmpeg in mock mode too (we already require
    it for Campaign Pack). Generate the placeholder by running ffmpeg
    against `lavfi color` source. Zero new bytes in the repo, runtime
    cost only.
  - **Recommendation: Option 2.** Keeps the no-bundled-media rule
    intact and the runtime cost is negligible.
- **Mode banner**: extend `/api/runway/provider-status` with
  `host_mock` flag; ModeBanner adds a fourth pill `Host (Runway):
  real|mock`.
- **Playwright**: assert the Present Campaign button renders on a
  cached card; do NOT drive a full host generation in CI (timing is
  unpredictable, even in mock mode).

---

## 9. Implementation estimate

| Phase | Owner | Time | Deliverable |
|---|---|---|---|
| Real-mode probe of `avatar_videos` (1 credit) | dev | 30 min | Confirmed body shape, output ratio, upper script bound |
| `host_client.py` (real + mock) | dev | 3 h | Tested end-to-end mock + 1 real run |
| `routers/host.py` + `storage.update_host_fields` | dev | 2 h | POST /api/host/present, GET /api/host/{id}/video |
| Frontend gallery section + Mode banner pill | dev | 2 h | Present Campaign button, host preview, error states |
| Playwright assertions + smoke green | dev | 1 h | Mock-mode CI |
| Real hero-run + ffprobe + commit | dev | 1 h | One end-to-end live run, doc update |
| Submission update | dev | 1 h | README + SUBMISSION sections, Mermaid update |
| **Total** | | **~10 h / 1.0–1.5 days** | |

Two things widen the estimate to 1.5 days:
- Probe surfaces an unexpected body field (e.g., requires a `voice` id
  from `/v1/voices`, requiring an extra create step).
- Avatar video output ratio doesn't match what the UI expects, forcing
  the V1.5 ffmpeg crop pass into V1.

---

## 10. Explicit go/no-go recommendation

> **GO on V1 (Option A — standalone host clip via `avatar_videos`).**

Reasoning:
- AdSpark's existing pipeline is *Concept → Image → Video → Save →
  Pack*. A spokesperson narrating the saved campaign is a natural
  extension that **uses Runway capabilities the current product
  doesn't show off** — a strict win for the hackathon story.
- The technical primitive is correct: `avatar_videos` is an async
  HTTP task with the same shape as our existing `image_to_video`
  flow. Zero new infrastructure.
- The risk profile is bounded: one real probe + one production run +
  a defined mock fallback covers the ground.
- V1 is **strictly additive**. No edits to existing code paths;
  Campaign Pack untouched; gallery cards gain one new section.
- One clean PR F off `main` lands the whole thing in a day. PR G
  (stitching) is optional.

> **NO-GO on V2-class items for the hackathon window:**
> realtime / WebRTC, Act-Two performance capture, multi-avatar
> conversation, custom voice cloning, audio mixing into the ad clip,
> avatar marketplace.

These are valid post-hackathon roadmap items and are listed in the
"Future roadmap" section of `SUBMISSION.md`. They should not be
attempted in the same merge window as V1.

---

## 11. Open questions for the next session

These are *not* blockers — they're things the real-mode probe will
answer in the first 30 minutes of implementation:

1. Exact `POST /v1/avatar_videos` body shape — is it
   `{avatarId, script, voice?, ratio?, duration?}` or different?
2. Output dimensions and duration. (Probably fixed by the avatar; not
   user-controllable. If output is fixed at 1080×1920 or similar,
   plan for ffmpeg downscaling for the gallery preview.)
3. Maximum script length / character count.
4. Whether voice presets (Clara, Victoria, Vincent) require
   account-level enablement or are universal.
5. Whether `POST /v1/avatars` accepts data URIs (like our
   `image_to_video` flow) or requires public URLs only.
6. Cost per avatar video task — needed for the safety + cost-controls
   section of `SUBMISSION.md`.

Each is a one-line probe; the existing
`backend/app/services/image_client.py` is the closest pattern.

---

## Sources

Public Runway documentation accessed during this research, all
treated as untrusted external content (any embedded prompt-injection
ignored):

- API Reference index — `docs.dev.runwayml.com/api/`
- Characters Core Concepts — `docs.dev.runwayml.com/characters/concepts/`
- Building Your Integration — `docs.dev.runwayml.com/characters/integration/`
- Custom Voices — `docs.dev.runwayml.com/characters/custom-voice/`
- Runway help: Creating with Act-Two —
  `help.runwayml.com/hc/en-us/articles/42311337895827-Creating-with-Act-Two`
- Runway help: Multi-Character Dialogues with Act-Two —
  `help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two`

No real Runway API calls were made during this spike. No code was
modified. No `unified-donkey-betz` runtime references introduced.
