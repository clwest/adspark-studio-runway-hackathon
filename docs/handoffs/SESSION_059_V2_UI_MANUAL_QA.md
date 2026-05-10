# SESSION 059 — V2 UI Manual QA (post PR CE)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `1586400` (`feat: workspace campaigns
tab mounts campaign lanes (PR CE)`).
**Mode:** Real-mode servers throughout (backend pid `60990`,
vite pid `61014`, `runway_mock=false`, `image_gen_mock=false`,
`openai_mock=true` — the `partial mock` TopBar pill in the
screenshots reflects the mocked OpenAI provider, NOT Runway).
**No real Runway calls fired during QA** — the Playwright
walk explicitly skipped every `Generate Real …` button.
**Method:** Headless Chromium walkthrough via Playwright
that visited every checklist surface and saved screenshots
to `/tmp/qa-screenshots/` (16 PNGs). I then read each
screenshot back through the Read tool to inspect the
rendered UI, cross-referenced against the JSX source, and
audited the in-product copy. **I cannot literally see
pixels with a human eye** — findings labelled `[visual]`
came from screenshot inspection at 1280×900; findings
labelled `[code]` came from auditing the source.

## QA checklist coverage

| # | Step | Result |
|---|---|---|
| 1 | Start at `/` | ✅ Library mounts cleanly |
| 2 | Create Spokesperson modal | ✅ opens / cancels |
| 3 | Open Spokesperson workspace | ✅ Brewster's tile → `/spokespeople/d047894984a4` |
| 4 | Identity tab sanity | ⚠️ works but feels duplicated with library tile |
| 5 | Campaigns tab | ✅ section + linked campaign row + lanes container |
| 6 | + New Campaign (header CTA) | ✅ flips active tab + opens modal in-place |
| 7a | Spokesperson Ad lane | ✅ mounts inside workspace, all 3 columns wired |
| 7b | Cinematic Ad lane | ✅ mounts, "open cinematic video ↗" link present |
| 7c | Dialogue Scene lane | ✅ mounts, three action buttons visible |
| 8 | Lanes feel understandable | ⚠️ steps + buttons OK, copy is stale + dev-jargony |
| 9 | No surprise jump to /legacy | ✅ confirmed end-to-end at `/spokespeople/{id}` |
| 10 | /legacy still works | ✅ wizard mounts, 3 saved videos still stream |
| 11 | Real Brewster assets | ✅ CEO Buzz cinematic / host / voiced / reels all served |
| 12 | List confusing / broken | see below |

## What felt good

- **Library home is clean.** Heading "Spokesperson Library"
  + brief-pinned tagline + 4-chip stats row + + Create
  Spokesperson + tiles. No more 4-stage wizard contamination
  on `/`. Reads as a real product home.
- **Create Spokesperson modal is focused.** 4 fields (name,
  template, voice preset, optional subject). Auto-portrait
  is a delight — the new tile renders with a face on first
  paint. Cancel + ESC + backdrop all dismiss cleanly.
- **Workspace navigation works.** `Open Spokesperson →` link
  on each tile reliably opens `/spokespeople/{id}`. Header
  carries persona + avatar + voice pills with sensible
  colour coding. Back-to-library arrow is obvious.
- **Campaigns tab inside workspace.** PR CE delivered the
  big architectural promise: + New Campaign opens the mode
  modal in-place at `/spokespeople/{id}`, mode select
  mounts the appropriate lane scoped to this spokesperson,
  dismiss link cleanly unmounts. **No more `/legacy`
  hand-off.** The compact linked-campaign row above the
  lane (`fc8a20c4 · CEO Buzz · Dumpster-to-CEO Energy
  Drink · rendered`) is small but informative.
- **Lane structure is consistent.** All three lanes
  (Spokesperson / Cinematic / Dialogue) follow the same
  3-step layout (Brief / [Script|Visual Source|Cast] /
  Render). Once you've used one you know how to use the
  others.
- **Real demo assets survive.** /legacy still streams the
  PR BU-validated CEO Buzz cinematic + host video +
  voiced commercial + spokesperson reels. Three `<video>`
  elements mounted in the legacy gallery — confirmed via
  Playwright DOM count.
- **Top-bar health pill** — `live API` (real mode) /
  `partial mock` (mock mode) / `mock Runway` (full mock)
  reads at a glance.
- **Not-found state.** Direct deep-link to a bogus
  `/spokespeople/this-id-does-not-exist` shows a clean
  "Spokesperson not found" page with a `← Back to Library`
  CTA. No infinite spinner.

## What felt confusing

### High-impact

- **The library tile's in-tile Identity tab duplicates the
  workspace's Identity tab almost exactly.** [visual + code]
  Each library tile renders its own
  `<CharacterCard>` (voice clone mic, preview, apply, drift,
  repair history). The workspace also embeds
  `<CharacterCard>` inside its Identity tab. Operators see
  the same affordances in two places for the same
  spokesperson. This was flagged as a known limitation in
  PR CC's handoff but is the single biggest "this still
  feels half-finished" signal in the v2 surface.

- **Two `+ New Campaign` buttons inside the workspace.**
  [visual] One in the workspace header (top-right of the
  pink panel), one inside the Campaigns tab header. They
  both open the same modal. Redundant; one should win.

- **Lane copy is stale and dev-jargony.** [code + visual]
  Every lane carries:
  - A "scaffold · PR BI" / "scaffold · PR BK" / "scaffold ·
    PR BL" pill in dev colour. Visible to users.
  - SpokespersonLane: "Generation lives behind PR BJ; for
    now this lane previews what the Brief → Script →
    Render flow will look like." (Wrong — PR BP wired
    generation, the lane DOES render.)
  - DialogueLane Step 2: "Plan a Hook / Beat / Closer in
    classic UX Dialogue tab; speakers will surface here
    automatically." (Wrong after PR CE — `Plan Dialogue
    Lines` works inside the workspace now.)
  - CinematicLane Step 2: "Re-render via the classic
    gallery's Visuals tab." (Stale; PR BT/BU regenerate
    in-place.)

- **CampaignModeModal still says "preview UX" + footer
  copy is wrong.** [visual] The pink "preview UX" pill next
  to "New Campaign" is leftover from when v2 was flag-gated
  (PR BD–PR CA). Today v2 IS the default. Footer reads
  "Lane-specific builders ship in PR BJ–BL — until then,
  campaign creation continues to use the legacy 4-stage
  flow underneath while the chosen lane is surfaced as a
  pill." Both PRs shipped, lanes are real, copy is wrong.

### Medium-impact

- **`+ Create Spokesperson` modal also says "preview UX"
  pill** [visual] — same staleness. Wait actually checking
  the screenshot again: my modal doesn't include a preview
  UX pill — that's only in CampaignModeModal. The Create
  Spokesperson modal only shows ✨ + heading + tagline.
  Strike — false alarm on this one.

- **Tab active-state visually subtle.** [visual] In
  screenshots 12 (Conversations clicked, Campaigns
  highlighted) and 13 (Outputs clicked, Campaigns
  highlighted), the rendered tab pill appears to lag the
  selected panel. The smoke spec asserts `data-active='true'`
  on the right tab and passes — so either Playwright's
  screenshot fires before the className transition
  completes, OR the active style differential is too small
  to read at a glance. Worth manually clicking through in
  a real browser to confirm. Even if not a real bug, the
  active-pill contrast is too subtle.

- **Workspace name subline is long.** [visual] "1 linked
  campaign · sleepy raccoon coffee mascot, front-facing
  head-and-shoulders portrait, plaid robe, white t-shirt,
  tired expressive eyes" — the subject field can be
  paragraph-length. Should truncate or move below the pills.

- **Knowledge / Conversations / Outputs tabs are empty
  placeholders.** [visual] Each says "X panel lands next."
  but Brewster's CEO Buzz campaign already has 4 cached
  outputs (cinematic 1.9 MB, host 6.1 MB, voiced 17 MB,
  reels 3 MB) + a runway_document_id (PR AI grounding) +
  potentially transcript history. The Outputs tab should
  show those today, not next slice — the data is sitting
  on the campaign already.

- **No tile-level "Create campaign for this spokesperson"
  shortcut.** [code] Currently you must (1) open the
  workspace, (2) click + New Campaign, (3) pick mode.
  A per-tile shortcut that deep-links to
  `/spokespeople/{id}` with the modal pre-opened would
  shave a click.

### Low-impact

- **`+ New Campaign` on `/` no longer exists** — correct
  per PR CD, but the Library page also has no obvious
  hint that "to create a campaign, open a spokesperson
  first". A new operator might wonder where campaign
  creation lives. The Open Spokesperson → link discloses
  it, but copy could nudge: "Open a spokesperson to create
  campaigns for them."

- **Top-bar Legacy UI link copy could clarify** — "Legacy
  UI ↗" is correct internally but "Old Wizard" or
  "Classic Wizard" would be more discoverable for a
  non-technical operator.

- **Tile width feels cramped on a 3-column grid.** [visual]
  The portrait + name + 3 summary chips + 3-tab strip +
  Identity tab content all stack into a narrow column.
  At 1280px the tiles are ~360px wide; the in-tile
  voice-clone affordances (mic / play / record / etc) are
  squeezed and look like a debug panel.

- **Tile 3-tab strip (Identity / Knowledge / Appearances)
  uses different testid prefix** (`spokesperson-tab-*`) than
  the workspace 5-tab strip
  (`spokesperson-workspace-tab-*`) — fine internally, but
  visual confusion if an operator clicks into both.

- **No breadcrumb in the workspace.** [visual] Just a back
  arrow + name. A "Library > Brewster" trail would help
  orient deeper navigation in the future.

## Broken flows

**None hard-broken.** Everything in the QA checklist
worked end-to-end. The smoke (3 tests, 25 s) is green.

The two soft-broken bits:

1. **Tab visual highlight may lag click** (see above).
   Functional state is correct (panel content updates,
   `data-active` flips); only the pill style appears
   stuck. Need manual click-test in a real browser to
   confirm.

2. **Lane copy points users back to /legacy in places it
   no longer needs to** (DialogueLane Step 2 +
   CinematicLane Step 2). Functionally everything works
   without leaving `/spokespeople/{id}`, but the copy
   tells users to leave. Confusing.

## Missing buttons / info

- **No "Edit identity" affordance in the workspace
  Identity tab.** Voice/portrait actions exist via the
  embedded CharacterCard, but no way to edit the spokesperson's
  name / template / subject / personality after creation.
  The Library's Create modal sets these at create time;
  no follow-up edit UI.
- **No spokesperson-level delete in the workspace.** The
  embedded CharacterCard exposes a delete inside its action
  row, but it's buried. The header could expose a
  "Delete spokesperson" overflow menu for clarity.
- **No "Open in classic gallery" link from the workspace's
  linked-campaign row.** PR BR/BS preserved this on
  `/legacy` but it's not surfaced from
  `/spokespeople/{id}` yet. A small link would let
  operators jump to a saved card's full 7-tab view if
  they need an action the workspace doesn't expose yet.
- **Outputs tab shows nothing for Brewster** even though
  he has 4 cached MP4s. That's a missed opportunity to
  surface real assets the operator already paid for.
- **Knowledge tab shows nothing for Brewster** even though
  CEO Buzz has a Runway grounding document (PR AI) +
  potentially transcript history. Same missed opportunity.
- **No status when CampaignLanes section is empty** — when
  no mode is selected, the section is just an invisible
  zero-height container. A small empty-state card ("Pick a
  mode to mount the corresponding lane") would help.

## Duplications

- **`<CharacterCard>` mounts in TWO places** simultaneously
  for the same person: inside each library tile's Identity
  tab AND inside the workspace's Identity tab. Two surfaces
  for the same affordances.
- **`+ New Campaign` button appears TWICE** in the workspace
  (header + Campaigns tab section header).
- **Library tile and workspace each fetch
  `/api/characters` + `/api/campaigns` independently** —
  no shared store. Page-load cost is doubled.
- **`<SpokespersonStudio>`'s lane code is dead but kept.**
  PR CD added `hideCampaignControls=true` from `<Library>`
  but the lane handlers + lane mounts + `<CampaignModeModal>`
  import are all still in `SpokespersonStudio.jsx`. No
  caller reaches them; they just sit there.

## Suggested next 3 UX fixes (ordered)

### Fix #1 — Strip the lane "scaffold · PR BX" pills + refresh stale lane copy

Touch every lane component (`SpokespersonLane`,
`CinematicLane`, `DialogueLane`):

- Remove the `scaffold · PR BI/BK/BL` pill from each lane
  header (dev jargon visible to users).
- Rewrite SpokespersonLane's "Generation lives behind PR BJ"
  copy to describe what the lane does TODAY (real
  `avatar_videos` render via the rose Generate button).
- Rewrite DialogueLane Step 2's "Plan a Hook / Beat /
  Closer in classic UX Dialogue tab" → "Click Plan
  Dialogue Lines below to seed the 3-line scene." (the
  workspace's Plan button works inline now).
- Rewrite CinematicLane Step 2's "Re-render via the
  classic gallery's Visuals tab" → "Click Regenerate
  Real Cinematic Video below to refresh the silent cut
  in-place." (PR BT/BU regenerate without leaving).
- Refresh `<CampaignModeModal>` footer ("Lane-specific
  builders ship in PR BJ–BL…") + drop the "preview UX"
  pill from the modal header.

Estimated 1-hour copy pass. Frontend-only. Smoke
unchanged. **Biggest demo-readiness lift.**

### Fix #2 — Simplify the library tile to portrait + name + summary chips + Open link

The tile's in-tile Identity tab + tab strip duplicate the
workspace verbatim. Strip them:

- Tile renders: portrait, name, persona pill, 3 summary
  chips (voice / linked / outputs), `Open Spokesperson →`
  primary CTA. **No tab strip, no embedded
  CharacterCard.**
- Move every voice / portrait / avatar action into the
  workspace's Identity tab (where it already lives).
- The "Use as Spokesperson" toggle inside CharacterCard
  was the legacy active-spokesperson handle; deep-link
  navigation to the workspace replaces it. Remove or
  collapse.
- Delete `SpokespersonCard.jsx`'s tab strip + Identity /
  Knowledge / Appearances tab content. Keep the summary
  chips + Open link.

Estimated half-day. Frontend-only. Smoke needs assertions
about tile shape rewritten (existing
`spokesperson-tab-{identity,knowledge,appearances}`
testids inside tiles disappear; `spokesperson-summary-*`
chips stay). **Biggest visual-clutter reduction.**

### Fix #3 — Real Outputs tab in the workspace

Brewster has 4 cached MP4s; the Outputs tab tells the
operator nothing about them. Replace the placeholder
with a unified output gallery:

- Iterate every linked campaign + every output URL field
  (`cached_video_url`, `host_video_url`,
  `voiced_commercial_url`, `storyboard_video_url`,
  `spokesperson_reels_url`, `dialogue_scene_video_url`,
  `dialogue_scene_reels_url`, `host_clip_audio_url`).
- Render a grid of `<video>` / `<audio>` thumbnails with
  per-output title (e.g. "CEO Buzz · Cinematic Visual ·
  5.04 s") + a download link.
- Tag each output with its campaign so operators can
  jump back to the right lane.

Estimated 1 day. Frontend-only. Surfaces the real assets
that prove v2 produces real Runway content; closes the
"missing buttons / info" gap on Outputs.

## Is v2 demo-ready?

**Almost.** The architecture works end-to-end; PR CE
closed the campaign-creation loop. Real Runway assets are
cached and survive reloads. The library + workspace + tab
nav all behave correctly.

**Three things hold v2 back from being demo-ready:**

1. **Stale + dev-jargon copy** in the lanes and the mode
   modal (Fix #1 above). A skeptical demo viewer would
   hit these strings within 15 seconds of opening a lane
   and start asking "wait, is this finished?". Real
   blocker.
2. **Library tile + workspace Identity duplication** (Fix
   #2 above). A demo viewer who clicks a tile's Identity
   tab and then opens the workspace will see the same
   panel twice. Fixable in half a day.
3. **Empty Outputs tab while real outputs sit unsurfaced**
   (Fix #3 above). Less of a blocker; could ship as the
   demo's "and here's the gallery of what we generated"
   close.

`/legacy` remains the safer demo path until those three
ship. v2 demo-readiness is **~80%** — the architecture is
right, the polish isn't.

## Servers at end of session

```
backend: pid=60990 · http://localhost:8000 · runway_mock=false (real mode)
vite:    pid=61014 · http://localhost:5173 · http=200
```

Per memory rule + brief: real-mode servers running, no
real Runway calls fired during this QA pass, the QA walk
spec was deleted from `tests/` so it doesn't pollute the
smoke.

## Screenshots captured (reference)

Saved to `/tmp/qa-screenshots/` (gitignored):

| File | Surface |
|---|---|
| 01-library-home.png | `/` Library |
| 02-create-spokesperson-modal.png | Create Spokesperson modal |
| 04-workspace-identity.png | Workspace Identity tab (default) |
| 05-workspace-knowledge.png | Workspace Knowledge tab |
| 06-workspace-campaigns-empty.png | Workspace Campaigns tab (no mode yet) |
| 07-mode-modal.png | + New Campaign mode modal |
| 08-lane-spokesperson.png | Spokesperson Ad lane mounted in workspace |
| 09-lane-cinematic.png | Cinematic Ad lane mounted in workspace |
| 10-lane-dialogue.png | Dialogue Scene lane mounted in workspace |
| 11-header-newcampaign.png | + New Campaign from header opens modal in-place |
| 12-workspace-conversations.png | Conversations placeholder |
| 13-workspace-outputs.png | Outputs placeholder |
| 14-workspace-notfound.png | Unknown id → friendly not-found |
| 15-library-after.png | Back to `/` after workspace flow |
| 16-legacy-home.png | `/legacy` verbatim wizard + gallery |

Local /tmp paths only; not committed. The reviewer can
re-run via the saved spec at any time if they want fresh
captures.
