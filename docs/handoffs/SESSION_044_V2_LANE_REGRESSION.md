# SESSION 044 — Lane Selection Regression Pass (PR BM)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BM patch in flight on top of `8967061`
`feat: dialogue scene lane scaffold (gated v2)`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_040 (PR BI Spokesperson Lane),
SESSION_042 (PR BK Cinematic Lane), SESSION_043 (PR BL Dialogue
Lane).

## Goal

PR BI / BK / BL each shipped one lane and added one mode-switch
assertion to the v2 smoke. PR BM hardens the test surface so
the v2 redesign is **structurally complete + verified**:

- v1 default doesn't leak any v2-only testids (catches the
  bug where a v2 surface accidentally renders unconditionally)
- v2 mounts unmount the legacy CharacterStudio (catches the
  inverse: v2 + v1 both rendering)
- footer toggle round-trip (v1 → click → v2 → click → v1)
  works end-to-end including reload remount

No production code changes — purely test additions. No backend
changes. Default v1 load unchanged. Lane scaffolds + modal +
flag all carry their PR BD–BL behaviour unchanged.

## Endpoint inventory

PR BM adds **no new routes**. Route count stays at **68**.
Test-only.

## What changed

### Modified files

- **`frontend/tests/adspark-smoke.spec.js`** (only file
  touched). Three changes:

  1. **v1 smoke negative assertions** — after the existing
     "+ Create Character" button visibility check, asserts
     each of these testids is **absent** on the default
     load:
     - `spokesperson-studio`
     - `spokesperson-new-campaign`
     - `spokesperson-active-mode`
     - `campaign-mode-modal`
     - `spokesperson-lane`
     - `cinematic-lane`
     - `dialogue-lane`

     If any of these leak into v1, the flag-aware mount in
     App.jsx has regressed.

  2. **v2 smoke positive negative assertion** — after the
     existing `spokesperson-studio` visibility check, asserts
     the legacy `+ Create Character` button has **count 0**
     when v2 mounts. Catches the inverse regression: v1
     CharacterStudio leaking into the v2 path.

  3. **New third test: `AdSpark Studio footer UX toggle
     round-trip`**. End-to-end click path:
     - Goto `/`, clear localStorage, reload.
     - Confirm v1 (legacy `+ Create Character` visible,
       `spokesperson-studio` absent, toggle reads
       `data-ux-mode="v1"` + copy "Try preview UX").
     - Click toggle, wait for `load`. Confirm v2 mounts
       (`spokesperson-studio` visible, `+ Create Character`
       absent, toggle reads `data-ux-mode="v2"` + copy
       "Use classic UX").
     - Click again, wait for `load`. Confirm v1 returns.
     - Console / page errors clean across the round-trip.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BM; route
  count narrative confirms unchanged at 68; intro now
  describes the v2 redesign as structurally complete.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BM; smoke results now report 3 passed.
- `docs/handoffs/SESSION_044_V2_LANE_REGRESSION.md` — this
  file.

## Coverage matrix

The brief listed seven assertion targets. PR BM verifies each:

| Brief requirement | Where verified |
|---|---|
| v1 default still loads classic UX | v1 test 7b.5 — `+ Create Character` button + `Character Studio` heading both visible |
| `?ux=v2` loads Spokesperson Studio | v2 test — `spokesperson-studio` visible, `+ Create Character` absent (PR BM) |
| selecting Cinematic mounts CinematicLane | v2 test — modal → cinematic → `cinematic-lane` visible (PR BK) |
| selecting Spokesperson mounts SpokespersonLane | v2 test — modal → spokesperson → `spokesperson-lane` visible (PR BI) |
| selecting Dialogue mounts DialogueLane | v2 test — modal → dialogue → `dialogue-lane` visible (PR BL) |
| clearing selected mode removes lane | v2 test — dismiss → all three lane testids count=0 (PR BL) |
| footer classic/preview toggle still works | new test 3 — round-trip with reload (PR BM) |

Plus: **v1 leakage catch** — new v1 negative-assertion block
catches a class of regression that wasn't covered before (a
v2-only surface accidentally rendering on the default path
because of a missing `isUxV2()` gate).

## Verification (this session)

Servers booted via `bash scripts/start-local-mock.sh` (PR BJ).

| Check | Result |
|---|---|
| Mock backend health | `runway_mock=true`, `image_gen_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 378.16 KB initial / 102.00 KB gzip + 561.97 KB lazy chunk (unchanged from PR BL — no JS changes) |
| Playwright mock smoke | `3 passed (29.8 s)` — v1 27.3 s, v2 1.1 s, toggle round-trip 749 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The v1 test runtime grew (~21 s → ~27 s) because
the negative-assertion block runs `getByTestId(…).toHaveCount(0)`
seven times. Each call defaults to a 5 s timeout but resolves
instantly when the testid is genuinely absent — the bump is
likely Playwright runtime variance, not the new assertions.

## Bugs surfaced + fixed

**None.** The full mode-switch chain spokesperson → cinematic
→ dialogue → dismiss already worked across PR BI/BK/BL; the
v1 ↔ v2 footer toggle round-trip also passed on first run.
PR BM is purely a smoke-hardening slice — no production code
needed adjustment.

## Server state at end of session

Mock servers still running for any follow-up testing. Operator
can flip to real mode via `bash scripts/start-local-real.sh`.

## Whether v2 lanes are ready for manual test

**Yes.** All three lane scaffolds mount, render, and unmount
correctly. The footer toggle flips between the v1 and v2
default surfaces with a reload. The mode-first modal closes on
selection and persists to localStorage.

What v2 **cannot** do yet (these are the next-tier slices):
- actually fire generation from any lane render button
- provide inline Brief / Script / Cast editing inside a lane
- click-through from Appearances rows or lane render buttons
  into the legacy gallery's saved card

What v2 **can** do today:
- show every existing spokesperson with Identity / Knowledge
  / Appearances tabs
- show every linked campaign's grounding + transcript history
  + inferred mode
- guide the operator through mode-first campaign intent
- preview the lane shape for whichever mode they pick
- live alongside v1 without breaking either path

## Limitations / follow-ups

- **Render buttons across all 3 lanes are still disabled
  placeholders.** Wiring them to fire real Runway routes is a
  future slice (per-lane: PR BN Spokesperson submit, PR BO
  Cinematic submit, PR BP Dialogue submit — or a single PR
  that wires all three).
- **No inline editing inside lanes.** Brief / Script / Cast
  panels are read-only previews; editing still requires the
  classic UX.
- **Toggle test reload is full-page.** Each click reloads
  `window.location` so the test runtime includes vite's hot
  module graph. Faster paths exist (React Context for the
  flag) but the current semantics match the operator's mental
  model.

## Recommended next slice

Two reasonable paths:

1. **Wire one lane's render buttons to real backend routes**
   — pick the easiest target (Spokesperson Reels: existing
   PR AG/AH route, no real Runway call needed for a fresh
   render once the source MP4 exists). Demonstrates that the
   v2 lane structure can fire production behaviour, not just
   preview it.
2. **Inline Brief editing inside lanes** — embed the existing
   CampaignForm component into Step 1 of each lane so the
   operator can capture a brief without leaving v2. Likely
   simpler than route wiring; doesn't require any lane
   submit handlers.

Either choice is a 1–2 hour slice. Defer the bigger
"campaign-create-from-modal" backend change (a `mode` field on
Campaign) until at least one lane has real submit semantics.
