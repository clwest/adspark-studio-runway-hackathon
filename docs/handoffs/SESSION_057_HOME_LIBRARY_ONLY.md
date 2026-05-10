# SESSION 057 — Home Library Only (PR CD)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CD patch in flight on top of `0b292e0`
`feat: spokesperson workspace shell + identity tab (PR CC)`;
commit + push pending after this handoff lands)

## Naming note

The user briefed this slice as **"PR CC — Move Campaign
Creation/Lanes Out of Home"**, but the previous
**PR CC — Spokesperson Workspace Shell + Identity Tab**
already shipped at commit `0b292e0`. To preserve a clean git
history without overlapping slot names, this slice ships as
**PR CD — Home Library Only**. Handoff filename is
`SESSION_057_HOME_LIBRARY_ONLY.md` (the brief asked for
`SESSION_056_HOME_LIBRARY_ONLY.md`, but SESSION_056 is
already taken by the workspace handoff). The intent of the
brief is fully implemented; the labels are the only delta.

**Builds on:** PR CA (router) + PR CB (library polish) +
PR CC (workspace + Identity).

## Goal

After PR CB / PR CC the homepage still showed the global
`+ New Campaign` button, the selected-mode pill, and the
Spokesperson / Cinematic / Dialogue lane components
inherited from the v1-era SpokespersonStudio shell. That
contradicted the new IA — campaign creation belongs inside
the spokesperson workspace, not on the library homepage.

PR CD strips all of that off `/`. The homepage is now a
pure Spokesperson Library: heading + tagline + stats +
tiles + Create CTA. The `<SpokespersonWorkspace>`'s own
`+ New Campaign` button keeps working but hands off to
`/legacy` (the verbatim v1 wizard) until lanes mount inside
the workspace's Campaigns tab in the upcoming slice.

PR CD is **frontend-only**. No backend changes; no
generation logic touched; `/legacy` preserved verbatim.

## Endpoint inventory

PR CD adds **no new routes**. Backend route count remains
**70**.

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - New prop `hideCampaignControls` (default `false`,
    backwards-compatible).
  - When `true`, suppresses:
    1. The `+ New Campaign` button (`spokesperson-new-campaign`)
       in the header.
    2. The active-mode pill banner
       (`spokesperson-active-mode`) below the header.
    3. All three lane components — `<SpokespersonLane>`,
       `<CinematicLane>`, `<DialogueLane>`.
    4. The mounted `<CampaignModeModal>`.
  - Defaults preserve the existing v1-era behaviour for any
    other caller (none today, but keeps the prop additive).

- **`frontend/src/Library.jsx`** — passes
  `hideCampaignControls={true}` to its
  `<SpokespersonStudio>`. Result: `/` reads as a pure
  library — heading, tagline, 4-chip stats row, primary
  `+ Create Spokesperson` CTA, spokesperson tiles, and the
  PR CC `Open Spokesperson →` per-tile link. Nothing else.

- **`frontend/src/components/SpokespersonWorkspace.jsx`**
  — `handleSelectMode` previously navigated to `/` after
  persisting the active mode. PR CD strips lanes off `/`,
  so that landing page no longer mounts a lane. Updated to
  navigate to `/legacy` instead — the verbatim v1 wizard is
  the canonical creation surface until lanes mount inside
  the workspace's Campaigns tab. The active spokesperson is
  already pinned in localStorage so legacy Stage 1 picks up
  the right person on first paint. The Campaigns tab's
  placeholder copy now mentions the `/legacy` fallback +
  the upcoming workspace lane mount.

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  (`@ /`) restructured:
  - The big PR BH/BI/BK/BL/BN/BO/BP/BQ/BR/BS/BT/BU
    mode-modal + lane assertion block (~305 lines, lines
    1138–1444) **deleted**. Those surfaces no longer
    render on `/`; the equivalent v1 walkthrough still
    runs against `/legacy` in Test 1.
  - New PR CD absence assertions in its place: the six
    testids `spokesperson-new-campaign`,
    `spokesperson-active-mode`, `campaign-mode-modal`,
    `spokesperson-lane`, `cinematic-lane`,
    `dialogue-lane` must all return `toHaveCount(0)`.
  - The earlier PR CB block's `+ New Campaign` button
    visibility assertion flipped from `toBeVisible()` to
    `toHaveCount(0)`.
  - The PR CC workspace navigation block at the bottom of
    Test 2 unchanged — tile open link → workspace →
    Identity / Knowledge / Campaigns / Conversations /
    Outputs tab round-trip + not-found state still
    asserted.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR CD; intro
  re-narrates the new homepage scope; PR CD row added at
  the bottom of the ledger.
- `docs/OPERATOR_USAGE_MAP.md` — section 0 routing reference
  refreshed: `/` library-only; `/spokespeople/:id` workspace
  with the new `/legacy` mode-select handoff.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR CD; build sizes / smoke results refreshed.
- `docs/handoffs/SESSION_057_HOME_LIBRARY_ONLY.md` — this
  file.

## Backend / generation preservation

- All **70** backend routes intact.
- All v1 lane handlers (`handleBuildSpokespersonReels`,
  `handleBuildVoicedCinematic`, `handleGenerateSpokespersonAd`,
  `handleStitchStoryboard`, `handlePlanDialogue`,
  `handleStitchDialogue`, `handleBuildDialogueReels`,
  `handleGenerateCinematicVideo`, `handleUpdateBrief`)
  live unchanged in `<SpokespersonStudio>` so the v1 lane
  components themselves can still be mounted by future
  callers (the workspace's Campaigns tab will reuse them
  next slice).
- All gitignored media (videos / portraits / voice MP3s /
  host clips / dialogue stitches / reels exports) reachable
  via the same URL fields. PR BU's CEO Buzz cinematic, the
  Brewster portrait, every other on-disk artefact play
  unchanged.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| `vite build` | 459.45 KB initial / 125.93 KB gzip + 561.97 KB lazy chunk (+0.35 KB initial / +0.10 KB gzip vs PR CC) |
| Playwright mock smoke | `3 passed (25.2 s)` — Test 1 (@ /legacy) 23.0 s, Test 2 (@ /) 940 ms, Test 3 (top-bar round-trip) 610 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The build delta is tiny (+0.35 KB initial / +0.10 KB gzip)
— three conditional gates and a workspace navigate-target
change. **No real Runway calls fired this session.**

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — homepage reads "Spokesperson
   Library", with the brief-pinned tagline, the 4-chip
   stats row, the primary `+ Create Spokesperson` CTA,
   spokesperson tiles with their summary chips +
   `Open Spokesperson →` links. **No `+ New Campaign`
   button anywhere on `/`. No mode pill. No lane
   components.**
2. Click any tile's `Open Spokesperson →` link → lands on
   `/spokespeople/{id}` (the PR CC workspace). Header
   shows the persona / avatar / voice pills + the primary
   `+ New Campaign` CTA.
3. Click `+ New Campaign` → mode modal opens (from
   workspace, not Library) → pick Cinematic Ad → mode +
   active spokesperson are persisted → page navigates to
   `/legacy`. The legacy wizard's Stage 1 has Brewster
   pre-selected via the persisted active spokesperson;
   the operator can complete the legacy create flow with
   any of the three modes' lanes (the legacy
   SpokespersonStudio at `/legacy` mounts lanes via the
   same code path PR CD just hid on `/`).
4. Click `← Library` to return to the homepage.
5. Top-bar `Legacy UI ↗` link still works.

## Limitations / follow-ups

- **`+ New Campaign` is a two-hop in v2.** Workspace →
  modal → /legacy. The next slice (PR CE — Workspace
  Campaigns Tab) will mount the lanes directly inside the
  workspace's Campaigns tab so the entire creation flow
  stays inside `/spokespeople/:id`.
- **No active-mode pill anywhere in v2.** PR CD hides it
  on `/` and the workspace doesn't render its own yet.
  The mode persists in localStorage so the legacy wizard
  picks it up; visible mode confirmation lives only at
  `/legacy` for now.
- **Workspace's mode select navigates away.** When a user
  picks a mode in the workspace they leave `/spokespeople/:id`
  for `/legacy`. Mildly disorienting but safer than landing
  on a blank `/` with no lane. PR CE removes this hop.
- **Lane component code is preserved unchanged.** They
  haven't been deleted — `<SpokespersonStudio>` still
  knows how to mount them when `hideCampaignControls=false`.
  PR CE will lift them into a workspace-scoped surface
  without touching internal lane behaviour.
- **Smoke for v2 lane behaviour now lives at /legacy.**
  Test 1 walks the same wizard + saved-card gallery
  surface; the lane testid set still resolves there. If
  the legacy wizard is ever sunset, Test 1 will need to
  move to a workspace-scoped equivalent.

## Recommended next slice

**PR CE — Workspace Campaigns Tab.** Mount the existing
Spokesperson / Cinematic / Dialogue lane components
directly inside the workspace's Campaigns tab so the
entire creation flow stays at `/spokespeople/:id`. Approach
options:

1. **Re-enable `<SpokespersonStudio>` in a sub-mode.** Pass
   a new `lanesOnly` prop that hides the heading, stats,
   library grid, and Create modal — leaving only the mode
   pill + lane mounts + CampaignModeModal. The workspace
   mounts that variant inside its Campaigns tab. Lowest-
   risk; reuses the existing handler stack verbatim.
2. **Extract a `<CampaignLanes>` component.** Lift the
   active-mode logic + lane handlers out of
   SpokespersonStudio into a shared, scoped component.
   Cleaner architecturally; more refactoring up front.

Option 1 is the smaller PR CE; option 2 is the right
long-term move. Either way, after PR CE the
SpokespersonStudio's lane logic can begin to be sunset
in favour of the workspace home.
