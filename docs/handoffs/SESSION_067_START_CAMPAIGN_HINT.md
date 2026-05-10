# SESSION 067 — Workspace Consumes Start Campaign Hint (PR CL)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CL patch in flight on top of `6679db9`
`feat: createspokesperson 4-step flow stepper (PR CK)`;
commit + push pending after this handoff lands)

**Builds on:** PR CK's CreateSpokespersonFlow Step 4
"Start a campaign" checkbox + the existing PR CC
SpokespersonWorkspace + PR CE CampaignLanes mount.

## Goal

PR CK captured the operator's intent in
`localStorage.adspark.startCampaignHint` when they checked
"Start a campaign" on Step 4 — but nobody read it back.
The flow finished, the modal closed, the operator stayed
on `/`, and the workspace they wanted to go to never
opened. The checkbox felt broken.

PR CL closes the loop in two places:

1. **SpokespersonStudio.handleSpokespersonCreated** —
   after writing the localStorage hint, **navigate to
   `/spokespeople/{id}`** so the workspace mount fires.
2. **SpokespersonWorkspace mount** — read the hint, and if
   it matches the route id: clear the key, switch to the
   Campaigns tab, open the campaign mode modal in-place.

Net effect end-to-end: tick the box → new tile lands in
library → workspace opens → mode picker is already
showing.

## Endpoint inventory

PR CL adds **no new routes**. Backend route count remains
**71**. Pure frontend wiring.

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - Imports `useNavigate` from `react-router-dom`.
  - `const navigate = useNavigate()` near the top of the
    component (after the prop destructure).
  - `handleSpokespersonCreated` extended: after writing
    `adspark.startCampaignHint`, calls
    `navigate('/spokespeople/{id}')` so the workspace
    mount fires + the hint round-trip completes. Operators
    who don't tick the box stay on `/` exactly as before
    (no navigation).

- **`frontend/src/components/SpokespersonWorkspace.jsx`**
  — adds a second mount-time useEffect (after the
  PR CC active-spokesperson pinning effect):
  ```js
  useEffect(() => {
    if (!id) return
    let hint = null
    try { hint = localStorage.getItem('adspark.startCampaignHint') }
    catch { return }
    if (!hint || hint !== id) return
    try { localStorage.removeItem('adspark.startCampaignHint') }
    catch { /* best-effort */ }
    setActiveTab('campaigns')
    setModeModalOpen(true)
  }, [id])
  ```
  - Single-shot — clears the key after consuming so a
    page refresh / re-mount doesn't re-open the modal.
  - Safe degradation if localStorage throws (private
    mode, etc.) — workspace still mounts normally; the
    mode modal just doesn't auto-open.
  - Does nothing when the hint is unset OR when the hint
    references a different id (operator visiting an
    unrelated spokesperson while a hint is still in
    flight).

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  (`@ /`) gets a new section right after the PR CC
  workspace not-found check (still inside the
  `cardTotal > 0` branch):
  ```js
  // Set hint, navigate, assert mode modal opens, key cleared.
  await page.evaluate((id) => {
    localStorage.setItem('adspark.startCampaignHint', id)
  }, cardId)
  await page.goto(`/spokespeople/${cardId}`)
  await expect(workspace).toHaveAttribute('data-active-tab', 'campaigns')
  await expect(page.getByTestId('campaign-mode-modal')).toBeVisible()
  expect(localStorage.getItem('adspark.startCampaignHint')).toBeNull()
  ```
  Test then ESC-closes the modal so the rest of Test 2
  isn't blocked by its overlay, and goto's back to `/`.

### Docs

- `docs/INVENTORY.md` — feature stack picks up PR CL;
  intro re-narrates the closed loop.
- `docs/OPERATOR_USAGE_MAP.md` — last-updated stamp moved.
- `00-START-NEXT-SESSION.md` — UX redesign foundation
  picks up PR CL; build + smoke results refreshed.
- `docs/handoffs/SESSION_067_START_CAMPAIGN_HINT.md` —
  this file.

### What did NOT change

- **Backend.** No routes touched.
- **CreateSpokespersonFlow.** Step 4's checkbox copy +
  the localStorage write path are unchanged from PR CK.
- **Mode modal copy.** The brief mentioned a possible
  status banner — opted out; the existing
  `<CampaignModeModal>` heading ("Choose campaign type")
  + footer copy is already clear enough.
- **`/legacy`.** No reference to the hint; never opens
  the v2 mode modal.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged from PR CK) |
| `vite build` | 480.83 KB initial / 131.52 KB gzip + 561.97 KB lazy chunk (+0.36 KB initial / +0.11 KB gzip vs PR CK — tiny wiring slice) |
| Playwright mock smoke | `3 passed (28.4 s)` — Test 1 (@ /legacy) 25.5 s, Test 2 (@ / + workspace + hint round-trip) 1.8 s, Test 3 (top-bar round-trip) 590 ms |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

**No real Runway calls fired this session.**

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 → click `+ Create Spokesperson`.
2. Walk Steps 1–3, then on Step 4 **check the
   "Start a campaign" checkbox**. (Avatar checkbox
   optional — won't affect the hint flow.)
3. Click `Create Spokesperson`. The flow runs the create
   + portrait pipeline. On success:
   - tile appears in library
   - localStorage hint set
   - **page navigates to `/spokespeople/{newId}`**
4. Workspace mounts. The Campaigns tab is auto-active and
   `<CampaignModeModal>` is showing. Operator picks Cinematic
   / Spokesperson / Dialogue → lane mounts inside the same
   workspace (PR CE behaviour).
5. localStorage hint is cleared. Refreshing the page does
   not re-open the modal.

## Limitations / follow-ups

- **One-shot consumption.** If the operator dismisses the
  modal without picking a mode, they need to click
  `+ New Campaign` manually to reopen — same as PR CE.
  Could add "intent retained" persistence later but the
  current behaviour matches operator expectation: dismiss
  = "I changed my mind".
- **No status banner.** The brief permitted a small
  intro copy; opted out since
  `<CampaignModeModal>`'s own heading already explains
  the choice. Easy to add later if needed.
- **Mismatched hints are ignored silently.** A stale
  hint pointing at a deleted character would be
  consumed only when the operator visits that exact
  `/spokespeople/{id}` route, which would currently
  show the not-found state without opening the modal.
  No cleanup needed.
- **Avatar bind side effect (PR CK opt-in) still
  fires before navigation.** If both checkboxes were
  ticked, the modal completes the avatar bind first
  then navigates. Avatar errors don't block navigation
  per PR CK's existing graceful-fallback behaviour.

## Recommended next slice

**PR CM — Library tile simplification** (SESSION 059
Fix #2): strip each `<SpokespersonCard>` tile down to
portrait + name + persona pill + summary chips +
`Open Spokesperson →` link. Deletes the in-tile tab
strip + the embedded `<CharacterCard>` Identity tab —
those affordances already live inside the workspace
at `/spokespeople/{id}` (which now also consumes the
PR CL hint). Reduces the most-flagged duplication
from QA. ~half-day, frontend-only.

Alternative: **PR CM' — Real Outputs tab gallery**
(SESSION 059 Fix #3) — replaces the workspace's
Outputs `<TabComingSoon>` with a unified gallery
surfacing every cached output URL across linked
campaigns. ~1 day.
