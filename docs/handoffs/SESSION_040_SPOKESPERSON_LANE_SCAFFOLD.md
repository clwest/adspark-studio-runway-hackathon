# SESSION 040 — Spokesperson Lane Scaffold (PR BI)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BI patch in flight on top of `600eec9`
`feat: mode-first campaign creation modal (gated v2)`; commit +
push pending after this handoff lands)
**Builds on:** SESSION_035–SESSION_039 (UX v2 foundation through
mode-first modal).

## Goal

PR BH gave the v2 surface a mode-first creation modal but the
selection only flipped a pill. PR BI makes the spokesperson
mode actionable: when `localStorage.adspark.activeMode ===
"spokesperson"`, a lane scaffold mounts below the pill with a
3-step Brief / Script / Render preview so the operator sees
what the lane will eventually do.

This is a **scaffold** — render buttons are disabled
placeholders, no real API calls fire from the lane. PR BJ wires
the actual `/spokesperson-ad` + `/spokesperson-ad/reels` submit
handlers + a Commercial Script editor inline. PR BI just makes
sure the lane shape is committed to muscle memory and the
testids are stable for downstream slices.

Default v1 load is unchanged. Backend untouched. No real Runway
calls.

## Endpoint inventory

PR BI adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### New files

- **`frontend/src/components/lanes/SpokespersonLane.jsx`** —
  the lane component. Three responsibilities:
  1. Pick a "focused" campaign — the most recent
     `linkedCampaigns[i]` by `created_at` ISO string compare.
  2. Render three step columns (Brief / Script / Render)
     stacked on small screens, side-by-side on `md+`.
  3. Surface two disabled placeholder render buttons that
     carry `data-has-output` flags so PR BJ can flip them to
     enabled with proper handlers without renaming testids.

  Receives `activeSpokesperson` (Character | null) +
  `linkedCampaigns` (Array<Campaign>). Empty-state hint at the
  bottom when neither is set.

  Local `formatKnowledgeTimeOrDash` helper falls back to `—` so
  rows never render an empty timestamp. Reuses
  `formatHistoryTimestamp` from `uiHelpers.js`.

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - imports `SpokespersonLane` from
    `./lanes/SpokespersonLane.jsx`.
  - active-mode pill copy is now conditional on `activeMode ===
    CAMPAIGN_MODES.SPOKESPERSON`: shows "Spokesperson Ad lane
    open." instead of the legacy "Mode selected. Lane-specific
    builder lands next." Other modes keep the legacy copy.
  - new sibling render block: when activeMode is
    `spokesperson`, mounts `<SpokespersonLane>` with the
    Character object resolved from `activeCharacterId` and the
    pre-indexed `campaignsByCharacter[activeCharacterId]`.
    Cinematic + dialogue modes only render the placeholder
    pill until PR BJ / PR BK ship.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test's pill assertion now expects
    `Spokesperson Ad lane open` instead of "Mode selected".
  - new block exercises the lane:
    - `spokesperson-lane` testid is visible with
      `data-mode="spokesperson"`.
    - all three step testids render
      (`spokesperson-lane-step-brief` / `…-script` / `…-render`).
    - both render buttons render disabled with the matching
      `data-render-target` attributes.
  - dismiss link assertion now also confirms the lane unmounts
    alongside the pill (it's gated on the same `activeMode`
    state).

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BI; route
  count narrative confirms unchanged at 68;
  SpokespersonStudio.jsx + new `lanes/SpokespersonLane.jsx`
  rows updated.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged. The
  v2 surface is gated; the operator-facing flow doc gets a
  wholesale rewrite when PR BN flips v2 to default.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BI; build sizes / route count.
- `docs/handoffs/SESSION_040_SPOKESPERSON_LANE_SCAFFOLD.md` —
  this file.

## Lane mount behaviour

```
SpokespersonStudio render order (v2):
  ┌─ section header (title + + New Campaign button)
  ├─ active-mode pill (if any mode chosen)
  │    if mode === spokesperson:  "Spokesperson Ad lane open."
  │    else:                       "Mode selected. Lane-specific…"
  ├─ <SpokespersonLane>                     ← only when mode === spokesperson
  ├─ <SpokespersonLibrarySkeleton> while loading
  └─ library grid OR empty state
```

Lane unmounts when:
- the operator clicks the dismiss link on the active-mode pill,
- the operator picks a different mode in the modal,
- the operator clicks "Use classic UX" in the footer (full
  reload back to v1).

Lane data sources:
- `activeSpokesperson` = the Character object resolved from
  `activeCharacterId` (set via PR U "Use as Spokesperson"
  buttons). May be `null`.
- `linkedCampaigns` = `campaignsByCharacter[activeCharacterId]`
  — the same per-character index PR BF builds for the
  Knowledge / Appearances tabs. Empty array when no campaigns
  link to the active spokesperson.

## Lane scaffold behaviour

Three step columns, each its own rounded ring-1 card:

| Step | Content when focused campaign exists | Content when no focused campaign |
|---|---|---|
| Step 1 · Brief | Business (bold), Product (truncated 60 chars), pointer copy "Brief capture will reuse the existing campaign form…" | "No linked campaign yet." + setup hint pointing at the classic UX |
| Step 2 · Script | First 220 chars of `commercial_script` in a monospace `<pre>` with `max-h-[6rem]` scroll, plus pointer copy about PR AC PromptPreview | Friendly copy noting the script editor lives in classic UX Stage 3 |
| Step 3 · Render | Two disabled buttons (Horizontal + Reels) each carrying `data-render-target` + `data-has-output` flags. Tooltip notes wiring lands with PR BJ. Last-touched timestamp at the bottom when set. | Same disabled buttons; "Create or select a campaign…" copy underneath |

Footer hint at the bottom of the lane (testid
`spokesperson-lane-empty-hint`) renders **only** when
`!hasSpokesperson && !hasCampaign`. Reads:

> Pick an active spokesperson (Use as Spokesperson on a card)
> and link them to a campaign to populate this lane.

## Placeholder / action behaviour

The two render buttons are intentionally `<button disabled>`
with `cursor-not-allowed` styling. They carry:

- `data-testid="spokesperson-lane-horizontal"` |
  `"spokesperson-lane-reels"`
- `data-render-target="horizontal" | "reels"`
- `data-has-output="true" | "false"` — flips to `"true"` when
  the focused campaign already has a cached
  `host_video_url` / `spokesperson_reels_url`. PR BJ will use
  this to decide between "Render" and "Re-render" copy.
- `title="Render wiring lands with PR BJ. Use the classic
  gallery to render today."`

No click handler is wired; clicking the disabled button is a
no-op and produces no network traffic. Operators who need to
render today still go through the legacy gallery (toggle UX
back to classic via the footer link).

## Verification (this session)

Servers were killed and restarted in **mock mode** before
testing. Real-mode credit burn already complete in
SESSION_REAL_API.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 362.78 KB initial / 99.99 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (22.2 s)` — v1 20.8 s, v2 767 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now covers the full PR BH → PR BI flow:

```
✓ + New Campaign opens modal w/ 3 mode cards
✓ Spokesperson Ad card → modal closes + pill flips
✓ pill copy reads "Spokesperson Ad lane open."
✓ <SpokespersonLane> visible with data-mode="spokesperson"
✓ all 3 step testids visible (brief / script / render)
✓ both render buttons visible + disabled
✓ render buttons carry data-render-target attributes
✓ localStorage round-trip → "spokesperson"
✓ dismiss → pill + lane both unmount
✓ localStorage cleared after dismiss
```

## Server state at end of session

**Servers left running** (per the new "always confirm both
servers running before claiming UI is testable" memory rule).
The user can hit the v2 surface immediately:

```
backend: pid=52101 · http://localhost:8000 · runway_mock=true
vite:    pid=52184 · http://localhost:5173 · http=200
```

Toggle UX via footer or `?ux=v2`; click `+ New Campaign`; pick
🎙️ Spokesperson Ad — the new lane appears.

## Limitations / follow-ups

- **No real generation from the lane.** Render buttons are
  disabled placeholders. Operators who want to fire
  `/spokesperson-ad` today flip back to v1 via the footer
  toggle.
- **No inline Brief / Script editing.** Steps 1 + 2 are
  read-only previews. PR BJ either embeds the existing
  CampaignForm + PromptPreview into Steps 1 + 2, or
  cross-links to the classic UX surfaces with a "Edit in
  classic UX →" affordance.
- **Lane only sees the active spokesperson.** If the operator
  hasn't clicked "Use as Spokesperson" on any card,
  `linkedCampaigns` is empty even when other characters have
  rich linkage. Acceptable scope; the operator picking an
  active spokesperson is the v2 mental model.
- **Mode lives in localStorage only.** Inherits the PR BH
  limitation. PR BJ's wiring will need to thread the chosen
  mode into the `POST /api/campaigns` payload (likely via a
  new `Campaign.metadata` field or a first-class `mode`
  literal).
- **No URL routing per lane.** Selecting a mode doesn't change
  the URL. Refreshing the page re-reads localStorage and
  remounts the lane on the same screen. Acceptable for V1.
- **Lane visual distinction is subtle.** Lane uses an
  emerald-tinted ring/background to mark the "Spokesperson
  Ad" mode. Cinematic / Dialogue lanes (PR BJ / PR BK) will
  use fuchsia / sky tints to mirror the mode-pill colours.

## Recommended next slice

**PR BJ — Cinematic Ad lane scaffold.**

Mirror PR BI's shape:

- New `frontend/src/components/lanes/CinematicLane.jsx` with a
  3-step Brief / Visual Source / Render layout. Visual Source
  step previews the cached image_to_video silent visual; Render
  step has disabled placeholder buttons for the silent cut +
  the Voiced Cinematic Ad mux.
- Mounts in SpokespersonStudio when `activeMode === "cinematic"`.
- Tints the lane chrome fuchsia (matches PR BG's
  `MODE_PILL_CLASSES.Cinematic`).
- Active-mode pill copy becomes "Cinematic Ad lane open." for
  this branch; falls back to legacy copy for `dialogue` until
  PR BK.
- Backend untouched. No real API calls.

Estimated PR BJ size: ~200 LOC. v1 default smoke unaffected.
v2 smoke gets a parallel block under the cinematic branch.

After PR BJ: PR BK ships DialogueLane, then PR BL wires the
unified Session Log, PR BM slims the Realtime tab, PR BN flips
v2 to default, PR BO prunes legacy.
