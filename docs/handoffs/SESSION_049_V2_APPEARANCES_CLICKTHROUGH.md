# SESSION 049 — V2 Appearances Click-Through (PR BR)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BR patch in flight on top of `74d5dc6`
`feat: v2 lane inline brief editing (PR BQ)`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_038 (PR BG Appearances tab wiring) +
SESSION_044 (PR BM regression pass) — the disabled "Open in
gallery →" affordance has been waiting since BG with a
tooltip noting it would land "with PR BJ–BL lane routing".
PR BR finally wires it.

## Goal

PR BG showed a list of linked campaigns on each
SpokespersonCard's Appearances tab, but every row's "Open
in gallery →" affordance was a disabled placeholder. Now
that v2 lanes can edit briefs (PR BQ) and fire actions
(PR BN/BO/BP), operators need a fast way to jump from the
spokesperson context into the full saved-card surface for
deeper testing.

PR BR is **frontend-only**. Reuses the existing
CampaignGallery saved-card scroll pattern from PR Y
(`newestSavedId`), but threads through a separate
`openCampaignId` so the v2 jump never collides with v1's
just-saved focus state. Backend untouched. Default v1
load unchanged.

## Endpoint inventory

PR BR adds **no new routes**. Route count remains **69**.
Frontend-only.

## What changed

### Modified files

- **`frontend/src/App.jsx`** —
  - new `openCampaignId` state (`null` by default).
  - threads `openCampaignId` + `onClearOpen` into
    `<CampaignGallery>`.
  - threads `onOpenCampaign={(id) => setOpenCampaignId(id)}`
    into `<SpokespersonStudio>` (only when `isUxV2()` is
    true).
  - completely independent of `newestSavedId` so v1's PR Y
    just-saved focus pattern is preserved unchanged.

- **`frontend/src/components/CampaignGallery.jsx`** —
  - top-level component accepts new props `openCampaignId =
    null`, `onClearOpen`.
  - threads them to each `<CampaignCard>` as
    `isOpenedFromV2` (boolean derived from id match) +
    `onClearOpen` callback.
  - `CampaignCard`:
    - new `openHighlight` local state.
    - new `useEffect` keyed on `isOpenedFromV2`: when it
      flips true, the card scrolls into view (smooth,
      block: 'center'), `setOpenHighlight(true)`, and after
      2.2 s `setOpenHighlight(false)` + `onClearOpen?.()`.
    - outer `<li>` carries new `data-testid="campaign-card"`,
      `data-campaign-id={c.id}`, and `data-opened-from-v2`
      attrs.
    - ring class flips per priority:
      - `openHighlight` → pink-400/70 ring + 28 px pink glow
      - else `isNewestSaved` → spark/60 ring + 24 px sky glow
      - else neutral zinc-800
    - `aria-current="true"` set when either highlight is
      active.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - accepts new `onOpenCampaign` prop.
  - new `openStatus = { campaignId, label }` local state for
    the success banner; auto-clears after 2.5 s via a
    `useEffect`.
  - new `handleOpenCampaign(campaignId)` calls
    `onOpenCampaign?.(id)` then resolves the campaign's
    `business` label from the local campaigns slice (falls
    back to `campaign <id-prefix>` when the campaign isn't
    in scope) and sets the status state.
  - threads `onOpenCampaign={handleOpenCampaign}` into
    `<SpokespersonCard>` per row.
  - new emerald banner `data-testid="spokesperson-open-status"`
    rendered above the modal, only when `openStatus.campaignId`
    is truthy.

- **`frontend/src/components/SpokespersonCard.jsx`** —
  - accepts new `onOpenCampaign` prop (default `null`).
  - "Open in gallery →" button toggles between two
    states based on `Boolean(onOpenCampaign)`:
    - **wired**: pink-500/30 chrome, `onClick →
      onOpenCampaign?.(cm.id)`, tooltip "Scroll to +
      highlight this campaign in the saved gallery
      below."
    - **placeholder**: zinc-800/40 chrome, disabled,
      tooltip "Click-through handler not wired."
  - testid `spokesperson-appearance-open` preserved.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 case's Appearances rows-branch:
    - drops the unconditional
      `await expect(openBtn).toBeDisabled()` assertion.
    - asserts `await expect(openBtn).toBeEnabled()`.
    - clicks the button.
    - asserts `getByTestId('spokesperson-open-status')` is
      visible with copy "Opened campaign in gallery".
    - asserts a `<li data-testid="campaign-card"
      data-opened-from-v2="true">` exists in the gallery
      (gives Playwright up to 1.5 s for the scroll +
      highlight to land).
  - empty-state branch unchanged.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BR; route
  count narrative confirms unchanged at 69.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
  v2 surface stays gated.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation
  expands; build sizes / smoke results.
- `docs/handoffs/SESSION_049_V2_APPEARANCES_CLICKTHROUGH.md`
  — this file.

## Click-through behaviour

```
Operator on SpokespersonStudio (?ux=v2):
  ↓ clicks "Use as Spokesperson" on Brewster's tile
  ↓ clicks Appearances tab
  ↓ Appearances tab lists FocusNet (Piper) or CEO Buzz (Brewster)
  ↓ clicks "Open in gallery →" on a row

Studio handler:
  ↓ handleOpenCampaign(campaignId)
  ↓ onOpenCampaign?.(campaignId)        — bubbles to App.jsx
  ↓ setOpenStatus({campaignId, label})  — banner appears

App.jsx:
  ↓ setOpenCampaignId(campaignId)        — gallery prop changes

CampaignGallery → CampaignCard with matching id:
  ↓ isOpenedFromV2 flips true
  ↓ useEffect: scrollIntoView + setOpenHighlight(true)
  ↓ ring + glow flip to pink
  ↓ data-opened-from-v2="true"
  ↓ after 2.2 s: setOpenHighlight(false) + onClearOpen?.()

App.jsx:
  ↓ setOpenCampaignId(null)              — gallery prop clears

After ~2.5 s in studio:
  ↓ openStatus auto-clears (banner disappears)
```

The clear-on-completion semantics mean the operator can
re-click the same row a few seconds later and trigger the
animation again — the effect's dependency on
`isOpenedFromV2` flipping back to `true` is sufficient.

## Save / state preservation

- `activeMode` (PR BH) preserved — the click-through doesn't
  flip the mode pill or unmount the active lane.
- `activeCharacterId` (PR U) preserved — the active
  spokesperson stays selected.
- `newestSavedId` (PR Y) **not touched** — v1's just-saved
  scroll pattern is independent.
- The CampaignGallery + saved cards re-render with the same
  campaigns data they already had; no refetch fires.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **69** (unchanged from PR BQ) |
| `vite build` | 394.16 KB initial / 105.97 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `3 passed (25.3 s)` — v1 21.1 s, v2 2.7 s, toggle round-trip 822 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now exercises the click-through end-to-end:
button enabled, status banner appears, gallery card flips
its `data-opened-from-v2` attribute. Resilient to fixture
variation: when no Appearances rows exist (no
linkedCampaigns for the active spokesperson), the smoke
falls into the empty-state branch and skips the click test.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule + the brief.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 → footer "Try preview UX →".
2. On Brewster's tile, click "Use as Spokesperson".
3. Click Appearances tab on Brewster's card.
4. CEO Buzz row → click "Open in gallery →" (now pink).
5. Page scrolls down to the saved gallery; the CEO Buzz
   card flashes a pink ring + glow for ~2 s; emerald banner
   reads "Opened campaign in gallery: CEO Buzz." and
   auto-clears.
6. Click again — the animation re-fires.

## Limitations / follow-ups

- **No tab-switch follow-through.** The CampaignCard scrolls
  into view but doesn't auto-open a specific tab inside it.
  An operator who clicked Appearances → Open in gallery
  may want the saved card to land on Visuals or Voice
  depending on what's cached. PR BR keeps it simple — the
  card defaults to Overview unless `isNewestSaved` is also
  true (in which case it defaults to Visuals per PR Y).
- **No keyboard navigation.** The button is a regular
  `<button>` so it's reachable via Tab, but Enter triggers
  the same path; no dedicated shortcut.
- **No undo on the highlight.** Once the 2.2 s timer fires
  the highlight goes away cleanly. If the operator wants
  to "find it again", they re-click the Appearances row.
- **The status banner only appears in v2.** v1 path has no
  matching surface — operators in v1 use the legacy
  newest-saved scroll pattern instead.
- **No live navigation between v2 + v1.** The page itself
  shows both surfaces simultaneously when v2 is active
  (Stage 1 = SpokespersonStudio, Stage 4 = CampaignGallery).
  An operator who toggles the footer back to "Use classic
  UX" gets a full reload; the highlight state is dropped.

## Recommended next slice

Two reasonable follow-ups:

1. **Wire Cinematic Video** with async `image_to_video`
   polling — closes the v2 lane render surface (last
   placeholder button). Adds a per-lane "regenerate visual"
   handler that fires `/runway/generate` + polls
   `/runway/task/{id}` until READY. Estimated 1–2 hours.
2. **Open-in-gallery deep-target** — extend PR BR so the
   click also hints which tab to open inside the
   CampaignCard (Visuals vs Voice vs Realtime) based on
   the row's inferred mode. Small follow-up; ~30 min.

Either is fine. Option 1 is the bigger win (closes the
last placeholder); Option 2 polishes PR BR's edge.
