# SESSION 095 — PR DL Dialogue Six Lines

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `c7ac745` (`feat: add conversations sub-tab
to Videos history (PR DK)`). PR DL patch in flight on top; commit
+ push pending operator approval after this handoff lands.

**Why this slice ran:** Closing the dialogue-line audit that ended
PR DK. The 3-line cap on dialogue scenes was a single hardcoded
backend constant — `_DEFAULT_LINE_COUNT = 3` in
`dialogue_service.py` — plus a 3-tuple of labels and a 3-tuple
speaker rotation. ffmpeg concat, per-line generate, the storage
layer, the serving route, and the OutputRecord shape are all
length-agnostic. The user has 50,000 hackathon credits, so cost
isn't a brake. Bumping to 6 gives operators room for proper
office-style A/B/C/A/B/C exchanges without any backend rearchitecture.

## What changed

### Backend `dialogue_service.py`

- `_DEFAULT_LINE_COUNT = 6` (was 3).
- New module-level tuple
  `_DEFAULT_LINE_LABELS = ("Hook", "Setup", "Beat 1", "Beat 2",
  "Twist", "Closer")` with a `len(...) == _DEFAULT_LINE_COUNT`
  assert that fails at import time if a future edit drifts one
  without the other.
- `_default_line_text` extended: new fallback strings for
  Setup / Beat 1 / Beat 2 / Twist; Hook + Closer prose unchanged.
  Tolerant label matching — any unknown beat label falls through
  to Closer's office-style line.
- `plan_lines` rewritten:
  - Cast assembled as `[primary, ...up to 2 more distinct ready
    characters]` capped at 3.
  - `speakers = tuple(cast[i % len(cast)] for i in range(_DEFAULT_LINE_COUNT))`.
    With 3+ ready cast: A/B/C/A/B/C. With 2: A/B/A/B/A/B. With 1:
    pure monologue.
  - Labels iterator pulls from `_DEFAULT_LINE_LABELS` (no more
    inline 3-tuple).

### Frontend `DialogueLane.jsx`

- `HACKATHON_DEMO_LINES` extended from 3 to 6 entries with the
  user's exact text — Donny → Riggs → Miles, twice through:
  1. Donny: *"We were supposed to make one ad. Then Chris gave us
     a workspace, campaigns, memory, and a deadline."*
  2. Riggs: *"Many AI coding sessions, one coherent build. Mostly.
     The dev tooling kept us aligned across PRs."*
  3. Miles: *"The result is Character OS: persistent AI
     spokespeople that learn the brand, create campaigns, and
     show up again."*
  4. Donny: *"And somehow, we also got videos, conversations,
     dialogue scenes, and a media library out of it."*
  5. Riggs: *"I'm still not convinced the raccoon was supposed to
     be in charge of quality assurance."*
  6. Miles: *"That's the point. Character OS turns brand
     characters into reusable creative infrastructure."*
- Demo preset banner copy flipped:
  *"three-line office-style skit (Donny → Riggs → Miles) … Backend
  caps a scene at 3 lines …"* → *"six-line office-style skit
  (Donny → Riggs → Miles, twice through) and auto-assigns
  speakers. Each rendered line still burns one Runway credit."*

### Backend tests `test_create_avatar_mock.py`

PR DJ shipped three dialogue tests with `len(lines) == 3` hard-coded.
PR DL rewires them to read `_DEFAULT_LINE_COUNT` from the module —
so the assertions track the const automatically and future bumps
don't break the suite.

Two new pytests added, scoped to PR DL specifically:

1. **`test_dialogue_plan_seeds_six_lines_with_expected_labels`** —
   sanity-checks that `_DEFAULT_LINE_COUNT == 6` and the labels
   tuple matches the spec verbatim; plans against a campaign with
   one ready character; asserts 6 lines with ids line-1..line-6;
   asserts the monologue fallback (all 6 lines share the primary
   character).
2. **`test_dialogue_plan_rotates_three_speakers_a_b_c`** — creates
   three ready characters (A as the campaign-attached primary, B
   + C in the library), plans, asserts (a) lines 1-3 each have a
   distinct speaker and (b) lines 4-6 repeat the same cast in the
   same order. The order of B vs C inside the secondary slot is
   not stable (filesystem mtime), so the test asserts the *pattern*
   (cycle of length 3) without coupling to a specific permutation.

Test helper `_plan_and_render_dialogue` rewritten: it now reads
`_DEFAULT_LINE_COUNT` and generates a list of `Line N text.` strings
sized to whatever the const is.

## Files changed

```
 backend/app/services/dialogue_service.py        | +60 / -28 (const + labels + plan_lines + fallback text)
 backend/tests/test_create_avatar_mock.py        | +95 / -22 (3 rewires + 2 new tests + helper)
 frontend/src/components/lanes/DialogueLane.jsx  | +25 / -8 (preset extended + banner copy)
 00-START-NEXT-SESSION.md                        | (head pointer)
 docs/INVENTORY.md                               | (PR DL block)
 docs/handoffs/SESSION_095_DIALOGUE_SIX_LINES_PR_DL.md | new
```

**Untouched:**

- `/legacy` — preserved
- Routes — count still **76**, no signature changes
- Storage helpers, ffmpeg concat path
- Model schema (`DialogueLine` already string-id-keyed,
  `_MAX_LINE_CHARS=300` still appropriate per line)
- Per-line generate / stitch / dialogue-scene reels paths — all
  read `record.dialogue_lines` and iterate, so length-agnostic
- `OutputsGallery`, `VideosTab`, `ConversationsHistory` —
  unchanged
- `Step1CampaignPanel`, `CampaignLanes` — unchanged

## Speaker rotation truth table

| Ready characters | Cast | Line 1 | Line 2 | Line 3 | Line 4 | Line 5 | Line 6 |
|---|---|---|---|---|---|---|---|
| ≥ 3 | A, B, C | A | B | C | A | B | C |
| 2   | A, B    | A | B | A | B | A | B |
| 1   | A       | A | A | A | A | A | A |
| 0   | _409 from plan route_ | — | — | — | — | — | — |

Primary slot (A) is `_attached_character(campaign)` when set, else
the first ready character. The remaining cast slots come from the
ready pool in filesystem-mtime order.

## Verification

| Check | Result |
|---|---|
| Backend pytest | **41/41 passed** (~7.2s) — 39 prior + 2 new PR DL |
| Backend route count | **76** (unchanged) |
| `vite build` | **543.46 KB initial / 145.98 KB gzip** (+0.35 KB / +0.15 KB vs PR DK — only the 3 extra demo lines added size) |
| Mock smoke (Playwright) | **3/3 passed** (~1m) |
| Mock dialogue probe (HTTP, end-to-end) | 6 lines seeded; speakers `PR DL Probe / Miles Monroe / Riggs Rally / PR DL Probe / Miles Monroe / Riggs Rally` — clean A/B/C/A/B/C; all 6 fallback labels' text fired correctly |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | backend up, `runway_mock=false`, vite http=200 |
| Real Runway calls fired | **0** |
| Donny's `d00dc42fe5cb` self-demo campaign | preserved |

## Manual walkthrough

1. **Open Donny** → Campaigns → 🎭 Dialogue Scene (any campaign).
2. Step 3 → click **Create Scene Lines** → backend seeds 6 idle
   lines, ids `line-1` through `line-6`, labels Hook / Setup /
   Beat 1 / Beat 2 / Twist / Closer in the fallback prose.
3. With Donny / Riggs / Miles all ready: speakers auto-assign
   A/B/C/A/B/C.
4. Click **Load Hackathon Office Scene** in the amber preset →
   all 6 lines overwrite with the user-spec skit copy + speakers
   auto-assigned by name.
5. ScriptPreview block shows the full 6-line scene in screenplay
   format.
6. Click **Render Line** per row × 6 → each line burns one
   `avatar_videos` task (~$0.05-$0.10 each in real mode; mock-mode
   produces lavfi placeholders for free).
7. Click **Stitch Final Scene** when all 6 lines are `ok` → ffmpeg
   concat produces ~45-90s of stitched output depending on per-
   line audio durations.
8. Click **Export Captioned Reel** for a 720×1280 vertical with
   burned-in captions timed per line.

## Cost math at 50,000 hackathon credits

- 1 line = 1 `avatar_videos` task ≈ $0.05-$0.10.
- 6-line scene = ~$0.30-$0.60 per stitch.
- Stitch + Captioned Reel = local ffmpeg, free.
- At 50k credits the operator can render hundreds of full 6-line
  scenes before hitting any budget concern. Effectively unlimited
  for the hackathon.

## Remaining risks

1. **`/legacy` still references the old 3-line plan.** Untouched
   per the brief's preservation rule; if an operator drops back to
   `/legacy` they'll see the legacy 3-line generator. The v2 lane
   is the canonical surface; legacy is a fallback only.
2. **Demo preset and backend default are independent.** Backend
   plan seeds 6 lines via `_default_line_text`; demo preset
   overwrites with the user-spec skit. If a future edit lengthens
   the backend default beyond 6 but leaves the demo preset at 6,
   the trailing N-6 lines stay on their fallback prose. Detectable
   visually in the ScriptPreview; not breakage.
3. **Pytest helper assumes the same character speaks every line in
   `_plan_and_render_dialogue`.** That keeps the cast_names
   assertion clean (single-name list) but doesn't exercise the
   new A/B/C path. The new
   `test_dialogue_plan_rotates_three_speakers_a_b_c` covers the
   rotation specifically.
4. **No operator-configurable scene length yet.** PR DL ships
   Option A from the PR DK audit; Options B (per-campaign
   `dialogue_line_count` field) and C (`POST /dialogue/plan` body
   accepts `line_count`) remain on the shelf if the demo team
   wants longer or shorter scenes per campaign. Both are 1-2 day
   PRs with clean backend signatures.
5. **`OPERATOR_USAGE_MAP.md` and `docs/WHAT_IT_IS.md` still say
   "3-line scenes."** Operator-facing docs that lag behind the
   code. Quick `sed` would fix them but I'd recommend a small
   docs-only follow-up PR (PR DM-DOC?) to update those + any
   `docs/handoffs/` aliasing — preserve historical handoff
   accuracy by leaving the SESSION_NNN files unchanged; only fix
   the live anchors.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

The new 6-line default is live in the running backend process.
Next dialogue plan against any campaign will seed 6 lines.
