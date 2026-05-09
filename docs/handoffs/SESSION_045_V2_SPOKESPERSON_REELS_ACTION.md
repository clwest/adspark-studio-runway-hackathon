# SESSION 045 — Wire V2 Spokesperson Lane Reels Action (PR BN)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BN patch in flight on top of `669a584`
`test: lane selection regression pass (PR BM)`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_040 (PR BI Spokesperson Lane scaffold)
+ SESSION_044 (PR BM regression pass).

## Goal

PR BI–BL gave the v2 mode-first UX three lane scaffolds with
disabled placeholder render buttons. PR BN wires **one** of
those buttons — Spokesperson Lane → Captioned Reels — to the
existing production route so the lane architecture proves it
can fire real behaviour without redesigning CampaignGallery.

Spokesperson Reels is the safest first wire because it's
ffmpeg-only — no Runway calls, no credits burned, no real-mode
session needed. The route (`POST /api/campaigns/{id}/spokesperson-ad/reels`,
PR AG/AH) takes the existing host clip MP4 and pads/letterboxes
it to 720×1280 with burned-in captions from the saved
Commercial Script.

Backend untouched. Default v1 load unchanged. Horizontal +
Cinematic + Dialogue lanes still placeholder.

## Endpoint inventory

PR BN adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - new `handleBuildSpokespersonReels(campaignId)` handler.
    Calls `api.buildSpokespersonReels(campaignId)`, replaces
    the matching record in the local `campaigns` state in
    place, fires `onCharactersChanged?.()` so the parent
    refreshes too. Returns the updated Campaign for the
    caller. Throws on failure (caller surfaces the error).
  - threads the handler into `<SpokespersonLane>` via the new
    `onBuildReels` prop alongside the existing
    `activeSpokesperson` + `linkedCampaigns` props.
  - other lanes (CinematicLane / DialogueLane) untouched —
    no `onBuild*` handlers wired yet.

- **`frontend/src/components/lanes/SpokespersonLane.jsx`** —
  - `useState` import for the new `reelsBusy` + `reelsError`
    local state.
  - new `onBuildReels` prop (defaults to `null`); when null
    or no campaign focused or no source ready, the button
    stays disabled.
  - new derived booleans:
    - `reelsSourceReady = focused.host_video_url &&
      focused.host_status === 'ok'`
    - `reelsCached = focused.spokesperson_reels_status ===
      'ok' && focused.spokesperson_reels_url`
    - `reelsFailed = focused.spokesperson_reels_status ===
      'failed' && focused.spokesperson_reels_error`
    - `reelsCanFire = onBuildReels && hasCampaign &&
      reelsSourceReady && !reelsBusy`
  - button label flips per state — "Build Captioned Reels" /
    "Rebuild Captioned Reels" / "Building Captioned Reels…".
  - tooltip explains *why* the button is disabled when it
    can't fire (missing campaign / missing source / missing
    handler).
  - violet chrome when enabled (mirrors v1 gallery's reels
    button colour vocabulary); zinc placeholder chrome when
    disabled.
  - new attrs on the button:
    - `data-source-ready="true|false"` — UI gate
    - `data-busy="true|false"` — toggles during the click
    - `data-has-output="true|false"` — already existed,
      preserved
    - `data-render-target="reels"` — already existed,
      preserved
  - status row appended below the button cluster (one of):
    - rose error with the click error message
    - zinc "posting to /spokesperson-ad/reels…" while busy
    - rose "Reels export failed: …" when the persisted
      `spokesperson_reels_error` is set
    - emerald `download captioned reels ↗` link when reels
      are cached
  - new testids:
    - `spokesperson-lane-reels-status`
    - `spokesperson-lane-reels-link`

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test's spokesperson-lane assertion block updated:
    - drops the unconditional `await expect(reelsBtn).toBeDisabled()`.
    - adds resilient disjunction: read
      `data-source-ready` from the button, assert
      enabled iff `"true"` and disabled iff `"false"`.
    - asserts `data-busy="false"` initially.
    - asserts the visible label matches `(Build|Rebuild)
      Captioned Reels` when source-ready.
  - footer toggle test untouched.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BN; route
  count narrative confirms unchanged at 68;
  SpokespersonStudio.jsx + SpokespersonLane.jsx rows updated
  with the new handler / props / testids.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BN; build sizes / route count.
- `docs/handoffs/SESSION_045_V2_SPOKESPERSON_REELS_ACTION.md`
  — this file.

## Source detection

Used the same gating CampaignGallery applies internally:

```javascript
// Source MP4 ready when the Spokesperson Ad cut has rendered:
//   c.host_video_url   set
//   c.host_status      === 'ok'
const reelsSourceReady = Boolean(
  focused.host_video_url && focused.host_status === 'ok'
)
```

The backend route (`POST /spokesperson-ad/reels`) returns a
409 when no source exists, so the lane's gating guards the
operator from a guaranteed failure. The route's success path
populates `spokesperson_reels_url` + `spokesperson_reels_status
= 'ok'`; the lane reads those fields to surface the
"Rebuild" label + download link.

## Lane action behaviour

```
Initial render with focused campaign that has source MP4:
  ┌────────────────────────────────────────────┐
  │ Build Captioned Reels             [ready]  │  enabled, violet
  └────────────────────────────────────────────┘

Click → setReelsBusy(true) → button text + busy attr flip:
  ┌────────────────────────────────────────────┐
  │ Building Captioned Reels…       [building…] │  disabled (busy)
  └────────────────────────────────────────────┘
  posting to /spokesperson-ad/reels…             ← status row

POST 200 with updated Campaign:
  ↓ SpokespersonStudio.handleBuildSpokespersonReels updates
    the campaigns slice in place
  ↓ onCharactersChanged?.() bubbles so parent refreshes too
  ↓ SpokespersonLane re-renders with new
    spokesperson_reels_url

  ┌────────────────────────────────────────────┐
  │ Rebuild Captioned Reels         [cached]   │  enabled, violet
  └────────────────────────────────────────────┘
  download captioned reels ↗                    ← emerald link

POST 4xx / 5xx → caught by lane's try/catch:
  ┌────────────────────────────────────────────┐
  │ Build Captioned Reels             [ready]  │  enabled (busy reset)
  └────────────────────────────────────────────┘
  Error: <message>                               ← rose status row
```

## Verification (this session)

| Check | Result |
|---|---|
| Mock backend booted | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 380.02 KB initial / 102.65 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `3 passed (23.2 s)` — v1 20.7 s, v2 1.1 s, toggle round-trip 706 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh` per
the new memory rule + the brief's request to "keep final
servers running in real mode for manual testing".

```
backend: pid=… · http://localhost:8000 · runway_mock=false,
         image_gen_mock=false  ← real Runway live
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 → click "Try preview UX →" in footer.
2. On Brewster the Raccoon's tile (or Piper Voltage's), click
   the Identity tab if not already active, then click
   "Use as Spokesperson" inside the embedded card.
3. Click "+ New Campaign" → pick 🎙️ Spokesperson Ad.
4. The Spokesperson Lane mounts; if the active spokesperson
   is linked to a campaign with a cached host MP4, the
   "Build Captioned Reels" button is **enabled** with violet
   chrome.
5. Click → status row reads "posting to /spokesperson-ad/reels…"
   for ~1–2 s → resolves to "Rebuild Captioned Reels" + the
   download link appears.

The CEO Buzz / Brewster real-mode assets from
SESSION_REAL_API are still on disk so the click produces a
fresh 720×1280 reels MP4 from the real 1088×704 spokesperson
cut.

## Limitations / follow-ups

- **Horizontal button still disabled.** The brief explicitly
  said wire only Reels in PR BN. Wiring Horizontal would need
  a "rebuild Spokesperson Ad" path; the existing
  `/spokesperson-ad` POST burns Runway credits per call.
  Defer until we have a "regenerate vs cache-hit" decision
  in the lane.
- **Cinematic + Dialogue lanes still all placeholders.**
  Same shape as PR BI/BK/BL ship; PR BN intentionally
  scoped to one button so the v2 architecture proves itself.
- **Click test not in smoke.** The v2 smoke asserts the
  disjunction (button enabled iff source-ready) but does not
  click. Adding a click test would require either
  pre-populating fixture data or threading a Use-as-Spokesperson
  click into the v2 test flow. Acceptable for V1 — the
  manual test path above covers click semantics.
- **Local refresh only.** SpokespersonStudio's
  `handleBuildSpokespersonReels` updates the local
  `campaigns` slice directly. If the operator switches
  back to v1 mid-session, the v1 gallery sees the same
  campaign data (parent's `onCharactersChanged` re-fetches).
- **No retry button on failure.** If the route returns 502
  or 409, the inline error renders + the button re-enables
  for another attempt. No "retry" affordance is surfaced
  separately.

## Recommended next slice

Two reasonable paths:

1. **Wire Cinematic Lane's Voiced Cinematic button** —
   ffmpeg-only mux of cached visual + host audio (PR S/X).
   Same shape as PR BN. Demonstrates the lane architecture
   works for a second mode.
2. **Wire Dialogue Lane's Stitch button** — ffmpeg concat
   of per-line MP4s (PR AF). Slightly more complex because
   it requires every line's `video_url` set first.

Either is a 1–2 hour slice mirroring PR BN's pattern. The
deeper backend work (Campaign.mode field, lane-driven
generation) can wait until at least one more lane has a real
submit handler.
