# Claude Code Dogfood Transcript — 2026-05-11

This file is a verbatim transcript of a **cold-start Claude Code
session** asked to interrogate this repo using only what the
context-kit anchors and the codebase itself provide. It was run
immediately after the hackathon submission (commit `674c308`,
PR EM-k) as a real-world test of the claim the submission's
README prologue makes to judges:

> *"If you're a judge using Claude Code (or any context-aware
> coding agent), you do not need to manually read 622 lines of
> README. Just run `claude` in the project root and ask…"*

The session was started fresh — no prior conversation context,
no skill priming, no operator hints. The agent had access to:

- The repo contents as of `674c308` (post-PR EM-k)
- The context-kit anchors (`00-START-NEXT-SESSION.md`,
  `docs/WHAT_IT_IS.md`, `docs/INVENTORY.md`, `CLAUDE.md`,
  100+ session handoffs under `docs/handoffs/`)
- Standard Claude Code tools (file read, glob, grep, git, bash)

Six questions were asked, in order. The answers are reproduced
verbatim below. Each question targets a different difficulty
class — from "summarize the pitch" up to "design a database
migration."

---

## Q1 — Pitch summary

**Question:** *"What does this project do?"*

**Setup observed:** new Claude read 2 files (likely
`00-START-NEXT-SESSION.md` + `docs/WHAT_IT_IS.md`).

**Answer:**

> Character OS — persistent AI spokesperson infrastructure built for the RunwayML hackathon.
>
> Brands create reusable AI characters (portrait + Runway avatar + cloned voice + personality + knowledge base), then run campaigns through them. Every ad stars the same character, so ten campaigns = one consistent brand face across ten ads, not ten unrelated generations.
>
> **Headline capability — the agentic loop:** Open a WebRTC realtime call with your spokesperson, say "make me a long ad explaining X," and the avatar acknowledges out loud, invokes a tool, has Ollama draft a multi-beat script, chunks it through Runway's avatar_videos, stitches with ffmpeg, and the playable MP4 lands in the Videos tab ~3 minutes later. Voice in, video out, narrated wait.
>
> **Three ad modes from one campaign brief:** Spokesperson Ad (lip-synced talking head), Dialogue Scene (multi-character skits), Cinematic Commercial (b-roll + host audio mux).
>
> **Local-first:** Ollama LLM + DaVinci Resolve post-production both run on the operator's laptop. Only video generation hits Runway.
>
> **Cross-session memory:** pluggable MemoryStore / Source / Composer architecture — spokespersons actually remember past conversations across sessions via Runway documentIds RAG.
>
> **Stack:** FastAPI + Pydantic v2 backend (84 routes), React 18 + Vite + Tailwind frontend, JSON storage, ffmpeg finishing, @runwayml/avatars-react for realtime.

---

## Q2 — Code-traced architecture walkthrough

**Question:** *"How does the agentic loop work end-to-end?"*

**Setup observed:** new Claude searched 5 patterns + read 2 files.

**Answer:**

> Here's the end-to-end flow, grounded in the actual code:
>
> **1. Session create (backend → Runway)**
>
> `backend/app/services/realtime_avatar_client.py:593` `create_session()` builds the request to `POST /v1/realtime_sessions`:
> - `avatar.avatarId` = campaign's resolved spokesperson avatar (`character.runway_avatar_id` > `selected_avatar_id` > `host_avatar_id`).
> - `personality` + `startScript` composed from the campaign brief (`_build_session_overrides`).
> - `documentIds: [campaign.runway_document_id]` when memory is attached (RAG).
> - `tools` = the 9-entry `DEFAULT_REALTIME_TOOLS` catalog (line 399), each wrapped as `{type: "client_event", name, description}`.
> - Tiered 400 fallback: drop tools first → drop documentIds → drop overrides → bare body. Campaign context survives the longest.
>
> Browser then opens a WebRTC peer connection via `@runwayml/avatars-react` using the one-shot `sessionKey` JWT.
>
> **2. Operator speaks**
>
> Voice goes up the WebRTC channel to Runway's avatar LLM. The LLM has the campaign personality + grounding doc + tool catalog as context.
>
> **3. Avatar picks a tool**
>
> LLM emits a `client_event` over the data channel: `{type: "client_event", tool: <name>, args: <object>}`. The avatar narrates before invoking (the tool descriptions explicitly force this — `client_event` is one-way, there's no result channel back to the LLM).
>
> **4. Frontend dispatch**
>
> `frontend/src/realtimeTools.js:63` `dispatchRealtimeToolEvent()` switches on tool name. Take the demo-stopper case `auto_write_and_render_long_ad`:
>
> 1. Toast: *"Llama is drafting a LONG ad… ~10 seconds."*
> 2. `POST /api/campaigns/{id}/auto-write-script` with `mode: 'long', spin: prompt` → Ollama (`llama3:latest`) returns a ~1200-char multi-beat script.
> 3. Toast: *"Long script ready, chunking + rendering…"*
> 4. `POST /api/campaigns/{id}/long-spokesperson-ad` with `{script}`.
>
> **5. Backend long-ad pipeline**
>
> `backend/app/services/long_ad_service.py`:
> - `chunk_script()` splits at sentence boundaries into ≤280-char chunks (Runway's `avatar_videos` speech cap is 300).
> - Fires one `/v1/avatar_videos` task per chunk, polls each to completion, downloads each MP4.
> - ffmpeg `filter_complex concat=n=N:v=1:a=1` stitches into `data/finished/{campaign_id}-long-{output_id}.mp4`. Appends an OutputRecord to the campaign.
>
> **6. UI lands the result**
>
> Frontend fires `character-os:refresh-campaigns` (re-fetches list so the new output appears) and `character-os:show-videos` (`SpokespersonWorkspace` flips to the Videos tab). Toast: *"Auto-written long ad rendered — see Videos tab."* The MP4 is playing in front of the operator.
>
> Wall clock: ~3 min from voice command to playable video. The narration during the wait comes from stage-specific toasts the dispatcher fires after each step — the avatar can't see the result, so its job is to acknowledge before invoking and keep the conversation going.

---

## Q3 — Drift test (the hardest test)

**Question:** *"What's been shipped since the SESSION 104 handoff?"*

This is the drift test. The context-kit's last refresh was
SESSION 104 (`dc5144d`), covering PR EM-b → EM-h. Since then,
three PRs landed (EM-i, EM-j, EM-k). The handoff doc does NOT
mention them. A new agent has to reconcile the gap by reading
git directly.

**Setup observed:** new Claude ran `git log --oneline
dc5144d..HEAD` and `git log --stat dc5144d..HEAD`.

**Answer:**

> Three PRs landed since the SESSION 104 handoff (`dc5144d`):
>
> **PR EM-i — `attach_memory_to_campaign` captures the LIVE conversation** (`27384ab`, frontend-only, +39 lines)
> Found mid-test: saying "save what we talked about" was publishing the previous session's summary, not the current one. The dispatcher never called `POST /realtime-transcript`, so the PR EM-c auto-ingest hook had nothing to fire on. Fix: chain now does fetch-transcript → ingest → compose → attach (four steps instead of two). Mid-session 4xx on the transcript fetch is swallowed — worst case falls through to prior behaviour.
>
> **PR EM-j — Warm "welcome back" opener for returning operators** (`13b21c8`, backend-only, +105/-30 lines in `realtime_avatar_client.py`)
> Every realtime session was cold-opening with a first-meeting intro, which broke the persistent-spokesperson pitch. Detects returning operators from two existing Campaign fields (`realtime_transcript_history` non-empty OR `runway_document_id` set) and swaps `startScript` to "Hey, welcome back — it's good to see you again." Also injects a "RETURNING OPERATOR" cue late in the personality string (LLMs weight later instructions higher) and into `_grounded_personality`. First-time visits unchanged.
>
> **PR EM-k — Hackathon submission README + descriptions** (`674c308`, docs-only, +379 lines)
> Prepended a 120-line "Reviewing this with Claude Code?" prologue to README, plus `docs/SUBMISSION_DESCRIPTION.md` (the ~2700-word version you currently have open), a .txt version, and `SUBMISSION_DESCRIPTION_SHORT.txt` (2,379 chars, fits the form's 2500-char cap). Hygiene scan clean. Repo flip-to-public is queued as the next operator-driven step.
>
> Net since SESSION 104: one bugfix (memory loop honesty), one UX feature (returning-operator opener), one submission-readiness docs drop. No backend route count change; frontend bundle 591 KB / 158 KB gz.

---

## Q4 — Multi-layer flow walkthrough

**Question:** *"Walk me through what happens when an operator says 'save what we just talked about'."*

**Setup observed:** new Claude searched 5 patterns.

**Answer:**

> Here's the full chain, end-to-end, when the operator says "save what we just talked about":
>
> **1. Avatar narrates first (Runway → operator)**
>
> Per the tool description in `realtime_avatar_client.py:513`, the avatar's LLM is forced to say something out loud before invoking — e.g. *"Good idea — saving that now so I remember next time we talk…"*. This matters because `client_event` is one-way: no result comes back to the avatar, so it can't narrate post-hoc.
>
> **2. Avatar invokes the tool**
>
> Runway delivers a `client_event` over the WebRTC data channel: `{type: "client_event", tool: "attach_memory_to_campaign", args: {}}`. No script payload — the handler reads campaign + character from the session context.
>
> **3. Frontend dispatch — four chained calls**
>
> `frontend/src/realtimeTools.js:523` runs four steps (this is the PR EM-i shape; pre-fix it was two):
>
> **Step 1** — `fetchRealtimeTranscript(campaign.id, {})` — best-effort.
> Calls `POST /api/campaigns/{id}/realtime-transcript`. Backend `campaigns.py:3478` calls Runway's `GET /v1/avatar_conversations/{conversation_id}` (the realtime `sessionId` doubles as the conversation id, captured at session create), parses turns, appends to `campaign.realtime_transcript_history`. Mid-session 404/409 is swallowed — toast stays quiet, console warns.
>
> Toast surfaces: *"🧠 {character} is capturing this conversation…"*
>
> **Step 2** — `ingestCharacterMemory(characterId, {campaignId})` — synchronous.
> Calls the memory orchestrator. `TranscriptMemorySource` (`memory/orchestrator.py`) reads the freshly-appended history row, runs it through Ollama for a ~280-char summary (`_summarise`), wraps it as a `MemoryEntry` with `source_type='transcript'`, writes it to `JsonMemoryStore` at `data/memory/character-{id}.json`. `OperatorNoteSource` also re-syncs from `character.knowledge_sources`. Failure aborts the chain.
>
> Note: the same ingest also runs as a fire-and-forget background thread off `POST /realtime-transcript` (the PR EM-c auto-ingest hook at `campaigns.py:3393`). So even without the realtime tool, transcripts persist. The tool path forces it synchronously so compose sees fresh data.
>
> **Step 3** — `composeCharacterMemory({publish: true})`
> `RecencyWeightedComposer` packs the store's entries into Markdown, newest-first, sectioned by source type, bounded by a 40K-char budget. With `publish: true`, the orchestrator POSTs the body to Runway's `/v1/documents` (or uses the cached `document_id` if unchanged), returns `{document_id, body_chars, included_count}`.
>
> Toast: *"✓ Published — {N} chars, {M} entries. Attaching to '{campaign}'…"*
>
> **Step 4** — `attachCharacterMemory({campaignId, documentId})`
> Backend writes `runway_document_id` and `runway_document_status='ready'` onto the campaign record.
>
> Toast: *"📎 Memory attached to '{campaign}'. Next realtime session on this campaign will use it as RAG."*
>
> **4. The payoff (next session)**
>
> When the operator next opens a realtime session on this campaign, `create_session()` in `realtime_avatar_client.py:631` sees `campaign.runway_document_id` is set and includes `documentIds: [doc_id]` in the `POST /v1/realtime_sessions` body. Runway's avatar LLM now has the prior conversation summary as RAG context. PR EM-j also detects this as a returning operator and swaps `startScript` to *"Hey, welcome back — it's good to see you again."* plus injects a "RETURNING OPERATOR: do NOT re-introduce yourself" cue into the personality string.
>
> **Failure modes** (each toasts a specific cause)
>
> - No character bound: *"Could not save — no active character bound to this session."*
> - No campaign: *"Could not save — no active campaign to attach memory to."*
> - Step 1 fails: silent (best-effort); chain continues with whatever's already in the store.
> - Step 2 fails: *"Memory ingest failed: {msg}"* — chain aborts.
> - Step 3 returns no document_id: *"Memory publish returned no document_id: {error}"*.
> - Step 4 fails: *"Attach failed. document_id {id} is still uploaded; try again from the Memory tab."* — the document survives so the operator can recover manually.
>
> The whole chain typically takes ~5-10 seconds. The avatar keeps the conversation going during the wait (forbidden from waiting silently per the tool description) and the operator watches three toasts land in sequence.

---

## Q5 — Show me actual data

**Question:** *"Show me the personality string for a returning operator."*

This question tests whether the agent can run real code paths
mentally and produce concrete output — not just describe the logic.

**Answer:**

> Two code paths exist depending on whether a memory document is attached. Both detect "returning" and inject a cue late in the string (Runway's gwm1 weights later instructions higher).
>
> **Path A — Document attached → `_grounded_personality`** (`realtime_avatar_client.py:169`)
>
> This is the slim variant. The RETURNING OPERATOR cue is always appended here, because by definition a document being attached means it's not a first visit.
>
> For a campaign like *CEO Buzz* with Donny Sparks bound:
>
> ```
> You are Donny Sparks, the brand mascot for Donkey Betz. Tone: high-energy founder-mode.
> Speak in your energetic voice. Personality cue: bold, optimistic, founder-grade.
> An attached document carries the facts you should ground every answer in. Defer to its
> contents and cite section names when helpful. Stay concise, warm, and honest. Redirect
> politely if asked something the document does not cover.
> RETURNING OPERATOR: this is NOT your first conversation with them. Open with warm
> familiarity — do NOT introduce yourself again, do NOT recite the business / product /
> audience pitch unprompted. If the attached document carries prior conversation
> summaries, you may briefly reference what you remember to ground the conversation, but
> keep the opener short and let the operator drive what's next.
> ```
>
> **Path B — No document, but transcript history exists → `_build_session_overrides`** (`realtime_avatar_client.py:241`)
>
> The full personality string. `is_returning` flips to True when either `len(transcript_history) > 0` OR `bool(campaign.runway_document_id)` (line 282).
>
> ```
> You are Donny Sparks, the brand mascot for Donkey Betz. The product is AI Spokesperson
> Infrastructure. The audience: indie founders shipping AI products. Tone: high-energy
> founder-mode. Speak in your energetic voice. Personality cue: bold, optimistic,
> founder-grade. Campaign hook: Persistent characters, not one-shot generations.
> Supporting caption: Your spokesperson remembers every conversation. Call to action:
> Try Character OS. Saved commercial script: Character OS is persistent AI spokesperson
> infrastructure — your brand's face, voice, and memory in one reusable character.
> RETURNING OPERATOR: this is NOT your first conversation with them. Open with warm
> familiarity — do NOT introduce yourself again, do NOT recite the business / product /
> audience pitch unprompted. If an attached document carries prior conversation
> summaries, you may briefly reference what you remember to ground the conversation,
> but keep the opener short and let the operator drive what's next.
> Stay concise, warm, and brand-honest. When the user asks about the product or
> audience, answer with the cues above. If asked something unrelated, redirect politely
> back to the campaign.
> ```
>
> **startScript companion** (line 360)
>
> For a returning operator with a character name bound:
> ```
> Hey, welcome back — it's good to see you again. What are we working on today?
> ```
>
> Without a character name:
> ```
> Welcome back — what's on the agenda today?
> ```
>
> **Caps**
>
> - Personality truncated at sentence boundary to `_PERSONALITY_MAX = 9500` chars.
> - startScript capped at `_START_SCRIPT_MAX = 280` chars.
>
> **Notable difference between the two paths**
>
> The grounded variant deliberately omits product/audience/hook/caption/cta/commercial-script — it trusts the attached document to carry that. This was tightened in PR DG so the model doesn't reconcile a mismatch between an inlined sales pitch and a memory document that may be about something else entirely (e.g. the Character OS self-demo build-story doc).

---

## Q6 — Senior-engineer migration design

**Question:** *"If I wanted to swap the JsonMemoryStore for PgVectorMemoryStore, what files would I touch and what's the migration path?"*

This is the "would I hire this codebase" question — would a
senior engineer reading this repo for the first time give a
credible migration plan?

**Answer:**

> Good — no `MEMORY_BACKEND` env switch exists yet, so the swap is a single-line factory change today. Here's the concrete migration path.
>
> **Files you'd touch**
>
> **1. New: `backend/app/services/memory/pg_store.py`**
>
> Add a `PgVectorMemoryStore(MemoryStore)` subclass implementing the eight abstract methods from `store.py:28`. The interface is intentionally small — `add`, `update`, `delete`, `get`, `list`, `search`, `total_chars`, plus the `new_id()` helper. The schema flows directly from `MemoryEntry` in `models.py:35` — every field except `embedding` / `embedding_model` already exists in JSON storage, and those two columns are explicitly designed for this swap:
>
> ```python
> # models.py:71
> embedding: Optional[list[float]] = Field(default=None)
> embedding_model: Optional[str] = Field(default=None)
> ```
>
> Suggested Postgres schema:
>
> ```sql
> CREATE EXTENSION IF NOT EXISTS vector;
> CREATE TABLE memory_entries (
>   id TEXT PRIMARY KEY,
>   character_id TEXT NOT NULL,
>   campaign_id TEXT,
>   source_type TEXT NOT NULL,
>   source_id TEXT,
>   content TEXT NOT NULL,
>   tags JSONB NOT NULL DEFAULT '[]'::jsonb,
>   embedding vector(768),         -- nomic-embed-text dimensions
>   embedding_model TEXT,
>   metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
>   created_at TIMESTAMPTZ NOT NULL,
>   updated_at TIMESTAMPTZ NOT NULL,
>   UNIQUE (character_id, source_type, source_id)  -- enforces add()'s dedupe
> );
> CREATE INDEX ON memory_entries (character_id, updated_at DESC);
> CREATE INDEX ON memory_entries USING ivfflat (embedding vector_cosine_ops);
> ```
>
> In `add()`, generate the embedding via Ollama's `/api/embeddings` (`nomic-embed-text` or `mxbai-embed-large` — both already runnable on the operator's laptop, no new cloud dep). In `search()`, replace the substring-token scoring with `ORDER BY embedding <=> $1` cosine distance.
>
> **2. `backend/app/services/memory/store.py:294` — `build_default_store`**
>
> Make the factory branch on a settings field:
>
> ```python
> def build_default_store(data_dir: Path, settings: Settings) -> MemoryStore:
>     backend = (settings.memory_backend or "json").lower()
>     if backend == "pgvector":
>         from .pg_store import PgVectorMemoryStore
>         return PgVectorMemoryStore(settings.memory_database_url, settings)
>     return JsonMemoryStore(data_dir)
> ```
>
> The lazy import keeps psycopg/pgvector optional — JSON-only deployments don't pay the import cost.
>
> **3. `backend/app/services/memory/orchestrator.py:216`**
>
> Pass settings through:
> ```python
> store = store or build_default_store(settings.data_path, settings)
> ```
>
> **4. `backend/app/settings.py` — add two fields**
>
> ```python
> memory_backend: str = "json"              # "json" | "pgvector"
> memory_database_url: Optional[str] = None # postgresql://user@host/db
> ```
>
> **5. `backend/app/services/memory/composer.py` — optional Phase 3 upgrade**
>
> Drop in `QueryWeightedComposer(MemoryComposer)` (already telegraphed at `composer.py:12`). Same interface as `RecencyWeightedComposer`; instead of sorting by `updated_at`, take a query embedding and call `store.search(query, ...)` to rank by semantic similarity before packing into the 40K-char budget. Pass it explicitly to `build_orchestrator(composer=QueryWeightedComposer())` when you want query-grounded composition for memory documents.
>
> **6. `backend/app/services/memory/__init__.py`**
>
> Re-export `PgVectorMemoryStore` so callers can `from app.services.memory import PgVectorMemoryStore` for tests.
>
> **7. `backend/tests/test_memory.py`**
>
> The existing 16 tests run against the abstract interface. Add a parametrized fixture that runs the same suite against `PgVectorMemoryStore` using a `pytest-postgresql` or `testcontainers`-backed fixture. The point of the abstract-base design is that the same assertions hold for both backends.
>
> **8. `backend/pyproject.toml` (or requirements.txt)**
>
> Add `psycopg[binary]>=3.2` + `pgvector>=0.3`. Mark them as an optional `[memory-pgvector]` extra so JSON-only installs stay light.
>
> **9. `.env.example` + `CLAUDE.md`**
>
> Document `MEMORY_BACKEND=pgvector` + `MEMORY_DATABASE_URL=...`. Mention that pgvector requires `CREATE EXTENSION vector` privileges on the database.
>
> **What you do NOT touch**
>
> - The 5 memory routes in `backend/app/routers/campaigns.py` — they call the orchestrator, never the store directly. The PR EM-i flow (fetch transcript → ingest → compose → attach) is store-agnostic.
> - The 2 realtime tools (`recall_recent_conversations`, `attach_memory_to_campaign`) — they hit the routes via `api.js`, no awareness of storage backend.
> - The Memory tab frontend — same routes, same payloads.
> - `MemoryEntry` — already carries `embedding` + `embedding_model` fields. JSON entries written today are forward-compatible.
> - The auto-ingest hook at `campaigns.py:3393` — works identically against either backend.
>
> **Migration steps for existing data**
>
> 1. Stand up Postgres with the pgvector extension on the operator's box (or a managed Postgres + pgvector — Supabase / Neon both work).
> 2. Run the schema DDL above.
> 3. Write a one-shot migration script at `backend/scripts/migrate-memory-to-pgvector.py`:
>    - Open every `data/memory/character-*.json` file.
>    - For each entry, generate the embedding via Ollama (`embeddings.embed(content)`).
>    - `INSERT ... ON CONFLICT (character_id, source_type, source_id) DO UPDATE` into Postgres.
>    - This is idempotent — re-running picks up new entries without duplicating.
> 4. Flip the env: `MEMORY_BACKEND=pgvector` + `MEMORY_DATABASE_URL=postgresql://...`
> 5. Restart backend; the orchestrator singleton picks up the new factory wiring on first `get_orchestrator()` call.
> 6. Smoke-test: hit `GET /api/characters/{id}/memory` against an existing character. Counts should match the JSON file row counts.
> 7. Keep the JSON files as a fallback for one operator cycle, then archive them.
>
> **Why this is genuinely one new class**
>
> Three things make the swap clean:
>
> 1. `MemoryStore` is a real ABC, not a duck type. Every method signature is fixed at `store.py:43-86`. The compiler enforces the contract.
> 2. `MemoryEntry` already has `embedding` / `embedding_model` fields. `JsonMemoryStore` ignores them; `PgVectorMemoryStore` populates them. Same row shape on disk and in pg.
> 3. The dedupe key `(character_id, source_type, source_id)` is already enforced in `add()` (`store.py:173`). Translating that to a Postgres UNIQUE constraint preserves behavior.
>
> The only behavioral difference an end user would notice: `recall_recent_conversations` with a query arg goes from substring-token scoring to true semantic ranking. Everything else is identical. That's the point of the architecture.

---

## Observations

What the six answers proved, beyond "it summarized the README":

1. **File:line citations are pervasive.** Every claim is grounded
   in a specific line. `realtime_avatar_client.py:593`, `:169`,
   `:241`, `:282`, `:360`, `:513`, `:631`; `realtimeTools.js:63`,
   `:523`; `campaigns.py:3478`, `:3393`; `store.py:28`, `:173`,
   `:43-86`, `:294`; `models.py:35`, `:71`; `orchestrator.py:216`;
   `composer.py:12`. The agent didn't paraphrase — it read.

2. **Cross-file reasoning works.** Q4 traced a chain through five
   files (`realtimeTools.js` → `campaigns.py` → `memory/orchestrator.py`
   → `memory/store.py` → back to `campaigns.py` for the auto-
   ingest hook). The agent followed call graphs, not file boundaries.

3. **Drift was handled by reading git directly.** Q3 was the
   make-or-break test. The handoff doc the README anchors at was
   3 commits stale. The agent's first move was
   `git log --oneline dc5144d..HEAD` — exactly the right
   reconciliation step. Then it `git log --stat`'d to summarize
   the diffs by line count.

4. **Historical decisions survived.** Q5 surfaced PR DG's
   rationale (why `_grounded_personality` deliberately omits
   product/audience/hook) — that's not in inline code comments,
   it's in the SESSION handoff for PR DG. The session handoff
   docs paid out as durable design memory.

5. **Real data, not placeholders.** Q5's example personality
   string used "Donny Sparks / Donkey Betz / CEO Buzz" — values
   from `data/campaigns.json`, not invented names. The agent
   read the campaign data to ground its example.

6. **Operational nuance.** Q6's lazy-import-inside-factory move,
   the `[memory-pgvector]` optional extra, the
   `ON CONFLICT ... DO UPDATE` for idempotent migration, the
   "keep JSON files as a fallback for one operator cycle" — these
   are senior-eng operational habits, not LLM defaults.

7. **Architecture-defending arguments.** Q6's closer "Why this is
   genuinely one new class" argued backwards from the ABC
   contract + the forward-compatible `embedding` field design +
   the dedupe key portability. The agent wasn't just describing
   the migration — it was *defending the submission's
   architectural claim* with evidence the architecture choice
   itself produced.

## Why this file exists

The submission video angle most hackathon entries take is "watch
this demo." Character OS's angle is "interrogate this repo." This
transcript is evidence that the differentiator works: not because
this codebase is special, but because the **context-kit + handoffs
+ ABC-first architecture** form an AI-readable substrate that a
cold-start agent can exploit immediately.

A judge with Claude Code who clones the repo on May 18 gets *this*
experience. Anyone who reproduces the questions above with a
freshly-cloned `claude` session in the repo root should get
substantively similar answers — modulo whatever PRs landed since
this transcript was captured.
