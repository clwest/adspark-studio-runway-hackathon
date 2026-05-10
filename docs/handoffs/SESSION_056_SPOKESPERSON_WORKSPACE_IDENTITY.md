# SESSION 056 — Spokesperson Workspace Shell + Identity Tab (PR CC)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CC patch in flight on top of `766648c`
`feat: spokesperson library polish + create spokesperson cta (PR CB)`;
commit + push pending after this handoff lands)
**Builds on:** PR CA (router + library-as-home) + PR CB
(library polish + Create CTA) + the existing
`/api/characters/*` route family (PR K through PR BB).

## Goal

PR CB made the homepage feel like a real product home, but
selecting a spokesperson still scrolled inside a tile rather
than opening a focused page. PR CC adds the dedicated
`/spokespeople/:id` workspace — the natural home for
identity / knowledge / campaigns / conversations / outputs
work. **Identity is fully implemented**; the other four tabs
ship as compact placeholders so the structure is visible
without committing to incomplete behaviour.

PR CC is **frontend-only**. Backend routes, generation
pipelines, and on-disk media are all untouched. /legacy
behaviour is preserved unchanged.

## Endpoint inventory

PR CC adds **no new routes**. Backend route count remains
**70**. The Identity tab calls the same `/api/characters/*`
routes the legacy CharacterStudio uses; the `+ New Campaign`
flow mode-selects via the existing `<CampaignModeModal>` then
hands off to the Library's lane logic on `/`.

## What changed

### New files

- **`frontend/src/components/SpokespersonWorkspace.jsx`**
  (~430 lines) — the workspace shell.
  - Reads `:id` from `useParams()`; fetches
    `/api/characters` + `/api/campaigns` once on mount;
    finds the matching character.
  - **Loading state** — skeleton block with two
    pulsing rectangles.
  - **Not-found state** — when the id doesn't match,
    renders a friendly message + a `Back to Library`
    CTA with stable testids
    (`spokesperson-workspace-not-found`,
    `spokesperson-workspace-back-cta`).
  - **Header** — back link (`←` to `/`), portrait,
    name (`<h1>`), three pills:
    - **Persona pill** — derived from `character.template`
      via a small label table (mascot / founder / coach /
      local_guide). `data-template` exposes the raw value.
    - **Avatar pill** — `host_avatar_status` mapped to
      ready (emerald) / mock (zinc) / failed (rose) /
      pending (amber when `host_avatar_id` set but no
      status) / not created (zinc).
    - **Voice pill** — same five-state vocabulary as the
      PR CB tile chip (preset / cloned (mock) / cloned +
      pending apply / cloned + applied / drift / failed).
    Tooltips on each pill expose the underlying
    field values for diagnosis.
    Subline: linked-campaign count + subject text.
    Primary `+ New Campaign` CTA on the right.
  - **5-tab nav** — Identity (default) / Knowledge /
    Campaigns / Conversations / Outputs. Each tab button
    carries `data-active` + a stable testid
    (`spokesperson-workspace-tab-{id}`). Outer `<main>`
    carries `data-active-tab={activeTab}` for smoke +
    future telemetry.
  - **Identity tab** — embeds the legacy `<CharacterCard>`
    with every handler wired:
    `handleGeneratePortrait`,
    `handleCreateAvatar`, `handleCloneVoice`,
    `handleApplyVoiceToAvatar`,
    `handleRefreshAvatarVoice`,
    `handleRefreshVoicePreview`, `handleDelete`. Each
    calls the same `api.*` helper the SpokespersonStudio
    handlers use. On delete, navigates back to `/`. The
    section is wrapped with a small explainer that PR CD
    will split this into a dedicated IdentityPanel +
    VoicePanel.
  - **Placeholder tabs** — Knowledge / Campaigns /
    Conversations / Outputs each render a reusable
    `<TabComingSoon>` panel with a short summary + a
    pink "lands next" pill. Each placeholder has a stable
    testid `spokesperson-workspace-{tab}`.
  - **`+ New Campaign` flow** — opens
    `<CampaignModeModal>`. On select:
    `persistActiveMode(mode)` + `saveActiveSpokespersonId(id)`
    + close modal + `navigate('/')`. Library's existing
    `<SpokespersonStudio>` reads both from localStorage
    on mount + lane mounts the right surface for the right
    spokesperson immediately. No cross-route plumbing
    required.
  - Pins the active spokesperson via
    `saveActiveSpokespersonId(id)` on mount so any
    deep-link to `/spokespeople/{id}` correctly aligns
    the active state with the URL.

### Modified files

- **`frontend/src/App.jsx`** — adds the new route:

  ```jsx
  <Route path="spokespeople/:id" element={<SpokespersonWorkspace />} />
  ```

  Inside the `<AppShell>` parent, alongside `/`, `/legacy`,
  `/legacy/*`, and the catch-all redirect.

- **`frontend/src/components/SpokespersonCard.jsx`** —
  - Imports `<Link>` from react-router-dom.
  - Adds an `Open Spokesperson →` link inside the PR CB
    summary chip strip with stable testid
    `spokesperson-summary-open`. Pink chrome to mirror
    the workspace primary tone. Pushed to the right via
    `ml-auto` so the chip strip reads
    `voice · linked · outputs · → Open` left-to-right.

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  (`@ /`) extended with a workspace navigation block:
  - Reads the first tile's `data-spokesperson-id`.
  - Clicks `spokesperson-summary-open`; asserts URL
    `/spokespeople/{id}`.
  - Asserts workspace mounts + carries
    `data-spokesperson-id` and
    `data-active-tab="identity"` initially.
  - Header testids: `-header`, `-name`, `-back-link`,
    `-new-campaign`, `-tabs`, `-avatar-pill`,
    `-voice-pill` all visible.
  - Identity tab is default + active; each of the four
    placeholder tabs (knowledge / campaigns /
    conversations / outputs) flips `data-active-tab` and
    mounts its own coming-soon panel when clicked.
  - Deep-links `/spokespeople/this-id-does-not-exist`;
    asserts `spokesperson-workspace-not-found` + the
    `Back to Library` CTA both render.
  - Round-trips back to `/` so subsequent assertions in
    Test 2 still apply.
  - Resilient to fixture state: when the library is empty
    (no spokespeople), the entire workspace block is
    skipped.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR CC; intro
  re-narrates the three top-level routes; PR CC row added
  to the ledger.
- `docs/OPERATOR_USAGE_MAP.md` — section 0 picks up the new
  `/spokespeople/:id` route entry; last-updated stamp moved.
- `docs/WHAT_IT_IS.md` — intentionally unchanged. PR CA's
  refresh still describes the Library as the homepage; the
  workspace is implementation detail until PR CD–CE expand it.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR CC; build sizes / smoke results refreshed.
- `docs/handoffs/SESSION_056_SPOKESPERSON_WORKSPACE_IDENTITY.md`
  — this file.

## Backend / generation preservation

- All **70** backend routes intact.
- Identity tab handlers call:
  - `POST /api/characters/{id}/generate-portrait`
  - `POST /api/characters/{id}/create-avatar`
  - `POST /api/characters/{id}/clone-voice`
  - `POST /api/characters/{id}/apply-voice`
  - `POST /api/characters/{id}/refresh-avatar-voice`
  - `POST /api/characters/{id}/refresh-voice-preview`
  - `DELETE /api/characters/{id}`
  All pre-existing; PR CC just gives them a new container.
- All gitignored media (videos / portraits / voice MP3s /
  host clips) reachable via the same URL fields. PR BU's
  CEO Buzz cinematic, the existing Brewster portrait, and
  every other on-disk artifact play unchanged.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| `vite build` | 459.10 KB initial / 125.83 KB gzip + 561.97 KB lazy chunk (+10.63 KB initial / +2.85 KB gzip vs PR CB) |
| Playwright mock smoke | `3 passed (30.7 s)` — Test 1 (@ /legacy) 28.3 s, Test 2 (@ /) 1.2 s, Test 3 (top-bar round-trip) 564 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The build delta is small (+10.63 KB initial / +2.85 KB gzip)
— the workspace component + new route + tile open link.

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
1. http://localhost:5173 — Spokesperson Library mounts
   (PR CA + CB header / stats / tiles).
2. Click Brewster's tile `Open Spokesperson →` link →
   navigates to `/spokespeople/d047894984a4`.
3. Workspace header shows portrait + "Brewster the
   Raccoon" + persona pill ("Mascot · animal/brand") +
   avatar pill (`avatar · ready` emerald, given the
   fixture state) + voice pill (`voice · cloned ·
   applied · match` emerald). Subline: "1 linked
   campaign".
4. Identity tab is default; CharacterCard renders inline
   with all voice + portrait + avatar affordances.
5. Click each of the four placeholder tabs (Knowledge /
   Campaigns / Conversations / Outputs) — each mounts
   its `<TabComingSoon>` panel with a short summary +
   a "lands next" pill.
6. Click `+ New Campaign` — `<CampaignModeModal>` opens.
   Pick Cinematic Ad → modal closes, page navigates to
   `/`, Library mounts the cinematic lane targeting
   Brewster's CEO Buzz campaign.
7. Click the top-bar `← Library` CTA at any time to
   return to `/`.
8. Direct deep-link to `/spokespeople/this-id-does-not-exist`
   renders the friendly not-found page with a Back CTA.

## Limitations / follow-ups

- **Identity tab still embeds CharacterCard.** The brief's
  "card-within-card" concern is real — PR CD splits this
  into a dedicated IdentityPanel + VoicePanel. For PR CC
  the embed gives operators every voice / portrait / avatar
  affordance immediately without rewriting; the PR CD
  decomposition is purely visual cleanup.
- **Knowledge / Campaigns / Conversations / Outputs are
  placeholders.** Each ships as a separate slice (PR CD/CE/CF)
  once the IdentityPanel split lands. Today they tease the
  expected content + link out to `/legacy` for operators
  who need the full surface immediately.
- **No keyboard navigation between tabs.** Each tab button
  is a regular `<button>` reachable via Tab; arrow-key
  navigation between tablist items is deferred.
- **Workspace fetches its own /api/characters +
  /api/campaigns.** Library fetches the same lists
  separately. A shared store (SWR-like) is the obvious next
  refactor but staying with per-route fetches keeps PR CC's
  blast radius tight.
- **Tile in-card tabs preserved.** SpokespersonCard still
  renders Identity / Knowledge / Appearances tabs in-tile
  alongside the new `Open Spokesperson →` link. The brief
  asked us not to do "a huge tile rewrite in this slice";
  PR CD or later may simplify the tile to portrait + name
  + summary chips + open link only.
- **`+ New Campaign` round-trip is two-step.** Click in
  workspace → modal → mode → navigate to / → lane mounts
  there. A future slice could mount the lane directly
  inside the workspace's Campaigns tab.
- **Active spokesperson is pinned to URL on mount.** This
  means navigating to a workspace also flips the
  `loadActiveSpokespersonId()` for /. Generally desirable
  but worth noting if a future slice introduces multi-
  spokesperson context.

## Recommended next slice

Two reasonable directions:

1. **PR CD — Identity / Voice panel split.** Extract the
   embedded CharacterCard's portrait surface +
   voice-clone-and-apply surface into two dedicated panels
   inside the workspace's Identity tab. Reduces the
   "card-within-card" feel + makes the Knowledge /
   Campaigns tabs ready to ship next. Estimated 1 day,
   frontend-only.
2. **PR CD' — Campaigns tab.** Skip the IdentityPanel
   split for now and ship the Campaigns tab as compact
   tile rows with regenerate / open actions per output.
   This lets the workspace replace the legacy gallery
   click-through faster but leaves Identity feeling busy.

Option 1 is the cleaner architectural step; option 2 ships
more visible product progress. Either is fine.
