# SESSION 083 — PR DA Multi-Ad / Reviewable Spokesperson Campaigns

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR DA patch in flight on top of
`2630532` `fix: preserve spokesperson output history
(PR CY)`; commit + push pending after this handoff
lands)

**Why this slice ran:** The Spokesperson Ad lane felt
single-mutable: clicking `+ New Campaign` left the prior
campaign's brief / script bleeding through, the lane
silently targeted "most recent" with no operator
selection, and there was no way to review older
campaigns. PR DA gives the operator a reviewable,
multi-ad surface that defaults to clarity over cleverness.

## Exact root cause of stale form values

`SpokespersonLane.jsx` line 61 (pre-PR DA):

```js
const sorted = [...campaigns].sort((a, b) => /* by created_at desc */)
const focused = sorted[0] || null
```

The lane *always* used the most-recent campaign as its
`focused` record. Two consequences:

1. **No operator selection.** Even if the operator
   wanted to review or edit campaign A while campaign B
   was newer, the lane silently rendered B's
   `<LaneBriefEditor>` instead.
2. **`+ New Campaign` didn't reset.** The button opened
   the mode-picker modal, but on close the lane still
   computed `focused = sorted[0]` against the same
   campaign list — so `<LaneBriefEditor>` re-mounted
   against the most-recent existing campaign, and
   `<LaneBriefCreator>` (the empty form) was never
   shown.

The brief / script the operator saw on click looked
"stale" because they were really still looking at the
*previous* campaign's brief — the new-campaign empty
form simply never appeared.

## What changed

### State lifted to the workspace

`SpokespersonWorkspace.jsx` now owns two new pieces of
campaign-selection state:

```js
const [selectedCampaignId, setSelectedCampaignId] = useState(null)
const [creatingNewCampaign, setCreatingNewCampaign] = useState(false)
```

State machine:

| Trigger | `selectedCampaignId` | `creatingNewCampaign` |
|---|---|---|
| Initial mount, no campaigns | `null` | `false` |
| Initial mount, ≥1 campaign | newest's id (auto) | `false` |
| Click `+ New Campaign` | `null` | `true` |
| Click campaign row | row's id | `false` |
| `<LaneBriefCreator>` save success | new id | `false` |
| Click "cancel new campaign" | (auto-recovers to newest) | `false` |
| Selected campaign deleted/detached | (auto-recovers to newest) | (unchanged) |

A small `useEffect` keeps the selection sane: if the
operator hasn't explicitly entered creating-new mode,
and either nothing is selected or the previous
selection no longer exists, the workspace falls back
to the newest linked campaign.

### Workspace campaigns list — now clickable + active

The list above the lane:

- Each row is a `role="button"` with `onClick`
  `handleSelectCampaign(c.id)` + keyboard `Enter` /
  `Space` handlers.
- Active row gets a pink ring + bg
  (`ring-pink-400/50 bg-pink-500/10`) and a
  `aria-pressed="true"` flag.
- New `data-active="true"|"false"` attribute on each
  `<li>` for testability.
- New `N× saved` chip when the campaign has at least
  one `spokesperson_ad` output in `outputs[]` — gives
  the operator at-a-glance render history without
  opening the Outputs tab.
- New `rendered` / `draft` pill is now emerald (when
  rendered) instead of always-zinc.
- New trailing `active` pill (when selected) or
  `edit →` affordance (when not selected) so the
  click-to-select interaction is discoverable.
- Header copy refreshed:
  - **before:** "Each lane below targets the most-recent
    campaign."
  - **after:** "Pick a campaign below, or create a new
    one. The lane edits the selected campaign."

### Lane reads selection, not "newest"

`SpokespersonLane.jsx`:

- New props: `focusedCampaign`, `creatingNew`,
  `onCancelCreate`.
- `focused` is now the prop value (passed in by
  `CampaignLanes`), not the internal sorted-newest
  derivation.
- `hasCampaign = Boolean(focused)` — when `creatingNew`
  is true, `focused` is null, so `hasCampaign` is
  false → existing Step 1 logic mounts
  `<LaneBriefCreator>` with blank fields. No more
  bleed-through.

`CampaignLanes.jsx`:

- New props: `selectedCampaignId`, `creatingNewCampaign`,
  `onSelectCampaign`, `onCancelCreateCampaign`.
- New derivation: `focusedCampaign = !creatingNewCampaign
  && selectedCampaignId ? linkedCampaigns.find(...) :
  null`.
- Passes `focusedCampaign` + `creatingNew` +
  `onCancelCreate` through to `SpokespersonLane`.
- `handleCreateCampaign` now calls
  `onSelectCampaign(new.id)` after a successful save,
  so the lane immediately re-mounts in editor mode
  against the freshly-created record.

### Active-state banner

A new banner sits between the lane header and the
3-step grid. Three states:

- **Creating new** (pink): `✏️ New campaign — fill the
  brief below to start. Previous campaigns stay in
  the list above.` + a `cancel new campaign` link.
- **Editing existing** (emerald): `Editing: <business
  name> · <product> <id-prefix>` so the operator
  always knows which campaign their edits will land on.
- **Idle / no selection** (zinc): `No campaign
  selected. Pick one from the list above or click +
  New Campaign.`

testid: `spokesperson-lane-active-state` with
`data-mode="new"|"editing"|"idle"`.

### Per-campaign render history

Step 3 now mounts a `<details>` block scoped to the
**selected campaign** when it has at least one
`spokesperson_ad` entry in `outputs[]`:

```
▸ N saved render(s) for this campaign
   ┌────────────────────────────────────────────────┐
   │ "first 60 chars of the script…"     open ↗   │
   │ "different take's script…"           open ↗   │
   │ + 2 more — see Outputs tab for full history    │
   └────────────────────────────────────────────────┘
```

testid: `spokesperson-lane-saved-renders` with
`data-output-count={n}`. Each row is a
`spokesperson-lane-saved-render-row` with
`data-output-id`.

This is **distinct** from the workspace Outputs tab
gallery (which shows every campaign's renders across
the whole spokesperson). The lane disclosure is the
"this-campaign" view.

## How older campaigns are reviewed

1. Operator opens the spokesperson workspace → Campaigns
   tab.
2. Linked campaigns list shows every campaign with its
   business/product label, render-status pill, saved-
   renders count, and an `edit →` affordance per row.
3. Click any row → `selectedCampaignId` updates,
   `creatingNewCampaign` clears, lane re-mounts:
   - Step 1 mounts `<LaneBriefEditor>` for THAT
     campaign (its business / product / audience /
     tone).
   - Step 2 mounts `<Step2Script>` reading THAT
     campaign's `commercial_script`.
   - Step 3 mounts the saved-renders disclosure for
     THAT campaign's `outputs[]`.
4. The active-state banner reads `Editing: <business>`
   so the operator can verify which campaign they're
   editing before clicking Save.

## How new campaigns reset cleanly

1. Operator clicks `+ New Campaign` (header button or
   in-lane link).
2. Workspace flips `creatingNewCampaign = true`,
   `selectedCampaignId = null`. Mode-picker modal
   opens.
3. Operator selects "Spokesperson Ad" mode → modal
   closes.
4. Lane mounts with:
   - active-state banner: pink, "✏️ New campaign —
     fill the brief below to start."
   - Step 1: `<LaneBriefCreator>` with **blank**
     business/product/audience/tone fields.
   - Step 2: empty-state copy "Save a campaign brief
     in Step 1 to author a script."
   - Step 3: disabled buttons with `requires brief`
     chips.
5. Operator fills + clicks Save brief → campaign
   created + auto-attached + `selectedCampaignId` set
   to new id + `creatingNewCampaign` cleared. Lane
   re-mounts in editor mode against the new record.
6. Operator can also click `cancel new campaign` to
   bail out of creating-new mode without saving — the
   workspace auto-recovers to the newest existing
   campaign.

## How videos are associated / displayed per campaign

Two surfaces:

1. **Lane Step 3 saved-renders disclosure** — scoped
   to the selected campaign. Reads from
   `focused.outputs.filter(o => o.kind === 'spokesperson_ad')`.
   Shows up to 5 rows with the script preview + an
   `open ↗` link to `/api/campaigns/{id}/output/{output_id}`.
2. **Workspace Outputs tab** — unchanged from PR CY.
   Shows the full append-only history across every
   linked campaign. Now distinguishes campaigns via
   the parent campaign label on each card.

The `N× saved` chip on each campaign-list row gives
the operator a one-glance view of how many takes that
campaign holds before clicking in.

## Files changed

```
 frontend/src/components/CampaignLanes.jsx          |  25 +++-
 frontend/src/components/SpokespersonWorkspace.jsx  | 159 ++++++++++++++++++----
 frontend/src/components/lanes/SpokespersonLane.jsx | 134 ++++++++++++++++--
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR DA block)
 docs/handoffs/SESSION_083_MULTI_CAMPAIGN_PR_DA.md  (new, this file)
```

No backend changes. Backend route count unchanged at
**74**. Cinematic / Dialogue lanes untouched (they still
receive `focusedCampaign` via `linkedCampaigns` newest-
sort fallback inside their own components — see
"remaining gaps" below).

## Verification

| Check | Result |
|---|---|
| Backend route count | **74** (unchanged) |
| Backend pytest | **20/20 passed (~0.94 s)** — no test changes |
| `vite build` | 505.92 KB initial / 136.99 KB gzip + 561.97 KB lazy chunk (+4.28 KB / +1.23 KB vs PR CY — workspace state machine + active banner + saved-renders disclosure). |
| Mock smoke | **3/3 passed (~29.7 s)** — Test 1 26.3 s, Test 2 1.9 s, Test 3 793 ms. |
| Mock probe | ✅ Two campaigns linked to one character — each carries its own `business`, `product`, `audience`, `tone`, `commercial_script`. No cross-pollination at the data layer (the bug was 100% in the lane's frontend selection logic). |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| Real Runway calls fired | **0** — all changes are frontend selection / display. |

## Manual walkthrough

1. **Open Donny** (or any spokesperson with multiple
   campaigns). Campaigns tab → see linked campaigns
   list. The newest is auto-selected (pink ring +
   `active` pill); the lane below shows that
   campaign's brief / script / saved renders.
2. **Click `+ New Campaign`** → modal opens. Select
   `Spokesperson Ad`. Modal closes. Active-state
   banner flips pink: `✏️ New campaign`. Lane Step 1
   mounts `<LaneBriefCreator>` with blank fields.
3. **Fill the new brief**: Business `Probe Co`,
   Product `Test product`, Audience `Devs`, Tone
   `Wry`. Click `Save brief`.
4. **Lane re-mounts in editor mode** against the new
   campaign (`Probe Co`). Banner is now emerald:
   `Editing: Probe Co · Test product`. Step 2 has
   `+ Save script` CTA.
5. **Save a script**, e.g. "Try Probe Co — devs love
   it." Step 2 preview appears.
6. **Click an older campaign row** in the list.
   Active pill jumps to that row; lane re-mounts
   against the older campaign's brief / script /
   saved renders. The script you just saved on
   `Probe Co` is NOT visible — it's the older
   campaign's content.
7. **Click `Probe Co` row** to switch back. New
   campaign's brief + script are intact.
8. **Cancel new campaign**: from the new-campaign
   banner, click `cancel new campaign` link → lane
   auto-selects the newest existing campaign.

## Remaining UX gaps

- **Cinematic / Dialogue lanes** still derive
  `focused = sorted[0]` internally. PR DA scope was
  Spokesperson Ad only per the brief. Single-PR
  follow-up to extend the selection plumbing if those
  lanes need it for the demo.
- **No script-history per campaign** beyond the
  current `commercial_script` field. The `outputs`
  list captures script per render, but editing the
  current `commercial_script` overwrites the live
  field. Out of scope today — operators reading the
  per-render disclosure get script provenance for
  every saved take.
- **No "delete campaign" affordance from inside the
  lane**. There IS a top-level
  `DELETE /api/campaigns/{id}` route, but the
  workspace doesn't expose it. Operators clean up
  via curl or another path. Out of scope.
- **Mode-picker modal still opens for `+ New
  Campaign`** even though the operator has already
  picked Spokesperson Ad to land in this lane. Could
  be optimised to skip the modal when already in a
  lane, but the current flow respects existing
  PR BH semantics. Defer.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```
