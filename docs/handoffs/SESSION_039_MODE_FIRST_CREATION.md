# SESSION 039 — Mode-First Campaign Creation Modal (PR BH)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BH patch in flight on top of `4a68278`
`docs: real-mode runway credit burn session log`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_035 (PR BD — UX v2 Flag), SESSION_036
(PR BE — SpokespersonStudio Scaffold), SESSION_037 (PR BF —
Knowledge Tab), SESSION_038 (PR BG — Appearances Tab),
and SESSION_REAL_API_CREDIT_BURN.

## Goal

PR BD–BG completed the v2 SpokespersonCard's first pass —
Identity + Knowledge + Appearances all show real data, gated
behind `?ux=v2`. PR BH is the **first v2 slice that visibly
diverges from v1 beyond Stage 1**: it adds a mode-first campaign
creation entry point.

The plan from SESSION_035 was: pick a lane (Cinematic /
Spokesperson / Dialogue) up front, then route into a
purpose-built creation flow. PR BH ships the front half of that
flow — modal + persistence + pill — while the lane-specific
builders ship later in PR BJ–BL.

This stays frontend-only. Backend's `CampaignCreate` payload
doesn't accept a `metadata` field today, so the chosen mode
lives in `localStorage.adspark.activeMode` until a lane builder
needs it server-side.

## Endpoint inventory

PR BH adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### New files

- **`frontend/src/components/CampaignModeModal.jsx`** — the
  three-card picker. Cards are static config (`MODE_CARDS`)
  with `id` ∈ `{cinematic, spokesperson, dialogue}`, an emoji,
  a one-line summary, and a 2–3 sentence detail block.
  Dismisses on backdrop click, Escape key, or close (×) button
  without persisting. `onSelect(mode)` fires when a card is
  clicked; the parent (`SpokespersonStudio`) is responsible for
  the persistence + UI follow-through.

  Accessibility: dialog carries `role="dialog"`,
  `aria-modal="true"`, `aria-labelledby` pointing at the title.
  Focus moves to the dialog on open via a `useRef` on mount.
  Esc handler + outside-click handler are both wired.

### Modified files

- **`frontend/src/uxFlag.js`** — adds three new exports for
  the active-mode lifecycle alongside the existing `getUxMode`
  family:
  - `getActiveMode()` — returns the persisted
    `localStorage.adspark.activeMode` if it's one of the three
    valid modes, else `null`.
  - `setActiveMode(mode)` — persists. Invalid inputs are
    silently ignored.
  - `clearActiveMode()` — removes the key.
  - `CAMPAIGN_MODES` — frozen `{ CINEMATIC, SPOKESPERSON,
    DIALOGUE }` constant set.
  - `ACTIVE_MODE_KEY` — exposes the storage key for tests.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - imports `CampaignModeModal` + the new `getActiveMode` /
    `setActiveMode` / `clearActiveMode` / `CAMPAIGN_MODES`
    exports from uxFlag.js.
  - new `MODE_LABELS` + `MODE_PILL_CLASSES_V2` constants for
    the operator-friendly pill copy + colours.
  - new state: `modeModalOpen` (boolean) + `activeMode` (lazy
    initialiser from `getActiveMode()`).
  - new handlers: `handleOpenCreateModal`,
    `handleCloseCreateModal`, `handleSelectMode(mode)`,
    `handleDismissActiveMode`.
  - new `+ New Campaign` button in the section header (right-
    aligned, pink, prominent).
  - new "Selected mode" pill block that renders when
    `activeMode` is non-null. Pill carries the colour-coded
    label, the placeholder copy, and a `dismiss` link.
  - `<CampaignModeModal>` mounted at the bottom of the
    section.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test now starts by clearing
    `localStorage.adspark.activeMode` + reloading so the pill
    starts hidden regardless of prior runs.
  - new block at the end of the v2 test exercises:
    - `+ New Campaign` button visibility + literal copy.
    - active-mode pill is initially absent.
    - clicking the button opens the modal.
    - all three mode cards render with the correct labels.
    - clicking the Spokesperson card closes the modal +
      surfaces the pill with `data-mode="spokesperson"` + the
      "Mode selected." copy.
    - `localStorage.adspark.activeMode === 'spokesperson'`
      after the click (round-trip proof).
    - dismiss link clears both the pill + the localStorage
      entry.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BH; route
  count narrative confirms unchanged at 68; uxFlag.js +
  SpokespersonStudio.jsx rows updated, new
  CampaignModeModal.jsx row.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged. The
  operator-facing flow gets a wholesale rewrite when v2 flips
  to default in PR BN.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BH; build sizes / route count.
- `docs/handoffs/SESSION_039_MODE_FIRST_CREATION.md` — this
  file.

## v2 mount behaviour

```
SpokespersonStudio header (v2-only):
  ┌────────────────────────────────────────┬─────────────────┐
  │ Spokesperson Studio  preview UX  …     │ + New Campaign  │
  │ Create persistent AI spokespeople …    │                 │
  └────────────────────────────────────────┴─────────────────┘

Click "+ New Campaign":
  ↓ setModeModalOpen(true)
  ↓ <CampaignModeModal isOpen={true} … /> mounts
  ↓ backdrop+dialog overlay, focus on dialog

Modal:
  ┌──────────────────────────────────────────────────────────┐
  │ New Campaign  preview UX                              ×  │
  │ Pick a lane up front …                                   │
  │                                                          │
  │ [🎬 Cinematic]  [🎙️ Spokesperson]  [🎭 Dialogue]         │
  │                                                          │
  │ Selection persists locally as adspark.activeMode …       │
  └──────────────────────────────────────────────────────────┘

Dismiss paths:
  - click backdrop          → onClose() — modal closes, no persist
  - click ×                 → onClose() — modal closes, no persist
  - press Escape            → onClose() — modal closes, no persist
  - click a mode card       → onSelect(mode) — modal closes, persists

After persist:
  ↓ setActiveMode(mode)             writes localStorage
  ↓ setActiveModeState(mode)        triggers re-render
  ↓ section renders pill block:
    ┌────────────────────────────────────────────────────┐
    │ [Spokesperson Ad]  Mode selected. Lane-specific    │
    │                    builder lands next (PR BJ–BL).  │
    │                                          dismiss   │
    └────────────────────────────────────────────────────┘
```

The legacy 4-stage creation flow (Brief → Creative Direction →
Saved) remains the actual path for creating a campaign record —
PR BH only owns the mode entry-point. Operators who pick a
mode + then create a campaign through the existing flow get a
saved card with no `metadata.mode` field; the locally-stored
`adspark.activeMode` survives until they dismiss it or another
mode is picked.

## Mode persistence behaviour

The brief allowed two paths:
1. Persist into `Campaign.metadata.mode` if the existing API
   supports it.
2. localStorage-only, with a clear pill so the choice isn't
   invisible.

We took path 2. The `CampaignCreate` Pydantic model in
`backend/app/models.py` does not declare a `metadata` field;
sending an extra `metadata` key in the payload would be
silently dropped by Pydantic v2's default `extra='ignore'`
behaviour. Adding the field would require a backend change,
which the slice brief explicitly forbade.

The `localStorage.adspark.activeMode` key is the single source
of truth for v2's mode-first selection until lane builders ship:

```
localStorage.adspark.activeMode
  ∈ "cinematic" | "spokesperson" | "dialogue" | (absent)
```

The lazy `useState` initialiser in SpokespersonStudio reads
this on mount via `getActiveMode()`, so a deep-link with the
key already set surfaces the pill on first render.

## Empty-state / safe-fallback behaviour

- **No mode selected (default):** No pill renders. The
  `+ New Campaign` button is the only PR BH-introduced UI
  element visible.
- **Mode selected, no campaign created yet:** Pill renders
  with the placeholder banner; the operator can either
  dismiss the pill or proceed through the legacy creation
  flow.
- **Mode selected, campaign created via legacy flow:** Saved
  card looks identical to v1's. The locally-stored mode
  doesn't get attached server-side. PR BJ–BL will route on
  this mode locally to open the saved card on the right
  lane-specific surface; until then, the saved card opens to
  the legacy Overview tab.
- **Modal opened, dismissed without picking:** No
  localStorage write. Pill stays hidden.
- **Default v1 path:** None of this exists. Stage 1 still
  renders CharacterStudio, not SpokespersonStudio.

## Verification (this session)

Servers were killed and restarted in **mock mode** before
testing (real-mode credit burn already complete in
SESSION_REAL_API).

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` (mock-mode for safety) |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 356.11 KB initial / 98.34 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (31.5 s)` — v1 30.2 s, v2 682 ms |
| Hygiene scan | empty (real-mode generated MP4s remain gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now exercises the full modal flow:

```
✓ + New Campaign button visible w/ correct copy
✓ active-mode pill absent on first paint (after clear+reload)
✓ button click opens modal
✓ all three mode cards render
✓ Spokesperson card click closes modal + flips pill
✓ pill carries data-mode="spokesperson" + "Mode selected." copy
✓ localStorage.adspark.activeMode === "spokesperson"
✓ dismiss link clears pill + localStorage
```

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh, mock mode for safety
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200
```

After implementation, smoke + build ran against fresh
processes. Servers are stopped at end of session.

## Limitations / follow-ups

- **Mode is not persisted on the backend Campaign record.**
  Selection lives in localStorage only. When PR BJ–BL ships
  the lane builders, we'll either thread `mode` through the
  existing creation payload (requires a small `Campaign`
  model addition — `metadata: dict = {}` mirroring
  `Character.metadata`) or graduate it to a first-class
  `Campaign.mode: Literal[…]` field.
- **No routing on selection yet.** Picking a mode flips the
  pill but does NOT auto-open a lane-specific builder. The
  legacy 4-stage flow + saved gallery remain the actual
  creation path. PR BJ–BL fills this in.
- **localStorage is per-browser, per-origin.** A campaign
  created on one machine won't carry the selected mode if the
  operator opens the saved card on another. Acceptable until
  the field is server-side.
- **Pill has no inline edit.** "Selected mode" can be
  dismissed but not changed in place — the operator clicks
  `+ New Campaign` again to pick a different mode (which
  overwrites localStorage). Acceptable; an in-place
  edit-pill is polish for a future PR.
- **Modal doesn't trap focus.** Tab navigation can leave the
  modal and reach elements behind the backdrop. The Escape
  key + outside click both still dismiss; full focus-trap is
  polish.
- **No keyboard shortcut for + New Campaign.** A future PR
  could bind `N` (or `Ctrl+N`) on the v2 surface to open the
  modal; today the only entry-point is the header button.

## Recommended next slice

**PR BI — SpokespersonLane (mode = spokesperson).**

Per the SESSION_035 design plan:

- New `frontend/src/components/lanes/SpokespersonLane.jsx`. A
  3-step focused flow: Brief → Script → Render (Reels +
  Horizontal toggle).
- Wraps the existing PR AB `/spokesperson-ad` route + PR AG
  `/spokesperson-ad/reels` route + PR AH captions.
- Mounts when `activeMode === 'spokesperson'` AND the
  operator has a saved campaign card open in v2 mode.
- Replaces the current Character + Voice tabs for v2 cards
  (legacy gallery still owns those tabs in v1).
- Smoke: extend v2 case to navigate into a spokesperson lane
  (or assert the surface exists) — depending on how mode
  routing lands. Possibly requires cosmetic SpokespersonStudio
  changes too: a "View as Spokesperson Ad" button on
  Appearances rows whose campaigns have the matching mode.

Estimated PR BI size: ~250 LOC across one new lane component
+ ~30 LOC of wiring in CampaignGallery / SpokespersonStudio.
No backend changes. Default v1 smoke unaffected.

After PR BI: PR BJ wires CinematicLane, PR BK wires
DialogueLane. Then PR BL ships the unified Session Log, PR BM
slims the Realtime tab, PR BN flips v2 to the default UX, and
PR BO prunes the legacy components.
