# Storyboard Commercial Builder — Research + V1 Design

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-z-storyboard-commercial-builder` (suggested)
**Closes the loop on:** `docs/handoffs/SESSION_010_LONGER_VIDEO_PREP.md`
**Companion to:** `docs/research/RUNWAY_API_CAPABILITY_MAP.md`,
`docs/research/RUNWAY_PROMPT_STRUCTURE.md`,
`docs/research/FLOW_INTEGRATION_AUDIT.md`

This document is the **Phase 1 audit + V1 design** for option #7
(Storyboard Commercial Builder) from SESSION_010. It answers the ten
questions the user listed in the kickoff prompt, then locks the
shape of the V1 build.

---

## Executive summary

**The recommended V1 is multi-shot stitch, not longer single clips.**

Going wider with Runway's existing image-to-video primitive and
ffmpeg concat is far safer than gambling on undocumented duration
support. We get a 3× perceived ad length without crossing any new
Runway capability boundary, falls back gracefully when a shot fails,
and reuses the proven Character anchoring path from PR W
(character portrait → `prompt_image`).

The V1 ships:

- 3 shot slots per saved campaign (Hook / Action / Payoff)
- Each shot uses the active character's portrait as `prompt_image`
- Each shot runs through the existing `runway_client.create_task`
- ffmpeg concat (filter_complex) stitches 3 cached MP4s into a
  single landscape MP4
- Optional voiced storyboard mux loops the Avatar Host Clip audio
  over the stitched 15 s output (same `-stream_loop` strategy PR X
  uses today for the single-cut voiced commercial)

---

## Q1 — What Runway model durations are currently supported in our app?

`backend/app/services/runway_client.py` `GENERATION_POLICY`:

| Model | Image required | Allowed ratios | Allowed durations |
|---|---|---|---|
| `gen4_turbo` | yes | `1280:720`, `720:1280`, `960:960` | **5 s** |
| `gen4.5` | no | `1280:720`, `720:1280`, `960:960` | **5 s, 8 s, 10 s** |

The frontend `src/settings.js` clamps user choices to these same
sets on restore, so old or invalid combinations never survive a
restart.

`runway_client.RunwayGenerateRequest` further hard-caps `duration`
at `Field(ge=5, le=10)` in `models.py:35`, so the backend rejects
anything outside 5–10 s before any HTTP fires.

Net: AdSpark exposes **5 s** for `gen4_turbo` and **5 / 8 / 10 s**
for `gen4.5` today. No 15 s, 30 s, or 60 s knob.

---

## Q2 — Can gen4.5 or gen4_turbo produce longer clips directly?

Per the capability map (§2 + §3) and the live `GENERATION_POLICY`,
the answer is **no** for the model families we ship.

- `gen4_turbo` is a 5 s primitive end-to-end.
- `gen4.5` documented durations are 5 / 8 / 10 s; the AdSpark policy
  enforces those exactly.
- The Runway capability map lists no `extend`, `continue`, `remix`,
  or `upscale` endpoint for these video models. Aleph
  (`video_to_video`) is a *style transfer* primitive, not a duration
  extender — it takes an existing clip and re-renders it with a
  different look at the same length.
- `character_performance` (Act-Two) requires a driving performance
  video and is documented as web-app-only for multi-character
  conversations.

The user could in principle bump our `GENERATION_POLICY` to allow
12 / 15 / 16 s on `gen4.5` and probe Runway to see if it accepts
larger values. That probe is **not on the V1 path**: even if Runway
quietly accepts larger durations, the credit cost / quality
plateau / character-drift tradeoff is unproven, the failure rate at
longer durations is undocumented, and the recovery story (a 15 s
clip that drifts off-character at second 11) is much worse than a
3-shot stitch where one shot fails and the user retries that one
shot.

**Verdict:** treat single-clip duration as fixed at the current
policy. Build longer commercials by composing multiple shots, not by
stretching one.

---

## Q3 — What is the safest V1: longer single clip or multi-shot stitch?

**Multi-shot stitch.** Concretely:

| Criterion | Longer single clip | Multi-shot stitch (V1) |
|---|---|---|
| Requires unverified Runway behavior | yes | no |
| Reuses proven `image_to_video` path | partial | yes |
| Failure recovery | re-run entire long task | retry just the failed shot |
| Character consistency | drifts at >5 s | locked per-shot via portrait |
| Mock-mode viability | trivial | trivial (re-uses mock task store) |
| ffmpeg dependency | none | already present (Pack + voiced mux) |
| Demo footprint | 1 clip | 3 clips → 1 stitched MP4 |
| Credit cost | 1 large clip | 3 small clips (≈3× the 5 s cost) |

The credit multiplier is real, but the quality + recoverability
tradeoff strongly favors stitching. SESSION_010's recommendation
matches.

---

## Q4 — How should shot prompts be generated?

Reuse the `simplifyFromConcept` machinery from PR T. Each shot is a
structured prompt obeying the **one character / one location / one
action / one camera** rule. The differences across the three shots
live entirely in `action` + (optionally) `mood`.

```
shot 1 — Hook:
  subject:     {character.name or audience.singular}, face visible,
               expressive but natural
  environment: {preset.environment}
  action:      enters the scene and looks toward camera
  camera:      static camera shot
  lighting:    {preset.lighting}
  mood:        {preset.mood} — opening beat, curious
  constraints: natural movement, high detail, 16:9

shot 2 — Action:
  subject:     {character.name or audience.singular}, face visible,
               expressive but natural
  environment: {preset.environment}
  action:      {preset.actionTemplate.replace("{subject}", product or business)}
  camera:      static camera shot, slow push-in
  lighting:    {preset.lighting}
  mood:        {preset.mood} — using / presenting the product
  constraints: natural movement, high detail, 16:9

shot 3 — Payoff:
  subject:     {character.name or audience.singular}, face visible,
               expressive but natural
  environment: {preset.environment}
  action:      reacts with a satisfied expression and looks toward camera
  camera:      static camera shot
  lighting:    {preset.lighting}
  mood:        {preset.mood} — payoff, satisfied, ready to act on the CTA
  constraints: natural movement, high detail, 16:9
```

For the canonical Brewster example:

| Shot | Action |
|---|---|
| Hook | Brewster shuffles into a small cozy kitchen at 2:17 AM, looks half-awake |
| Action | Brewster brews a cold brew on the coffee machine, watches it pour |
| Payoff | Brewster takes one sip, eyes widen, gives a quick thumbs-up |

The frontend storyboard panel exposes the three prompts read-only in
V1. A future polish can let the user edit them inline (see "future
polish" below).

The prompts are emitted by a new `frontend/src/storyboardBuilder.js`
that calls `buildRunwayVideoPrompt` once per shot and returns
`{shots: [{id, label, prompt}, ...]}`.

---

## Q5 — How should we preserve character consistency?

**Pin the same character portrait as the `prompt_image` for every
shot.** This is the proven approach from PR W — when "Use Character"
is the visual source, the runway generate route receives the
character portrait as `prompt_image`, and downstream Runway uses it
as the identity anchor.

Concretely:

- The storyboard plan pulls `character.portrait_url` (relative
  `/api/characters/{id}/portrait`) and stamps it onto every
  generated shot's `source_image_url`.
- The shot-generate route passes that URL through to
  `runway_client.create_task` exactly the same way the existing
  campaign generate flow does — `maybe_to_data_uri` already handles
  the `/api/characters/{id}/portrait` prefix and embeds the cached
  PNG as a data URI before posting to Runway.
- We do **not** chain last-frame → next-shot's reference image. That
  pattern (image-to-video continuation) is option #4 in SESSION_010
  and is explicitly out of scope for V1 — the per-shot character
  pin is simpler and equally effective for our use case (the same
  spokesperson, three actions, one location).

If the campaign has no attached character, V1 falls back to the
campaign's reference image (`campaign.reference_image_url`) as the
shared `prompt_image` for all three shots. Less ideal — the
campaign's reference image is a one-off scene not necessarily
optimized for re-use across three actions — but still produces a
coherent stitched commercial because the visual style stays
consistent.

If neither exists, the storyboard plan returns an error (409) with
a friendly "Attach a character first" message. Same shape as the
voiced-commercial gating in `routers/campaigns.py:393`.

---

## Q6 — How should we store shot metadata?

Add fields to `Campaign` in `app/models.py`. No separate JSON store
— campaigns already own all the per-shot artefacts conceptually
(generated by AdSpark, anchored to one campaign id, deletable in
the existing `DELETE /api/campaigns/{id}` cascade).

```python
# app/models.py — additions to Campaign

StoryboardShotStatus = Literal[
    "idle", "pending", "running", "ok", "failed"
]

class StoryboardShot(BaseModel):
    id: str           # "shot-1" / "shot-2" / "shot-3"
    label: str        # "Hook" / "Action" / "Payoff"
    prompt: str
    source_image_url: Optional[str] = None  # character portrait or campaign image
    task_id: Optional[str] = None
    status: StoryboardShotStatus = "idle"
    video_url: Optional[str] = None         # /api/campaigns/{id}/storyboard/shot-1
    cache_path: Optional[str] = None        # filename only; full path resolved server-side
    duration: int = 5
    error: Optional[str] = None

# Campaign gets:
storyboard_shots: list[StoryboardShot] = []
storyboard_status: Optional[Literal[
    "idle", "planning", "ready", "stitching", "ok", "failed"
]] = None
storyboard_video_url: Optional[str] = None
storyboard_error: Optional[str] = None
```

Backward compat: old campaign records read fine without the fields
(Pydantic defaults). The fields persist via a new
`update_storyboard_fields(...)` helper on `CampaignStore`, mirroring
the existing per-feature update helpers (PR S `update_voiced_
commercial_fields`, PR H `update_dub_fields`).

Cached MP4s live alongside the existing per-feature caches:

- per-shot clips → `backend/data/storyboard/<campaign_id>-<shot_id>.mp4`
- stitched output → `backend/data/finished/<campaign_id>-storyboard.mp4`
- voiced storyboard (optional) →
  `backend/data/finished/<campaign_id>-storyboard-voice.mp4`

`backend/.gitignore` already covers `data/` so no media is committed.

---

## Q7 — How should mock mode work?

**Same shape as PR S/X:** mock mode produces deterministic
placeholders so the UX flow is exercisable without keys.

1. **Plan storyboard** — pure local computation, no Runway call,
   identical in mock and real mode. Returns 3 shot dicts.
2. **Generate shot N** — when `settings.runway_mock` is true,
   `runway_client.create_task` already returns a mock task id that
   succeeds in ~12 s with the BigBuckBunny sample MP4 URL. The
   storyboard-shot route polls the task the same way the existing
   campaign flow does (or — V1 simplification below — synthesises
   a local placeholder MP4 directly with ffmpeg lavfi, bypassing the
   download). Decision: **lavfi placeholder** for mock, mirroring
   the host-clip mock path. Net: mock-mode shot generation finishes
   in <2 s with a real h264 stream the stitcher can concat.
3. **Stitch** — runs ffmpeg concat over whatever shot MP4s are on
   disk. In mock mode the inputs are 3 lavfi placeholders; the
   output is a real 15 s landscape MP4 that plays inline.
4. **Voiced storyboard mux** (optional) — same `-stream_loop -1`
   approach PR X uses for the single-cut voiced commercial. Mock
   host clip is a silent ffmpeg lavfi placeholder; the muxed
   output then has a silent audio track but a valid stream the
   `<video>` player can render.

Playwright smoke runs in mock mode end-to-end. No Runway calls
during the smoke; no real spend on automated tests.

---

## Q8 — How should ffmpeg stitch clips?

**`filter_complex` with the `concat` filter**, not the concat
demuxer. The demuxer requires the inputs to share codec / pixel
format / timebase exactly — Runway clips do, but adding a re-encode
pass for safety is cheap (~1–2 s per shot at libx264 veryfast crf
23) and it normalises any small differences a Runway redownload
might introduce.

Reference command (3 shots → 1 landscape MP4):

```bash
ffmpeg -y -loglevel error \
  -i shot1.mp4 -i shot2.mp4 -i shot3.mp4 \
  -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30[v0];\
                   [1:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30[v1];\
                   [2:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30[v2];\
                   [v0][v1][v2]concat=n=3:v=1:a=0[outv]" \
  -map "[outv]" \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -movflags +faststart \
  -f mp4 \
  storyboard.mp4
```

Notes:

- All inputs are normalised to **1280×720 / 30 fps / square pixels**
  before concat so the output has a single uniform stream.
- We pin to **landscape** for V1 — same default the Pack uses,
  matches the existing voiced-commercial output dimensions, sidesteps
  per-format stitching for now (Reels/Square crops are listed as
  future polish below).
- Audio is dropped (`a=0`) at this stage. The optional voiced
  storyboard mux is a separate pass.
- The `setsar=1` + `fps=30` filters are belt-and-suspenders against
  Runway returning slightly different SAR or fps between shots.
- `+faststart` mirrors the existing finisher_service flag so
  browsers can begin playback before the file is fully buffered.

Implementation sits next to `VideoFinisher.build_commercial_with_voice`
in `finisher_service.py` as a new
`VideoFinisher.build_storyboard(campaign_id, shot_paths)` method
returning a `CommercialResult`-shaped dataclass.

---

## Q9 — How should audio work?

**V1 ships visual-only.** The stitched 15 s MP4 has no audio track.

Once the visual concat works, an optional second route bolts on the
voiced storyboard:

```
POST /api/campaigns/{id}/storyboard/voiced
```

…which:

1. Confirms `storyboard_video_url` exists.
2. Confirms `host_video_url` exists (or auto-creates via
   `generate_host_video` when an avatar is ready, mirroring PR X).
3. Runs ffmpeg with `-stream_loop -1 -i storyboard.mp4 -i host.mp4
   -map 0:v:0 -map 1:a:0 -c:v libx264 -c:a aac -shortest` so the
   visual stitches under the host pitch audio for as long as the
   pitch runs (typically ~10 s; the storyboard is 15 s so the visual
   gets cut to match the audio length — a tradeoff, but the user
   can replay or extend the host script for a longer mix).

Output: `backend/data/finished/<id>-storyboard-voice.mp4`.

This second route is explicitly **non-blocking on V1**. If visual
stitching works and the voiced mux fails for any reason, the user
still has a voiceless 15 s storyboard MP4. The V1 PR ships the
voiced route alongside, but the demo plan stays "show the silent
storyboard first, then the voiced version" — same incremental story
as PR S → PR X.

---

## Q10 — What is the smallest demoable V1?

**Backend (≈260 LOC):**

- `models.py` — add `StoryboardShot` + 4 Campaign fields
- `services/finisher_service.py` — add `build_storyboard()` method +
  optional `build_storyboard_with_voice()` method (mirrors
  `build_commercial_with_voice`)
- `services/storyboard_service.py` — new module:
  - `plan_storyboard(campaign, settings) -> list[StoryboardShot]`
  - `generate_shot(campaign, shot_id, settings) -> ShotResult`
- `services/storage.py` — add `update_storyboard_fields` /
  `update_storyboard_shot_fields` helpers
- `routers/campaigns.py` — add 4 routes:
  - `POST /api/campaigns/{id}/storyboard/plan`
  - `POST /api/campaigns/{id}/storyboard/generate-shot/{shot_id}`
  - `POST /api/campaigns/{id}/storyboard/stitch`
  - `GET /api/campaigns/{id}/storyboard-video`
  - (optional) `POST /api/campaigns/{id}/storyboard/voiced` +
    `GET /api/campaigns/{id}/storyboard-voiced-video`

**Frontend (≈140 LOC):**

- `src/api.js` — add `planStoryboard`, `generateStoryboardShot`,
  `stitchStoryboard` (and optionally `buildVoicedStoryboard`)
- `src/storyboardBuilder.js` — new helper:
  `buildStoryboardShots({ concept, form, character, ratio })`
- `src/components/CampaignGallery.jsx` — Visuals tab grows a
  Storyboard subsection between Voiced Commercial and Campaign
  Pack:
  - Plan Storyboard button
  - 3 shot cards with prompt preview + Generate Shot N button
    (gated on plan existing) + per-shot status chip
  - Stitch Storyboard button (gated on all 3 ok)
  - Inline `<video>` player for the stitched output
- `src/components/CampaignGallery.jsx` Exports tab — add a row in
  the file ledger between Voiced Commercial and Pack outputs

**Tests:**

- `tests/adspark-smoke.spec.js` — extend the Visuals tab assertions
  to verify the Storyboard subsection renders + the Plan button
  clicks through in mock mode + the gated Stitch button is disabled
  when shots haven't been generated.

**Hard constraints (lifted from kickoff prompt):**

- ✅ Existing single-video flow untouched
- ✅ Commercial with Voice untouched
- ✅ No new providers
- ✅ No generated media committed (`backend/data/` already ignored)
- ✅ Mock mode preserved
- ✅ Playwright smoke kept passing
- ✅ AdSpark stays standalone
- ✅ Automated tests fire zero real Runway calls

---

## V1 Endpoint contract (summary)

```
POST /api/campaigns/{id}/storyboard/plan
  body: {} (optional: { ratio: "1280:720" })
  effect: writes campaign.storyboard_shots = 3 shot dicts;
          campaign.storyboard_status = "ready"
  returns: Campaign

POST /api/campaigns/{id}/storyboard/generate-shot/{shot_id}
  body: {}
  effect: fires runway_client.create_task with the shot's prompt +
          source_image_url; polls to SUCCEEDED; downloads to
          data/storyboard/{id}-{shot_id}.mp4; updates the shot's
          status / task_id / video_url
  returns: Campaign
  errors:  404 (campaign or shot not found),
           409 (no source image; storyboard not planned yet),
           502 (Runway call failed)

POST /api/campaigns/{id}/storyboard/stitch
  body: {}
  effect: runs ffmpeg filter_complex over the 3 cached shot MP4s;
          writes data/finished/{id}-storyboard.mp4; updates
          storyboard_video_url + storyboard_status
  returns: Campaign
  errors:  409 (not all shots ready / ffmpeg unavailable)

GET /api/campaigns/{id}/storyboard-video
  returns: video/mp4 FileResponse for the stitched MP4
  errors:  404 (not built yet)

(optional V1.1)
POST /api/campaigns/{id}/storyboard/voiced
  body: { auto_generate_host: true }
  effect: ffmpeg loop the storyboard visual under host audio;
          writes data/finished/{id}-storyboard-voice.mp4
  returns: Campaign
  errors:  same as commercial-with-voice's preconditions

GET /api/campaigns/{id}/storyboard-voiced-video
  returns: video/mp4 FileResponse
```

---

## Frontend UX shape

The Visuals tab grows a Storyboard subsection. Initial state shows
an explainer card and the **Plan Storyboard** button. After
planning, three numbered cards render the prompt + state per shot.
Once all three shots are `ok`, **Stitch Storyboard** unlocks. Once
the stitched MP4 exists, the inline `<video>` plays it and a
**Build voiced storyboard** button surfaces (shipping in V1.1).

State machine (per campaign):

```
idle → (Plan) → ready
ready → (Generate Shot N) → shot N status changes
ready (all 3 shots ok) → (Stitch) → stitching → ok | failed
ok → (Build voiced) → ok-voiced | failed-voiced
```

---

## Demo plan (Brewster, post-V1)

1. From an existing saved campaign with Brewster attached.
2. Visuals tab → Plan Storyboard → 3 shots render with auto-derived
   prompts (Hook / Action / Payoff).
3. Generate Shot 1 (mock-safe / real ~60–90 s).
4. Generate Shot 2.
5. Generate Shot 3.
6. Stitch Storyboard → 15 s MP4 plays inline.
7. (V1.1) Build Voiced Storyboard → final voiced MP4 plays inline.

Total real Runway spend: 3 × `image_to_video` (5 s gen4_turbo) +
optional 1 × `avatar_videos`. Roughly 15 credits — same order as
the existing PR X auto-host demo.

---

## Out of scope for V1 (deferred)

- **Edit prompt per shot.** V1 prompts are read-only. A future PR
  exposes an inline `<textarea>` per shot card with a Simplify
  button (pattern carbon-copied from PR T).
- **Reels / Square stitching.** V1 emits landscape only. A future
  PR runs the stitch with the per-format dims helper from
  `finisher_service.FORMAT_DIMS` and saves three storyboard MP4s.
- **Last-frame → next-shot chaining.** Option #4 in SESSION_010 is
  still a viable polish if Runway exposes any extend / continue
  primitive. Not needed for V1.
- **Audio-first timeline.** Option #6 in SESSION_010 is a much
  bigger build. Deferred.
- **Per-shot duration override.** All shots are 5 s in V1.
- **Concurrent shot generation.** V1 generates shots one at a time
  via separate POSTs. Frontend can fire 3 in sequence. A future
  optimisation runs them in parallel via `asyncio.gather` and shaves
  ~2 min off the real-mode end-to-end time.
- **Drag-to-reorder shots.** The 3 slots are fixed Hook → Action →
  Payoff in V1.

---

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Character drift across shots | medium | Pin same portrait as `prompt_image` for every shot; one-character / one-location / one-action structure per shot |
| One shot fails mid-build | medium | Each shot is independently retryable; stitch refuses until all 3 are `ok`; no all-or-nothing failure mode |
| Audio cutoff (storyboard 15 s vs host audio ~10 s) | medium | V1 ships visual-only; voiced V1.1 trims to host length (`-shortest`), accepting that the third shot may visually run past the audio |
| Credit cost 3× single-shot | high (by design) | UI surfaces 3 separate Generate buttons so the user opts in per shot; mock mode covers automated test paths |
| Runway returning differently-shaped MP4s between shots | low | Stitch normalises every input to 1280×720/30fps/square pixels via filter_complex |
| ffmpeg concat filter version differences | low | The filter_complex concat filter has been stable in ffmpeg ≥ 4.x; AdSpark requires ffmpeg 7.x for the existing Pack pipeline |

---

## Verification plan (this PR)

- Backend import: `from app.main import app; print(len(app.routes))`
  → should jump from 40 to **44** (+4 storyboard routes; the optional
  voiced-storyboard pair adds 2 more if shipped).
- Frontend build: `vite build` — diff < 5 KB initial JS.
- Playwright smoke: `npm run test:e2e` in mock mode — must still
  pass; new assertions verify the Storyboard subsection renders +
  the Plan button is reachable.
- Real Brewster verification (optional, behind explicit per-task
  approval):
  1. Plan storyboard
  2. Generate Shot 1 (~60–90 s)
  3. Optionally generate Shots 2 + 3
  4. Stitch
  5. `ffprobe` the output for duration / dimensions
  6. (V1.1) Build voiced storyboard, ffprobe for audio stream
- Git hygiene: `git status` clean except for tracked code; no
  `backend/data/` / `.env` / generated MP4s introduced.

---

## What this V1 explicitly does NOT do

- Does not change the existing `GENERATION_POLICY`. `gen4_turbo`
  stays at 5 s; `gen4.5` stays at 5 / 8 / 10 s.
- Does not rewrite the structured prompt builder. It calls the
  existing `buildRunwayVideoPrompt` once per shot.
- Does not introduce a new provider. Every external call still
  goes through the existing Runway clients.
- Does not commit any media. All generated MP4s land under
  `backend/data/`, which is gitignored.
- Does not change the existing single-cut voiced commercial.
  PR S/X behavior is preserved verbatim.
- Does not change the Playwright smoke's existing PR A–Y assertions.
  New assertions are additive only.
- Does not auto-generate shots on plan. The user clicks Generate
  per shot, so credit spend is opt-in per shot.
- Does not add a marketplace / export / share affordance.
- Does not touch unified-donkey-betz (read-only inspection only).

---

## File map (V1)

```
backend/
  app/
    models.py                                 +12 LOC (StoryboardShot + 4 Campaign fields)
    routers/campaigns.py                      +180 LOC (4 routes + body models)
    services/
      finisher_service.py                     +90 LOC (build_storyboard + optional voice variant)
      storage.py                              +60 LOC (update_storyboard_fields + per-shot helper)
      storyboard_service.py                   +150 LOC (NEW — plan + generate-shot)
docs/
  research/STORYBOARD_COMMERCIAL_BUILDER.md   (this file)
frontend/
  src/
    api.js                                    +25 LOC (3–5 new helpers)
    storyboardBuilder.js                      +90 LOC (NEW)
    components/CampaignGallery.jsx            +180 LOC (Storyboard subsection + ledger row)
  tests/
    adspark-smoke.spec.js                     +20 LOC (Storyboard subsection assertions)
```

Total: ≈800 LOC across backend, frontend, and one new doc.
