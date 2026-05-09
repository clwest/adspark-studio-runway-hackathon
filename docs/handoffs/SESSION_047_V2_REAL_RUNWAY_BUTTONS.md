# SESSION 047 — Wire V2 Real Runway Generation Buttons (PR BP)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BP patch in flight on top of `5e7400f`
`feat: wire v2 cinematic lane voiced cinematic action (PR BO)`;
commit + push pending after this handoff lands)
**Builds on:** SESSION_045 (PR BN) + SESSION_046 (PR BO)
which wired the first two v2 lane actions; PR BP completes
the v2 lane action surface.

## Goal

PR BN + PR BO wired 2 of 8 distinct v2 lane render targets.
PR BP brings the count from 2 → 7 by wiring **everything else
that maps to a one-click backend route** — including **one
credit-burning real Runway button** (Spokesperson Horizontal)
gated behind explicit warning copy.

The only button still on the placeholder list is **Cinematic
Video** — it would require async `image_to_video` task
polling, which is more than "one click = one POST" and is
deferred to a future slice.

Backend untouched. Default v1 load unchanged. Frontend-only.

## Endpoint inventory

PR BP adds **no new routes**. Route count stays at **68**.
Reuses five existing routes:

| Lane button | Backend route | Cost |
|---|---|---|
| Spokesperson Horizontal | `POST /api/campaigns/{id}/spokesperson-ad` | 🔥 burns Runway credits |
| Cinematic Storyboard Commercial | `POST /api/campaigns/{id}/storyboard/stitch` | ffmpeg only |
| Dialogue Plan Lines | `POST /api/campaigns/{id}/dialogue/plan` | template only — no upstream calls |
| Dialogue Stitch Scene | `POST /api/campaigns/{id}/dialogue/stitch` | ffmpeg only |
| Dialogue Captioned Reels | `POST /api/campaigns/{id}/dialogue-scene/reels` | ffmpeg only |

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  five new handlers mirroring PR BN/BO's shape. Each calls
  the matching `api.*` helper, swaps the campaign in the
  local `campaigns` slice in place, bubbles
  `onCharactersChanged`, returns the updated Campaign,
  throws on failure:
  - `handleGenerateSpokespersonAd(campaignId)` — real
    Runway. Wired into SpokespersonLane via
    `onGenerateSpokesperson`.
  - `handleStitchStoryboard(campaignId)` — ffmpeg. Wired
    into CinematicLane via `onStitchStoryboard`.
  - `handlePlanDialogue(campaignId)` — template. Wired into
    DialogueLane via `onPlanDialogue`.
  - `handleStitchDialogue(campaignId)` — ffmpeg. Wired into
    DialogueLane via `onStitchDialogue`.
  - `handleBuildDialogueReels(campaignId)` — ffmpeg. Wired
    into DialogueLane via `onBuildDialogueReels`.

- **`frontend/src/components/lanes/SpokespersonLane.jsx`** —
  Horizontal button is now wired. Local `horizontalBusy` +
  `horizontalError` state, `horizontalCanFire` gating
  (`onGenerateSpokesperson` set + focused campaign +
  usable avatar), label flips per state, **rose chrome**
  when enabled, "⚠️ Real Runway. Each click bills
  `avatar_videos`." caption (`spokesperson-lane-horizontal-warning`),
  status row below the button cluster
  (`spokesperson-lane-horizontal-status`). New attrs:
  `data-source-ready`, `data-busy`, `data-burns-credits="true"`.

- **`frontend/src/components/lanes/CinematicLane.jsx`** —
  Storyboard button is now wired. Local `storyBusy` +
  `storyError` state, gated on every shot in
  `storyboard_shots[*]` having `status === 'ok'`. Amber
  chrome when enabled. Status row + download link on
  cached. New attrs match PR BN/BO. Cinematic Video stays
  a placeholder.

- **`frontend/src/components/lanes/DialogueLane.jsx`** —
  all three buttons wired. Sky chrome across the lane.
  Combined status row at the bottom that surfaces the
  busiest path (plan / stitch / reels) + persisted
  failures + download links for stitch + reels. Per-line
  generation still lives in classic UX (each line is a
  real `avatar_videos` task; lane shows readiness count
  like "1/3 lines" instead of firing them).

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - v2 case's Spokesperson block updated: drops
    unconditional Horizontal disabled assertion, adds
    `data-burns-credits="true"` + `data-source-ready` +
    `data-busy` attribute checks.
  - Cinematic block: Storyboard button now disjunction-
    asserted (enabled iff `data-source-ready="true"`).
    Cinematic Video stays unconditionally disabled.
  - Dialogue block: all three buttons disjunction-asserted.
  - footer toggle test untouched.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BP; route
  count narrative confirms unchanged at 68;
  SpokespersonStudio.jsx + lane rows updated to mention
  the 5 new wires.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged;
  v2 is gated and the operator-facing flow doc gets a
  wholesale rewrite when v2 flips to default.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation
  expands; build sizes / smoke results.
- `docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md` — appended
  one new row for the PR BP validation call.
- `docs/handoffs/SESSION_047_V2_REAL_RUNWAY_BUTTONS.md` —
  this file.

## Credit-safety design

The brief required clear UI marking for any button that
burns real Runway credits. Implementation:

1. **Rose chrome** on the Horizontal button when enabled
   (only credit-burning button in PR BP). All other wired
   buttons use lane-mode chrome (violet / fuchsia / amber /
   sky) which signals "safe — no credits."
2. **Adjacent caption** below the button:
   `⚠️ Real Runway. Each click bills avatar_videos.` —
   only renders when the button is actually clickable
   (`horizontalCanFire === true`).
3. **Tooltip** on the button itself:
   `⚠️ POST /v1/avatar_videos — burns Runway credits per
   click. Generation is sync (~30–60 s).`
4. **Marker attribute** `data-burns-credits="true"` so
   future tooling (telemetry, click confirmation modals)
   can flag this specific class of button.
5. **Status row** while busy: `posting to /spokesperson-ad…
   (real Runway, may take 30–60 s)` — sets expectation
   about latency.
6. **One click = one POST**. The route is sync end-to-end
   (the backend polls `avatar_videos` until READY internally
   before returning); the lane's busy state ends with the
   single response. No client-side polling, no retry loops.

The other four wired buttons in PR BP are explicitly
non-credit-burning:
- `dialogue/plan` is template-driven (sets up the
  Hook/Beat/Closer line shape from `commercial_script`,
  doesn't fire Runway).
- `storyboard/stitch`, `dialogue/stitch`,
  `dialogue-scene/reels` are all ffmpeg-only over cached
  per-shot / per-line MP4s.

## Real-mode manual validation

Per the brief, ran one controlled real-mode pass to confirm
the new Horizontal wiring is end-to-end functional.

| TS (UTC) | Lane / action | Campaign | Spokesperson | Endpoint | Status | Output |
|---|---|---|---|---|---|---|
| 2026-05-09T23:26:53Z | Spokesperson Horizontal (PR BP) | CEO Buzz `fc8a20c42bc5` | Brewster the Raccoon `d047894984a4` | `POST /api/campaigns/{id}/spokesperson-ad` (real `avatar_videos`) | **200** in 44.9 s | `data/host/fc8a20c42bc5.mp4` (6.3 MB / 1088×704 / 18.25 s · h264 + AAC mono 48kHz · task `cf7e6067-0a11-4dbb-be17-21169c5a0177`) — overwrote prior real-mode output from SESSION_REAL_API |

Demo-worthy: ✅. Equivalent to one click of the new v2
Spokesperson Lane "Generate Real Spokesperson Ad" button.

The other four PR BP wires were validated via the smoke
disjunction (gating + attrs render correctly); their actual
backend routes were exercised in earlier sessions (PR Z, AF,
AG, AH).

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 390.35 KB initial / 104.67 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `3 passed (23.5 s)` — v1 20.8 s, v2 1.3 s, toggle round-trip 794 ms |
| Real-mode boot (manual validation) | `bash scripts/start-local-real.sh`; `runway_mock=false` confirmed via `/health` |
| Real-mode validation call | 1 × Spokesperson Horizontal → 200, 44.9 s, fresh real MP4 |
| ffprobe new asset | `1088×704 h264 + AAC 48kHz mono · 18.25 s` (real Runway shape) |
| Hygiene scan | empty (real-mode MP4 still gitignored via `backend/.gitignore: data/`) |
| Drift guard | `context-kit anchors look recent.` |

## Server status (final)

Real-mode running per memory rule + brief.

```
backend: pid=… · http://localhost:8000 · runway_mock=false,
         image_gen_mock=false  ← real Runway live
vite:    pid=… · http://localhost:5173 · http=200
```

## Limitations / follow-ups

- **Cinematic Video button still disabled.** Wiring it to
  the existing `/api/runway/generate` route would require
  client-side polling of the resulting task — significantly
  more wiring than the other PR BP buttons. Defer.
- **Per-line dialogue generation still in classic UX.**
  PR BP's "Plan Dialogue Lines" button creates the line
  shape but doesn't render each line's `avatar_videos`.
  Operator goes to v1 Dialogue tab to fire individual line
  renders, then returns to v2 to stitch. Acceptable for
  V1; future slice could add a "Generate Next Pending
  Line" button that fires one at a time.
- **Per-shot storyboard generation still in classic UX.**
  Same pattern as dialogue lines — PR BP scaffolds the
  stitch button, classic UX owns the per-shot render.
- **No retry button on failure.** Errors render inline +
  the button re-enables for another click. No
  separately-styled "retry" affordance.
- **Mode field on Campaign still client-side only.** All
  PR BP wiring keys off existing Campaign fields
  (`host_status`, `dialogue_lines[*].status`, etc).
  Defer the `Campaign.mode` schema addition until the v2
  brief-capture surface ships.

## Recommended next slice

Two options:

1. **Wire Cinematic Video** with async `image_to_video`
   polling — adds the last placeholder button and proves
   the v2 architecture can handle async tasks too.
   Estimated 1–2 hours.
2. **Inline brief editing** — embed the existing
   `CampaignForm` + `PromptPreview` into Step 1 of each
   lane so the operator can edit business / product /
   audience / commercial_script without leaving v2.
   Bigger surface; ~2–3 hours.

Either is reasonable. Option 1 closes the v2 lane surface;
option 2 reduces v1 round-trips for editing.
