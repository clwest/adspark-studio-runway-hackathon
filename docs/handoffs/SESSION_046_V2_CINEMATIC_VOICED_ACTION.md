# SESSION 046 — Wire V2 Cinematic Lane Voiced Cinematic Action (PR BO)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BO patch in flight on top of `13bc608`
`feat: wire v2 spokesperson lane reels action (PR BN)`; commit
+ push pending after this handoff lands)
**Builds on:** SESSION_042 (PR BK Cinematic Lane scaffold) +
SESSION_045 (PR BN — first wired v2 action).

## Goal

PR BN proved the v2 lane architecture can fire production
behaviour by wiring SpokespersonLane → Captioned Reels. PR BO
extends the proof to a **second mode**: CinematicLane → Voiced
Cinematic. Same shape as PR BN — ffmpeg-only mux of cached
visual + host audio, no Runway credits burned, no backend
changes.

Default v1 load unchanged. Cinematic Video + Storyboard
buttons stay placeholders. Spokesperson + Dialogue lanes
untouched beyond PR BN.

## Endpoint inventory

PR BO adds **no new routes**. Route count stays at **68**.
Frontend-only. Reuses `POST /api/campaigns/{id}/commercial-with-voice`
(PR S / PR X).

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - new `handleBuildVoicedCinematic(campaignId)` handler.
    Mirrors PR BN's `handleBuildSpokespersonReels` exactly:
    calls `api.buildCommercialWithVoice(campaignId)`, swaps
    the matching record in the local `campaigns` state in
    place, fires `onCharactersChanged?.()`, returns the
    updated Campaign for the caller. Throws on failure.
  - threads the handler into `<CinematicLane>` via the new
    `onBuildVoicedCinematic` prop. Other lanes
    (SpokespersonLane / DialogueLane) untouched.

- **`frontend/src/components/lanes/CinematicLane.jsx`** —
  - `useState` import for `voicedBusy` + `voicedError`.
  - new `onBuildVoicedCinematic` prop (defaults to `null`).
  - new derived booleans (mirror v1's `commercialBuildable`
    exactly):
    - `voicedIsCached = focused.cached_video_url`
    - `voicedHostReady = focused.host_video_url &&
      focused.host_status === 'ok'`
    - `voicedHasUsableAvatar = focused.character_id ||
      focused.selected_avatar_id || (focused.host_avatar_id
      && status ∈ {'ready','mock'})`
    - `voicedBuildable = voicedIsCached &&
      (voicedHostReady || voicedHasUsableAvatar)`
    - `voicedCached = focused.voiced_commercial_status ===
      'ok' && focused.voiced_commercial_url`
    - `voicedFailed = focused.voiced_commercial_status ===
      'failed' && focused.voiced_commercial_error`
    - `voicedCanFire = onBuildVoicedCinematic && hasCampaign
      && voicedBuildable && !voicedBusy`
  - button label flips per state — "Build Voiced Cinematic"
    / "Rebuild Voiced Cinematic" / "Building Voiced
    Cinematic…".
  - tooltip explains *why* the button is disabled (no
    campaign / no cached visual / no host clip + no usable
    avatar / no handler).
  - fuchsia chrome when enabled; zinc placeholder chrome
    when disabled.
  - new attrs on the button:
    - `data-source-ready="true|false"` — UI gate
    - `data-busy="true|false"` — toggles during click
    - `data-has-output="true|false"` — already existed
    - `data-render-target="voiced-cinematic"` — already
      existed
  - new status row appended below the three-button cluster
    (one of):
    - rose error from the click handler
    - zinc "posting to /commercial-with-voice…" while busy
    - rose "Voiced cinematic failed: …" when persisted
      `voiced_commercial_error` is set
    - emerald `download voiced cinematic ↗` link when
      voiced commercial is cached
  - new testids:
    - `cinematic-lane-voiced-status`
    - `cinematic-lane-voiced-link`

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test's cinematic-lane block updated:
    - drops the unconditional `await
      expect(cineVoicedBtn).toBeDisabled()` blanket assertion.
    - adds resilient disjunction: read
      `data-source-ready` from the Voiced button, assert
      enabled iff `"true"` and disabled iff `"false"`.
    - asserts `data-busy="false"` initially.
    - asserts the visible label matches `(Build|Rebuild)
      Voiced Cinematic` when source-ready.
    - Cinematic Video + Storyboard buttons keep their
      unconditional disabled assertions.
  - footer toggle test untouched.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BO; route
  count narrative confirms unchanged at 68;
  SpokespersonStudio.jsx + CinematicLane.jsx rows updated
  with the new handler / props / testids.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BO; build sizes / smoke results.
- `docs/handoffs/SESSION_046_V2_CINEMATIC_VOICED_ACTION.md` —
  this file.

## Source detection

Used the same gating CampaignGallery applies:

```javascript
const voicedIsCached = Boolean(focused.cached_video_url)
const voicedHostReady = Boolean(
  focused.host_video_url && focused.host_status === 'ok'
)
const voicedHasUsableAvatar = Boolean(
  focused.character_id ||
  focused.selected_avatar_id ||
  (focused.host_avatar_id &&
    ['ready', 'mock'].includes(focused.host_avatar_status || ''))
)
const voicedBuildable =
  voicedIsCached && (voicedHostReady || voicedHasUsableAvatar)
```

The backend route 409s if no source; the lane's gating
prevents the operator from triggering a guaranteed failure.

## Lane action behaviour

```
Initial render with focused campaign that's buildable:
  ┌────────────────────────────────────────────┐
  │ Build Voiced Cinematic            [ready]  │  enabled, fuchsia
  └────────────────────────────────────────────┘

Click → setVoicedBusy(true) → button text + busy attr flip:
  ┌────────────────────────────────────────────┐
  │ Building Voiced Cinematic…    [building…]  │  disabled (busy)
  └────────────────────────────────────────────┘
  posting to /commercial-with-voice…           ← status row

POST 200 with updated Campaign:
  ↓ SpokespersonStudio.handleBuildVoicedCinematic updates
    the campaigns slice in place
  ↓ onCharactersChanged?.() bubbles
  ↓ CinematicLane re-renders with new
    voiced_commercial_url

  ┌────────────────────────────────────────────┐
  │ Rebuild Voiced Cinematic         [cached]  │  enabled, fuchsia
  └────────────────────────────────────────────┘
  download voiced cinematic ↗                  ← emerald link

POST error → caught by lane's try/catch:
  ┌────────────────────────────────────────────┐
  │ Build Voiced Cinematic            [ready]  │  enabled (busy reset)
  └────────────────────────────────────────────┘
  Error: <message>                              ← rose status row
```

## Verification (this session)

| Check | Result |
|---|---|
| Mock backend booted | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 382.22 KB initial / 103.06 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `3 passed (24.2 s)` — v1 21.6 s, v2 1.2 s, toggle round-trip 728 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh` per
the memory rule + the brief's request to "keep final servers
running in real mode for manual testing".

```
backend: pid=… · http://localhost:8000 · runway_mock=false,
         image_gen_mock=false  ← real Runway live
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 → click "Try preview UX →" in footer.
2. On Brewster the Raccoon's tile, click "Use as Spokesperson"
   inside the embedded card.
3. Click "+ New Campaign" → pick 🎬 Cinematic Ad.
4. The Cinematic Lane mounts; if the focused linked campaign
   has the silent visual cached + a host clip OR usable
   avatar, the "Build Voiced Cinematic" button is **enabled**
   with fuchsia chrome.
5. Click → status row reads "posting to /commercial-with-voice…"
   for ~1–2 s → resolves to "Rebuild Voiced Cinematic" + the
   download link appears.

The CEO Buzz / Brewster real-mode assets from
SESSION_REAL_API are still on disk (`fc8a20c42bc5-commercial-voice.mp4`),
so the click produces a fresh ffmpeg-mux'd voiced commercial.

## Limitations / follow-ups

- **Cinematic Video + Storyboard buttons still disabled.**
  Wiring those would burn Runway credits per click
  (`image_to_video` for the silent cut, multiple
  `image_to_video` for the storyboard). Defer until we have
  a "regenerate vs cache-hit" decision in the lane.
- **Dialogue lane untouched.** Per the brief, PR BO scoped
  to one button in one lane. PR BP (or whatever the next
  slice number is) can wire DialogueLane's Stitch button
  using the same shape.
- **No live click test in smoke.** Same as PR BN — the
  disjunction asserts gating correctness without firing
  the actual route. Manual test path covers the click
  semantics.
- **Mode field on Campaign still client-side only.** This
  remains a follow-up; not blocking the wired actions.
- **Avatar resolution lives outside the lane.** When
  `voicedHostReady` is false but `voicedHasUsableAvatar` is
  true, the backend route auto-creates the host clip via
  PR X. The lane just opens the gate; it doesn't surface
  what's about to happen. Acceptable for V1 — the operator
  reads the same status copy as the v1 gallery.

## Recommended next slice

**Wire DialogueLane's Stitch button.** Mirror PR BN / PR BO
pattern with `api.stitchDialogue(focused.id)` (PR AF).
Gating: every line in `focused.dialogue_lines[*]` has
`status === 'ok'` AND a `video_url` set. ffmpeg-only mux of
the per-line MP4s into one scene.

After that wire is in: three of the nine lane render buttons
fire production behaviour — proving the v2 architecture
works across all three modes. Then the bigger slices (Mode
field on Campaign, lane-driven brief editing, click-through
from Appearances rows) become unblocked.
