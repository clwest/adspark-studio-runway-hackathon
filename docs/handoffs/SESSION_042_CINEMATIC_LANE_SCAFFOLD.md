# SESSION 042 — Cinematic Lane Scaffold (PR BK)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BK patch in flight on top of `c04aced`
`chore: local real-mode runtime guard (PR BJ)`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_040 (PR BI — Spokesperson Lane Scaffold)
+ SESSION_041 (PR BJ — Local Real-Mode Runtime Guard).

## Goal

Second lane in the v2 mode trio. PR BI scaffolded the
Spokesperson lane; PR BK ships the Cinematic Ad lane in the
same shape so the mode-first UX surfaces all three options
(Cinematic / Spokesperson / Dialogue) the operator picks
between in PR BH's modal.

Backend untouched. Render buttons are disabled placeholders.
Default v1 load unchanged.

## Endpoint inventory

PR BK adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### New files

- **`frontend/src/components/lanes/CinematicLane.jsx`** —
  mirrors PR BI's SpokespersonLane shape with cinematic
  vocabulary. 3-step layout (Brief / Visual Source / Render),
  three disabled render buttons mapping to:
  - **Cinematic Video** — `cached_video_url` (silent
    image_to_video cut)
  - **Voiced Cinematic** — `voiced_commercial_url` (PR S/X
    ffmpeg `-stream_loop -1 -shortest` mux)
  - **Storyboard Commercial** — `storyboard_video_url`
    (PR Z 3-shot stitched concat)

  Receives `activeSpokesperson` + `linkedCampaigns` props
  identical to SpokespersonLane. Picks the most-recent linked
  campaign as "focused" via ISO-string `created_at` compare.
  Fuchsia ring + emerald-on-cached visual indicator in
  Step 2; commercial_script preview rendered inline so the
  operator sees what the cinematic narration will say.

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - imports `CinematicLane` from
    `./lanes/CinematicLane.jsx`.
  - active-mode pill copy is now per-mode:
    - `"Spokesperson Ad lane open."` (spokesperson)
    - `"Cinematic Ad lane open."` (cinematic)
    - legacy `"Mode selected. Lane-specific builder lands
      next."` (dialogue — until PR BL).
  - new sibling render block: when `activeMode ===
    CAMPAIGN_MODES.CINEMATIC`, mounts `<CinematicLane>` with
    the same handler/data props the Spokesperson lane uses.
    Mode switch from spokesperson → cinematic unmounts
    SpokespersonLane and mounts CinematicLane in its place.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test now extends past the spokesperson lane block:
    - re-opens the modal via the same `+ New Campaign`
      button.
    - clicks the cinematic mode card.
    - asserts the spokesperson lane has unmounted.
    - asserts `cinematic-lane` is visible with
      `data-mode="cinematic"`.
    - asserts all three step testids render.
    - asserts all three render buttons render disabled with
      the matching `data-render-target` attributes
      (`cinematic-video`, `voiced-cinematic`, `storyboard`).
    - dismiss assertion now also checks the cinematic lane
      unmounts at end of the v2 case.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BK; route
  count narrative confirms unchanged at 68; intro updated
  to describe the second lane.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged. The
  v2 surface is gated; operator-facing flow rewrites land
  when v2 flips to default.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BK; build sizes / route count.
- `docs/handoffs/SESSION_042_CINEMATIC_LANE_SCAFFOLD.md` —
  this file.

## Lane mount behaviour

```
SpokespersonStudio render order (v2):
  ┌─ section header (title + + New Campaign button)
  ├─ active-mode pill (if any mode chosen)
  │    if mode === spokesperson:  "Spokesperson Ad lane open."
  │    if mode === cinematic:     "Cinematic Ad lane open."
  │    if mode === dialogue:      "Mode selected. Lane-specific…"
  ├─ <SpokespersonLane>           ← only when mode === spokesperson
  ├─ <CinematicLane>              ← only when mode === cinematic
  ├─ <SpokespersonLibrarySkeleton> while loading
  └─ library grid OR empty state
```

At most one lane is mounted at a time — the v2 smoke now
asserts this disjunction explicitly: after switching from
spokesperson to cinematic, `spokesperson-lane` count is 0 and
`cinematic-lane` count is 1.

## Lane scaffold behaviour

| Step | Content when focused campaign exists | Content when no focused campaign |
|---|---|---|
| Step 1 · Brief | Business (bold), Product (truncated 60 chars), pointer copy | "No linked campaign yet." + setup hint |
| Step 2 · Visual Source | "Silent visual cut cached" emerald label when `cached_video_url` set; commercial_script preview in monospace `<pre>` | "Visual source picker (Generate / Upload / Use Character / Text-only) lives in classic UX Stage 3" |
| Step 3 · Render | Three disabled buttons (Cinematic Video / Voiced Cinematic / Storyboard Commercial), each carrying `data-has-output` based on the corresponding cached URL | Same disabled buttons; "Create or select a campaign…" copy |

Each render button's tooltip reads:
> Render wiring lands with the cinematic lane builder. Use the
> classic gallery to render today.

## Verification (this session)

| Check | Result |
|---|---|
| Local servers killed pre-test | `bash scripts/stop-local.sh` → `✅ servers stopped` |
| Mock backend booted | via `bash scripts/start-local-mock.sh` (PR BJ); `runway_mock=true`, `image_gen_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 370.30 KB initial / 101.06 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (22.9 s)` — v1 21.3 s, v2 934 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

## Server state at end of session

Servers still running in mock mode after the smoke (next
slice — PR BL — also uses mock). Operator can flip to real
mode anytime via `bash scripts/start-local-real.sh`.

## Limitations / follow-ups

- **No real generation from the lane.** Render buttons are
  disabled placeholders. Operators who want to fire
  `image_to_video` / `commercial-with-voice` / storyboard
  routes flip back to v1 via the footer toggle.
- **No inline visual-source picker.** Step 2 is a read-only
  preview indicator; the actual picker (Generate / Upload /
  Use Character / Text-only) lives in classic UX Stage 3.
- **Storyboard preview is binary.** "Storyboard Commercial"
  button shows `cached` / `placeholder`, but the lane doesn't
  surface the per-shot statuses (idle / running / ok / failed).
  Acceptable for V1 scaffold; a future polish slice could
  expand this into a 3-shot mini-list.

## Recommended next slice

**PR BL — Dialogue Lane Scaffold** (next in the user-locked
chain). Mirror PR BI / PR BK shape with 3 steps Brief / Cast /
Lines & Stitch and 3 disabled buttons (Generate Lines / Stitch
/ Captioned Reels). Sky-tinted chrome to match the mode pill.

After PR BL: PR BM lane regression pass.
