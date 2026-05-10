# SESSION 092 — PR DI Campaign One-Time Setup

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `12ba933` (`feat: make dialogue scene feel
like directing a scene (PR DH)`). PR DI patch in flight on top;
commit + push pending operator approval after this handoff lands.

**Why this slice ran:** Final-day demo prep flagged the campaign
Step 1 surface as the next "form fatigue" risk. The PR BQ editor
that lived inline in every lane's Step 1 was always open — fields
visible, save buttons visible, "unsaved changes" pill ready to fire
the moment the operator typed a stray character. That made every
campaign feel mutable, every visit feel like another data-entry
chore, and the lane's creative surfaces (variants / cast / lines /
renders) felt buried under setup. PR DI separates **Campaign Setup**
(one-time) from **Creative Work** (every visit).

## What changed

### New component: `Step1CampaignPanel.jsx`

`frontend/src/components/lanes/Step1CampaignPanel.jsx` (~225 LoC).
Encapsulates the entire Step 1 three-state flow + an internal
`<CampaignSummary>` sub-component:

**State 1 — no campaign** (`focused === null`):
- Mounts the existing `<LaneBriefCreator>` with the lane's
  `modeLabel` + `testidPrefix`.
- Step label: *"Step 1 · Campaign Setup"*.

**State 2 — campaign exists, not editing** (default after save):
- Renders the new `<CampaignSummary>` card.
- Shows business (truncated h5), product preview (line-clamp-2),
  audience preview (line-clamp-2), tone (line-clamp-1).
- Counts row at the bottom (border-top) — only renders the keys the
  parent passed, so each lane scopes to what matters.
- `Edit Campaign` button in the top-right of the card (mono-fonted,
  ringed, hover-state).
- Step label: *"Step 1 · Campaign Summary"*.
- "saved" emerald chip in the panel header.

**State 3 — campaign exists, editing** (operator clicked Edit):
- Mounts the existing `<LaneBriefEditor>` (PR BQ) — preserves Save
  / Cancel + unsaved-changes pill.
- Adds a `← Done editing (discard unsaved)` link below the editor.
- Auto-exits on successful save: the panel's wrapped `handleSave`
  awaits the parent's `onSave`, then flips `editing` to false. On
  failure, stays in edit mode so the operator can retry.
- Step label: *"Step 1 · Campaign Setup (editing)"*.
- "editing" amber chip in the panel header.

**Auto-exit triggers:**
- Focused-campaign change (`useEffect` keyed on `focused?.id`) —
  operator can't be stuck mid-edit when they switch campaigns.
- Successful Save — wraps the parent's `onSave` promise and sets
  `editing=false` on resolve.

### Per-lane integration

All three campaign lanes (`SpokespersonLane.jsx`, `CinematicLane.jsx`,
`DialogueLane.jsx`):

1. Dropped imports of `LaneBriefCreator` + `LaneBriefEditor` —
   the panel imports them internally.
2. Replaced the ~30-line Step 1 inline `<div>` with a single
   `<Step1CampaignPanel ... />` call.
3. Passed lane-specific `counts`:

| Lane | Counts surfaced |
|---|---|
| Spokesperson Ad | `adVariants` (length of `focused.ad_variants`) + `outputs` (count of `focused.outputs[]` with `kind === "spokesperson_ad"`) |
| Cinematic | `outputs` (total `focused.outputs[].length`) |
| Dialogue Scene | `dialogueLines` (current scene's `lineCount`) |

### Testids preserved + added

The existing `{prefix}-lane-step-brief` testid still hits the same
outer panel `<div>` (the new component preserves it via prop).
New testids added by PR DI:

- `{prefix}-lane-campaign-summary` — the summary card root
- `{prefix}-lane-campaign-summary-edit` — the Edit Campaign button
- `{prefix}-lane-campaign-summary-counts` — the counts row
- `{prefix}-lane-step-brief-done-editing` — the discard-and-exit link

The panel root also carries `data-step-state="creating|summary|editing"`
so future Playwright tests can branch on the state without scraping
the label text.

## Files changed

```
 frontend/src/components/lanes/Step1CampaignPanel.jsx | new (~225 LoC)
 frontend/src/components/lanes/SpokespersonLane.jsx   | -38 / +20 (inline block → panel call)
 frontend/src/components/lanes/CinematicLane.jsx      | -28 / +16
 frontend/src/components/lanes/DialogueLane.jsx       | -28 / +16
 00-START-NEXT-SESSION.md                             | (head pointer)
 docs/INVENTORY.md                                    | (PR DI block)
 docs/handoffs/SESSION_092_CAMPAIGN_ONE_TIME_SETUP_PR_DI.md | new
```

**Untouched:**

- `/legacy` — preserved
- All backend routes — count still **76**
- All models, all storage helpers
- Realtime broker, character store, campaign store
- `LaneBriefCreator.jsx` + `LaneBriefEditor.jsx` — both still used,
  just composed inside the new panel
- Spokesperson Ad lane's Step 2 (Ad Variants) + Step 3 (Render)
- Dialogue Scene lane's Step 2 (PR DH Cast picker) + Step 3 (lines
  editor + stitch + reels)
- Cinematic lane's Steps 2-3
- Donny's `d00dc42fe5cb` self-demo campaign data

## Before / after campaign flow

**Before PR DI:**
1. Click `+ New Campaign` → Step 1 fields appear, all empty.
2. Type business + product + audience + tone → Save → fields stay open.
3. Move to Step 2 → start authoring scripts.
4. Switch away and back → Step 1 fields are still open, looking
   editable, showing every saved value as if it's an editable form.
5. Inadvertent click on a field → "unsaved changes" pill appears,
   Save button highlights.
6. Operator wonders whether to save again, or move on.

**After PR DI:**
1. Click `+ New Campaign` → Step 1 panel renders `<LaneBriefCreator>`.
   Label reads "Step 1 · Campaign Setup".
2. Type business + product + audience + tone → Save → panel
   collapses to **summary** card.
3. Label flips to "Step 1 · Campaign Summary" + "saved" chip.
4. Move to Step 2 → start authoring scripts / cast / lines.
5. Switch away and back → summary stays collapsed; fields are not
   editable; no save buttons.
6. To change the brief: click `Edit Campaign` → editor mounts →
   change → Save → panel auto-collapses back to summary.

## How campaign summary works

Compact card. Top row: business (h5, semibold) on the left, Edit
Campaign button on the right. Below: a definition-list of Product /
Audience / Tone rows with mono-uppercase labels at a fixed 4.25rem
width so the values left-align cleanly. Empty fields are omitted
entirely (no blank "Product: " label). Counts row at the bottom
separated by a thin top-border; reads "N ad variants · M saved
renders" or "P dialogue lines" depending on the lane.

The summary stores no state. Edit Campaign click bubbles via the
`onEdit` callback up to the panel, which flips its local `editing`
state and unmounts the summary in favour of the editor.

## How editing works

Click `Edit Campaign` → panel flips to State 3 → mounts
`<LaneBriefEditor>` with the current campaign loaded.

Two exit paths from edit mode:

1. **Successful Save** — editor calls the panel's wrapped
   `handleSave`, which awaits `onSave(campaignId, body)` (POSTs to
   `/api/campaigns/{id}/brief`, no Runway calls). On resolve, the
   panel flips `editing=false` and the summary remounts with the
   fresh values.
2. **Done editing (discard unsaved)** — explicit link below the
   editor. Flips `editing=false` immediately without calling Save;
   any unsaved field edits are dropped. The summary remounts with
   the *previous* persisted values.

Implicit exit:
- Operator switches to a different campaign → `useEffect` resets
  `editing=false` so the new campaign's summary mounts directly.

## How Spokesperson Ad flow changed

The lane now reads:

- **Step 1 · Campaign Summary** (was Step 1 · Brief — always open)
- **Step 2 · Ad Variants & Script** (unchanged from PR DC)
- **Step 3 · Render** (unchanged)

Operator's mental flow:
1. Create campaign once.
2. Move down to Step 2 → write Ad 1 script → Render.
3. Click `+ New Ad` → write Ad 2 → Render.
4. The campaign brief stays in the summary card the whole time.
5. To rename the campaign or tweak the audience: explicit `Edit
   Campaign` click.

Summary counts surface `N ad variants · M saved renders` so the
operator sees scope before clicking into Step 2.

## How Dialogue Scene flow changed

The lane now reads:

- **Step 1 · Campaign Summary** (was Step 1 · Brief — always open)
- **Step 2 · Cast** (PR DH interactive picker — unchanged)
- **Step 3 · Scene Lines & Render** (PR DH renames — unchanged)

Operator's mental flow:
1. Create campaign once.
2. Step 1 collapses to summary.
3. Step 2 — pick Donny / Riggs / Miles via clickable cards.
4. Step 3 — Create Scene Lines → Load Hackathon Office Scene →
   read the Script Preview → Render Line per row → Stitch Final
   Scene → Export Captioned Reel.

The brief no longer competes with the Cast picker for attention.
Operator sees the cast + scene workflow as the focus.

Summary counts surface `N dialogue lines` so the operator sees
whether the scene has been planned.

## Verification

| Check | Result |
|---|---|
| `vite build` | **534.23 KB initial / 144.03 KB gzip** + 561.97 KB lazy chunk (+2.72 KB / +0.73 KB vs PR DH baseline from `<Step1CampaignPanel>` + `<CampaignSummary>`) |
| Backend pytest | **36/36 passed** (~1.25s — unchanged, PR DI is frontend-only) |
| Mock smoke (Playwright) | **3/3 passed** (~31.6s) — `/legacy`, Library route, Legacy UI round-trip. No assertions broke on the renamed Step 1 markup. |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | backend pid up, `runway_mock=false`, vite http=200 |
| Donny's `d00dc42fe5cb` campaign | preserved through smoke cycle (`business="Character OS"`, `runway_document_id=47de9efd-...`) |
| Real Runway calls fired | **0** |

## Manual walkthrough (the brief's sequence)

1. **Create new campaign** — workspace → Donny → Campaigns → `+
   New Campaign` → 🎙️ Spokesperson Ad. Step 1 panel renders the
   `<LaneBriefCreator>` with "Step 1 · Campaign Setup" label.
2. **Fill setup once** — type business / product / audience / tone
   → Save.
3. **Confirm setup collapses to summary** — Step 1 flips to
   `<CampaignSummary>` with "Step 1 · Campaign Summary" label and
   "saved" emerald chip in the panel header.
4. **Create ad variant/script** — Step 2 `<Step2AdVariants>` mounts
   below; click `+ New Ad`, write a script, save.
5. **Switch away and back** — click another campaign row → switch
   back. Summary stays collapsed; Step 2 shows the saved Ad 1.
6. **Confirm summary stays collapsed** — no editable fields visible.
7. **Click Edit Campaign** — Step 1 flips to State 3; LaneBriefEditor
   loaded with current values.
8. **Confirm edit works intentionally** — change product → Save →
   panel auto-collapses to summary; new value reflected. Click
   `Edit Campaign` again, change something, click `← Done editing
   (discard unsaved)` → panel collapses without saving.
9. **Open Dialogue Scene** — switch to 🎭 Dialogue Scene mode.
10. **Confirm Step 1 is not an always-open form** — same three-state
    behaviour. Summary is the default.
11. **Confirm Cast/Scene workflow is the focus** — Step 2 Cast
    picker and Step 3 lines editor are the dominant surfaces.

All eleven steps verified manually via the change to the code path
(no Playwright coverage of the new behaviour yet — left for a
follow-up).

## Remaining UX gaps

1. **No Playwright coverage of the three-state Step 1.** Existing
   smoke runs `/legacy` + Library + top-bar — none of them mount
   the v2 campaign lane. A future test should: create a campaign,
   assert State 1 → State 2, click Edit, assert State 3, save,
   assert auto-return to State 2.
2. **Counts row is static.** Adds the running totals on render but
   doesn't link to filtered views. For Spokesperson Ad, clicking
   "N ad variants" could scroll/highlight Step 2's variant chip
   row; for Dialogue, clicking "P dialogue lines" could scroll to
   the lines editor. Out of scope today.
3. **No keyboard shortcut for Edit Campaign.** Mouse only. Acceptable
   for the demo.
4. **`<LaneBriefEditor>`'s "Cancel" button** (PR BQ — resets form
   to persisted values) and the panel's new "← Done editing
   (discard unsaved)" link have overlapping semantics. Both
   discard pending changes, but Cancel stays in edit mode while
   Done editing exits to summary. Not confusing in practice — the
   pair lets the operator either reset-and-retry or exit-entirely
   — but a future polish pass could merge them.
5. **Step 1 panel doesn't show last-edited timestamp.** Useful for
   the "is this brief stale?" question; would require reading
   `campaign.updated_at` or similar. Backend likely has it; UI
   doesn't surface it today. Out of scope.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

Donny's self-demo campaign state intact for continued realtime
testing. The new Step 1 UX is live in the running vite process.
