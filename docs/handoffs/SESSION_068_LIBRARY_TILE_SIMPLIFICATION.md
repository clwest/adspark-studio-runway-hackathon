# SESSION 068 — Library Tile Simplification (PR CM)

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CM patch in flight on top of `c016de7`
`feat: workspace consumes start campaign hint (PR CL)`;
commit + push pending after this handoff lands)

**Builds on:** every workspace slice (PR CC, PR CE, PR CK,
PR CL) that put the per-spokesperson controls inside
`/spokespeople/:id`. Closes the SESSION 059 manual-QA
**Fix #2** punch-list item — the most-flagged duplication
between the library tile and the workspace.

## Goal

Before PR CM the homepage tile was a mini-app. Each tile
mounted the full `<CharacterCard>` inside an Identity
sub-tab, plus Knowledge + Appearances sub-tabs that
duplicated workspace functionality. Operators saw
identical voice / portrait / avatar controls in two
places (library tile AND workspace Identity tab) for the
same spokesperson. The QA pass flagged this as the
loudest "this still feels half-finished" signal.

PR CM strips the tile down to its proper job:
**browse → identify → open**.

## Endpoint inventory

PR CM adds **no new routes**. Backend route count remains
**71**. Pure frontend simplification.

## What changed

### Modified files

- **`frontend/src/components/SpokespersonCard.jsx`** —
  rewritten 691 → ~220 lines.
  - Render output is now a single card with: portrait
    image OR a "Portrait pending" placeholder (with
    "Open workspace to generate." sub-copy), the name as
    `<h3>`, the archetype as a pink pill, the role
    one-liner from `character.subject`, the PR CB summary
    chip strip (voice + linked + outputs + transcripts;
    outputs and transcripts only render when > 0), and a
    primary `Open Spokesperson →` link routing to
    `/spokespeople/:id`.
  - **Removed from this file** (now lives in the workspace
    at `/spokespeople/:id`):
    - the Identity / Knowledge / Appearances tab strip
    - the embedded `<CharacterCard>` import + JSX
    - voice clone / apply / refresh / repair surfaces
    - portrait generation buttons
    - per-campaign mode pills + gallery click-through
      (PR BR/BS surface)
    - the "Use as Spokesperson" toggle
    - `summariseKnowledge` per-tile linked/transcript
      summary (replaced by a smaller `summariseCounts`
      that mirrors the chip-strip math only)
    - every prop that the embedded CharacterCard needed:
      `busyAction`, `onSetActive`, `onGeneratePortrait`,
      `onCreateAvatar`, `onDelete`, `onCloneVoice`,
      `onApplyVoiceToAvatar`, `onRefreshAvatarVoice`,
      `onRefreshVoicePreview`, `onOpenCampaign`
  - Props that **stay**: `character`, `linkedCampaigns`,
    `isActive`. Extras passed by older callers are
    silently dropped (React warns but won't break).
  - New testids: `spokesperson-tile-portrait`,
    `spokesperson-tile-portrait-placeholder`,
    `spokesperson-tile-name`, `spokesperson-tile-persona`,
    `spokesperson-tile-subject`,
    `spokesperson-summary-transcripts`. Existing testids
    preserved: `spokesperson-card`, `data-spokesperson-id`,
    `spokesperson-card-summary`,
    `spokesperson-summary-voice`,
    `spokesperson-summary-linked`,
    `spokesperson-summary-outputs`,
    `spokesperson-summary-open`.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  `<SpokespersonCard>` mount drops every now-unused
  callback prop (9 in total). The handlers themselves
  (`handleGeneratePortrait`, etc.) stay in
  `<SpokespersonStudio>` because the workspace flow's
  `onCharactersChanged` propagation paths use them and
  the file is still the canonical mount of the
  `<CampaignLanes>` + mode modal stack on the legacy v2
  surface. Removing the unused handlers entirely is a
  separate cleanup that can wait. The mount now reads:
  ```jsx
  <SpokespersonCard
    key={c.id}
    character={c}
    isActive={c.id === activeCharacterId}
    linkedCampaigns={campaignsByCharacter[c.id] || []}
  />
  ```

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  (`@ /`) tile-iteration block rewritten:
  - Asserts portrait XOR placeholder (exactly one).
  - Asserts `spokesperson-tile-name`,
    `spokesperson-tile-persona`,
    `spokesperson-card-summary`,
    `spokesperson-summary-voice`,
    `spokesperson-summary-linked` all visible.
  - Asserts the primary `Open Spokesperson →` link is
    visible with the correct copy.
  - Asserts the in-tile tab testids
    (`spokesperson-tab-{identity,knowledge,appearances}`,
    `spokesperson-{identity,knowledge,appearances}-tab`)
    all `toHaveCount(0)`.
  - The PR BF Knowledge-summary block, PR BG
    Appearances-row block, and PR BR/BS Open-in-gallery
    click-through assertions are deleted. Those
    surfaces no longer exist on `/`. The PR CC
    workspace navigation block + PR CL hint
    round-trip block are unchanged.

### What did NOT change

- **Backend.** No routes touched. `/api/characters` +
  `/api/characters/{id}/portrait` still serve the same
  shape; the tile reads them unchanged.
- **Workspace at `/spokespeople/:id`.** Every tab still
  renders. Identity tab still embeds the full
  `<CharacterCard>` with portrait / voice clone / avatar
  apply / drift / repair — all the surfaces removed from
  the tile. Operators who need any of those click
  `Open Spokesperson →` and arrive at the workspace.
- **Library wrapper / chrome.** Library heading, tagline,
  4-chip stats row, `+ Create Spokesperson` CTA,
  workspace Campaigns tab, etc. — all unchanged.
- **CharacterCard itself.** The component file stays
  (used by both `<SpokespersonWorkspace>`'s Identity tab
  and the legacy `/legacy` CharacterStudio).
- **`/legacy`.** Untouched.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| `vite build` | 470.92 KB initial / 129.20 KB gzip + 561.97 KB lazy chunk (-9.91 KB initial / -2.32 KB gzip vs PR CL) |
| Playwright mock smoke | `3 passed (27.6 s)` — Test 1 (@ /legacy) 24.6 s, Test 2 (@ /) 1.8 s, Test 3 (top-bar round-trip) 623 ms |
| Hygiene scan | empty (no PNG / video committed) |
| Drift guard | `context-kit anchors look recent.` |

The bundle delta is the first meaningful **shrinkage** of
the v2 surface since PR CA — proof that the simplification
isn't a wash.

**No real Runway calls fired this session.**

## Visual snapshot

`/tmp/qa-screenshots/21-library-after-CM.png` (gitignored)
captures the new tile shape against the mock backend. The
mock-mode `data/` only carries one character today
(Brewster Bolt, no portrait), so the snapshot lands on the
"Portrait pending" placeholder path — exactly the right
visual to ship for unrendered demo cards. The chip strip
shows `voice · felix · 0 campaigns`; the Open Spokesperson
button reads correctly. Real-mode `/` displays all 7 demo
spokespeople with their generated portraits per PR CG/CI.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — homepage Library shows 7 tiles
   (3 demo with PR CI portraits, 1 still-blank Rex
   Roadside, 3 pre-existing user spokespeople with their
   portraits). Each tile is a single card with name +
   persona + role + chips + Open link. **No tab strip.
   No voice mic. No nested controls.**
2. Click any tile's `Open Spokesperson →` link →
   `/spokespeople/{id}` workspace mounts with the full
   Identity tab unchanged.
3. Inside the workspace, every voice / portrait / avatar
   control still works exactly as before. The tile's
   simplification didn't remove anything — just relocated.
4. `/legacy` still works.

## Limitations / follow-ups

- **9 unused handlers still in `<SpokespersonStudio>`.** The
  `handleGeneratePortrait` / `handleCreateAvatar` / etc.
  functions are kept because the legacy v2 surface
  (`hideCampaignControls=false`) and `onCharactersChanged`
  propagation paths reference them. A future cleanup
  (PR CN candidate) could delete them once we confirm
  the workspace flow is the only consumer. ~30 min, no
  visible change.
- **`Portrait pending` placeholder is read-only.** No
  inline "Generate now" button. Operators must open the
  workspace to render. By design — the brief explicitly
  said "Do not trigger generation from homepage." If the
  copy "Open workspace to generate." starts feeling
  buried, a future polish slice could surface a "→
  generate now" mini-link that deep-links to
  `/spokespeople/{id}` with a hint to auto-fire portrait
  on mount (mirroring PR CL's `startCampaignHint`
  pattern).
- **Tile width is unchanged.** The simpler card uses the
  same grid (`sm:grid-cols-2 md:grid-cols-3`) so 1280px
  viewports still see 3 columns. Could let cards breathe
  at 2 columns for a more curated feel; out of scope.
- **No tile-level activity timestamp.** The brief
  mentioned "transcript count if available" — captured.
  Latest-activity timestamp not surfaced (would need a
  `formatHistoryTimestamp` import + a small chip).
  Defer.

## Recommended next slice

**PR CN — Real Outputs tab gallery** (SESSION 059 Fix #3,
the last remaining demo-readiness blocker). Replace the
workspace's Outputs `<TabComingSoon>` placeholder with a
unified gallery surfacing every cached output URL across
the spokesperson's linked campaigns
(`cached_video_url` / `host_video_url` /
`voiced_commercial_url` / `storyboard_video_url` /
`spokesperson_reels_url` / `dialogue_scene_video_url` /
`dialogue_scene_reels_url`). Brewster the Raccoon already
has 4 cached MP4s; the new demo personas' outputs fill
in naturally as operators run Generate inside the
workspace lanes. ~1 day, frontend-only.

After PR CN ships, all three SESSION 059 demo-readiness
blockers (lane copy, tile simplification, Outputs
gallery) are closed.
