# SESSION 061 — Demo Spokespeople Fixtures (PR CG)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CG patch in flight on top of `6ad1bf7`
`feat: v2 copy cleanup — remove dev jargon (PR CF)`; commit
+ push pending after this handoff lands)

## Naming note

The user briefed this slice as **"PR CF — Create Real Demo
Spokespeople Fixtures"**, but the previous **PR CF — V2 Copy
Cleanup + Remove Dev Jargon** already shipped at commit
`6ad1bf7`. To preserve a clean git history without
overlapping slot names, this slice ships as **PR CG — Demo
Spokespeople Fixtures**. Handoff filename is
`SESSION_061_DEMO_SPOKESPEOPLE_FIXTURES.md` (the brief asked
for `SESSION_060_DEMO_SPOKESPEOPLE_FIXTURES.md`, but
SESSION_060 is already taken by the copy-cleanup handoff).
Intent fully implemented; the labels are the only delta.

## Goal

The three pre-PR-CG spokespeople (Brewster the Raccoon,
Piper Voltage, Sir Landsloplot) were created under earlier
product assumptions. They don't clearly demonstrate the new
"persistent AI spokesperson infrastructure" model — every
existing record is a `mascot`, none surface the founder /
dealership / creator-host story the new IA implies.

PR CG seeds four canonical demo personas — one per template
type — that map cleanly onto product use cases:

| Persona | Template | Voice | Use case |
|---|---|---|---|
| Brewster Bolt | `mascot` | drew | High-energy product hype / social ads / energy-drink demos |
| Clara Vale | `founder` | clara | Polished SaaS / B2B explainer / AdSpark platform pitch |
| Rex Roadside | `local_guide` | marcus | Dealership / automotive sales / Ford-style demos |
| Mina Spark | `coach` | ruby | Creator-style social host / Reels commentary / reaction explainers |

The seeder is **idempotent**, **safe re-runs**, **does NOT
touch existing user characters**, and **never calls
Runway**.

## Endpoint inventory

PR CG adds **no new routes**. Backend route count remains
**70**. Reuses the existing `CharacterStore.create()` and
`CharacterStore.update()` helpers via direct Python imports
— no HTTP API touched.

## What changed

### New files

- **`scripts/seed-demo-spokespeople.py`** (~250 lines) —
  the idempotent seeder.
  - `chdir(BACKEND_ROOT)` before any imports so
    `Settings.data_path` (defaults to `./data`) resolves to
    the canonical `backend/data/` directory the running
    uvicorn process serves. Without this the script
    silently writes to a repo-root `data/` directory the
    backend never reads.
  - Imports `CharacterCreate` + `CharacterStore` directly
    via `sys.path.insert(BACKEND_ROOT)`.
  - Static `DEMO_SPOKESPEOPLE` list of four fixture dicts
    with: `id` (slug-style key for metadata), `name`,
    `template`, `subject`, `style`, `personality`,
    `catchphrases` (3 each), `voice_preset`,
    `metadata_role`, `metadata_use_case`.
  - `_find_by_name` does case-insensitive name match
    against the existing characters list; the matching key
    is the **idempotency key**.
  - `_seed_one(store, fixture)` upserts:
    - **Existing match** → `store.update(id, **fields,
      metadata={...})` — refreshes the demo-defined columns
      + the metadata flag without disturbing operator-
      generated portraits / voice clones / Runway avatar
      bindings.
    - **New** → `store.create(CharacterCreate(...))` then a
      separate `store.update(id, metadata=...)` because
      `CharacterCreate` doesn't accept the `metadata` field
      (only the `Character` model does).
  - Prints a 3-column summary table (name / id / action)
    after the run.

### Idempotency guarantees

- Running the script twice yields identical state on the
  second run; the second run prints `updated` for every row
  instead of `created`.
- A seeded record's id is stable; subsequent updates
  preserve the first run's id.
- Only the demo-defined fields plus `metadata` are
  patched; voice / avatar / portrait fields the operator
  may have generated since are **never** cleared.
- Non-demo characters (anything not matching one of the 4
  canonical names case-insensitively) are **never** read,
  written, or even iterated past. The 3 pre-existing
  records (Brewster the Raccoon, Piper Voltage, Sir
  Landsloplot) survive untouched.
- The `metadata.demo=True` flag plus the
  `metadata.demo_persona` slug let future tooling
  (cleanup scripts, demo-only filters, future fixtures)
  detect demo records without depending on names.

### Modified files

- **`docs/INVENTORY.md`** — feature stack picks up PR CG;
  intro re-narrates the 7-tile library state.
- **`docs/OPERATOR_USAGE_MAP.md`** — last-updated stamp
  moved.
- **`00-START-NEXT-SESSION.md`** — UX redesign foundation
  picks up PR CG; current-state describes the seeded
  library + 7-tile count.
- **`docs/handoffs/SESSION_061_DEMO_SPOKESPEOPLE_FIXTURES.md`**
  — this file.

### What did NOT change

- **No backend code, routes, or schema changes.** The
  Character model already had `metadata: dict = {}` —
  the seeder uses it as-is.
- **No frontend changes.** The library tile + workspace
  surfaces all read the same `/api/characters` endpoint;
  they immediately render the new records on first paint.
- **No demo campaigns created in this slice.** The brief
  flagged campaigns as "if existing scripts make this
  easy" — `CampaignCreate` requires `selected_concept`,
  `runway_prompt`, and `social_post` on every record,
  which would mean either invoking the concept-generation
  flow or hand-crafting per-fixture concept JSON. Both
  are real work; deferred to PR CH per the brief's
  fallback ("only create spokespeople and document
  campaign creation as next").
- **No portrait generation.** The brief said "Optionally
  generate mock portraits only if current local mode is
  mock-safe." Real-mode servers were running throughout;
  the script is deliberately portrait-blank to avoid any
  Runway risk. Operators click `Generate Portrait` inside
  the app per character.
- **`backend/data/characters.json` itself is not
  committed.** Per CLAUDE.md hygiene rules,
  `backend/data/` is gitignored. The fixtures land in the
  developer's local `characters.json`; production /
  hackathon-demo machines run the seeder once.

## Spokesperson roster after seeding

| id | name | template | voice | demo flag | portrait |
|---|---|---|---|---|---|
| `abf9ce2f70ec` | Brewster Bolt | mascot | drew | ✅ | (blank) |
| `541a300cd057` | Clara Vale | founder | clara | ✅ | (blank) |
| `dc52be037644` | Rex Roadside | local_guide | marcus | ✅ | (blank) |
| `28d6df60b1b4` | Mina Spark | coach | ruby | ✅ | (blank) |
| `5f1b3738d084` | Piper Voltage | mascot | victoria | — | generated (pre-existing) |
| `d047894984a4` | Brewster the Raccoon | mascot | drew | — | generated (pre-existing — CEO Buzz fixture) |
| `438916e176b1` | Sir Landsloplot | mascot | vincent | — | generated (pre-existing) |

Total: **7 spokespeople** in the library after seeding (was
3 before).

## UI verification

`/` library renders all 7 tiles. Stats row chip
`library-stat-spokespeople` reads `7`. Programmatic check:

```
$ curl -s http://localhost:8000/api/characters \
    | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d['characters']))"
7
```

Headless Playwright snapshot saved to
`/tmp/qa-screenshots/17-library-after-seed.png` confirms
the four new tiles appear in the grid (top row) with empty
portrait slots, alongside the three existing tiles
(Piper / Brewster the Raccoon / Sir Landsloplot) which
keep their generated portraits intact.

## Verification

| Check | Result |
|---|---|
| Seed script first run | 4 created · cleared in `_find_by_name` confusion → re-targeted to `backend/data/` |
| Seed script idempotent re-run | 4 updated · 0 duplicates |
| Existing characters preserved | 3/3 (Brewster the Raccoon, Piper Voltage, Sir Landsloplot) untouched |
| `GET /api/characters` count | **7** |
| `library-stat-spokespeople` data-count | **7** |
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| Frontend build | unchanged from PR CF (no JSX edits) |
| Playwright mock smoke | `3 passed (43.6 s)` — Test 1 (@ /legacy) 41.1 s, Test 2 (@ /) 1.4 s, Test 3 (top-bar round-trip) 565 ms |
| Hygiene scan | empty (real-mode MP4s + new characters.json all gitignored) |
| Drift guard | `context-kit anchors look recent.` |

Test 1 (`@ /legacy`) ran longer than the previous baseline
(41 s vs ~30 s) because the legacy gallery now mounts
**seven** saved-card panels instead of three; each card
renders its full 7-tab structure. Behaviour unchanged;
purely scaling cost.

**No real Runway calls fired this session.** Per CLAUDE.md
hard rules + brief, real-mode generation is reserved for
explicit per-task approval.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — homepage shows **7 tiles** with
   the 4-chip stats row reading `7 spokespeople`.
2. New tiles (Brewster Bolt, Clara Vale, Rex Roadside,
   Mina Spark) sit at the top of the grid with blank
   portrait slots. Each shows the persona pill (mascot /
   founder / local_guide / coach) + `voice · preset · …`
   chip + `0 campaigns`.
3. Click `Open Spokesperson →` on any new tile —
   navigates to `/spokespeople/{id}` workspace. Header
   shows the seeded persona / voice pills; the embedded
   CharacterCard inside Identity tab shows the Generate
   Portrait button (which calls real Runway image when
   clicked).
4. The 3 existing tiles (Piper / Brewster the Raccoon /
   Sir Landsloplot) keep their portraits + linked
   campaigns + cached outputs.

## Limitations / follow-ups

- **No demo campaigns yet.** Each new persona has 0
  linked campaigns. The compelling demo flows
  (Brewster Bolt → CEO Buzz, Clara Vale → AdSpark
  explainer, Rex Roadside → Freedom Ford, Mina Spark →
  Reels commentary) still need campaign records. The
  CEO Buzz campaign exists today but is linked to
  Brewster THE RACCOON, not Brewster BOLT — so the
  demo flow narrative is split. Resolving this is a
  PR CH candidate.
- **Portraits are blank for the new four.** Operators
  must click Generate Portrait per-tile to render
  faces. In real-mode this burns Runway image credits
  (~one per tile). Could be batched with a helper
  later.
- **No legacy fixture overlap.** The legacy 4-stage
  wizard at `/legacy` has its own +Create Character
  form (full 6-field surface). Operators using
  `/legacy` to create new spokespeople won't see them
  flagged as demo unless the seeder runs again with
  matching names. Acceptable for a fixture-only slice.
- **Voice presets are educated guesses.** I picked
  drew (energetic male) for Brewster Bolt, clara
  (matches the name) for Clara Vale, marcus (practical
  male) for Rex Roadside, ruby (warm playful female)
  for Mina Spark. None of the four fixtures has been
  voice-cloned yet — operators can clone over the
  preset anytime.
- **The seeder targets `backend/data/`.** Hard-coded
  via `BACKEND_ROOT / "data"` after my first run hit
  the wrong path. Robust against running from any
  working directory; doesn't honour custom
  `Settings.data_dir` overrides. If a future deploy
  needs a non-default data dir, the script needs an
  env-var honour pass.
- **Pyright complains about `app.*` imports.** The
  imports work at runtime via `sys.path.insert`;
  pyright's static analyser doesn't follow that. False
  positives.

## Recommended next slice

Two reasonable directions:

1. **PR CH — Demo Campaigns Fixtures.** Companion
   slice that creates one campaign per new
   spokesperson:
   - Brewster Bolt → CEO Buzz (re-link the existing CEO
     Buzz campaign from Brewster the Raccoon, OR clone
     it into a parallel record)
   - Clara Vale → AdSpark Platform explainer
   - Rex Roadside → Freedom Ford truck spotlight
   - Mina Spark → Reels commentary demo
   Each as a draft campaign with brief / business /
   product / runway_prompt fields filled but no cached
   outputs. Operators run Generate Real Cinematic /
   Spokesperson Ad inside the workspace to fill them
   out. ~1 day of fixture work + maybe a campaign-seed
   script mirroring the spokesperson one.
2. **PR CH' — Library Tile Simplification (SESSION 059
   Fix #2).** Strip each `<SpokespersonCard>` tile
   down to portrait + name + persona pill + summary
   chips + Open link, removing the in-tile tab strip
   and embedded `<CharacterCard>`. Reduces the most-
   flagged duplication from QA. ~half-day.

Option 1 makes the demo narrative complete; option 2
makes the library visually clean. The user's call.
