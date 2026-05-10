# SESSION 088 — PR DE Curated Self-Demo Grounding

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `abf9623` (`feat: add context-kit realtime
grounding upload (PR DD)`). PR DE patch in flight on top; commit +
push pending operator approval after this handoff lands.

**Why this slice ran:** PR DD's real upload landed cleanly on Donny
Sparks' `d00dc42fe5cb` campaign — document id
`351925df-d9b0-4641-8a83-e39a0fb9a03e`, status `ready`, broker gate
verified. But review of the uploaded content surfaced a conflation
problem: the raw-dump payload blended **Character OS** (the
hackathon product) and **context-kit** (the separate AI
context-management tool used to coordinate the build) until they
read as the same thing. The grounded avatar would inherit that
conflation. PR DE fixes the source of the bleed.

## Exact root cause of conflation

PR DD's `build_payload()` raw-dumped repo files:

1. `docs/WHAT_IT_IS.md` (~16.5k chars, full) — product narrative
2. `00-START-NEXT-SESSION.md` (6k cap) — PR-by-PR project history
3. `docs/INVENTORY.md` (8k cap) — runtime map
4. Latest two `SESSION_*.md` handoffs (8k each)

Three problems:

1. **No product/tool distinction.** Repo docs interleave "what
   AdSpark does" with "how context-kit's drift guard works" without
   ever saying "these are different things." The dump inherited that
   ambiguity.
2. **Handoff voice dominated.** PR handoffs (PR CW, PR DA, PR DC,
   etc.) are written for *future builders*, not for a spokesperson.
   They lean on insider shorthand ("OutputRecord", "lane Step 3",
   "broker injects documentIds"). Dumped verbatim, the spokesperson
   would speak that vocabulary.
3. **Tail-trim arbitrariness.** The 40k cap fired and trimmed the
   last section mid-content. Whatever ended up surviving the trim
   was load-bearing for the avatar's understanding, but the trim
   point was a function of file mtimes — not editorial intent.

## What changed

### Script rewrite (`scripts/upload-context-kit-demo-grounding.py`)

`build_payload()` is now a pure function returning a curated 6-section
Markdown narrative authored inline in the script's `SECTIONS` list.
No runtime file reads. The repo docs were source material the
authors read while writing the narrative; the script no longer
touches them.

**Section layout:**

| # | Heading | What it covers |
|---|---|---|
| Preamble | How To Answer Questions Using This Document | Hard rules + canonical distinction line |
| 1 | What Character OS Is | The product — AI spokesperson platform |
| 2 | What context-kit Is | The build tool — anchor files + drift guard |
| 3 | How context-kit Helped Build Character OS | Their relationship explicitly framed |
| 4 | What Character OS Can Do Today | Product capabilities, operator-facing |
| 5 | Demo Talking Points | Spokesperson framings for open questions |
| 6 | What Not To Conflate | Seven canonical Q&A pairs for guardrail moments |

**Canonical distinction line** (single unbroken line so the
spokesperson can quote it verbatim and so the test's substring check
works):

> Character OS is the hackathon product. context-kit is the separate
> AI context-management package used to coordinate the build.

**Hard rules in the preamble** the spokesperson reads first:

- Do not describe Character OS as context-kit.
- Do not describe context-kit as the product being demoed.
- When asked about context-kit, say it is the separate AI
  context-management package that helped the builders stay aligned.
- When asked about Character OS, say it is the AI spokesperson
  platform — the hackathon product itself.

**Section 6 Q&A pairs** cover (and exceed) the four demo questions
required by the brief:

1. "Is Character OS the same thing as context-kit?" → No, with
   distinction line.
2. "What is Character OS?" → AI spokesperson platform.
3. "What is context-kit?" → Separate AI context-management package.
4. "How did context-kit help build this?" → Coordinated many AI
   coding sessions.
5. "Did you build context-kit during the hackathon?" → It grew
   alongside but is reusable tooling.
6. "Can I use context-kit through the Character OS UI?" → No;
   repo-side tooling.
7. "Does context-kit power the realtime conversation?" → No;
   Runway `/v1/realtime_sessions` + grounding doc do.

**Dropped helpers:** `_read`, `_head_only`, `_recent_handoffs`,
`REPO_ROOT`. The `\n\n`-trim bug surface (which clipped START and
INVENTORY to 30 chars in the PR DD draft, fixed mid-PR with a 50%
minimum-cut threshold) is gone entirely.

### Dry-run output

The brief required: section headings, char count, first 1000 chars.

```
Curated grounding document — section headings:
  [preamble] How To Answer Questions Using This Document
  [§1] 1. What Character OS Is
  [§2] 2. What context-kit Is
  [§3] 3. How context-kit Helped Build Character OS
  [§4] 4. What Character OS Can Do Today
  [§5] 5. Demo Talking Points
  [§6] 6. What Not To Conflate

Document length: 8,103 chars (cap 40,000)
Canonical distinction line: "Character OS is the hackathon product. context-kit is the separate AI context-management package used to coordinate the build."

--- first 1000 chars ---
# Character OS — Self-Demo Grounding Document
...
```

### Demo checklist (`docs/DEMO_CHECKLIST.md`)

Section 6 rewritten:

- Renamed "Context-Kit Self-Demo" → "Character OS Self-Demo".
- Default brief updated: `Business: How Character OS Was Built`,
  `Product: Context-kit demo grounding for the realtime spokesperson`
  (matches the live campaign created in PR DD).
- Suggested-questions list now carries the **four canonical demo
  questions** with **expected answers** (per the brief):

  - "What is Character OS?"
  - "What is context-kit?"
  - "How did context-kit help build this?"
  - "Are Character OS and context-kit the same thing?"

- Refresh instruction points at the script's `SECTIONS` list rather
  than at repo docs, since the script is now the authoring surface.
- Failure-mode line added: if the avatar fuses the two concepts,
  re-upload and restart.

### Tests (`backend/tests/test_create_avatar_mock.py`)

Four new pytests pin the curated structure. Script loaded via
`importlib.util.spec_from_file_location` because the hyphenated
filename can't be imported with normal `import` syntax:

- `test_grounding_document_has_required_sections` — all six numbered
  headings + the preamble heading land in both the returned headings
  list and the assembled content.
- `test_grounding_document_carries_canonical_distinction` — the
  exact distinction line is present in content AND is exported as
  `CANONICAL_DISTINCTION` (kept in sync so the dry-run banner can't
  drift from the document).
- `test_grounding_document_carries_guardrails` — the four
  "Hard rules" lines from the preamble are all present.
- `test_grounding_document_under_cap` — content ≤ 40k chars and the
  defensive `[truncated]` marker did not fire.

Pytest **32/32** (28 prior + 4 new PR DE).

## Files changed

```
 scripts/upload-context-kit-demo-grounding.py                   | rewritten (~330 LoC)
 backend/tests/test_create_avatar_mock.py                       | +110 (4 new tests)
 docs/DEMO_CHECKLIST.md                                         | Section 6 rewrite
 00-START-NEXT-SESSION.md                                       | (head pointer)
 docs/INVENTORY.md                                              | (PR DE block)
 docs/handoffs/SESSION_088_CURATED_GROUNDING_PR_DE.md           | new
```

**Untouched:**

- `/legacy` (per brief)
- Realtime broker (`realtime_avatar_client.py`) — no behaviour change
- Backend routes — count still **76**
- All models, all storage
- Frontend — no UI changes
- The existing `Campaign.runway_document_*` state on Donny Sparks'
  `d00dc42fe5cb` campaign — still carries the PR DD raw-dump
  grounding doc. Operator re-runs the script after PR DE merges to
  refresh it with the curated version (one real `/v1/documents` call,
  same campaign).

## Verification

| Check | Result |
|---|---|
| Backend route count | **76** (unchanged from PR DD) |
| Backend pytest | **32/32 passed (~1.27s)** — 28 prior + 4 new PR DE tests |
| Script `--dry-run` | 7 section headings, 8,103 chars, distinction line lands, 1000-char preview clean |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` (1 commit since touch, threshold 5) |
| Real Runway calls fired | **0** — explicitly forbidden by the brief |
| Frontend build | not run (no frontend touched) |
| Mock smoke | not run (no UI changes; would have disrupted the operator's running real-mode backend) |

## Bug encountered + fixed during the slice

`test_grounding_document_carries_canonical_distinction` failed on
the first pytest run because the canonical line was originally
hard-wrapped across two lines in the preamble with a `\n> ` in the
middle. The test's `expected in content` substring check broke
across the wrap. Fix: collapsed the line to a single unbroken
Markdown blockquote line. This is also better for the spokesperson —
quoting an unbroken line is easier than reassembling two halves.

A Pyright `reportArgumentType` diagnostic on
`importlib.util.spec_from_file_location` returning `ModuleSpec | None`
was also fixed with a one-line `assert` guard.

## Operator re-upload after PR DE lands

Once PR DE is committed and pushed, the existing grounding doc on
Donny's `d00dc42fe5cb` campaign is still the PR DD raw-dump version.
To replace it with the curated narrative:

```bash
python scripts/upload-context-kit-demo-grounding.py \
    --campaign-id d00dc42fe5cb
```

That fires **one real `/v1/documents` call** against Runway. The
campaign's `runway_document_id` flips to a new UUID; the broker
picks it up automatically on the next realtime session create. The
old document id is replaced rather than amended.

## Server status (final)

Real-mode backend left running:

```
backend: http://localhost:8000 · pid 28939 · runway_mock=false
vite:    http://localhost:5173 · pid 28963 · http=200
```

Backend already has the PR DD raw route loaded; PR DE only changes
script + test + docs, so no backend restart needed.
