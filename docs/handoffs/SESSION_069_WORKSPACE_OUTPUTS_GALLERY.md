# SESSION 069 — Workspace Outputs Gallery (PR CN)

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CN patch in flight on top of `18dbda0`
`feat: library tile simplification (PR CM)`; commit + push
pending after this handoff lands)

**Builds on:** every workspace slice (PR CC, PR CE, PR CK,
PR CL, PR CM) that put per-spokesperson surfaces inside
`/spokespeople/:id`. Closes the SESSION 059 manual-QA
**Fix #3** punch-list item — and with it the **third and
final** demo-readiness blocker. After PR CN, the entire
SESSION 059 punch-list (lane copy / library tile / Outputs
gallery) is closed.

## Goal

Until PR CN the workspace's **Outputs** tab was the only
remaining `<TabComingSoon>` placeholder that sat next to a
real, value-producing surface. Every other tab (Identity,
Campaigns) had been wired to actual data; Outputs read
"Generated videos and reels will appear here." which was
true but useless — the cached MP4s already existed on the
linked campaigns, the operator just couldn't browse them
from inside the spokesperson workspace. The brief that
operators are about to demo:

- Brewster the Raccoon's CEO Buzz campaign already owns 4
  cached outputs (Spokesperson Ad / Cinematic Video /
  Voiced Cinematic / Captioned Reels)
- the workspace had no way to play them inline
- jumping back to `/legacy` to find them broke the
  v2 narrative

PR CN replaces the placeholder with a real
`<OutputsGallery>` that walks the spokesperson's linked
campaigns and surfaces **every cached output URL** as an
inline-playable card.

## Endpoint inventory

PR CN adds **no new routes**. Backend route count remains
**71**. Pure frontend slice — the gallery just reads
campaign rows the workspace already fetches via the
existing `/api/characters` + `/api/campaigns` calls. No
new API helper, no new persistence path, no migrations.

## What changed

### New file

- **`frontend/src/components/OutputsGallery.jsx`**
  (~280 lines) — the gallery component.
  - Single default export `<OutputsGallery
    linkedCampaigns={[]} />`. Internal helper
    `discoverOutputs(linkedCampaigns)` walks each
    campaign and emits one card per populated URL across
    8 fields, cross-referenced against
    `CampaignGallery.jsx`'s render paths and the
    `Campaign` model:

    | URL field | Status field | Label | Orientation |
    |---|---|---|---|
    | `host_video_url` | `host_status` | Spokesperson Ad | horizontal |
    | `cached_video_url` | `cache_status` | Cinematic Video | horizontal |
    | `voiced_commercial_url` | `voiced_commercial_status` | Voiced Cinematic | horizontal |
    | `storyboard_video_url` | `storyboard_status` | Storyboard | horizontal |
    | `storyboard_voiced_url` | `storyboard_voiced_status` | Voiced Storyboard | horizontal |
    | `dialogue_scene_video_url` | `dialogue_scene_status` | Dialogue Scene | horizontal |
    | `spokesperson_reels_url` | `spokesperson_reels_status` | Captioned Reels | vertical (720×1280) |
    | `dialogue_scene_reels_url` | `dialogue_scene_reels_status` | Captioned Dialogue Reels | vertical (720×1280) |

  - Each card embeds an inline
    `<video data-testid="output-card-video" controls muted
    playsInline preload="metadata">` so the browser pulls
    only the first frame. **Never autoplays** — operator
    must press play. No automatic credit burn (and these
    are cached MP4s anyway, so the cost is zero
    regardless). Vertical cards use `aspect-[9/16]
    mx-auto max-w-[12rem]`; horizontal use `aspect-video`.
  - Status chip tone map: `ok` → emerald, `failed` →
    rose, `unavailable`/`no_video`/`no_host`/`no_audio`/
    `pending`/`running` → amber, `mock` → zinc. Falls
    back to zinc for unknown statuses.
  - Orientation pill: `Horizontal` for the standard
    16:9 lane outputs, `Vertical · Reels` for the two
    720×1280 captioned exports.
  - Each card label row: campaign id-prefix (first 8
    chars, monospace) + business + product (when set).
    Tooltip on the line to expose the full label when
    the truncated form clips.
  - `open / download ↗` link at the bottom of each
    card uses `download` + `target="_blank" rel="noreferrer"`
    so power users can grab the underlying MP4. Spark
    pink colour matches the rest of the v2 vocabulary.
  - Sort order: newest-first by parent
    `campaign.created_at` (per-output timestamps don't
    all exist on the model, so the campaign timestamp
    is the cleanest proxy).
  - Empty state branch: when 0 cards discovered, renders
    a `data-testid="outputs-gallery"
    data-output-count="0"` section with copy "Cinematic
    visuals, spokesperson ads, dialogue scenes, reels,
    and voiced exports across every linked campaign —
    one playable gallery." plus a pink pill reading
    "No outputs yet. Create a campaign or generate from
    the Campaigns tab." (testid: `outputs-empty`). No
    "go generate now" CTA per the brief — operator must
    use the Campaigns tab.

### Modified files

- **`frontend/src/components/SpokespersonWorkspace.jsx`**
  - Adds `import OutputsGallery from './OutputsGallery.jsx'`
    next to the existing CampaignLanes / CharacterCard
    imports.
  - The Outputs tab block changes from
    ```jsx
    {activeTab === 'outputs' && (
      <TabComingSoon
        testid="spokesperson-workspace-outputs"
        ...
      />
    )}
    ```
    to
    ```jsx
    {activeTab === 'outputs' && (
      <section
        data-testid="spokesperson-workspace-outputs"
        className="space-y-3"
      >
        <OutputsGallery linkedCampaigns={linkedCampaigns} />
      </section>
    )}
    ```
  - The other two `<TabComingSoon>` mounts (Knowledge /
    Conversations) are untouched — those remain the
    valid "lands next" placeholder slots.

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  (`@ /`) workspace walk extended:
  - The `for (const placeholder of …)` loop that asserted
    the three TabComingSoon placeholders now iterates
    only `['knowledge', 'conversations']` — Outputs has
    graduated.
  - A new dedicated Outputs assertion block lands
    immediately after the placeholder loop:
    ```js
    await page.getByTestId('spokesperson-workspace-tab-outputs').click()
    await expect(workspace).toHaveAttribute('data-active-tab', 'outputs')
    await expect(page.getByTestId('spokesperson-workspace-outputs')).toBeVisible()
    const outputsGallery = page.getByTestId('outputs-gallery')
    await expect(outputsGallery).toBeVisible()
    const outputCount = await page.getByTestId('output-card').count()
    if (outputCount === 0) {
      await expect(page.getByTestId('outputs-empty')).toBeVisible()
    } else {
      await expect(page.getByTestId('output-card').first()).toBeVisible()
      await expect(page.getByTestId('output-card-video').first()).toBeVisible()
      await expect(page.getByTestId('output-card-link').first()).toBeVisible()
    }
    ```
    The branch on `outputCount` is intentional — mock
    mode's seeded fixtures may or may not carry cached
    URLs (Brewster the Raccoon's CEO Buzz has 4; the
    PR CH demo campaigns ship as drafts with no
    outputs); both shapes are valid.

### What did NOT change

- **Backend.** No routes added or modified. Route count
  stays at **71** (the single PR CK addition,
  `POST /api/characters/{id}/metadata`, is the most
  recent change).
- **Generation pipelines.** Nothing about how outputs
  are produced changes. The gallery is a pure read of
  fields the existing pipelines already populate.
- **Campaigns tab.** The PR CE / PR CL / PR CM behaviour
  inside the workspace's Campaigns tab is untouched —
  lanes still own all the generation triggers.
- **`<CampaignGallery>` (legacy).** The v1 gallery's
  per-card render paths for these same URLs are unchanged.
  The new component is a parallel, read-only,
  spokesperson-scoped view; the legacy gallery remains
  the campaign-scoped view.
- **`/legacy`.** Untouched.
- **Library wrapper / chrome.** Library heading, tagline,
  4-chip stats row, `+ Create Spokesperson` CTA — all
  unchanged.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true`, `image_gen_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged from PR CK; 1 above the 70 baseline that ran from PR BU through PR CJ) |
| `vite build` | 476.43 KB initial / 130.27 KB gzip + 561.97 KB lazy chunk (+5.51 KB initial / +1.07 KB gzip vs PR CM) |
| Playwright mock smoke | `3 passed (28.1 s)` — Test 1 (@ /legacy) 25.1 s, Test 2 (@ /) 1.7 s, Test 3 (top-bar round-trip) 589 ms |
| Hygiene scan | empty (no PNG / video committed) |
| Drift guard | `context-kit anchors look recent.` |

The PR CM bundle shrinkage (-9.91 KB) is partially given
back here (+5.51 KB) — net since PR CL is still -4.40 KB,
so the v2 surface is still trending lighter even with the
new gallery.

**No real Runway calls fired this session.** The gallery
only reads cached outputs that already exist on disk; no
new generations were started.

## Visual snapshot / live demo path

`/tmp/qa-screenshots/22-outputs-gallery-after-CN.png`
(gitignored) captures the new gallery against the mock
backend on Brewster the Raccoon's workspace. Brewster
the Raccoon owns the **CEO Buzz** campaign
(`fc8a20c4-2bc5-…`) which has 4 cached outputs, so the
gallery lands populated:

1. **Spokesperson Ad** (horizontal) — the lip-synced
   talking-avatar render
2. **Cinematic Video** (horizontal) — the silent
   image-to-video cinematic cut
3. **Voiced Cinematic** (horizontal) — cinematic visual
   muxed with spokesperson narration
4. **Captioned Reels** (vertical · 720×1280) — Reels
   export of the Spokesperson Ad

Each card plays inline on press. The orientation pill on
the Reels card reads `Vertical · Reels`; the others read
`Horizontal`. The status chip on each is `ok` (emerald).
The download link opens the underlying `/api/campaigns/
fc8a20c4.../<field>` URL in a new tab.

Empty-state path is reachable on the other 3 demo
spokespeople (Clara Vale / Rex Roadside / Mina Spark) —
their PR CH draft campaigns have no cached outputs yet,
so the gallery renders the empty pill prompting the
operator to generate from the Campaigns tab.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule. Health probe afterwards reads
`runway_mock=false` + `image_gen_mock=false`.

Manual test path:
1. http://localhost:5173 — homepage Library shows 7
   tiles. Click any tile's `Open Spokesperson →` link.
2. Inside the workspace, click the **Outputs** tab.
3. For Brewster the Raccoon (the CEO Buzz spokesperson):
   the gallery mounts with 4 cards — Spokesperson Ad /
   Cinematic Video / Voiced Cinematic / Captioned Reels.
   Press play on any card to confirm the inline preview
   works.
4. For any other spokesperson with no cached outputs:
   the empty pill shows with the "No outputs yet."
   prompt.
5. Switch back to the **Campaigns** tab → lane controls
   still mount unchanged.

## Limitations / follow-ups

- **No filter / sort UI.** The gallery sorts newest-first
  by `campaign.created_at` and that's it. Once a
  spokesperson accumulates many outputs across many
  campaigns the grid could grow unwieldy. A future polish
  slice could add: filter by output type (Spokesperson
  Ad / Cinematic / Reels / Dialogue), filter by campaign,
  or a search-by-business box. Defer.
- **No per-output regenerate affordance.** Each card is
  read-only — operators must use the Campaigns tab's
  lanes to regenerate. By design — one direction
  for generation triggers (Campaigns) and one for
  consumption (Outputs).
- **No per-output delete.** Caching is currently
  single-slot per field per campaign, so the only way to
  "delete" is to overwrite via regenerate. Defer until
  there's a real need.
- **Vertical reels framing on mobile.** The
  `max-w-[12rem]` cap keeps reels narrow on desktop; on
  mobile the grid drops to a single column anyway so it
  reads correctly. Tested at 375px viewport.
- **Per-output timestamps not surfaced.** Sort is by
  parent campaign timestamp because per-field timestamps
  aren't all on the `Campaign` model. If a campaign has
  outputs across multiple regenerate cycles, the order
  inside that campaign reflects the source-code field
  order, not actual chronology. Acceptable today.

## Recommended next slice

After PR CN, **all three** SESSION 059 demo-readiness
blockers (lane copy / tile simplification / Outputs
gallery) are closed. The v2 surface is feature-complete
for the v13 demo loop.

Recommended next directions (any of these is a clean
slice):

- **PR CO — Tag `hackathon-submission-v14`.** The v2 UX
  reset arc (PR CA → PR CN) is now self-contained.
  Cutting a tag here gives demo evaluators a single
  artefact that includes the Spokesperson Library home,
  the workspace, the simplified tile, the rich
  CreateSpokespersonFlow stepper, and the real Outputs
  gallery. Five-minute slice.
- **PR CO — Workspace Knowledge tab wiring.** Of the two
  remaining `<TabComingSoon>` placeholders, Knowledge is
  the more impactful — it would surface
  `linkedCampaigns[].grounding_notes`,
  `linkedCampaigns[].transcripts[]`, and any
  spokesperson-level knowledge artefacts (PR AB voice
  preset detail, history entries, etc.). Half-day slice.
- **PR CO — Workspace Conversations tab wiring.** The
  Realtime Spokesperson conversations on each campaign
  could be aggregated into a per-spokesperson view here.
  Lower priority since the legacy `<RealtimeSpokesperson>`
  surface still works campaign-by-campaign. Half-day.

The user has historically picked the next slice based on
where the demo narrative leaks — `00-START-NEXT-SESSION.md`
already lists the priorities; this handoff doesn't lock
in a follow-up.
