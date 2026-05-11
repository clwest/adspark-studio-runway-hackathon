# SESSION 097 — PR DN Submission Demo Content Seeder

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `2280117` (`feat: let dialogue scenes extend
without losing existing lines (PR DM)`). PR DN patch in flight on
top; commit + push pending operator approval after this handoff
lands.

**PR letter note:** the brief came in labeled "PR DM" but DM was
already shipped earlier in this session (dialogue-extend slice,
commit `2280117`). To avoid collision in the PR ledger, this slice
is shipping as **PR DN** instead. Content is unchanged from the
brief — just the identifier moved one letter forward.

**Why this slice ran:** Submission video recording is the next
demo-day event. The three hackathon spokespeople (Donny / Riggs /
Miles) needed structured content — knowledge sources, campaigns,
and ad variants — so the operator can click Render at recording
time without first authoring text on the fly. PR DN provides one
idempotent script that seeds exactly that, plus a 7-step recording
plan doc.

## What changed

Pure content-seeding slice. Zero app feature changes. Two new
files added to the repo:

### 1. `scripts/seed-submission-demo-content.py`

~430 LoC, stdlib-only (`urllib.request` for HTTP, `argparse` for
CLI). The script:

1. `GET /api/characters` → locate Donny / Riggs / Miles by exact
   name (case-sensitive). Missing characters are reported and
   skipped — they don't block the others.
2. For each found character:
   - **Knowledge source:** check existing
     `character.knowledge_sources[].title` for a match; if absent,
     `POST /api/characters/{id}/knowledge` with the seeded title,
     `source_type="brand_note"`, and content.
   - **Campaign:** `GET /api/campaigns?character_id=...` →
     match by `business` field; if absent, `POST /api/campaigns`
     with the minimum-valid `CampaignCreate` shape (business +
     product + audience + tone + selected_concept + runway_prompt
     + social_post) then `POST /api/campaigns/{id}/attach-character`.
   - **Ad variant:** check campaign's `ad_variants[].title`; if
     absent, `POST /api/campaigns/{id}/ad-variant` with the seeded
     title + script.
3. Print a summary table per character: `slot: created | skipped |
   would-create · id=...`.

**Idempotency:** every write is gated by a title / business
check, so a second run prints `skipped · id=...` for every slot.
Verified by running twice against the live backend — the second
run reported 9/9 skipped with stable ids.

**Safety:**

- **Script-level guard:** `SCRIPT_MAX_CHARS = 300` raises
  `RuntimeError` if a future edit pushes a variant script past
  the Runway `avatar_videos` cap.
- **No Runway calls:** every write goes through local-only routes.
- **No `/legacy` touch.**
- **No media overwrites:** existing rendered MP4s + output history
  are never touched (no `/host-video`, `/dialogue/stitch`,
  `/reels` calls).
- **Per-character scope:** the script only touches the three named
  spokespeople — other characters in the library are invisible to
  it.

**CLI:**

```bash
# Preview without writing:
python scripts/seed-submission-demo-content.py --dry-run

# Apply against the running backend:
python scripts/seed-submission-demo-content.py

# Custom backend URL:
python scripts/seed-submission-demo-content.py \
    --base-url http://localhost:9000
```

### 2. `docs/SUBMISSION_VIDEO_PLAN.md`

7-step recording flow + camera/audio sanity checklist + known
risks table. Target runtime ~90–120s. Steps:

1. Cold open with the 6-line Hackathon Office Scene Dialogue.
2. Donny's spokesperson ad — creative angle.
3. Riggs's spokesperson ad — build story / context-kit
   explanation.
4. Miles's spokesperson ad — business value.
5. Create a new spokesperson live (proves platform flexibility).
6. One realtime grounded question — option (a) one question per
   spokesperson, or (b) one canonical-distinction question to
   Donny (faster, safer).
7. End on the **Videos** tab + **Conversations** sub-tab (PR DK)
   showing the saved media + persisted transcripts.

Hand-off section notes that re-recording the next day is safe —
all prior renders + transcripts survive (PR CY / PR DJ / PR AJ),
and re-running the seed script is idempotent.

## Seeded content (after first run against the live backend)

| Spokesperson | Knowledge title | Campaign id · business | Variant id · title |
|---|---|---|---|
| Donny Sparks | Creative Campaign Builder | `0a52aef38809` · "Character OS Creates Reusable AI Ads" | `c46edda30a3a` · "Submission · Reusable AI Ads" |
| Riggs Rally | Hackathon Build Process | `09e09a0b3129` · "How We Built Character OS" | `6f9523c88828` · "Submission · Build Story" |
| Miles Monroe | Business Value of Persistent Spokespeople | `9d4e15683704` · "Why Businesses Need Persistent Spokespeople" | `4bd361ca989a` · "Submission · Business Value" |

Variant scripts (all under the 300-char cap):

- **Donny** — *"Most AI ads feel like one-off experiments. Character OS gives your brand persistent spokespeople, reusable campaigns, saved videos, and ad variants you can keep building on instead of starting over every time."* (~220 chars)
- **Riggs** — *"This hackathon build was not one giant prompt. Character OS came together through AI coding sessions, context-kit handoffs, and a lot of fast testing. The result is a team of AI spokespeople explaining the system they helped create."* (~235 chars)
- **Miles** — *"Companies do not need more random content. They need consistent voices that can explain, sell, and show up across campaigns. Character OS turns AI spokespeople into reusable creative infrastructure."* (~200 chars)

## Files changed

```
 scripts/seed-submission-demo-content.py            | new (~430 LoC)
 docs/SUBMISSION_VIDEO_PLAN.md                      | new
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR DN block)
 docs/handoffs/SESSION_097_SEED_SUBMISSION_DEMO_PR_DN.md | new
```

**Untouched:**

- All app code — no backend / frontend changes
- Routes — count still **76**
- Models, services, storage
- Tests — pytest unchanged at 44/44
- `/legacy` — preserved
- Other seed scripts (`scripts/seed-demo-spokespeople.py`,
  `scripts/seed-demo-campaigns.py`) — left intact; PR DN's script
  is additive

## Verification

| Check | Result |
|---|---|
| Backend pytest | **44/44 passed** (~7.3s, unchanged — script is repo-root) |
| Backend route count | **76** (unchanged) |
| Script `--dry-run` | clean: 9/9 would-create across the 3 spokespeople |
| First real run on live backend | **9/9 created** with valid ids |
| Second real run (idempotency probe) | **9/9 skipped** with stable ids; zero duplicates |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode backend | still up at pid `98373`, `runway_mock=false` |
| Real Runway calls fired by this PR | **0** — every write is a local-only route |

## Next manual render steps for the submission video

Once PR DN is merged + pushed, the recording day workflow is:

1. **Pre-flight** — run `docs/DEMO_CHECKLIST.md` §0 (the operator
   already knows this drill).
2. **Open Donny / Riggs / Miles workspaces in tabs.** Each one
   has its dedicated campaign already in the campaigns-list and
   ready to render.
3. **Step 1** of the video — pre-render the dialogue scene by
   running through the 6-line preset once before recording.
4. **Steps 2-4** — for each of the three spokespeople, click into
   their campaign → Step 3 → Render new Spokesperson Ad. Each one
   takes ~30-60s on Runway. With the 50,000-credit hackathon
   budget that's a non-issue.
5. **Step 5** — `+ Create Spokesperson` → mascot template → quick
   name + subject + style → Generate Portrait → Create Avatar.
   Plan for ~60-90s.
6. **Step 6** — Open Donny → Conversations primary tab → Start
   Conversation → ask the canonical-distinction question.
7. **Step 7** — Videos tab + Conversations sub-tab walkthrough.

Total render budget for steps 2-4 alone: 3 × `avatar_videos` =
roughly $0.15-$0.30. Step 1's dialogue (6 lines) is another ~$0.30-
$0.60. Step 6's realtime is ~$0.10/minute. All comfortably under
the 50,000-credit allocation.

## Remaining risks

1. **Three characters must be named exactly "Donny Sparks" /
   "Riggs Rally" / "Miles Monroe".** The script does case-sensitive
   match; a rename in the library (e.g., to "Donny") would silently
   skip that character. Mitigated by the script printing the
   `Missing characters` warning when any of the three are absent.
2. **Idempotency keys are title / business strings.** If the
   operator manually edits a seeded campaign's `business` field in
   the workspace, a re-run of the script would create a second
   campaign matching the original seed name. Acceptable — the
   workspace UX would surface both in the campaigns list, and the
   operator can delete the duplicate. Title-based keys are the
   simplest stable identity available without adding a per-record
   `seed_id` field.
3. **The 4-character live-creation step (step 5 of the video plan)
   isn't covered by the seed script** — by design. The point of
   step 5 is to *demonstrate live creation*. Pre-staging would
   defeat the demo.
4. **Variant scripts live in `SEED` dict** in the script file. If
   the recording reveals one of them needs a tone tweak, edit the
   script + re-run. Idempotency means re-runs only update *new*
   variants; to mutate an existing variant text the operator must
   either delete the seeded variant in the workspace (no UI yet
   for that) or rename the seeded variant title so a fresh one
   gets created. Future polish: a `--force` flag that
   POSTs an upsert (variant `id` passed in the body — PR DC's
   upsert path already supports this) so titles can be re-applied.

## Server status (final)

```
backend: http://localhost:8000 · pid 98373 · runway_mock=false
vite:    http://localhost:5173 · pid 98397 · http=200
```

The seeded campaigns + variants + knowledge sources are live in
`backend/data/campaigns.json` + `backend/data/characters.json`.
Opening any of Donny / Riggs / Miles in the workspace now shows
their dedicated submission campaign in the campaigns list with the
seeded ad variant ready to render.
