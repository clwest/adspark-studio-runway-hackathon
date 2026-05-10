# SESSION 086 — PR DC Ad Variants

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR DC patch in flight on top of
`e560bee` `feat: demo-day stabilization — pre-call
checklist, dialogue preset, readiness panel (PR DB)`;
commit + push pending after this handoff lands)

**Why this slice ran:** Final-day prep flagged the
Campaigns flow as the last UX surface that still
"felt unsafe": the campaign record itself was the
mutable script container, so creating a new ad meant
editing the campaign and losing the prior take's
script context. PR DC separates **stable Campaign
context** (brief: business / product / audience /
tone) from **mutable Ad Variants** (title + script).
Multiple variants stack under one campaign; each
render attaches `variant_id` + `variant_title` to its
OutputRecord so the Outputs gallery groups takes
under their producing variant.

## Exact root cause of stale / mutating campaign state

`Campaign.commercial_script` was a single mutable
string field on the campaign record. Every "save
script" overwrote it. Renders read it via
`script_override` precedence, so the spoken text
moved with the field. Operators trying to keep
multiple takes around had to either:

1. Edit + re-render in place (overwrites the script
   context for the prior take), or
2. Create a whole new campaign with the same brief
   (works but feels heavyweight).

OutputRecords (PR CY) captured the *resolved* script
per render, so prior takes' scripts were technically
preserved on disk — but the UI surfaced only the
campaign's current script, so operators couldn't
tell which output came from which script.

PR DC's fix: add a per-campaign `ad_variants` list,
each entry carrying its own title + script. The
render path accepts an optional `variant_id`, uses
that variant's script as the spoken text, and stamps
the OutputRecord with `variant_id` + `variant_title`
for gallery grouping.

## Data model shape

### `AdVariant` (new, on Campaign)

```python
class AdVariant(BaseModel):
    id: str                # 12-char hex
    title: str             # 1-80 chars
    script: str            # 0-2000 chars (placeholder OK)
    created_at: datetime
    updated_at: datetime
```

### `Campaign.ad_variants: list[AdVariant] = []`

Newest-first. Capped at 20 entries by the store.

### `AdVariantCreate` (request body, upsert shape)

```python
class AdVariantCreate(BaseModel):
    id: Optional[str] = None       # omit → create new; set → update existing
    title: str                     # required
    script: str = ""               # optional, defaults empty
```

### `OutputRecord` (extended)

Two new optional fields:

```python
variant_id: Optional[str] = None
variant_title: Optional[str] = None
```

Pre-PR-DC records leave both `None`; legacy
campaign-level renders leave both `None`. New
variant-scoped renders carry both.

## Routes

**New route:**

- `POST /api/campaigns/{campaign_id}/ad-variant` —
  upsert one variant. Returns the updated Campaign.
  Backend route count **74 → 75**.

**Extended:**

- `POST /api/campaigns/{campaign_id}/host-video` —
  `HostVideoBody.variant_id` is honoured. When set
  AND the variant exists on the campaign:
  - Backend reads the variant's script as the spoken
    text (overrides explicit `script_override` and
    legacy `commercial_script`).
  - The appended PR CY OutputRecord captures
    `variant_id` + `variant_title`.
- `POST /api/campaigns/{campaign_id}/spokesperson-ad`
  — alias route passes `variant_id` through to
  `post_host_video` so both call sites preserve the
  variant linkage.

Legacy `/api/campaigns/{id}/script` route preserved
unchanged for backward compatibility.

## New campaign behaviour

PR DA already cleared brief fields on `+ New
Campaign`. PR DC extends the "blank slate" semantics
to script: a fresh campaign has `ad_variants=[]` and
`commercial_script=null`, so Step 2 mounts the
`<NoVariantsState>` empty-state with a `+ New Ad`
CTA. Operator clicks → creates "Ad 1" variant →
inline title + script editor opens.

## Ad variant behaviour

`Step2AdVariants` wraps Step 2:

- **Empty state** (`<NoVariantsState>`): "+ New Ad"
  CTA. When the campaign has a legacy
  `commercial_script` but no variants, a "Convert to
  Ad 1 variant" amber button materialises the saved
  script into a real variant. Side-by-side with "+
  New Ad (blank)" for fresh starts.
- **Populated state**: variant chip-row with each
  variant's title as a clickable pill (pink ring +
  active). `+ New Ad` chip at the end of the row
  creates a fresh "Ad N" placeholder + auto-selects
  it.
- **Selected-variant editor** (`<VariantScriptEditor>`):
  preview + `Edit ad` button. Click → inline title
  input + script textarea (≤300 chars, `N/300`
  counter) + Save / Cancel. Save POSTs
  `/ad-variant` with `id` set so the existing
  variant updates in place.

Step 3 render button reads `selectedVariantId` from
lane state and passes it to `onGenerateSpokesperson`,
which forwards as `body.variant_id` to the host-video
route.

testids: `spokesperson-lane-variant-chips`,
`spokesperson-lane-variant-chip` (per chip with
`data-variant-id`, `data-active`),
`spokesperson-lane-variant-new`,
`spokesperson-lane-variant-script`,
`spokesperson-lane-variant-editor`,
`spokesperson-lane-variant-edit`,
`spokesperson-lane-variant-title-input`,
`spokesperson-lane-variant-script-input`,
`spokesperson-lane-variant-save`,
`spokesperson-lane-variant-cancel`,
`spokesperson-lane-variants-empty`,
`spokesperson-lane-variants-convert-legacy`,
`spokesperson-lane-variants-new`.

## How videos are linked / reviewed per variant

Three surfaces:

1. **Lane Step 3 saved-renders disclosure** (PR DA,
   variant-scoped in PR DC) — when a variant is
   selected, filters to renders with that
   `variant_id`; otherwise shows all the campaign's
   spokesperson_ad outputs. Each row shows the
   variant title (pink), script preview, open link.
   Summary reads `N saved render(s) for this
   variant` or `for this campaign`. `data-scope` =
   `variant|campaign` for testability.
2. **Workspace Outputs tab gallery** (PR CY,
   variant-aware in PR DC) — each spokesperson_ad
   card now shows the variant title above the script
   preview when captured. testid `output-card-variant`.
3. **Per-row `N× saved` chip** on the workspace
   campaigns list (PR DA) — unchanged; counts every
   spokesperson_ad render across all the campaign's
   variants.

## Files changed

```
 backend/app/models.py                              |  46 ++
 backend/app/routers/campaigns.py                   |  94 +++-
 backend/app/services/storage.py                    |  38 ++
 backend/tests/test_create_avatar_mock.py           | 126 +++++
 frontend/src/api.js                                |   8 +
 frontend/src/components/CampaignLanes.jsx          |  15 +-
 frontend/src/components/OutputsGallery.jsx         |  12 +
 frontend/src/components/lanes/SpokespersonLane.jsx | 572 ++++++++++++++++++-
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR DC block)
 docs/handoffs/SESSION_086_AD_VARIANTS_PR_DC.md     (new)
```

Backend untouched at the route-layer count baseline
of PR DB (`74 → 75` for the new `/ad-variant` route).
`/legacy` untouched.

## Verification

| Check | Result |
|---|---|
| Backend route count | **75** (+1 vs PR DB) |
| Backend pytest | **24/24 passed (~1.29 s)** — 20 prior + 4 new PR DC tests (`test_ad_variant_create_and_update`, `test_ad_variant_404_when_campaign_missing`, `test_ad_variant_validation`, `test_host_video_captures_variant_id`) |
| `vite build` | 527.42 KB initial / 142.04 KB gzip + 561.97 KB lazy chunk (+6.29 KB / +1.20 KB vs PR DB — `<Step2AdVariants>` + `<VariantChipRow>` + `<VariantScriptEditor>` + `<NoVariantsState>` subcomponents). |
| Mock smoke | **3/3 passed (~31.5 s)** — Test 1 28.0 s, Test 2 2.0 s, Test 3 928 ms. |
| **Mock probe — variant flow end-to-end** | ✅ Two variants on Campaign A; two variant-scoped renders, each output carries `variant_title` + variant script verbatim. Campaign B opens blank (`ad_variants=[]`, `commercial_script=null`). Re-opening Campaign A preserves both variants + both outputs. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| Real Runway calls fired | **0** — variant CRUD is text-only; render path tested via mock. |

## Manual walkthrough (the brief's sequence)

1. **Open Donny.** Workspace Campaigns tab.
2. **Create Campaign A** via `+ New Campaign` →
   Spokesperson Ad → fill brief → Save.
3. **Step 2 mounts the empty-state** — click `+ New Ad`.
   Variant "Ad 1" created + auto-selected.
4. **Click `+ Add script`** → type a script → Save
   variant. Step 2 now shows the variant chip "Ad 1"
   (pink) + script preview + `Edit ad` button.
5. **Step 3 → click `Render new Spokesperson Ad`**.
   Backend renders + appends OutputRecord with
   `variant_id` + `variant_title="Ad 1"`. Step 3
   saved-renders disclosure shows `1 saved render
   for this variant`.
6. **Click `+ New Ad`** in the variant chip-row.
   "Ad 2" placeholder created + auto-selected. Add
   script → Save variant → Render.
7. **Click "Ad 1" chip** → variant editor + saved-
   renders both scope back to Ad 1's data. Click
   "Ad 2" → scopes to Ad 2.
8. **Create Campaign B** via `+ New Campaign`. All
   brief fields blank. Step 2 shows `<NoVariantsState>`
   empty state — no bleed-through.
9. **Click Campaign A row** in the list. Brief
   re-populates. Both variants + both outputs
   visible.
10. **Outputs tab** — each Spokesperson Ad card
    shows its `variant_title` (pink) above the
    script preview.

## Remaining demo risks

- **Variant delete is not exposed.** Operator can
  create new variants but can't remove old ones from
  the UI. Backend has no DELETE route for variants
  yet either; the workspace recovery is to
  re-create the campaign. Acceptable for today.
- **Legacy `commercial_script` is still readable**
  by the legacy host-video path. Operators on a
  campaign with both a legacy script AND variants
  will see the variants' scripts win (variant_id
  override takes priority). The "Convert to Ad 1"
  CTA in the `<NoVariantsState>` lets operators
  migrate cleanly.
- **Dialogue Scene + Cinematic lanes** still target
  the campaign's mutable script field, not variants.
  PR DC scope was Spokesperson Ad only per the
  brief. Dialogue uses `dialogue_lines` per line so
  its mental model is already plural; Cinematic
  remains single-track.
- **Output sort by created_at, not variant.** When
  two variants render in alternating order, the
  Outputs gallery interleaves them by timestamp.
  Variant chip on each card makes grouping
  recoverable visually. A "group by variant" toggle
  is a future PR.
- **No render-per-variant rate limiting.** Operators
  can blast renders against a single variant. The
  `Render new Spokesperson Ad` button uses the
  selected variant's script regardless of how many
  prior renders exist. PR CY append-only behaviour
  preserves all of them; cost discipline is on the
  operator.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```
