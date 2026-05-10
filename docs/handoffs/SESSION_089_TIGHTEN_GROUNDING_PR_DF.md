# SESSION 089 — PR DF Tighten Grounding Language

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `e2670e0` (`feat: curate realtime grounding
for Character OS self-demo (PR DE)`). PR DF patch in flight on top;
commit + push pending operator approval after this handoff lands.

**Why this slice ran:** PR DE landed a structurally clean curated
narrative — the document had clear sections for Character OS and
context-kit and an explicit "Are they the same thing?" Q&A. But a
real demo of the grounded avatar on Donny Sparks' `d00dc42fe5cb`
campaign surfaced a softer failure mode: the spokesperson was
describing context-kit as if it helped *the avatar* maintain
context across the realtime conversation. The structural separation
held; the *language* didn't.

## Exact root cause of the softer conflation

The PR DE document used the word **"session"** liberally in
context-kit's description:

> context-kit's job is to make sure every new AI coding session
> can pick up exactly where the last one left off…

The realtime avatar — itself running inside what it experiences as
a "session" with a viewer — reads that and generalizes. "Session" is
the LLM-bait word: context-kit talks about coding sessions, the
avatar lives inside conversation sessions, and the bridge between
those two senses is short enough that a reasonable LLM crosses it.

Secondary contributors:

- The Section 6 Q&A "Does context-kit power the realtime
  conversation?" was the only line negating runtime involvement.
  It was easy for the LLM to read the surrounding context-kit
  description as "yes, but for a different definition of memory."
- The document never named the *Character OS product features*
  that actually do power the spokesperson's knowledge (campaign
  grounding documents + character knowledge sources). When asked
  "where does your memory come from?" the avatar had no other
  named feature to reach for, so it grabbed context-kit.

## What changed

All changes are in the curated narrative authored inside
`scripts/upload-context-kit-demo-grounding.py`. No route changes,
no broker changes, no model changes, no UI changes.

### Preamble — three new hard rules

```
- Do not describe context-kit as the memory system for Character
  OS spokespeople, the memory layer for the avatars, or the thing
  that powers the realtime conversation. It is none of those.
- When asked about context-kit, say it is the separate AI
  context-management package that helped the AI coding sessions
  building this project stay aligned. By "AI coding session" we
  mean a developer's IDE-side assistant (Claude Code / Cursor /
  Copilot writing real code) — not a viewer talking to a Character
  OS spokesperson.
- If asked how the spokesperson knows things, explain it using
  Character OS's own product features: the campaign grounding
  document attached to this campaign, plus the character's
  knowledge sources. Explain those separately from context-kit.
```

### Preamble — two new canonical lines

```
> context-kit is a memory protocol for AI coding sessions, not the
> memory system for Character OS spokespeople.

> context-kit does not make the avatars remember conversations.
> It helped the AI builders stay aligned while developing the
> project.
```

The original "Character OS is the hackathon product. context-kit
is the separate AI context-management package…" distinction line
stays. PR DF adds two siblings that block the specific failure
mode PR DE didn't anticipate.

### Section 2 — leading disambiguation paragraph

Section 2 now opens with explicit disambiguation:

> When this document says "AI coding session" it means a
> developer's IDE-side AI assistant — Claude Code, Cursor,
> Copilot — actually writing or editing source files in the
> Character OS repository. It does **not** mean a viewer talking
> to a Character OS spokesperson over WebRTC. Those are two
> completely different things that both happen to involve AI, and
> context-kit only addresses the first one.

That kills the "session" ambiguity at the source.

### Section 6 — three new Q&A pairs

1. **"Does context-kit power the spokespeople's memory?"**
   → No. context-kit was used during development to keep AI coding
   sessions aligned. Character OS has its own product features for
   character identity, knowledge sources, campaigns, conversations,
   and outputs.

2. **"How do you know things about Character OS?" / "Where does
   your memory come from?" / "What gives you context?"**
   → Names the two Character OS product features: the **campaign
   grounding document** attached to this campaign (Markdown content
   the realtime broker passes to Runway as `documentIds`) and the
   **knowledge sources** saved on the character record. Closes with
   "context-kit is not involved at runtime."

3. **"So what *is* context-kit then, in one line?"**
   → Carries the new "context-kit is how the project was built,
   not what the product is" answer style. This is the line the
   spokesperson can quote when the viewer wants a quick summary.

## Files changed

```
 scripts/upload-context-kit-demo-grounding.py                   | +73 (preamble + section 2 + section 6)
 backend/tests/test_create_avatar_mock.py                       | +75 (2 new tests)
 00-START-NEXT-SESSION.md                                       | (head pointer)
 docs/INVENTORY.md                                              | (PR DF block)
 docs/handoffs/SESSION_089_TIGHTEN_GROUNDING_PR_DF.md           | new
```

**Untouched:**

- `/legacy` (per brief)
- Realtime broker (`realtime_avatar_client.py`) — no behaviour change
- All routes — count still **76**
- All models, all storage
- Frontend
- `docs/DEMO_CHECKLIST.md` — Section 6 already covers the four
  canonical demo questions per PR DE; PR DF's new Q&A pairs are
  internal to the grounding document, not new demo prompts

## Verification

| Check | Result |
|---|---|
| Backend route count | **76** (unchanged from PR DE) |
| Backend pytest | **34/34 passed (~1.36s)** — 32 prior + 2 new PR DF tests |
| Script `--dry-run` | 7 section headings, **10,742 chars** (up from 8,103, still well under 40k cap), distinction line lands, 1000-char preview clean |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` (1 commit since touch, threshold 5) |
| Real Runway calls fired | **0** — explicitly forbidden by the brief |

### New test surface

`test_grounding_document_disambiguates_avatar_memory` — six
forbidden phrases must not land verbatim:

- `context-kit helps character os spokespeople`
- `context-kit is the memory layer for the avatars`
- `context-kit powers the spokesperson`
- `context-kit gives the avatars memory`
- `context-kit makes the avatars remember`
- `context-kit is the memory system for character os`

`test_grounding_document_carries_pr_df_distinctions` — seven
required phrases must land (whitespace-normalized substring check
defends against Markdown line wrap at column 72):

- `memory protocol for ai coding sessions`
- `not the memory system for character os spokespeople`
- `context-kit does not make the avatars remember`
- `how the project was built, not what the product is`
- `claude code` (proves the IDE-side disambiguation landed)
- `campaign grounding document`
- `knowledge sources`

## Bug encountered + fixed during the slice

`test_grounding_document_carries_pr_df_distinctions` failed on the
first pytest run because the required substring `"how the project
was built, not what the product is"` lives across a Markdown line
wrap in Section 6's answer (the line wraps after "product\n  is").
A naive `in` substring check sees `"what the product\n  is"` and
mismatches.

Fix: normalize whitespace before the substring check (`re.sub(r"\s+", " ", lower)`).
Future prose edits that wrap differently won't break the test, and
the LLM reads the document with whitespace already collapsed.

The PR DE tests use the unnormalized substring check and pass —
their substrings happen to not span line breaks. I considered
backporting the normalization but it's scope creep; PR DE's tests
are fine.

## Operator re-upload after PR DF lands

Donny Sparks' `d00dc42fe5cb` campaign currently carries the PR DE
curated grounding document (id `788b5649-536f-4466-9d02-f82247bfd081`).
To swap to the PR DF tightened version:

```bash
python scripts/upload-context-kit-demo-grounding.py \
    --campaign-id d00dc42fe5cb
```

That fires **one real `/v1/documents` call**. The campaign's
`runway_document_id` flips to a new UUID; the broker picks it up
automatically on the next realtime session create.

## How to verify the fix actually fixes the realtime drift

After re-upload, open Donny's "How Character OS Was Built" campaign
→ Conversations tab → Start Conversation. Try these probes (the
PR DE questions plus three new memory-conflation probes):

- "Where does your memory come from?"
- "Does context-kit power your memory?"
- "How do you know things about Character OS?"

The avatar should:

- Name **campaign grounding documents** and **character knowledge
  sources** as the two real product features.
- Explicitly say context-kit is **not** involved at runtime.
- Use the line "context-kit is how the project was built, not what
  the product is."

If the avatar still says context-kit helps it remember things,
either (a) the upload didn't land — check
`runway_document_status=ready` — or (b) the prose needs another
pass.

## Server status (final)

Real-mode backend already running and unchanged from PR DE push:

```
backend: http://localhost:8000 · pid 39805 · runway_mock=false
vite:    http://localhost:5173 · pid 39841 · http=200
```

No restart needed — PR DF only changes script + test + docs. The
existing `/realtime-document/raw` route from PR DD is loaded.
