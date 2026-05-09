# SESSION 043 — Dialogue Lane Scaffold (PR BL)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BL patch in flight on top of `7185554`
`feat: cinematic ad lane scaffold (gated v2)`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_040 (PR BI — Spokesperson Lane) +
SESSION_042 (PR BK — Cinematic Lane).

## Goal

Third and final lane in the v2 mode trio. PR BI scaffolded
Spokesperson, PR BK scaffolded Cinematic, PR BL ships Dialogue
in the same shape. With BL the v2 mode-first surface mounts a
purpose-built lane for every mode the operator can pick from
PR BH's modal.

Backend untouched. Render buttons are disabled placeholders.
Default v1 load unchanged.

## Endpoint inventory

PR BL adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### New files

- **`frontend/src/components/lanes/DialogueLane.jsx`** — same
  shape as PR BI / PR BK with dialogue-specific vocabulary:
  - **Step 1 Brief** — business + product preview from focused
    campaign.
  - **Step 2 Cast** — speaker list inferred from
    `focused.dialogue_lines[*]` (deduped by `character_id` /
    `avatar_id`, capped at 6 visible with `+N more`
    overflow). Empty state when no lines planned.
  - **Step 3 Lines & Stitch** — three disabled render buttons:
    - Generate Dialogue Lines → per-line `avatar_videos`
      render
    - Stitch Dialogue Scene → `dialogue_scene_video_url`
      (PR AF concat)
    - Captioned Reels · 720×1280 → `dialogue_scene_reels_url`
      (PR AG/AH letterbox + per-line drawtext captions)

  Sky-tinted chrome (`ring-sky-400/30 bg-sky-500/[0.04]`) to
  match the PR BG `MODE_PILL_CLASSES["Dialogue Scene"]` colour
  vocabulary. Same `formatTouchedOrDash` helper as PR BK for
  the last-touched line.

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - imports `DialogueLane` from
    `./lanes/DialogueLane.jsx`.
  - active-mode pill copy for dialogue flips from the legacy
    placeholder to `"Dialogue Scene lane open."`.
  - new sibling render block: when `activeMode ===
    CAMPAIGN_MODES.DIALOGUE`, mounts `<DialogueLane>` with
    the same handler/data props the other lanes use. Mode
    switch from cinematic → dialogue unmounts CinematicLane
    and mounts DialogueLane in its place.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test now extends past the cinematic lane block:
    - re-opens the modal via the `+ New Campaign` button.
    - clicks the dialogue mode card.
    - asserts the cinematic lane has unmounted.
    - asserts `dialogue-lane` is visible with
      `data-mode="dialogue"`.
    - asserts all three step testids render
      (`dialogue-lane-step-brief` / `…-cast` / `…-lines`).
    - asserts all three render buttons render disabled with
      the matching `data-render-target` attributes
      (`dialogue-lines`, `dialogue-stitch`,
      `dialogue-reels`).
  - dismiss assertion now also checks the dialogue lane
    unmounts at end of the v2 case.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BL; route
  count narrative confirms unchanged at 68; intro updated
  to call out completion of the lane trio.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BL; build sizes / route count.
- `docs/handoffs/SESSION_043_DIALOGUE_LANE_SCAFFOLD.md` —
  this file.

## Lane mount behaviour

```
SpokespersonStudio render order (v2):
  ┌─ section header (title + + New Campaign button)
  ├─ active-mode pill (if any mode chosen)
  │    spokesperson:  "Spokesperson Ad lane open."
  │    cinematic:     "Cinematic Ad lane open."
  │    dialogue:      "Dialogue Scene lane open."
  ├─ <SpokespersonLane>            ← mode === spokesperson
  ├─ <CinematicLane>               ← mode === cinematic
  ├─ <DialogueLane>                ← mode === dialogue
  ├─ <SpokespersonLibrarySkeleton> while loading
  └─ library grid OR empty state
```

At most one lane mounted at a time. v2 smoke now exercises
the full mode-switch chain spokesperson → cinematic → dialogue
and asserts the disjunction at every step.

## Lane scaffold behaviour

| Step | Content when focused campaign exists | Content when no focused campaign |
|---|---|---|
| Step 1 · Brief | Business (bold), Product (truncated 60 chars), pointer copy | "No linked campaign yet." + setup hint |
| Step 2 · Cast | `N speakers` count + cast list (max 6 + overflow) inferred from `dialogue_lines[*]`; falls back to "No dialogue lines planned…" when none | "Cast ships with the dialogue plan…" hint pointing at classic UX Dialogue tab |
| Step 3 · Lines & Stitch | Three disabled buttons (Generate Lines / Stitch / Reels), each carrying `data-has-output` based on the corresponding cached URL or per-line video URL | Same disabled buttons; "Create or select a campaign…" copy |

Each render button's tooltip:
> Render wiring lands with the dialogue lane builder. Use the
> classic Dialogue tab to render today.

## Verification (this session)

| Check | Result |
|---|---|
| Mock backend booted | `bash scripts/start-local-mock.sh`; `runway_mock=true`, `image_gen_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 378.16 KB initial / 102.00 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (22.9 s)` — v1 21.2 s, v2 1.1 s |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

## Server state at end of session

Mock servers still running for the PR BM regression-pass smoke
that follows.

## Limitations / follow-ups

- **No real generation.** Render buttons are disabled
  placeholders. Operators who want to plan / render dialogues
  flip back to v1 via the footer toggle.
- **Cast list is read-only.** Step 2 surfaces the inferred
  cast but doesn't let the operator add / remove speakers.
  Plan editing lives in the classic UX Dialogue tab; lane
  builder follow-up will graduate it inline.
- **No per-line render-status surface.** Step 3's "Generate
  Dialogue Lines" button shows binary `placeholder` /
  `partial cache`, but doesn't expose the per-line
  idle/running/ok/failed breakdown. Polish slice could
  expand into a 3-row mini list.

## Recommended next slice

**PR BM — Lane Selection Regression Pass** (next in the
user-locked chain). Strengthen smoke coverage so all three
v2 lanes can be selected, mounted, dismissed, and switched
without breaking v1; add a reload-based v1↔v2 toggle test;
fix any lane-switch bugs surfaced.
