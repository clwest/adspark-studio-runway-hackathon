# SESSION 093 — PR DJ Persistent Creative Workspaces

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `96ee817` (`fix: make campaign setup a
one-time summary flow (PR DI)`). PR DJ patch in flight on top;
commit + push pending operator approval after this handoff lands.

**Why this slice ran:** Two related problems flagged in the brief:
(a) Dialogue Scene stitched videos + captioned reels were not
reliably appearing in the Videos/Outputs gallery — PR CY's
append-only OutputRecord history shipped for `spokesperson_ad` +
`spokesperson_reels` but the dialogue routes were silently
overwriting their canonical MP4s without ever appending an
OutputRecord, so every re-stitch invisibly replaced the prior take;
(b) "Outputs" felt backend-flavoured and detached from the
campaign workspace mental model. PR DJ closes both gaps and
sharpens the persistent campaigns-list count chip while it's
nearby.

## Three parts

### PART 1 — Dialogue outputs append to `campaign.outputs[]`

**Backend:** `backend/app/routers/campaigns.py`

- `_append_output_record` extended with two new optional kwargs:
  `cast_names: list[str] | None` and `line_count: int | None`.
  Threaded into the persisted `entry` dict; backward-compat
  guaranteed by Pydantic defaulting to `None` for old records.
- New helper `_dialogue_metadata_for_campaign(record)` (campaigns.py:
  ~1907) iterates the campaign's `dialogue_lines` once and returns
  `(cast_names_in_first_appearance_order, total_line_count)`.
  Dedup keeps cast in line order so a Donny→Riggs→Donny pattern
  surfaces as `["Donny", "Riggs"]` (not alphabetised, not
  duplicated).
- `post_dialogue_stitch` success branch (lines ~1311-1338): mirror
  PR CY's spokesperson_ad pattern — `_new_output_id()` →
  `_persist_output_copy(canonical, output_id)` → call
  `_append_output_record(kind="dialogue_scene", cache_filename,
  cast_names, line_count)`. The canonical
  `{campaign_id}-dialogue-scene.mp4` stays in place for the legacy
  single-field URL; the historical copy lands at
  `{campaign_id}-dialogue-scene-{output_id}.mp4` in the same
  `data/finished/` directory the existing `get_campaign_output`
  route already maps `dialogue_scene` to (no file-server changes
  needed — PR CY's mapping at campaigns.py:1931-1938 already
  covered both kinds).
- `post_dialogue_scene_reels` success branch (lines ~2402-2432):
  same pattern, kind=`dialogue_scene_reels`. Picks the newest
  `dialogue_scene` OutputRecord and uses its id as
  `parent_output_id`, so the gallery can render "derived from
  Dialogue Scene".

**Model:** `backend/app/models.py`

- `OutputRecord` gains `cast_names: Optional[list[str]] = None` and
  `line_count: Optional[int] = None`. Both optional; pre-PR-DJ
  records and non-dialogue kinds leave them as None.
- `OutputKind` already had `dialogue_scene` + `dialogue_scene_reels`
  entries (added when PR CY shipped) — no enum change.

**Tests:** `backend/tests/test_create_avatar_mock.py`

Three new pytests that exercise the full mock-mode pipeline (plan →
save → render → stitch → reels) — ffmpeg-lavfi placeholders mean
no Runway calls but real MP4 files on disk:

1. `test_dialogue_stitch_appends_output_record` — stitches three
   lines, asserts `outputs[0].kind == "dialogue_scene"` +
   `cast_names == [single character]` + `line_count == 3`; serves
   the file via `/output/{id}`; re-stitches and asserts append-only
   (two records, both on disk).
2. `test_dialogue_reels_appends_output_record_with_parent` —
   stitches, then exports reels, asserts reels record has
   `kind="dialogue_scene_reels"` + `parent_output_id` pointing at
   the scene record + the same cast/line metadata.
3. `test_dialogue_metadata_dedup_cast_in_order` — Donny→Riggs→Donny
   pattern; asserts `cast_names == ["Donny Multi", "Riggs Multi"]`
   (deduped, in line order, not alphabetised).

Helper `_plan_and_render_dialogue` (test file, ~line 980)
encapsulates the plan/save/render dance so the three tests stay
focused on the assertion. Critical detail it pins: the plan route
filters speaker candidates via the `CharacterStore`, so the
character must have a library-level Runway avatar (not just a
campaign-level host avatar) before plan; helper force-creates the
avatar via `POST /api/characters/{id}/create-avatar`.

### PART 1b — OutputsGallery renders dialogue metadata

**Frontend:** `frontend/src/components/OutputsGallery.jsx`

- `buildCardsForCampaign` reads `o.cast_names` + `o.line_count`
  from the OutputRecord and passes them through to each card as
  `castNames: string[] | null` + `lineCount: number | null`.
- `<OutputCard>` renders a new sub-line below the variant-title
  area when either field is present:
  ```
  cast: Donny, Riggs, Miles · 3 lines
  ```
  Sky-300 mono font, italics off, line-clamp-1. New testid
  `output-card-dialogue-meta`.

The KIND_META block already had `dialogue_scene` + `dialogue_scene_reels`
entries (PR CN scaffolded the labels + descriptions; only the
metadata sub-line was missing). LEGACY_FIELDS already includes
dialogue fallbacks for pre-PR-DJ campaigns.

### PART 3 — "Outputs" → "Videos" rename

Operator-facing rename only; tab `id`, all testids
(`outputs-gallery`, `outputs-empty`, `output-card`, etc.) preserved
so no Playwright assertions break.

- `frontend/src/components/SpokespersonWorkspace.jsx:21` — tab
  label `"Outputs"` → `"Videos"`. Tab `id` stays `"outputs"` so
  URL hashes (e.g. `?tab=outputs`), testids, and code paths
  remain stable.
- `frontend/src/components/OutputsGallery.jsx` — two `<h2>` headers
  + the empty-state copy ("No outputs yet" → "No videos yet")
  all flipped.
- `frontend/src/components/lanes/SpokespersonLane.jsx` — two prose
  refs ("renders are preserved in the Outputs tab" + "see Outputs
  tab for the full history") flipped to "Videos tab".

Component filename `OutputsGallery.jsx` and prop name
`linkedCampaigns` unchanged — those are internal vocabulary, not
operator-facing.

### Bonus polish — campaigns-list count chip

`SpokespersonWorkspace.jsx:730-732` campaigns-list per-row
`N× saved` chip used to count only `spokesperson_ad` outputs. With
dialogue scenes now appending OutputRecords, the count widens to
all *primary* video kinds:

```js
['spokesperson_ad', 'dialogue_scene', 'cinematic_video']
```

Reels (`spokesperson_reels`, `dialogue_scene_reels`) are derived
and excluded — counting them would double-count the parent. Tooltip
flips from "N saved Spokesperson Ad render" to "N saved video
render(s) (Spokesperson Ad / Dialogue Scene / Cinematic — reels
not counted)". `isRendered` boolean similarly uses the wider count.

## Before / after campaign UX

**Before PR DJ:**
- Stitch a dialogue scene → canonical file lands at
  `data/finished/{id}-dialogue-scene.mp4`. Re-stitch overwrites
  silently. Videos gallery surfaces the **current** scene only,
  via the legacy `dialogue_scene_video_url` field fallback.
- Campaigns-list chip says "N× saved" but only counts spokesperson_ad
  renders — a campaign with three dialogue scene renders shows 0.
- Tab label says "Outputs" — sounds like backend output state, not
  finished media.

**After PR DJ:**
- Each stitch appends a new OutputRecord; canonical file copy is
  preserved at `{id}-dialogue-scene-{outputId}.mp4` so historical
  takes survive re-stitches.
- Reels exports append their own OutputRecord with `parent_output_id`
  linking back to the source scene.
- Videos gallery shows each dialogue scene as a distinct card with
  cast + line-count metadata.
- Campaigns-list chip count reflects all primary video kinds.
- Tab label reads "Videos" — operator vocabulary.

## How campaign list works now (PART 2 audit)

The PR DJ brief asked for a persistent campaigns-list-first UX.
That UX already exists from PR DA + PR DI:

- **PR DA** (commit `2510562`) shipped `spokesperson-workspace-
  campaigns-list` — a `<ul>` of click-to-select campaign rows
  sorted newest-first, with active pink ring, "N× saved" chip,
  "rendered" / "draft" pill, "edit →" affordance, full keyboard
  support (Enter/Space).
- **PR DI** (commit `96ee817`) collapsed the Step 1 campaign-setup
  form into a read-only `<CampaignSummary>` card after save, with
  an explicit `Edit Campaign` button — so campaigns stop feeling
  like always-editable forms.

PR DJ's only addition to the list itself is the broadened count
chip. The "Campaigns tab feels like a persistent workspace, not a
repeated setup flow" outcome is achieved by the union of PR DA +
PR DI + this PR.

## How workspace selection works

Click a row in the campaigns list → the workspace lifts `selectedCampaignId`
to that row (`SpokespersonWorkspace.handleSelectCampaign`); the
ring + pill flip to active. `CampaignLanes` reads `selectedCampaignId`
and tells the focused lane (Spokesperson / Cinematic / Dialogue)
to mount against that campaign. PR DI's `<Step1CampaignPanel>` then
renders the Summary card (not the editor) for the selected campaign,
and the operator does creative work in Step 2-3.

`+ New Campaign` mounts a brand-new campaign modal flow; on save
the new campaign joins the list and auto-becomes the selected
campaign (PR DA `onSelectCampaign` post-save call).

## Files changed

```
 backend/app/models.py                                  | +13 (OutputRecord cast_names + line_count)
 backend/app/routers/campaigns.py                       | +60 (helper + 2 success branches + kwargs)
 backend/tests/test_create_avatar_mock.py               | +175 (3 new pytests + helper)
 frontend/src/components/OutputsGallery.jsx             | +35 (card metadata sub-line + 3 rename strings)
 frontend/src/components/SpokespersonWorkspace.jsx      | +12 / -5 (tab rename + chip count widen)
 frontend/src/components/lanes/SpokespersonLane.jsx     | +2 / -2 (Outputs → Videos prose)
 00-START-NEXT-SESSION.md                               | (head pointer)
 docs/INVENTORY.md                                      | (PR DJ block)
 docs/handoffs/SESSION_093_PERSISTENT_CREATIVE_WORKSPACES_PR_DJ.md | new
```

**Untouched:**

- `/legacy` — preserved
- Realtime broker, character store, campaign store core helpers
- All routes — count still **76** (PR DJ only modifies existing
  route handlers; no new endpoints)
- KIND_META — already had dialogue entries from PR CN
- File-server `get_campaign_output` — already covered both
  dialogue kinds from PR CY
- All Playwright testids
- `LaneBriefCreator` / `LaneBriefEditor` / `Step1CampaignPanel` /
  `CampaignLanes` core logic — only the count chip flow touched
- Step labels in PR DH's Dialogue lane (Cast / Scene Lines / Render)

## Verification

| Check | Result |
|---|---|
| Backend pytest | **39/39 passed** (~3.4s) — 36 prior + 3 new PR DJ tests |
| Backend route count | **76** (unchanged) |
| `vite build` | **534.93 KB initial / 144.22 KB gzip** (+0.70 KB / +0.19 KB vs PR DI baseline). Build clean. |
| Mock smoke (Playwright) | **3/3 passed** (~60s — first test ran long but green) |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | backend up, `runway_mock=false`, vite http=200 |
| Real Runway calls fired | **0** |
| Donny's `d00dc42fe5cb` self-demo campaign | preserved (Character OS / PR DF doc id `47de9efd-...`) |

## Manual walkthrough (the brief's sequence)

1. **Open Donny** in `/spokespeople/1527fded7c81`.
2. **Create new campaign** → modal → 🎭 Dialogue Scene → fill brief
   → Save. Step 1 collapses to Campaign Summary (PR DI), campaign
   joins persistent list (PR DA).
3. **Confirm campaign enters persistent list** — appears at the top
   of `spokesperson-workspace-campaigns-list` with active pink ring
   + "draft" pill (no renders yet).
4. **Open campaign workspace** — click row → ring + "active" pill
   flip. CampaignLanes mounts DialogueLane against that campaign.
5. **Create Dialogue Scene** — Step 2 cast picker (PR DH) → pick
   3 characters → Step 3 → Create Scene Lines → optionally Load
   Hackathon Office Scene → Render Line per row → Stitch Final
   Scene.
6. **Render/stitch mock outputs** — in mock mode stitch produces a
   real MP4 via ffmpeg lavfi placeholders.
7. **Confirm dialogue scene lands in Videos/Outputs** — switch to
   Videos tab (was "Outputs") → new card appears with "Dialogue
   Scene" label + cast metadata sub-line + line count.
8. **Switch campaigns** — click a different row in the list.
9. **Return to original** — click back; selected ring flips again.
10. **Confirm all media persists** — Videos tab still shows all
    historical dialogue scene + reel cards.
11. **Confirm no stale form state** — Step 1 stays in Summary card,
    no editable fields surfaced until `Edit Campaign` is clicked.

## Remaining architecture gaps

1. **Conversations are not OutputRecords.** The realtime
   transcript flow (PR AJ) persists per-campaign transcript fields
   on the Campaign model (`realtime_transcript_*`), not as
   OutputRecord entries. The brief's mental model lists
   "Conversations" as a campaign-scoped artifact peer with Videos;
   today the Conversations tab shows the live broker UI but
   doesn't reuse the OutputsGallery layout. Out of scope for PR
   DJ; would be a clean PR DK if needed.
2. **Voiced Storyboard + Voiced Commercial outputs lacked PR CY
   append at write time.** PR DJ didn't audit those; assume they
   were covered when PR CY landed but worth a follow-up grep if
   the Videos gallery is missing cards for those kinds.
3. **OutputsGallery legacy fallback path** still exists for pre-PR-CY
   campaigns that have a populated `dialogue_scene_video_url`
   without an `outputs[]` entry. Now that PR DJ appends on stitch,
   new campaigns will always have an OutputRecord; legacy
   campaigns still use the fallback. A backfill migration would
   eliminate the fallback path but isn't urgent.
4. **Cast metadata not editable** — the `cast_names` field is
   write-once at stitch time. If the operator re-plans the scene
   with different speakers and re-stitches, the new OutputRecord
   gets the new cast (correct). Old records keep their original
   cast (also correct). No risk; just noting.
5. **Component filename `OutputsGallery.jsx` not renamed.** Tab
   label flipped but the file/component name stays — refactor
   would touch every import. Cosmetic; out of scope.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

Donny's self-demo campaign state intact. The new dialogue-output
append behaviour requires a backend restart (already done after
PR DJ commit) — operator's next dialogue stitch on any campaign
will land an OutputRecord automatically.
