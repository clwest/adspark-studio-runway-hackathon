# SESSION 062 — Demo Campaign Fixtures for New Spokespeople (PR CH)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CH patch in flight on top of `3f2987b`
`chore: demo spokespeople fixtures seeder (PR CG)`; commit
+ push pending after this handoff lands)

**Builds on:** PR CG (4 demo spokespeople seeded) +
Campaign / CampaignStore plumbing (PR A → PR BU). Companion
slice — gives every new demo spokesperson exactly one
purpose-built draft campaign so the v2 workspace
Campaigns / Knowledge / Outputs tabs have real context.

## Goal

PR CG made the library look right (7 spokespeople, all the
templates represented), but the four new demo personas had
**zero linked campaigns**. Opening any of them showed an
empty Campaigns tab, an empty Knowledge tab, an empty
Outputs tab. Architecturally correct, narratively empty.

PR CH adds one purpose-built draft campaign per new
spokesperson — each chosen to demonstrate that
spokesperson's role and intended ad modes:

| Spokesperson | Business | Product | Tone | Intended modes |
|---|---|---|---|---|
| Brewster Bolt | CEO Buzz | Dumpster-to-CEO Energy Drink | loud, funny, high-energy | spokesperson + reels + cinematic |
| Clara Vale | AdSpark Studio | Persistent AI Spokesperson Platform | polished, strategic, trustworthy | cinematic + spokesperson + realtime |
| Rex Roadside | Freedom Ford | F-150 / Ranger truck spotlight | practical, helpful, no-pressure | spokesperson + dialogue + reels |
| Mina Spark | Spark Social | Corner-spokesperson commentary ads | playful, creator-native, quick | reels + dialogue + corner-commentary |

All four ship as **drafts** — brief / business / product /
audience / tone / runway_prompt / selected_concept /
social_post / commercial_script all populated with
intentional copy, but **zero cached outputs**. Operators
click Generate in the workspace lanes to fill them out.

## Endpoint inventory

PR CH adds **no new routes**. Backend route count remains
**70**.

## What changed

### New files

- **`scripts/seed-demo-campaigns.py`** (~330 lines) — the
  idempotent seeder.
  - Same `chdir(BACKEND_ROOT)` + `sys.path.insert` trick
    as the spokespeople seeder so imports + paths resolve
    to `backend/data/`.
  - Static `DEMO_CAMPAIGNS` list of four fixture dicts
    each containing: `key` (slug), `spokesperson_name`
    (case-insensitive lookup key into the character
    store), `business`, `product`, `audience`, `tone`,
    `intended_modes`, `selected_concept` (title / hook /
    visual / caption / cta), `runway_prompt`,
    `commercial_script`, `social_post` (caption / cta /
    hashtags).
  - **Spokesperson lookup**: case-insensitive name match
    against `CharacterStore.list()`. If a fixture's
    spokesperson hasn't been seeded yet (PR CG hasn't
    run), the campaign is skipped with a `skipped
    (spokesperson not seeded)` action — operators run
    PR CG's seeder first.
  - **Idempotency key**: `(character_id, business)` pair.
    `Campaign` model has no `metadata` field, so the
    metadata-tag pattern PR CG uses for spokespeople
    isn't available; the character_id + business pair
    is unique enough across the demo set + safe against
    accidental collision with existing user campaigns
    (which would need to share BOTH the character_id of
    a demo spokesperson AND a matching business string —
    deliberately unlikely).
  - **Upsert path**:
    - **Existing match** → patch the demo-defined columns
      in place (business / product / audience / tone /
      selected_concept / runway_prompt /
      commercial_script / social_post / character_id) via
      a direct row mutation + `_write` for atomic safety.
      Operator-generated outputs (cached_video_url,
      host_video_url, voiced_commercial_url, host_task_id,
      runway_task_id, storyboard_*, dialogue_*,
      *_reels_url, etc.) are **never** cleared.
    - **New** → hand-roll a `Campaign` record (id, created_at,
      character_id, all the brief fields) and prepend to
      the rows list. Skips `store.create()` because the
      official path doesn't accept `character_id` — it
      requires a follow-up `update_character_attachment`
      call and would yield a brief un-linked window. The
      hand-roll keeps the link atomic.
  - Uses `_write` (the store's atomic tmp-then-rename
    helper) so re-runs never corrupt the JSON file.
  - Prints a 4-column summary table (spokesperson /
    business / campaign id / action) after the run.

### Idempotency guarantees

- Running the script twice yields identical state on the
  second run; second run prints `updated` for each row,
  same campaign IDs, no duplicates.
- Operator-generated output URLs / task IDs / status
  fields are **preserved across re-runs**. The seeder
  only overwrites the eight demo-defined columns
  (business / product / audience / tone /
  selected_concept / runway_prompt / commercial_script /
  social_post + the character_id link).
- Existing user campaigns (anything not matching a demo
  spokesperson by character_id) are **never** read past
  the `_find_existing` filter.
- If a demo spokesperson hasn't been seeded yet, the
  matching campaign is skipped with a clear warning;
  operators run the spokespeople seeder first.

### Modified files

- **`docs/INVENTORY.md`** — feature stack picks up PR CH;
  intro re-narrates the 7-spokesperson + 4-demo-campaign
  state.
- **`docs/OPERATOR_USAGE_MAP.md`** — last-updated stamp
  moved.
- **`00-START-NEXT-SESSION.md`** — UX redesign foundation
  picks up PR CH; current-state describes the seeded
  campaigns + the running smoke counts.
- **`docs/handoffs/SESSION_062_DEMO_CAMPAIGN_FIXTURES.md`**
  — this file.

### What did NOT change

- **No backend code, routes, or schema changes.** The
  Campaign model has no `metadata` field; the seeder
  sidesteps that by keying on `(character_id, business)`
  instead of inventing a tag column.
- **No frontend changes.** `/api/campaigns` returns the
  new draft records on the same shape the workspace's
  Campaigns tab + lanes already consume. The lanes pick
  the most-recent linked campaign per the existing
  selection logic.
- **No portrait / video / audio generation.** Per brief +
  CLAUDE.md hard-rules, real Runway generation requires
  explicit per-task approval. The four campaigns ship
  with `runway_prompt` populated so operators can click
  Generate Real Cinematic Video / Generate Real
  Spokesperson Ad inside the workspace to fill outputs.
- **`backend/data/campaigns.json` itself is not
  committed.** Per CLAUDE.md hygiene rules,
  `backend/data/` is gitignored. Each developer's
  machine runs the seeder once.

## Demo campaigns after seeding

| campaign id | spokesperson | business | product | runway_prompt set |
|---|---|---|---|---|
| `881646950d0a` | Brewster Bolt | CEO Buzz | Dumpster-to-CEO Energy Drink | ✅ |
| `cf11a84703d5` | Clara Vale | AdSpark Studio | Persistent AI Spokesperson Platform | ✅ |
| `9915bcd4dded` | Rex Roadside | Freedom Ford | F-150 / Ranger truck spotlight | ✅ |
| `56344420541c` | Mina Spark | Spark Social | Corner-spokesperson commentary ads | ✅ |

All four carry: `selected_concept` (title / hook / visual
/ caption / cta) + `runway_prompt` + `commercial_script` +
`social_post` (caption / cta / hashtags) ready to feed
the respective lanes.

## UI verification

- `GET /api/campaigns` returns 34 records (4 new demo
  drafts + 30 pre-existing). All four demo campaigns
  carry their assigned `character_id`.
- Library home `/`: the 4-chip stats row shows
  `library-stat-linked-campaigns` `data-count="6"` (the 4
  new + 2 pre-existing campaigns whose `character_id`
  links to a Character — Brewster the Raccoon's CEO Buzz
  and Piper Voltage's FocusNet). Was 2 before PR CH.
- Brewster Bolt's workspace at `/spokespeople/abf9ce2f70ec`
  (or whatever id the seeder assigned this run) → click
  Campaigns tab → row reads
  `881646950d0a · CEO Buzz · Dumpster-to-CEO Energy
  Drink · draft`. The `+ New Campaign` button opens the
  mode modal in-place; the lanes mount with CEO Buzz as
  the focused linked campaign.
- Each spokesperson workspace's Identity tab subline now
  reads `1 linked campaign · ...` instead of `0 linked
  campaigns · ...`.

## Verification

| Check | Result |
|---|---|
| Seed script first run | 4 created (campaigns 30 → 34) |
| Seed script idempotent re-run | 4 updated · 0 duplicates |
| Existing campaigns preserved | 30/30 untouched (CEO Buzz Brewster-the-Raccoon record + every other pre-existing campaign survives unchanged) |
| `GET /api/campaigns` count | **34** |
| 4 demo campaigns linked to correct demo characters | ✅ verified via the curl + python3 probe (each of the 4 character_ids matches the PR CG fixtures) |
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| Frontend build | unchanged from PR CF (no JSX edits) |
| Playwright mock smoke | `3 passed (33.0 s)` — Test 1 (@ /legacy) 30.5 s, Test 2 (@ /) 1.4 s, Test 3 (top-bar round-trip) 595 ms |
| Hygiene scan | empty (real-mode MP4s + characters.json + campaigns.json all gitignored) |
| Drift guard | `context-kit anchors look recent.` |

**No real Runway calls fired this session.** Per
CLAUDE.md hard rules + brief.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — homepage shows **7 tiles** with
   `6 linked campaigns` in the stats row (was 2 before
   PR CH; +4 from this slice).
2. Click `Open Spokesperson →` on Brewster Bolt's tile →
   `/spokespeople/{id}` workspace mounts.
3. Workspace header subline now reads `1 linked
   campaign · …` (was `0`).
4. Click **Campaigns** tab → section shows the new
   `881646950d0a · CEO Buzz · Dumpster-to-CEO Energy
   Drink · draft` row.
5. Click `+ New Campaign` → mode modal opens in-place
   → pick **Spokesperson Ad** → `<SpokespersonLane>`
   mounts with CEO Buzz pre-loaded as the focused
   campaign. Step 1 brief editor shows the seeded
   `business=CEO Buzz`, `product=Dumpster-to-CEO Energy
   Drink`, `audience` + `tone`. Step 2 script preview
   reads the seeded `commercial_script`. Step 3 Generate
   Real Spokesperson Ad button reads "burns credits" —
   click would fire real Runway.
6. Repeat 2–5 for Clara Vale (AdSpark Studio · Persistent
   AI Spokesperson Platform), Rex Roadside (Freedom Ford
   · F-150 / Ranger), Mina Spark (Spark Social ·
   corner-commentary).
7. Each demo workspace now feels narratively complete:
   purpose-built copy + a real linked campaign + the
   matching lane wired to fire real generation.

## Limitations / follow-ups

- **No outputs yet.** Each new campaign has zero cached
  videos / audio. Operators must click each lane's
  Generate button per spokesperson to fill the Outputs
  tab. Could be batched in a future "demo render"
  helper, but each click burns Runway credits.
- **Brewster Bolt's CEO Buzz is a parallel record.** The
  PR BU-validated CEO Buzz cinematic asset
  (`data/videos/fc8a20c42bc5.mp4`) is on the original
  CEO Buzz campaign linked to **Brewster the Raccoon**.
  Brewster Bolt's CEO Buzz draft (id `881646950d0a`) is
  a separate record with no cached video. If the demo
  story wants Brewster Bolt to inherit Brewster the
  Raccoon's existing real-Runway asset, that's a manual
  follow-up: copy the cinematic, host clip, voiced
  commercial, and reels URLs over via a one-shot
  utility, or re-link the original campaign's
  character_id (which would cost Brewster the Raccoon
  the asset). Both are operator decisions.
- **No metadata field on Campaign.** The fixture set
  can't be queried "find all demo campaigns" without a
  hand-rolled lookup. If future tooling needs this, two
  options: (1) add `metadata: dict = {}` to the
  Campaign model (small, backwards-compatible) and
  re-seed; (2) cross-reference via the demo
  spokespeople's `metadata.demo_persona` flag (each
  demo campaign's character_id maps to a known demo
  persona).
- **`intended_modes` is fixture-only.** The seeder
  records the intended modes inside the script's
  fixture dict but does NOT write them to the campaign
  itself. The workspace's lane logic just renders all
  three lanes regardless. If the UI ever wants to
  highlight "this campaign was designed for these
  modes", the data has to land somewhere first.
- **The seeder uses `_read` / `_write`** — internal
  CampaignStore methods. Not a public API. If those
  helpers ever change shape, the seeder needs an
  update. Acceptable for a fixture-only script.
- **Pyright complains about `app.*` imports.** Same
  false-positive as the spokespeople seeder; runtime
  works.

## Recommended next slice

Two reasonable directions:

1. **PR CI — Library tile simplification (SESSION 059
   Fix #2).** Strip each `<SpokespersonCard>` tile down
   to portrait + name + persona pill + summary chips +
   `Open Spokesperson →` link. Delete the in-tile tab
   strip + the embedded `<CharacterCard>` Identity tab —
   those affordances already live inside the workspace
   at `/spokespeople/:id`. Reduces the most-flagged
   duplication from QA. ~half-day, frontend-only.
2. **PR CI' — Real Outputs tab gallery (SESSION 059
   Fix #3).** Replace the workspace's Outputs
   `<TabComingSoon>` placeholder with a unified gallery
   that surfaces every cached output URL across linked
   campaigns. Brewster the Raccoon already has 4 cached
   MP4s; the new demo personas have 0 today, but as
   operators run Generate, the gallery fills naturally.
   ~1 day, frontend-only.

Option 1 is the smaller win; option 2 makes the demo
narrative pop the moment outputs land. Either is fine.
