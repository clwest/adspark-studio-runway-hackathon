# SESSION 082 — PR CY Append-Only Output History

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CY patch in flight on top of
PR CX (still uncommitted from prior turn) which is on
top of `d9e556c` `fix: replace concatenated portrait
templates with clean composer (PR CW)`. **PR CX should
commit first** as a clean atomic slice before PR CY).

**Why this slice ran:** When a Spokesperson Ad
generated twice, the second render overwrote the
first — the Outputs gallery only ever showed the
latest. Operators expected a saved history of every
render they paid for. PR CY gives them that.

## Exact overwrite cause

Three single-value fields on `Campaign`:

```python
host_video_url: Optional[str] = None
spokesperson_reels_url: Optional[str] = None
# (and analogous fields for other lanes)
```

Plus a single canonical cache filename:

```python
# backend/app/services/character_host_client.py:162
def path_for(settings, campaign_id):
    return _host_dir(settings) / f"{campaign_id}.mp4"
```

So every `/api/campaigns/{id}/host-video` POST:

1. Downloaded the new render to `data/host/{id}.mp4`,
   atomically replacing the prior file (`tmp.replace(target)`).
2. Updated `host_video_url` to the same canonical
   URL `/api/campaigns/{id}/host-video` — no version,
   no history.
3. The Outputs gallery (`OutputsGallery.jsx`) iterated
   a fixed `OUTPUT_FIELDS` array and read each
   single-value URL from the campaign once.

**Result:** prior renders gone from disk + gallery.

## Persistence model

New `Campaign.outputs: list[OutputRecord]` — append-only
history. Each entry:

```python
class OutputRecord(BaseModel):
    id: str                                # 12-char hex
    kind: OutputKind                        # spokesperson_ad |
                                            # spokesperson_reels |
                                            # cinematic_video | ...
    video_url: str                          # /api/campaigns/{id}/output/{output_id}
    cache_filename: str                     # historical filename only
    script: Optional[str] = None            # for spokesperson_ad
    task_id: Optional[str] = None           # Runway task id when real
    mock_mode: Optional[bool] = None
    parent_output_id: Optional[str] = None  # for derived (reels) outputs
    created_at: datetime
```

Capped at 50 entries by `CampaignStore.append_output(...)`
(newest-first) so `campaigns.json` stays bounded.

**Disk layout:** every successful render writes the
canonical file (`data/host/{id}.mp4`) **and** copies
to a per-output historical filename
(`data/host/{id}-{output_id}.mp4`). The legacy
`host_video_url` keeps pointing at the canonical
"latest" path so existing UI consumers (lane status
chips, `host_status=ok` checks, the gallery's legacy
fallback) stay backward-compatible.

**New route** — generic file server by output id:

```
GET /api/campaigns/{campaign_id}/output/{output_id}
```

Looks up the OutputRecord on the campaign, resolves
its `cache_filename` against the kind-specific cache
dir (`data/host/`, `data/finished/`, `data/videos/`),
and returns a `FileResponse`. 404 if either id is
unknown or the file is missing.

Backend route count **73 → 74** (just one new route —
the rest reuses existing endpoints).

## Files changed

```
 backend/app/models.py                              |  83 +++++++
 backend/app/routers/campaigns.py                   | 171 +++++++++++++
 backend/app/services/storage.py                    |  27 ++
 backend/tests/test_create_avatar_mock.py           | 100 ++++++++ (PR CY portion)
 frontend/src/components/OutputsGallery.jsx         | 276 +++++++++++++++++++++
 frontend/src/components/lanes/SpokespersonLane.jsx |  18 +- (UX copy)
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR CY block)
 docs/handoffs/SESSION_082_OUTPUT_HISTORY_PR_CY.md  (new, this file)
```

(The diff stat also shows PR CX's untouched changes
because PR CX hasn't been committed yet — see note at
the top of this handoff.)

## Hooks

Two routes wire into the new history:

1. `POST /api/campaigns/{id}/host-video` — on success:
   - generate `output_id`
   - copy `data/host/{id}.mp4` → `data/host/{id}-{output_id}.mp4`
   - append OutputRecord with `kind="spokesperson_ad"`,
     `script=script_override or commercial_script`,
     `task_id=result.task_id`, `mock_mode=result.mock_mode`
2. `POST /api/campaigns/{id}/spokesperson-ad/reels` —
   on success:
   - generate `output_id`
   - copy `data/finished/{id}-spokesperson-reels.mp4` → historical filename
   - append OutputRecord with `kind="spokesperson_reels"`,
     `parent_output_id` = id of the most-recent
     `spokesperson_ad` output (links the derived reel
     back to its source for gallery grouping)

The append helper (`_append_output_record`) is
best-effort — if the disk copy fails or the store
write throws, we log a warning and don't block the
underlying render's success response.

## Outputs tab / gallery changes

`frontend/src/components/OutputsGallery.jsx` rewritten:

- **Primary path:** read `campaign.outputs` (newest-first
  array of `OutputRecord`s). One card per record. Each
  card carries:
  - kind label (Spokesperson Ad / Captioned Reels / …)
  - orientation pill (Horizontal / Vertical · Reels)
  - description (per-kind)
  - **script preview** (140-char snippet, italic, in
    quotes) when present — distinguishes multiple
    spokesperson_ad takes that share a campaign
  - **`derived from <parent kind>` line** for reels
    cards that link back to their source ad
  - parent campaign label (`{id-prefix} business · product`)
  - `created` relative time (`12s ago`, `4h ago`, …)
  - status pill (`ok` / `mock` / etc.)
  - inline `<video controls muted preload="metadata">`
  - `open / download ↗` link
- **Legacy fallback:** when `campaign.outputs` is empty
  (campaigns from before PR CY landed), the gallery
  walks the same `host_video_url` / `cached_video_url`
  / etc. fields as PR CN — one synthetic card per
  populated single-value URL — so pre-PR-CY records
  stay visible without a backfill migration.
- **Header copy refresh:** "Every render is preserved
  — re-rendering creates a new billable video, not an
  overwrite."

`testid` changes: `data-output-kind`, `data-output-id`,
`output-card-script`, `output-card-created` for
testability.

## Lane UX copy (per spec)

Spokesperson lane Step 3 button copy refreshed:

| element | before | after |
|---|---|---|
| horizontal label (when cached) | `Regenerate Real Spokesperson Ad` | `Render new Spokesperson Ad` |
| horizontal chip (when cached) | `cached · burns credits` | `previous render saved` |
| horizontal warning copy | `⚠️ Real Runway. Each click bills avatar_videos.` | `⚠️ Re-rendering creates a new billable video. Prior renders are preserved in the Outputs tab.` |
| reels label (when cached) | `Rebuild Captioned Reels` | `Rebuild captions from saved video` |

## Before / after behaviour

**Before:** click `Generate Real Spokesperson Ad` →
new MP4 lands → click again → new MP4 overwrites old.
Outputs tab shows 1 card. Operator silently lost the
first take.

**After:** click `Generate Real Spokesperson Ad` →
new MP4 lands + appended to history. Click `Render
new Spokesperson Ad` (re-labelled) → new MP4 lands +
appended. Outputs tab shows 2 cards, both playable
via `/api/campaigns/{id}/output/{output_id}`. Both
files on disk: `{id}.mp4` (canonical/latest) +
`{id}-{a}.mp4` + `{id}-{b}.mp4` (historical).

## Verification

| Check | Result |
|---|---|
| Backend route count | **74** (+1 vs PR CW: the new `/output/{id}` route) |
| Backend pytest | **20/20 passed (~0.96 s)** — 17 pre-existing + 3 new PR CY tests (`test_host_video_appends_output_history`, `test_output_route_404s_for_unknown_id`, `test_output_route_404s_for_unknown_campaign`) |
| `vite build` | 501.64 KB initial / 135.76 KB gzip + 561.97 KB lazy chunk (+2.08 KB / +0.56 KB vs PR CX baseline — gallery rewrite + lane copy refresh). |
| Mock smoke | **3/3 passed (~32.1 s)** — Test 1 29.0 s, Test 2 1.8 s, Test 3 709 ms. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| Real Runway calls fired | **0** — preservation verified end-to-end in mock mode. |

The pytest covers exactly the user's manual walkthrough:
"create campaign, generate output A, generate output B,
confirm A and B both appear in Outputs". It also asserts
both historical files exist on disk and the
`/output/{id}` route serves either one.

## Tests / checks run

- `pytest tests/test_create_avatar_mock.py` — 20 passed.
- `npm run build` — clean, +2.08 KB initial / +0.56 KB gzip vs PR CX baseline.
- `npm run test:e2e` — 3/3 passed.
- `bash scripts/check-context-kit-drift.sh` — anchors recent.
- `git ls-files | grep ...` hygiene scan — empty.
- Manual mock probe (via pytest fixture) — round-trip
  confirmed: 1st render appends 1 entry; 2nd render
  appends a 2nd entry; both files persist on disk; the
  generic `/output/{id}` route serves either.

## Remaining risks

- **Disk usage doubles per render.** The canonical
  `<id>.mp4` AND the per-output `<id>-<oid>.mp4`
  both land on disk. Acceptable for our scale (a
  handful of demo campaigns × ≤50 history entries
  each); could be tightened to "historical only"
  later if we revisit the GET `/host-video` legacy
  route to read from `campaign.outputs[0]` instead.
- **Other lanes still overwrite.** PR CY hooks
  `spokesperson_ad` + `spokesperson_reels`. Cinematic
  / voiced commercial / storyboard / dialogue scene /
  dialogue reels still update single-field URLs in
  place. The OutputsGallery legacy fallback keeps
  them visible (one card per populated single-field),
  but they don't yet preserve history. Single-PR
  follow-up to extend the same hooks.
- **Run history is per-campaign, not per-spokesperson.**
  The gallery groups by linked-campaigns of the
  active spokesperson; but cross-campaign viewing for
  a single character isn't supported. Out of scope
  today.
- **`parent_output_id` for reels assumes the most-
  recent spokesperson_ad output is the source.** If
  the operator edits the script + builds reels off the
  *previous* take, the parent link still points at
  the latest. Edge case; correct behaviour for the
  typical workflow.
- **No migration for pre-PR-CY records.** The legacy
  fallback handles them; no backfill script needed.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

- **Commit PR CX (Knowledge flow) first** — it's a
  separate atomic slice that's been sitting
  uncommitted; it should land before PR CY.
- After PR CX commits, **commit PR CY** (this slice).
- **PR CZ — extend output-history hooks** to the
  remaining lanes (cinematic, voiced commercial,
  storyboard, storyboard voiced, dialogue scene,
  dialogue reels) so every render path appends to
  `campaign.outputs`.
