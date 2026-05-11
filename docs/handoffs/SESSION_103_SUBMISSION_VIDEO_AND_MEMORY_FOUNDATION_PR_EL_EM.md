# SESSION 103 — Submission Video Production + Memory Foundation (PR EL → PR EM-a)

**Date:** 2026-05-11 (continuation of the submission push)
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` — six commits layered on SESSION 102's `4fdc5b1`
**Triggered by:** Two parallel needs — produce the submission video
ASAP, and lay the foundation for an architecture move (cross-session
memory) that the agentic-loop demo opened the door to.

> *"I would rather spend 15 hours building than 20 minutes recording
> a video lmao."* — Chris

This session covers two arcs that ran intentionally in parallel:
the **submission video production pipeline** (PR EL family, 4 commits)
and the **cross-session memory foundation** (PR EM-a, 1 commit).
Both ship under the submission-push umbrella but represent very
different things — one is throwaway production tooling for tonight,
the other is durable platform infrastructure.

---

## Arc 1 — Submission video production (PR EL family)

The submission video is being assembled by Character OS itself —
the recursion-as-pitch move. 17 raw clips produced via the platform:
10 cinematic b-roll cuts + 5 talking-head beats + 2 live demo
screen recordings (operator-supplied, scripted via
`live-demo-scripts.md`).

### Production pipeline

| Stage | Source | What it produces |
|---|---|---|
| 1. B-roll | `scripts/burn-broll-for-submission-video.py` (EL-a) | 10 × 5s gen4.5 text-to-video shots in `data/submission_video/broll/` |
| 2. Beat scripts | `scripts/draft-submission-video-beats.py` (EL-b) | 15 Llama-drafted variants (5 beats × 3) in `data/submission_video/scripts/beat-NN-*.json` |
| 3. Beat renders | `scripts/burn-submission-video-beats.py` (EL-c) | 3 Spokesperson Ads (parallel) + 2 dialogue scenes (sequential, with parallel-rendered lines) |
| 4. Fact-fix rerolls | `scripts/reroll-submission-fixes.py` (EL-d) | Targeted re-renders for Beat 6 + Beat 8 lines 2/6 after operator audit |
| 5. Live demo scripts | `data/submission_video/scripts/live-demo-scripts.md` | Pre-flight + on-camera beat sheets for the two screen-recorded segments |
| 6. DaVinci assembly | Operator-driven via the existing `🎬 Polish in DaVinci Resolve` button (PR EF) | Final stitched submission video |

### Beat-by-beat outline

| # | t-range | Source | Persona(s) | Final output id |
|---|---|---|---|---|
| 1 | 0:00–0:08 | B-roll #1 (intro-spotlight) | — | broll/01-intro-spotlight.mp4 |
| 2 | 0:08–0:35 | Long Ad solo | Donny | 260252b4b978 |
| 3 | 0:35–1:05 | Long Ad solo | Miles | d3e77131bca7 |
| 4 | 1:05–1:55 | Dialogue Scene (6L) | Donny + Riggs + Miles | e0a808065551 |
| 5 | 1:55–2:45 | **Screen recording** | (live agentic loop demo) | operator records |
| 6 | 2:45–3:15 | Long Ad solo | Riggs | d905ae0a73c6 (PR EL-d re-roll) |
| 7 | 3:15–3:45 | **Screen recording** | (live DaVinci polish demo) | operator records |
| 8 | 3:45–4:30 | Dialogue Scene (6L) | Donny + Riggs | 1745d2ef9a50 (PR EL-d re-roll) |
| 9 | 4:30–4:45 | B-roll #10 (sunrise-workspace) + outro Fusion title | — | broll/10-sunrise-workspace.mp4 |

### The fact-check audit (PR EL-d)

Operator review caught two issues in the first burn:

1. *"On this laptop"* appeared 4× across Beat 6 + Beat 8 line 2.
   Repetitive phrasing. Rewritten with `locally` / `in post` /
   `hits the network` to vary the language without losing technical
   accuracy.

2. Beat 8 line 6's *"in one night"* was factually wrong — the build
   ran across a **hackathon weekend**, not a single night. Replaced
   with *"in one hackathon weekend"* for honesty.

The first realtime-tool-generated Long Ad (output `b5ed9b9a3e54` on
Donny's "Character OS Creates Reusable AI Ads") was separately audited
during the submission video planning. Llama hallucinated two
capabilities — *"trending topics"* and *"join our community"* — that
don't exist today. Operator's choice: keep the clip in the submission
video but voice-over the segment with the "Llama just wrote the
spec sheet" framing (Take 1 of three drafted voice-over scripts).
The hallucination becomes the roadmap.

### Submission video budget reality

The operator had ~45K Runway credits expiring at the hackathon
deadline. PR EL spent ~3,000-4,000 credits across the b-roll burn
+ initial beat burn + targeted rerolls. ~40K remained unused;
operator's call to leave them on the table rather than burn
speculatively.

---

## Arc 2 — Memory foundation (PR EM-a)

The agentic-loop demo's hallucinated capabilities surfaced a real
architectural question: **what would it take to make those
capabilities real?** The operator already has another app
streaming real-time data; the question wasn't whether the
infrastructure could exist, but whether Character OS had a clean
way to plug it in.

PR EM-a ships that clean way.

### What "memory" means in Character OS today (post PR EM-a)

Memory has always been layered (covered in the SESSION 102 nerd
dive). PR EM-a adds **a unified persistence + ingestion pipeline**
on top of those existing layers, so future sources (operator's
other apps, external feeds, fine-tuned RAG) plug in via one
interface rather than scattering across the codebase.

### Architecture

Three pluggable layers + one orchestrator:

```
                 ┌──────────────────────────────────────┐
                 │   MemoryOrchestrator (singleton)     │
                 │   - ingest_from_all_sources()        │
                 │   - compose_and_publish()            │
                 └────────────┬─────────────────────────┘
                              │
        ┌─────────────────────┼────────────────────────┐
        ▼                     ▼                        ▼
  MemorySource[]          MemoryStore             MemoryComposer
  (pluggable INPUTS)      (pluggable              (size-bounded
                           STORAGE)                text assembly)
  ───────────────         ────────────            ──────────────
  OperatorNoteSource      JsonMemoryStore         RecencyWeightedComposer
   (Character.knowledge_   (Phase 1, file)         (Phase 1)
    sources mirror)
  TranscriptMemorySource  PgVectorMemoryStore     QueryWeightedComposer
   (realtime_transcript_   (Phase 3, planned)      (Phase 3, planned)
    history → Llama
    summary)
  ExternalFeedSource
   (your other app —
    wire-in shape)
```

### Key abstractions (`backend/app/services/memory/`)

- **`models.py`** — `MemoryEntry` is the lingua franca. Pydantic model
  with `id`, `character_id`, optional `campaign_id`, `source_type`,
  `source_id`, `title`, `content`, `tags`, optional `embedding` +
  `embedding_model`, `metadata`, timestamps. Same shape across all
  backends — JsonMemoryStore ignores `embedding`, PgVectorMemoryStore
  reads / writes it later without entry migration.

- **`store.py`** — `MemoryStore` ABC + `JsonMemoryStore` (Phase 1).
  Five verbs: `add`, `update`, `delete`, `get`, `list`, `search`,
  plus `total_chars` for budget math. JsonMemoryStore persists one
  file per character at `data/memory/character-{id}.json`.

- **`sources.py`** — `MemorySource` ABC + three concrete classes.
  `OperatorNoteSource` mirrors the Character record's
  `knowledge_sources` (PR CX) so existing operator-typed notes
  flow through the memory pipeline without duplicate storage.
  `TranscriptMemorySource` pulls turns from the campaign's
  `realtime_transcript_history` (PR BC) and Llama-summarises each
  conversation into a ≤280-char memory note.
  `ExternalFeedSource` is the stub showing the wire-in shape for
  operator's future external data pipelines.

- **`composer.py`** — `MemoryComposer` ABC +
  `RecencyWeightedComposer` (Phase 1). Renders entries as Markdown
  with sections per `source_type`. Bounded by 40K-char budget
  (~11K tokens, well under Runway's 50K-token document cap).
  Returns `(body, included_entries)` so callers can show which
  memories made the cut.

- **`orchestrator.py`** — `MemoryOrchestrator` is the public API.
  Two methods routes will call:
    `.ingest_from_all_sources(character_id, campaign_id=None)`
    `.compose_and_publish(character_id, ..., publisher=create_document)`
  Cached singleton via `@lru_cache` for FastAPI dependency
  injection.

### Test coverage

16 tests in `backend/tests/test_memory.py`, all passing:
- JsonMemoryStore CRUD + search + source-id dedup + filters
- OperatorNoteSource ingestion + empty-content skip
- TranscriptMemorySource per-session entry production
- RecencyWeightedComposer ordering, budget enforcement, campaign
  scope filter
- MemoryOrchestrator ingest + compose end-to-end
- `register_source` runtime extension path

Full backend suite: 72/72 green (was 56; +16 from this PR).

### Operator wire-in for "your other app"

The submission video's hallucinated *"trending topics"* feature
is literally one function away from real:

```python
from app.services.memory import get_orchestrator
from app.services.memory.sources import ExternalFeedSource

def my_other_app_fetcher(character_id, campaign_id):
    # query your real-time data source
    return [
        {"id": "<stable>", "title": "...", "content": "...",
         "tags": [...], "metadata": {...}},
        ...
    ]

orch = get_orchestrator(settings)
orch.register_source(ExternalFeedSource(
    fetcher=my_other_app_fetcher, feed_name="my_other_app",
))
# Next ingest pulls from your app + every other registered source.
```

No backend code changes. The avatar then "remembers" everything
the external source feeds in.

---

## What's parked for after submission

### Phase 2 — Routes + Memory UI (next, intended for tonight)

- `POST /api/characters/{id}/memory/ingest` — fire every registered
  source for the character, return counts
- `GET /api/characters/{id}/memory` — list current memory entries
  with filtering
- `DELETE /api/characters/{id}/memory/{entry_id}` — operator
  cleanup
- `POST /api/characters/{id}/memory/compose-and-publish` —
  compose + upload to Runway document, attach to the campaign
- Memory tab on the Identity card — list, filter, manual re-ingest
  trigger, "publish to Runway document" button
- Auto-ingest hook — when a realtime session ends, fire the
  ingest in the background so the next session reads the prior
  session's summary

### Phase 3 — Semantic memory (post-submission)

- `PgVectorMemoryStore` — Postgres + pgvector. Same interface;
  embeddings generated via Ollama (`nomic-embed-text`); cosine
  similarity replaces substring scoring in `MemoryStore.search`
- `QueryWeightedComposer` — semantic ranking instead of pure
  recency. Takes a query (campaign brief + operator prompt) and
  scores entries by similarity, then packs the top N within budget
- Runway documents **PATCH** path — update an existing document
  rather than re-uploading the whole body when memory grows
- LLM-extracted facts source — after an ad renders, scan the
  script + the campaign for new claims, persist as `auto_extracted`
  entries

### Phase 4 — Operator-curated memory editing (post-submission)

- Inline memory editing UI — operator can correct LLM-summarised
  entries before they're published as documents
- Tag-based filtering in the composer — promote/demote entries by
  tag
- Memory expiration — TTL per entry, archive vs delete

---

## Server status (end of session 103)

```
backend: http://localhost:8000 · runway_mock=false · llm_provider=ollama
         llm_model=llama3:latest
vite:    http://localhost:5173 · http=200
ollama:  llama3:latest (8B), qwen2.5-coder:7b, deepseek-coder-v2
DaVinci: Resolve Studio 20.3.1.6 · "Runway Hackathon" project ready
memory:  data/memory/ created (empty until Phase 2 wires the routes)
```

---

## Cross-references

- SESSION 102 (the submission push proper):
  `docs/handoffs/SESSION_102_LOCAL_LLM_REALTIME_AGENT_PR_DS_TO_EK.md`
- speech.type=audio parked plan:
  `docs/research/SPEECH_TYPE_AUDIO_FINDINGS.md`
- Submission video production assets:
  `backend/data/submission_video/` (all gitignored;
  manifest.json + scripts/*.json + broll/*.mp4 + the live-demo
  beat sheet)
- Memory module:
  `backend/app/services/memory/`
- Memory tests:
  `backend/tests/test_memory.py`

---

## Sentence from the operator, for the record (continued)

After watching the first agentic-loop demo render land:

> *"The video looked great and it sounded good too!"*

Then setting up the submission push:

> *"I would rather spend 15 hours building than 20 minutes recording
> a video lmao."*

Then commissioning the memory foundation:

> *"Make sure its scable if can add in pgvector and other sources
> and just plug them in later."*

Ship it.
