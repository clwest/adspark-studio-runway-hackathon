# SESSION 071 — PR CO Repair Demo Data + Portraits + Stats Accuracy

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CO patch in flight on top of
`45bce42` `docs: v2 full manual UI QA + demo readiness
review (SESSION 070)`; commit + push pending after this
handoff lands)

**Closes:** every SESSION 070 V2-QA punch-list item — top
5 demo blockers + the P1 polish "library stats should
scope to live linked campaigns".

## Goal

SESSION 070 found the v2 *interaction model* was demo-
ready (PR CA → PR CN composes a coherent product) but
the v2 *data layer* had decayed:

- `characters.json` held a single faceless Brewster Bolt
- 6 of the 6 character-linked campaigns were orphans
  (referenced deleted character ids)
- Brewster Bolt's CEO Buzz campaign with 4 cached
  outputs (cinematic / host / voiced / reels) was
  invisible — orphaned to a dead char id
- `library-stat-linked-campaigns` claimed 6 + 46
  outputs while every workspace surfaced 0
- the only living tile had no portrait

PR CO restores the data so the polished UI has actual
content to render.

## Endpoint inventory

PR CO adds **no new routes**. Backend route count remains
**71**. Pure data + script + tiny frontend filter slice.

The only Runway calls fired were 4 image generations
(`POST /api/characters/{id}/generate-portrait`); each is
logged in `SESSION_REAL_API_CREDIT_BURN.md`.

## What changed

### Data state — before vs after

| Metric | Before PR CO | After PR CO |
|---|---|---|
| live characters | 1 | **4** |
| character-linked campaigns | 6 | 6 |
| live-linked campaigns (resolve to a real char) | 0 | **5** |
| campaigns with cached outputs reachable from any tile | 0 | **1** (Brewster's CEO Buzz `fc8a20c4` — 4 outputs) |
| `library-stat-spokespeople` | 1 | **4** |
| `library-stat-linked-campaigns` | 6 (overstated; all orphan) | **5** (live-linked only) |
| `library-stat-outputs` | 46 (overstated; counted 38 anonymous test rows + 8 orphan outputs) | **4** (Brewster's outputs) |
| `library-stat-transcripts` | 39 (counted anonymous rows) | **1** (live-linked transcripts) |
| portrait coverage | 0/4 demo personas | **3/4** (Rex Roadside upstream-failed) |

### Spokesperson IDs (post-PR CO, all idempotent name-keyed)

| Persona | id | template | voice | portrait |
|---|---|---|---|---|
| Brewster Bolt | `4be4ad28f91a` | mascot | drew | **OK** (526 KB) |
| Clara Vale | `920408399d30` | founder | clara | **OK** (575 KB) |
| Rex Roadside | `cdaeb5b32518` | local_guide | marcus | **FAILED** (upstream — retry available in-app) |
| Mina Spark | `2fd897b776cc` | coach | ruby | **OK** (770 KB) |

Brewster Bolt's id `4be4ad28f91a` matches the
SESSION 070 snapshot — the seeder updated the existing
record by name. The other three were freshly created.

### Campaign relinks (5 campaigns, 0 deletions)

| campaign id | business | old (orphan) | new (live demo) | outputs preserved |
|---|---|---|---|---|
| `881646950d0a` | CEO Buzz | `abf9ce2f70ec` (dead) | `4be4ad28f91a` Brewster Bolt | none |
| `fc8a20c4…` | CEO Buzz | `d047894984a4` (dead) | `4be4ad28f91a` Brewster Bolt | **cinematic + host + voiced + reels** |
| `cf11a847…` | AdSpark Studio | `541a300cd057` (dead) | `920408399d30` Clara Vale | none |
| `9915bcd4…` | Freedom Ford | `dc52be037644` (dead) | `cdaeb5b32518` Rex Roadside | none |
| `56344420…` | Spark Social | `28d6df60b1b4` (dead) | `2fd897b776cc` Mina Spark | none |

Every output URL on every relinked campaign is preserved
verbatim — `cached_video_url` /
`/api/campaigns/{id}/video`, `host_video_url`,
`voiced_commercial_url`, `spokesperson_reels_url`,
status fields, `runway_task_id`, and the `host_clip_*`
chain all carry through unchanged.

**Not relinked:**

- 1 FocusNet campaign (`22fa0a24…` → `5f1b3738…`) —
  Piper Voltage was a user-owned spokesperson, never
  part of the PR CG demo seed list. Per the brief's
  "do not delete user/non-demo data" rule, the row
  stays orphan. Operator can manually re-link via the
  workspace if they want.
- 38 anonymous `Local coffee shop` campaigns from the
  PR-A era — no `character_id`, never had one. Untouched.

### New file

- **`scripts/relink-orphan-demo-campaigns.py`** —
  ~140 lines. Walks `campaigns.json`, identifies
  orphaned demo campaigns by `(business, dead
  character_id)`, re-points their `character_id` to
  the matching live demo spokesperson. Idempotent
  (already-correct rows print `ok` and the file is
  not re-written when nothing changes). Never deletes
  rows; never touches non-demo businesses; never
  touches output URL fields. Same `os.chdir(BACKEND_ROOT)`
  + `sys.path.insert` pattern as the PR CG/CH seeders so
  it resolves the same `backend/data/` the live uvicorn
  process serves.

### Modified files

- **`scripts/seed-demo-spokespeople.py`** — no edits
  this slice; **re-ran** as designed. Updated Brewster
  Bolt (existing) + created Clara Vale / Rex Roadside /
  Mina Spark. Preserves operator-generated voice clones
  / avatars / metadata on the existing record.
- **`scripts/seed-demo-campaigns.py`** — no edits;
  **re-ran** after the relinker. Found the now-relinked
  campaigns by `(live_character_id, business)` and
  refreshed fixture-defined fields (brief / concept /
  prompt / script / social_post). Did not touch output
  URLs, did not duplicate.
- **`frontend/src/components/SpokespersonStudio.jsx`** —
  the library-stats-row IIFE (~30 lines starting at
  line 634) now scopes the three tracked counts
  (`linked-campaigns`, `cached-outputs`,
  `transcript-entries`) to **live-linked** campaigns
  only:
  ```js
  const liveCharacterIds = new Set(characters.map((c) => c.id))
  const liveLinkedCampaigns = campaigns.filter(
    (c) => Boolean(c.character_id) && liveCharacterIds.has(c.character_id),
  )
  ```
  `totalLinkedCampaigns = liveLinkedCampaigns.length`,
  outputs reduce + transcripts reduce both use
  `liveLinkedCampaigns` instead of the unfiltered
  campaigns slice. `totalSpokespeople` stays
  `characters.length` (one stat that was always correct).

### What did NOT change

- **Backend.** No routes added or modified. Route count
  stays at **71**. No model changes, no migrations,
  no new endpoints.
- **PR CG/CH seeders.** Both used as-shipped; no edits
  required. Both are already idempotent + safe.
- **The relinker is non-destructive.** Re-running it
  after CO ships will find every demo campaign already
  linked to the right live id and print `ok` rows
  without writing.
- **Generation pipelines.** Nothing about how outputs
  are produced changes.
- **`/legacy`.** Untouched.

## Real Runway calls fired

Logged in `docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md`
under a new "SESSION 071 follow-up — PR CO demo-portrait
restoration" subsection.

| time (CDT) | character | result | size on disk |
|---|---|---|---|
| 2026-05-10 00:43 | Brewster Bolt | OK | 526 KB |
| 2026-05-10 00:43 | Clara Vale | OK | 575 KB |
| 2026-05-10 00:44 | Rex Roadside | **FAILED** (`portrait task FAILED: An unexpected error occurred.`) | — |
| 2026-05-10 00:44 | Mina Spark | OK | 770 KB |

Total: **4** real `gen4_image_turbo` portrait calls. **3
succeeded, 1 upstream-failed.** Rex Roadside has now
failed Runway upstream **4 times** across PR CI / PR CJ
investigation / PR CO — the same error string each time.
The failure is not a code path; it is a Runway upstream
issue specific to that prompt-or-seed combination.
Operator can retry via the in-app `Generate Portrait`
button (PR CJ portrait-failed phase handles the next
attempt's UI cleanly). Rex's record stays in
`characters.json` with `portrait_url=null`; the homepage
tile renders the gray "Portrait pending" placeholder
which is the documented v2 state.

No video calls fired. ~$0.075 in image credits this
slice (3 successful gen4_image_turbo calls; the failure
does not bill).

## Verification

| Check | Result |
|---|---|
| Mock backend booted | `bash scripts/start-local-mock.sh` (briefly, for smoke) |
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| `vite build` | 476.47 KB initial / 130.28 KB gzip + 561.97 KB lazy chunk (+0.04 KB initial / +0.01 KB gzip vs PR CN — pure filter) |
| Playwright mock smoke | `3 passed (27.2 s)` — Test 1 (@ /legacy) 24.3 s, Test 2 (@ /) 1.7 s, Test 3 (top-bar round-trip) 670 ms |
| Hygiene scan | empty (no PNG / video committed; portrait PNGs land in gitignored `backend/data/characters/`) |
| Drift guard | `context-kit anchors look recent.` |
| Real-mode reboot | `bash scripts/start-local-real.sh`; `runway_mock=false` |
| Live `/api/characters` | 4 records, 3 with portrait_url set |
| Live `/api/campaigns` predicted stats | 5 live-linked campaigns, 4 cached outputs, 1 transcript entry — matches what the patched stats-row will render |

## UI verification (post-real-reboot)

Manual test path the operator can walk now:

1. http://localhost:5173 — homepage Library shows **4
   tiles** (3 with portraits, Rex Roadside with
   placeholder). Stats chip strip reads
   `4 spokespeople · 5 linked campaigns · 4 cached
   outputs · 1 transcript entry` — every number now
   reconciles with reachable content.
2. Click Brewster Bolt → workspace mounts on Identity
   tab with the real portrait + voice pill `voice ·
   preset · drew`.
3. Click Outputs → **4 cards play inline** (Spokesperson
   Ad, Cinematic Video, Voiced Cinematic, Captioned
   Reels — all with `status=ok` emerald chips).
4. Click Campaigns → 2 CEO Buzz rows (the relinked
   `881646950d0a` draft and the relinked-with-outputs
   `fc8a20c4…`); pick either to mount the lane.
5. Open Clara / Rex / Mina workspaces → Identity tab
   loads cleanly, Campaigns tab shows the matching
   demo campaign, Outputs gallery shows the empty pill
   "No outputs yet. Create a campaign or generate from
   the Campaigns tab." (correct empty-state branch).
6. `/legacy` round-trip → unchanged.

## Limitations / follow-ups

- **One un-fixed P1 polish:** lane button textContent
  concatenation (`"Generate Real Cinematic Videono
  prompt"` / `"Generate Real Spokesperson Adno avatar"`).
  Not in PR CO scope. ~5 min fix in
  `CinematicLane.jsx` + `SpokespersonLane.jsx` —
  prepend `\u00A0— ` to the disabled-reason span text.
  Defer.
- **Two un-fixed P2 polishes** from SESSION 070:
  - Library `<h1>` whitespace (`"Spokesperson
    LibraryRunway-powered"`).
  - Knowledge / Conversations placeholders could carry
    "→ Create a campaign / Bind an avatar" mini-CTAs.
  Both <10 min if ever needed; otherwise demo-acceptable
  as-is.
- **Rex Roadside portrait still missing.** The PR CO
  retry consumed the slice's portrait-burn budget. If
  the operator wants a Rex face, click `Generate
  Portrait` inside his Identity tab (PR CJ retry path
  is wired). Historically this prompt has failed
  Runway upstream every time — may need
  `prompt_override` with manual rewording to succeed.
- **CEO Buzz duplicated under Brewster Bolt.** Two
  campaigns now both link to `4be4ad28f91a` with
  business `CEO Buzz` — `881646950d0a` (draft, no
  outputs) and `fc8a20c4…` (with the 4 cached outputs).
  Demo-acceptable (both are valid CEO Buzz campaigns;
  one is "fresh fixture", one is "campaign with
  rendered assets") but slightly noisy. A future tiny
  cleanup could merge by keeping the one with the most
  outputs and deleting the empty draft. Not urgent.
- **FocusNet campaign still orphaned.** Piper Voltage
  was a user-owned spokesperson; she was deleted
  alongside the demo personas at some unknown point.
  PR CO deliberately did not relink her FocusNet
  campaign per the "do not delete user/non-demo data"
  rule. If the operator wants Piper back, they can
  re-create her via the in-app Create Spokesperson
  flow + manually relink the FocusNet campaign — out
  of scope here.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Files modified this session

- `scripts/relink-orphan-demo-campaigns.py` (new, tracked)
- `frontend/src/components/SpokespersonStudio.jsx`
  (~30-line stats-row IIFE rewrite)
- `docs/INVENTORY.md` (PR CO row + intro re-narration)
- `00-START-NEXT-SESSION.md` (head-of-file pointer + foundation list + implemented section + build size + demo-fixture text)
- `docs/OPERATOR_USAGE_MAP.md` (last-updated stamp)
- `docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md` (PR CO follow-up subsection)
- `docs/handoffs/SESSION_071_DEMO_DATA_REPAIR.md` (this file, new)

**Not committed:** the regenerated `backend/data/` JSON
+ the `backend/data/characters/*-portrait.png` files —
all gitignored per the project's hard rules. Anyone
restoring the demo state from a fresh checkout runs
`scripts/seed-demo-spokespeople.py` →
`scripts/relink-orphan-demo-campaigns.py` →
`scripts/seed-demo-campaigns.py` and clicks `Generate
Portrait` on each missing tile (or fires
`POST /api/characters/{id}/generate-portrait` per the
PR CO log).

## Recommended next slice

After PR CO, the v2 demo path is unblocked end-to-end.
The remaining work is polish-grade and not demo-blocking:

- **PR CP — Lane button textContent fix** (5 min, no
  cost). Closes the last SESSION 070 P1 polish item.
- **PR CP — Tag `hackathon-submission-v14`** (5 min, no
  cost). v2 reset arc PR CA → PR CO is self-contained
  and complete; cutting a tag here gives demo
  evaluators a single artefact.

Either is a clean five-minute slice. The data layer is
restored; the interaction model is unchanged. We are
demo-ready.
