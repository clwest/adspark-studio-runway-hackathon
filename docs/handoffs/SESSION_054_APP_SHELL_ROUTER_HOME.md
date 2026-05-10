# SESSION 054 — App Shell + Router + Spokesperson Library as Home (PR CA)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CA patch in flight on top of `9148cd9`
`docs: log PR BU real-mode credit burn`; commit + push
pending after this handoff lands)
**Builds on:** PR BD (UX v2 flag) through PR BU (Cinematic
Video persistence). PR CA is the first frontend architecture
refactor since v1 — it flips the homepage from the legacy
4-stage wizard to the Spokesperson Library and moves the
wizard to `/legacy`.

## Goal

The product is **persistent AI spokesperson infrastructure**,
but the visible UI still opened with a campaign wizard. PR CA
fixes that: `/` is now the Spokesperson Library; the legacy
wizard moves behind a route. The v2 surface graduates to
default with no flag required.

PR CA is **frontend-only**. Backend routes, generation
pipelines, storage helpers, and on-disk media are all
untouched.

## Endpoint inventory

PR CA adds **no new routes**. Backend route count remains
**70**. The frontend now has three top-level routes:

| Route | Page | Notes |
|---|---|---|
| `/` | `<Library>` | Spokesperson Library (default homepage; mounts `<SpokespersonStudio>`). |
| `/legacy` | `<LegacyApp>` | Verbatim v1 four-stage wizard + saved-campaign gallery, frozen. |
| `/legacy/*` | `<LegacyApp>` | Alias to `/legacy` for emergency deep-links. PR CB will land `/legacy/gallery` as a direct gallery anchor. |
| `*` | `<Navigate to="/" replace>` | Anything else redirects to `/`. |

## What changed

### New files

- **`frontend/src/components/AppShell.jsx`** — persistent
  shell wrapping `<TopBar>` + a routed `<Outlet>`. Owns the
  one-shot localStorage migration:
  - `localStorage.adspark.ux === "v1"` → navigate to /legacy
    + clear the key.
  - `?ux=v1` → same redirect + strip the param.
  - `?ux=v2` → strip the param silently (deep-link
    backwards-compat).
  - Anything else → land on the requested route.

- **`frontend/src/components/TopBar.jsx`** — three jobs:
  brand (`AdSpark Studio` + tagline `persistent AI
  spokesperson infrastructure`), tiny health pill (`mock
  Runway` / `partial mock` / `live API` / `backend down`
  with `data-mock` + `data-runway-mock` + `data-status`
  attrs), and a route-aware Legacy UI affordance:
  - on `/` → `Legacy UI ↗` zinc link (testid
    `app-shell-legacy-link`).
  - on `/legacy` → `← Library` pink CTA (testid
    `app-shell-home-cta`).
  Health is a single GET `/health` on mount — no polling.

- **`frontend/src/Library.jsx`** — thin wrapper around
  `<SpokespersonStudio>` for the `/` route. Owns
  active-spokesperson state via the same localStorage key
  the legacy wizard uses (`adspark.activeSpokesperson` via
  `loadActiveSpokespersonId` / `saveActiveSpokespersonId`),
  so toggling between `/` and `/legacy` preserves the
  selection. Pre-warms `/api/campaigns` + `/api/characters`
  on mount so the studio's first paint hits a warm backend.

- **`frontend/src/LegacyApp.jsx`** — clone of the original
  `App.jsx` (~830 lines) renamed to `<LegacyApp>` with two
  surgical changes:
  1. The `isUxV2() ? <SpokespersonStudio> : <CharacterStudio>`
     ternary in Stage 1 is replaced with an unconditional
     `<CharacterStudio>` — `/legacy` is the always-v1
     surface; the v2 SpokespersonStudio + lanes only mount
     on `/`.
  2. Footer `<UxModeToggle />` removed entirely (button
     deleted, the unused helper function deleted, related
     uxFlag imports deleted). The top-bar Legacy UI link is
     the canonical round-trip.
  All v1 wizard handlers (PR A through PR AZ-era stack) are
  preserved verbatim — the smoke at `/legacy` still walks
  the full create flow.

### Modified files

- **`frontend/src/App.jsx`** — completely rewritten as a
  thin router root. ~30 lines. Mounts
  `<BrowserRouter>` + the three routes above with
  `<AppShell>` as the layout parent. **No data fetching here
  any more** — page components own their own list fetches.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  one-line change. The PR BR/BS Appearances "Open in
  gallery →" affordance was always-enabled because
  SpokespersonStudio threaded its internal
  `handleOpenCampaign` to SpokespersonCard regardless of
  whether the parent (App / Library) actually provided
  `onOpenCampaign`. PR CA threads `null` instead when the
  parent didn't wire one, so on the `/` route the button
  reads its existing disabled placeholder state. PR BR/BS
  click-through behaviour is preserved unchanged on /legacy
  (where LegacyApp does wire the callback through to
  CampaignGallery).

- **`frontend/tests/adspark-smoke.spec.js`** — three tests
  restructured for the new routing:
  - **Test 1** (`@ /legacy`, ~25.6 s) — verbatim end-to-end
    walkthrough of the v1 wizard. Same assertions as the
    pre-PR-CA smoke; only the entry URL flipped from `/` to
    `/legacy`. Step 13c's footer `ux-mode-toggle` assertion
    swapped for a one-line top-bar `app-shell-home-cta`
    visibility check (the dedicated round-trip lives in
    Test 3).
  - **Test 2** (`@ /`, ~740 ms) — Spokesperson Library is
    the new default. Asserts `library-route`,
    `app-shell-topbar`, `app-shell-legacy-link`,
    `app-shell-health-pill`, and `spokesperson-studio` all
    mount; explicitly asserts the legacy "+ Create
    Character" button + Stage 2 "Campaign Brief" heading +
    ModeBanner are absent. The PR BR/BS Appearances click-
    through assertions are tightened to expect the disabled
    placeholder on `/` (the gallery isn't here; PR CB
    relocates it).
  - **Test 3** (top-bar Legacy UI round-trip, ~550 ms) —
    `/` → click `app-shell-legacy-link` → assert URL `/legacy`
    + LegacyApp surfaces present + library-route absent →
    click `app-shell-home-cta` → assert URL `/` + library
    surfaces back.

- **`frontend/package.json`** — adds
  `react-router-dom@^7.15.0`. Two moderate-severity
  vulnerabilities reported by `npm audit` are in transitive
  deps unrelated to runtime; no action taken.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR CA; intro
  re-narrates the routing layout; PR CA row added to the
  ledger.
- `docs/OPERATOR_USAGE_MAP.md` — new section 0 (routing
  reference) at the top; subsequent sections still describe
  the working surfaces, which now live on `/`.
- `docs/WHAT_IT_IS.md` — opening rewritten to lead with
  "persistent AI spokesperson infrastructure" + new "The
  frontend reset (PR CA)" section.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR CA; build sizes / smoke results refreshed;
  new bullet describing the routing layout.
- `docs/handoffs/SESSION_054_APP_SHELL_ROUTER_HOME.md` —
  this file.

## Backend / generation preservation

- All **70** backend routes intact. No additions, no
  deletions, no schema changes.
- All `api.js` helpers (PR A through PR BU) unchanged.
- All generation pipelines (Runway client, ffmpeg pipelines,
  voice client, realtime broker, transcript fetcher) untouched.
- All gitignored media (videos / portraits / voice MP3s /
  host clips / dialogue stitches / reels exports) reachable
  via the same URL fields on Campaign / Character. PR BU's
  CEO Buzz cinematic (`data/videos/fc8a20c42bc5.mp4`,
  validated on real Runway with task
  `b5d331ba-9844-42ab-b857-982920794a9c`) plays unchanged
  inside the legacy gallery.
- Real-mode demo path (CEO Buzz + Brewster) works on both
  `/` (lane regenerate flow) and `/legacy` (wizard +
  gallery), since both routes consume the same campaigns +
  characters JSON files.

## UX flag handling (one-shot migration)

| Input | Behaviour |
|---|---|
| `localStorage.adspark.ux === "v1"` | Redirect to `/legacy` once on first load, clear the key. |
| `localStorage.adspark.ux === "v2"` | Stay on whatever route was requested; clear the key. |
| `?ux=v1` query param | Strip the param + redirect to `/legacy`. |
| `?ux=v2` query param | Strip the param silently. |
| No localStorage / no query | Land on the requested route (default `/`). |

The `uxFlag.js` module stays in the codebase as a one-shot
migration helper inside AppShell. It's removable once the
legacy route itself sunsets (PR CC+).

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged from PR BU) |
| `vite build` | 438.88 KB initial / 120.98 KB gzip + 561.97 KB lazy chunk (+39.20 KB initial / +13.47 KB gzip vs PR BU) |
| Playwright mock smoke | `3 passed (27.4 s)` — Test 1 25.6 s, Test 2 740 ms, Test 3 550 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The bundle increase is one-shot — `react-router-dom@^7` is
~12 KB gzip; the rest is the new shell + Library scaffolding.
PR CB onward should stay flat.

**No real Runway calls fired this session.** Per CLAUDE.md
hard rules + brief, real-mode generation is reserved for
explicit per-task approval.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule + the brief.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — lands on the Spokesperson
   Library (no flag, no `?ux=v2`).
2. Top bar shows `AdSpark Studio` + a `live API` pill
   (real-mode boot) + `Legacy UI ↗` link.
3. Brewster's tile renders with Identity / Knowledge /
   Appearances tabs. "+ New Campaign" button still opens
   the mode modal; lanes still mount per mode and fire
   real production behaviour (PR BN/BO/BP/BT/BU all
   working unchanged).
4. Click "Legacy UI ↗" — top-bar swaps to `← Library`,
   page mounts the verbatim v1 wizard at `/legacy`. All
   four stages + saved-campaign gallery work as before.
5. Click `← Library` — back to `/`.
6. Direct `/?ux=v1` deep-link redirects to `/legacy` once
   and clears the param.

## Limitations / follow-ups

- **No `/legacy/gallery` deep-link yet.** Currently aliased
  to `/legacy` (full app). PR CB will land a route that
  scrolls to the saved-card gallery anchor inside LegacyApp
  — useful for SESSION_REAL_API click-throughs that point
  at a specific campaign id. Two-line change: add a
  `<Route path="legacy/gallery">` that mounts LegacyApp
  with a `scrollToGallery` prop.
- **Appearances click-through disabled on `/`.** On the new
  homepage, the v2 Appearances row's "Open in gallery →"
  button reads its disabled placeholder (no gallery on
  `/`). PR BR/BS behaviour is preserved verbatim on
  `/legacy`. PR CB lands the workspace Campaigns tab as
  the new click-through target.
- **No shared list store yet.** Library and LegacyApp each
  own their own `/api/characters` + `/api/campaigns`
  fetches. A shared SWR-like hook is the obvious next
  refactor (PR CB+) but staying with per-component fetches
  kept PR CA's blast radius tight.
- **No deep-linkable spokesperson workspace yet.** PR CA
  intentionally does not introduce `/spokespeople/:id`. The
  Library tile click still flips active-spokesperson state
  + scrolls within the Library page; PR CB lands the
  dedicated workspace.
- **Bundle size jump.** +39 KB initial / +13 KB gzip from
  `react-router-dom`. One-shot; future PRs reuse the dep.
  If we want it cheaper later, swapping for a 30-line
  in-house route matcher is a 1-hour task (the current
  routing surface is small enough).
- **Console warnings: react-router future-flags.** v7
  emits soft deprecation warnings about v8 future flags;
  smoke filters them via `IGNORED_CONSOLE_ERRORS`. Real
  cleanup lands when we bump to v8.

## Recommended next slice

Two reasonable directions:

1. **PR CB — Spokesperson Workspace shell + Identity tab**
   (the next slice in the SESSION_053 refactor plan).
   Adds `/spokespeople/:id` route mounting a
   `<SpokespersonWorkspace>` with header + tab bar. The
   Identity tab is fully implemented (lifts CharacterCard's
   portrait / voice clone / apply-to-avatar / refresh
   handlers into a dedicated panel). Knowledge / Campaigns
   / Conversations / Outputs render `<TabComingSoon>`
   placeholders. Library tile click navigates here. Old
   `SpokespersonCard.jsx` (the in-tile tabs version) gets
   deleted. Estimated 1 day.
2. **`/legacy/gallery` deep-link.** Tiny ~30-min slice that
   makes the `/legacy/gallery` route scroll the saved-card
   gallery into view on mount. Useful for click-throughs
   from the future workspace before PR CB lands.

PR CB is the bigger product win; the gallery deep-link is
nice-to-have polish.
