# SESSION 058 — Workspace Campaigns Tab Mounts Campaign Lanes (PR CE)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CE patch in flight on top of `d002b8c`
`feat: home library only — strip campaign controls off / (PR CD)`;
commit + push pending after this handoff lands)

**Builds on:** PR CA (router) + PR CB (library polish) +
PR CC (workspace + Identity) + PR CD (home library-only).
The lane components themselves date back to PR BI / BK / BL;
PR BN / BO / BP / BQ / BT / BU wired their handlers.

## Goal

PR CD made `/` library-only but left workspace campaign
creation in a half-finished state — `+ New Campaign` mode
select still navigated to `/legacy` because lanes weren't
mounted inside the workspace yet. PR CE closes the loop:
the workspace's Campaigns tab now mounts the existing
Spokesperson / Cinematic / Dialogue lane components via a
new reusable `<CampaignLanes>` component. Mode select +
lane interaction + every lane handler all stay at
`/spokespeople/:id`.

PR CE is **frontend-only** — pure component extraction. No
backend routes, no schema changes, no generation logic
touched. `/legacy` preserved unchanged. `/` stays
library-only.

## Endpoint inventory

PR CE adds **no new routes**. Backend route count remains
**70**. Lane handlers reuse the long-standing
`/api/campaigns/*` routes; `handleGenerateCinematicVideo`
chains `POST /api/runway/generate` → poll `GET
/api/runway/task/{id}` → `POST /api/campaigns/{id}/cinematic-video`
exactly as PR BT + PR BU do.

## What changed

### New files

- **`frontend/src/components/CampaignLanes.jsx`** (~290
  lines) — self-contained "campaign creation surface" lifted
  out of `<SpokespersonStudio>`. Owns:
  - `activeMode` state (read once at mount via
    `getActiveMode()`; mode select persists via
    `setActiveMode()`; dismiss link clears via
    `clearActiveMode()`).
  - the selected-mode pill banner with mode-specific copy
    + dismiss link (mirrors PR BH/BI shape; testids
    `campaign-lanes-active-mode` /
    `campaign-lanes-active-mode-dismiss`).
  - all three lane components — `<SpokespersonLane>`
    (PR BI/BN/BP), `<CinematicLane>` (PR BK/BO/BP/BT/BU),
    `<DialogueLane>` (PR BL/BP).
  - every lane handler:
    - `handleBuildSpokespersonReels` → `api.buildSpokespersonReels`
    - `handleBuildVoicedCinematic` → `api.buildCommercialWithVoice`
    - `handleGenerateSpokespersonAd` → `api.generateSpokespersonAd`
    - `handleStitchStoryboard` → `api.stitchStoryboard`
    - `handlePlanDialogue` → `api.planDialogue`
    - `handleStitchDialogue` → `api.stitchDialogue`
    - `handleBuildDialogueReels` → `api.buildDialogueSceneReels`
    - `handleUpdateBrief` → `api.updateCampaignBrief`
    - `handleGenerateCinematicVideo` → `api.startRunway` +
      poll loop + `api.persistCinematicVideo` (PR BT + PR BU
      semantics preserved exactly: 5 s ± 800 ms jitter,
      60-attempt 5-min cap, terminal SUCCEEDED / FAILED /
      CANCELED, no infinite loops).
  - the `<CampaignModeModal>` mount, controlled by
    `modalOpen` / `onModalClose` props so any caller can
    flip it.
  - Outer `<section data-testid="campaign-lanes"
    data-active-mode={mode}>` exposes the active mode for
    smoke + future tooling.

  Props:
  - `activeSpokesperson` (Character | null) — passed to
    every lane.
  - `linkedCampaigns` (Array<Campaign>) — campaigns linked
    via `character_id`; lanes pick the most-recent.
  - `campaigns` (Array<Campaign>) — full list, used by
    `handleGenerateCinematicVideo` to read
    `runway_prompt` / `reference_image_url` /
    `runway_model`. Falls back to `linkedCampaigns` if
    not provided.
  - `modalOpen` (bool) — controlled modal visibility.
  - `onModalClose` (() => void) — modal-dismiss callback.
  - `onCampaignsChanged((Campaign) => void)` — fires after
    every successful handler with the updated campaign;
    parent merges into its local slice.

### Modified files

- **`frontend/src/components/SpokespersonWorkspace.jsx`** —
  - Imports swapped: `<CampaignLanes>` replaces the direct
    `<CampaignModeModal>` import; `persistActiveMode` from
    `uxFlag.js` no longer needed (CampaignLanes owns
    activation).
  - `handleOpenCreateCampaign` now flips
    `setActiveTab('campaigns')` + `setModeModalOpen(true)`
    in one shot. The header `+ New Campaign` button
    triggers this so a click from any tab opens the
    workspace's Campaigns view + the modal in-place.
  - **`handleSelectMode` deleted.** CampaignLanes owns
    mode selection now; PR CD's `navigate('/legacy')`
    fallback is gone.
  - New `handleCampaignsChanged(updated)` propagates
    per-handler updates into the workspace's local
    campaigns slice (matches index if found; prepends
    otherwise).
  - **Campaigns tab content rewritten.** Replaces the
    old `<TabComingSoon>` placeholder with a real
    section: header (title + count + `+ New Campaign`
    button — testid
    `spokesperson-workspace-campaigns-new`) + a compact
    `<ul>` of linked campaigns (testids
    `spokesperson-workspace-campaigns-list` +
    `spokesperson-workspace-campaigns-row` per row,
    each carrying `data-campaign-id`) + the
    `<CampaignLanes>` mount with the active spokesperson
    + linked campaigns + full campaigns list +
    controlled modal + change callback.
  - The standalone `<CampaignModeModal>` mount at the
    bottom of the workspace removed (CampaignLanes
    owns it now).

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  workspace-navigation block extended:
  - Placeholder loop now covers Knowledge / Conversations
    / Outputs only (Campaigns gets its own block).
  - New Campaigns assertions: click Campaigns tab →
    section visible + `+ New Campaign` button visible +
    `<CampaignLanes>` mounted (uses `toHaveCount(1)`
    rather than `toBeVisible()` because the empty
    section has zero height before a mode is selected) +
    no modal yet → click + New Campaign → modal opens
    **at the same URL** (no `/legacy` navigation) →
    click `campaign-mode-card-cinematic` → modal closes
    + active-mode pill `data-mode="cinematic"` +
    `cinematic-lane` mounts + spokesperson-lane /
    dialogue-lane absent → click dismiss link → pill +
    lane unmount + localStorage `adspark.activeMode`
    cleared.
  - Resilient to fixture state: the entire workspace +
    Campaigns block is gated on `cardCount > 0`.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR CE; intro
  re-narrates the Campaigns tab + workspace-scoped lanes;
  PR CE row added.
- `docs/OPERATOR_USAGE_MAP.md` — `/spokespeople/:id` entry
  refreshed: Campaigns tab now mounts CampaignLanes; +
  New Campaign opens the modal in-place; lanes wire every
  handler.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR CE; build sizes / smoke results refreshed.
- `docs/handoffs/SESSION_058_WORKSPACE_CAMPAIGN_LANES.md` —
  this file.

## Backend / generation preservation

- All **70** backend routes intact.
- All lane handler API helpers unchanged (`api.*` calls in
  CampaignLanes are the same as PR BN / BO / BP / BQ /
  BT / BU's). The polling loop for `image_to_video` is
  byte-equivalent to v1 `App.handleGenerateVideo` — same
  cadence, same terminal handling, same cap.
- All gitignored media (videos / portraits / voice MP3s /
  host clips / dialogue stitches / reels exports)
  reachable via the same URL fields. PR BU's CEO Buzz
  cinematic, the Brewster portrait, every other on-disk
  artifact play unchanged.
- `<SpokespersonStudio>`'s lane code preserved verbatim
  (still gated by `!hideCampaignControls` from PR CD; no
  caller reaches it today, but keeping it avoids a delete
  before the workspace flow proves itself in real-mode
  validation).

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| `vite build` | 465.64 KB initial / 127.54 KB gzip + 561.97 KB lazy chunk (+6.19 KB initial / +1.61 KB gzip vs PR CD) |
| Playwright mock smoke | `3 passed (29.3 s)` — Test 1 (@ /legacy) 27.1 s, Test 2 (@ /) 1.0 s, Test 3 (top-bar round-trip) 600 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The build delta is moderate (+6.19 KB / +1.61 KB) — the new
component + Campaigns tab content + the smoke extensions.

**No real Runway calls fired this session.** Per CLAUDE.md
hard rules + brief, real-mode generation is reserved for
explicit per-task approval.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — Spokesperson Library only
   (PR CD homepage). Click any tile's
   `Open Spokesperson →` link.
2. Workspace mounts at `/spokespeople/{id}`. Identity tab
   default. Click `+ New Campaign` in the header.
3. **Active tab flips to Campaigns + the mode modal
   opens — no navigation away.** URL stays at
   `/spokespeople/{id}`.
4. Pick **Cinematic Ad** — modal closes; active-mode pill
   shows; CinematicLane mounts inside the workspace's
   Campaigns tab section. Brief / Visual Source / Render
   columns visible; the linked campaign list above the
   lane shows the most-recent campaign in compact form.
5. Click `Generate Real Cinematic Video` (rose, burns
   credits) → real Runway start + poll + persist runs
   exactly as PR BT/BU validated. Status row progresses
   through `starting → polling → saving to campaign →
   saved to campaign`. URL still
   `/spokespeople/{id}`.
6. Click `dismiss` on the active-mode pill → lane
   unmounts; pill goes away; localStorage cleared.
7. Re-open `+ New Campaign` and pick **Spokesperson Ad**
   instead → SpokespersonLane mounts with Horizontal +
   Reels actions (the Horizontal button burns credits
   per PR BP).
8. Click `Identity` to bounce back to portrait + voice
   work; click `Knowledge` / `Conversations` /
   `Outputs` for the still-placeholder tabs.
9. Click the top-bar `Legacy UI ↗` to confirm `/legacy`
   still works end-to-end.

## Limitations / follow-ups

- **`<SpokespersonStudio>` lane code is now dead.** No
  caller reaches it today (the Library passes
  `hideCampaignControls=true` from PR CD; the workspace
  uses `<CampaignLanes>`). Keeping it avoids a delete
  before the workspace flow proves itself; a future slice
  can sunset the studio's lane handlers + the
  `hideCampaignControls` prop entirely.
- **Workspace `<CampaignLanes>` and the Library's
  `<SpokespersonStudio>` use independent campaigns
  fetches.** The workspace fetches its own list; the
  Library fetches its own. A shared SWR-like store is the
  obvious next refactor; today's per-route fetches keep
  PR CE's blast radius tight.
- **`onCampaignsChanged` propagates one campaign at a
  time.** If a future lane action touches multiple
  campaigns or characters at once (none today), the
  caller would need to refetch. Matches the existing
  per-handler shape; not a regression.
- **CampaignLanes is empty until a mode is selected.** The
  outer `<section data-testid="campaign-lanes">` has zero
  height in that state. Smoke uses `toHaveCount(1)`
  instead of `toBeVisible()` to handle this. Operators
  see the section quietly until they pick a mode; no
  visual placeholder is rendered for the empty state.
- **No tile-level "+ New Campaign" shortcut yet.** The
  brief flagged this as a maybe; today operators must
  open the workspace first. A future slice could surface
  a per-tile "Create campaign" link that deep-links to
  `/spokespeople/{id}` with the modal pre-opened.

## Recommended next slice

Two reasonable directions:

1. **PR CF — Sunset SpokespersonStudio's lane code +
   `hideCampaignControls` prop.** Deletes the duplicated
   lane handlers + lane mounts inside SpokespersonStudio
   now that no caller reaches them. Removes the
   `<CampaignModeModal>` import. Reduces studio file size
   ~40%. Lowest-risk follow-up.
2. **PR CF' — Workspace Knowledge / Outputs tabs.** Replace
   the remaining `<TabComingSoon>` placeholders with real
   content: Knowledge surfaces grounding documents +
   transcript history per spokesperson; Outputs becomes a
   unified gallery of cinematic / spokesperson ad /
   dialogue / reels / voice outputs across every linked
   campaign. The compact campaigns list inside the
   Campaigns tab is the seed of the Outputs view.

Option 1 is the cleaner architectural step; option 2
ships more visible product progress. Either is fine.
