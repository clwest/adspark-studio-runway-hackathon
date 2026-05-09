# Multi-Character Dialogue Scene Builder — V1 Design

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-af-dialogue-scene-builder`
**Companion to:** `RUNWAY_AVATAR_API_DEEP_REVIEW.md`,
`STORYBOARD_COMMERCIAL_BUILDER.md`, `FLOW_INTEGRATION_AUDIT.md`

This is the V1 design for AdSpark's **Dialogue Scene Builder** —
sequential talking-avatar lines stitched into one MP4 to create
Office-style branded skits, founder-vs-mascot reactions, fake
podcasts, and other multi-character social formats.

---

## 1. Product thesis

AdSpark started as "AI commercial generator". With Character Studio
(PR K), Voiced Commercial / Spokesperson Ad (PR S/X/AB), and Storyboard
(PR Z), the product became **"AI ad + character studio"**. PR AF
takes the next step: AdSpark is now a **branded character universe
authoring tool**.

The thesis: brands don't just want a single ad. They want recurring
characters who appear in:

- ad spots
- TikTok / Reels skits
- founder content
- product reaction videos
- mascot back-and-forths
- fake interviews + podcasts
- "in the office" scenes
- explainer dialogues

Every one of those formats reduces to the same V1 primitive:
**characters take turns saying lines on camera**. That's the
Dialogue Scene Builder.

---

## 2. Why sequential clips are enough for V1

We could build this on one of three primitives:

| Approach | Pro | Con | V1 fit |
|---|---|---|---|
| **A. Sequential `avatar_videos` stitched with ffmpeg** | Reuses existing pipeline; deterministic; cheap; one character per clip is well-supported | No real-time interaction; line N+1 doesn't react visually to line N | ✅ V1 |
| **B. Multi-character `realtime_sessions`** | Live conversation feel | 5-min session cap, WebRTC complexity, multiple parallel sessions, mid-demo fragility | ❌ deferred |
| **C. `character_performance` (Act-Two) multi-character** | Visually unified scene | Needs driving videos for every line, orchestration costs | ❌ wrong primitive |

Sequential `avatar_videos` is the right V1 because:

1. **It's the same primitive AdSpark already uses for Spokesperson Ad.**
   No new third-party surface — just multiple targeted calls + concat.
2. **Identity is stable per line.** Each line targets one Character's
   `runway_avatar_id`; the resulting clip has no identity drift
   (unlike `image_to_video`, which would drift even with the same
   portrait pinned across shots).
3. **Mock mode is trivial.** ffmpeg `lavfi` with `drawtext` per line
   produces deterministic placeholder MP4s the stitcher can concat.
4. **It composes with the existing stack.** The same dialogue scene
   could later become a Cinematic Ad's voiceover track, a Voiced
   Storyboard variant, or a Realtime conversation seed — V1 doesn't
   foreclose any future direction.

The V1 limitation we accept: characters don't visually react to each
other. Line 2 is shot in isolation, not "looking at" Line 1's
character. Acceptable for skit-style content where the cut between
speakers is its own beat. Listed in §6 future polish.

---

## 3. Why not realtime multi-avatar yet

`realtime_sessions` doesn't support multi-character parallel
conversations as a documented feature. The closest you can get
today is two browsers running two sessions with the same human
acting as the bridge — fragile, unbranded, and not a product. The
LiveKit Agents path (`characters/livekit/`) might enable this with
custom orchestration, but that's a much bigger build with mid-demo
network failure modes.

PR AF deliberately stays on the async + ffmpeg path. When + if
Runway exposes multi-character realtime, we can add a sibling
"Live Dialogue" surface without touching the V1 builder.

---

## 4. Route design

| Method + path | Purpose |
|---|---|
| `POST /api/campaigns/{id}/dialogue/plan` | Generate the default 3-line scene from saved campaign + ready characters. Pure local computation. |
| `POST /api/campaigns/{id}/dialogue/line/{line_id}` | Update one line's text and/or speaker. Body: `{text?, character_id?}`. Resets that line's status to `idle` so the next render uses the new state; invalidates the stitched scene. |
| `POST /api/campaigns/{id}/dialogue/generate-line/{line_id}` | Render one line via Runway `avatar_videos`. Mock mode synthesises a `lavfi` placeholder. Persists `task_id`, `video_url`, `cache_filename`. |
| `POST /api/campaigns/{id}/dialogue/stitch` | ffmpeg `filter_complex concat` over every cached line clip with audio preserved. Refuses unless every line is `ok`. Output → `data/finished/{id}-dialogue-scene.mp4`. |
| `GET /api/campaigns/{id}/dialogue-scene` | Streams the stitched MP4. |
| `GET /api/campaigns/{id}/dialogue/line/{line_id}` | Streams an individual line MP4 — useful for previewing each clip before stitching. |

Routes 51 → 57 (+6).

### Data model additions (Campaign)

```python
dialogue_lines: list[DialogueLine] = []
dialogue_scene_status: Optional[Literal["idle","planning","ready","stitching","ok","failed"]]
dialogue_scene_video_url: Optional[str]
dialogue_scene_error: Optional[str]
```

```python
class DialogueLine(BaseModel):
    id: str
    character_id: Optional[str]
    character_name: Optional[str]
    avatar_id: Optional[str]
    text: str = ""
    status: Literal["idle","pending","running","ok","failed"] = "idle"
    task_id: Optional[str]
    video_url: Optional[str]
    cache_filename: Optional[str]
    error: Optional[str]
    mock_mode: Optional[bool]
```

### Default 3-line plan

```
labels  = ("Hook", "Beat", "Closer")
speakers = (primary, secondary, primary)  # A → B → A back to closer
beats   = _split_script_sentences(commercial_script, 3)
```

- **Primary** = attached character if present, else first ready
  character.
- **Secondary** = second-distinct ready character, falls back to
  primary when only one is ready (V1 still works as a single-speaker
  monologue split into 3 lines).
- **Beats** are derived from `commercial_script` sentences when
  available; templated fallback per beat when the script is short or
  missing.

Example for CEO Buzz with Brewster (primary) and Ledger (secondary):

```
Line 1 — Brewster (Hook):
  "Meet CEO Buzz. Built for founders, coders, and sleep-deprived legends..."
Line 2 — Ledger (Beat):
  "...chasing impossible ideas at 3AM. One sip and your terrible startup ideas feel venture-backed."
Line 3 — Brewster (Closer):
  "Drink smarter. Build harder."
```

### ffmpeg concat strategy

`filter_complex concat=n=N:v=1:a=1` with **audio preserved** (the
storyboard concat dropped audio; dialogue keeps it because every
line carries the avatar's speech). Each input is normalised to
1088×704 / 30 fps / square pixels first so future polish with
mixed-source clips would still concat cleanly, even though all V1
inputs share the gwm1_avatars dimensions.

Audio is resampled with `aresample=async=1,asetpts=N/SR/TB` so
silent placeholder tracks (mock mode) and real AAC tracks share a
uniform stream the concat filter accepts without splice glitches.

---

## 5. Mock strategy

V1 mock mode produces a 5-second 1088×704 ffmpeg-`lavfi` placeholder
per line with the speaker name + a snippet of the line text drawn
over a neutral background. Audio stream is silent (`anullsrc`) but
present, so the stitch path doesn't need a separate code path for
mock vs real.

Net result: with no Runway key, the user can still:

1. Plan a dialogue scene
2. Generate every line (each ~1-2 s of ffmpeg work)
3. Stitch into one MP4
4. Play / download the result

This is the same mock-parity bar PR Z (storyboard) and PR S/X
(commercial-with-voice) hold to — fully demoable without any spend.

---

## 6. Future roadmap

### Tier 1 — small additions, high content lift

1. **Vertical export** — second stitch path that pads/centers the
   1088×704 output into 720×1280 with a brand-coloured background.
   Solves the TikTok/Reels gap.
2. **Caption overlays** — burn-in subtitles per line via ffmpeg
   `subtitles=` filter. Trivial once we keep the per-line text. Big
   social win.
3. **Reaction shots** — between Line N and Line N+1, insert a 1 s
   cutaway clip of the next speaker's avatar reacting (silent
   `avatar_videos` with personality-driven prompt). Doubles the
   credit cost but the back-and-forth feels much more like real
   editing.
4. **Custom line count** — let the user add / remove lines beyond
   the default 3. Same data model; just a UI affordance.

### Tier 2 — bigger UX builds

5. **Episode templates** — pre-baked scene structures: "founder vs
   accounting", "mascot reacts to user reviews", "fake podcast cold
   open". Each template = a name + a per-line label vector + a
   per-line prompt template that pulls campaign fields.
6. **Character lore / memory** — let characters carry over saved
   personality + history from prior scenes. Couples with §17.2 of
   the avatar API deep-review (RAG documents attached to the
   Character).
7. **Fake podcast format** — same primitive but rendered as
   "audio-only" (extract audio track from each line, concat, export
   MP3). Different distribution surface.
8. **Live + scripted hybrid** — first 2 lines scripted via
   `avatar_videos`, third line is a 5-min `realtime_sessions`
   conversation the user can drop into.

### Tier 3 — out of scope for now

9. **True multi-character realtime.** Needs Runway-side support
   that doesn't exist today. Could revisit via LiveKit Agents
   (`characters/livekit/`) if we ever take on that complexity.
10. **Visual choreography / blocking.** Real "two characters in the
    same shot" requires `character_performance` (Act-Two) with
    driving videos — the wrong primitive for a fast skit
    generator.

---

## 7. Mock + real verification (this PR)

### Mock-mode end-to-end

1. Save a campaign with a script + at least one Character (avatar
   status `ready` or `mock`).
2. Open the saved card → **Dialogue** tab → **Plan Dialogue Scene**.
3. Edit any line's text + speaker. **Save Line** persists; status
   resets to `idle`.
4. **Generate Line Clip** for each line — ffmpeg `lavfi` produces
   a 5 s placeholder with the speaker label + line text drawn
   on-screen. Each line takes ~1-2 s.
5. **Stitch Dialogue Scene** — concat path produces a 15 s MP4 at
   1088×704 with continuous audio (silent in mock mode).
6. ffprobe confirms one video stream + one audio stream + correct
   duration.

### Real-mode (deferred verification)

Same flow with `runway_mock=false`. Each line takes ~30-60 s; a
full scene runs ~3 min wall clock + ~15 credits per character per
line (3 lines = ~45 credits). Output: real lip-synced multi-
speaker MP4.

Real verification was not run in this PR — would burn credits
without explicit per-task approval. Backend code paths are the
same as the existing PR F / PR AB Spokesperson Ad render, which
has been verified end-to-end multiple times.

---

## 8. Hard constraints honored (PR AF)

- ✅ Reuses existing Character Studio + `avatar_videos` pipeline.
- ✅ ffmpeg patterns mirror PR Z + PR S/X.
- ✅ No new Runway endpoints.
- ✅ No media / secrets committed.
- ✅ Mock mode preserved.
- ✅ Playwright smoke preserved (smoke asserts the new Dialogue tab
  + Plan button render).
- ✅ Spokesperson Ad / Cinematic Ad / Storyboard flows untouched.
- ✅ Backend remains backward-compatible (old campaign records
  deserialize fine; `dialogue_*` fields default to empty / null).

---

## 9. File map (V1)

```
backend/
  app/
    models.py                                 +30 LOC (DialogueLine + 4 Campaign fields)
    routers/campaigns.py                      +280 LOC (6 routes + body model)
    services/
      finisher_service.py                     +130 LOC (build_dialogue_scene)
      storage.py                              +80 LOC (3 dialogue helpers)
      dialogue_service.py                     +320 LOC (NEW — plan + generate + mock)
docs/
  research/DIALOGUE_SCENE_BUILDER.md          (this file)
frontend/
  src/
    api.js                                    +25 LOC (4 dialogue helpers)
    components/CampaignGallery.jsx            +400 LOC (Dialogue tab + Overview card +
                                                     Exports row + state + handlers)
  tests/
    adspark-smoke.spec.js                     +20 LOC (Dialogue tab assertions)
```

Total: ≈1,300 LOC + one new research doc.
