# SESSION 104 — Memory Phase 2 + Conversation UX + Handoff (PR EM-b → PR EM-h)

**Date:** 2026-05-11 (continuation of the submission push)
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` — nine commits layered on SESSION 103's `2e83c95`
**Triggered by:** PR EM-a shipped the memory foundation; this session
wired it into real surfaces (routes, UI, auto-ingest, realtime tools)
**and** polished the conversation experience that consumes it.

> *"Make sure that you are maintaining context-kit since we are
> bouncing all over the place right now lol"* — Chris

This session covers **two interleaved arcs** that landed across nine
commits on top of `2e83c95` (SESSION 103). Arc 1 finishes the memory
pipeline plumbing — Phase 2 of the PR EM-a roadmap. Arc 2 polishes
the realtime conversation surface and adds a character-to-character
handoff tool so avatars can swap mid-call.

---

## Commit timeline (post-SESSION-103)

| Commit | PR | Summary |
|---|---|---|
| `0774522` | EM-b | Memory routes + Memory tab on the Identity workspace |
| `473ed5d` | EM-c | Auto-ingest hook on realtime transcript fetch |
| `8ae4880` | EM-d | One-click attach published memory document to a campaign |
| `6568610` | EM-e | Avatar tools `recall_recent_conversations` + `attach_memory_to_campaign` |
| `fdd2b7a` | EM-e2 | Fallback to `campaign.character_id` when char prop is null (race fix) |
| `2f26f96` | EM-e3 | Realtime READY timeout 30 → 60s + last-status diagnostic |
| `c955c83` | EM-f | Zoom-style fixed overlay for the live conversation surface |
| `c5b84bc` | EM-g | `handoff_to_character` realtime tool (avatar-to-avatar handoff) |
| `fe771fd` | EM-h | READY cap 60 → 150s + force-narrate tool descriptions |

---

## Arc 1 — Memory pipeline (PR EM-b → EM-e)

### PR EM-b — Routes + Memory tab (`0774522`)

The PR EM-a foundation already exposed `MemoryOrchestrator`. PR EM-b
mounted it on the API + gave it a UI:

- 5 new routes on `backend/app/routers/characters.py`:
  - `GET    /api/characters/{id}/memory` — list entries, filter by
    `source_type` / `campaign_id`
  - `POST   /api/characters/{id}/memory/ingest` — fire every
    registered source, return per-source counts
  - `DELETE /api/characters/{id}/memory/{entry_id}` — operator cleanup
  - `POST   /api/characters/{id}/memory/compose` — preview the
    composed Markdown body (with optional `publish=true` to upload
    as a Runway document)
  - `POST   /api/characters/{id}/memory/attach` — attach a published
    document to a campaign (sets `runway_document_id` +
    `runway_document_status='ready'` on the Campaign so the next
    realtime session reads it as RAG)
- New `<MemoryPanel>` component at `frontend/src/components/MemoryPanel.jsx`
  with budget bar, source-type filter chips, compose preview surface,
  publish + attach buttons, per-entry delete
- New tab "Memory" in `SpokespersonWorkspace` between Knowledge and
  Campaigns

Backend route count: **79 → 84** (5 added).

### PR EM-c — Auto-ingest hook on transcript fetch (`473ed5d`)

`POST /api/campaigns/{id}/realtime-transcript` (PR AJ) now fires
`MemoryOrchestrator.ingest_from_all_sources` in the background
**after** a successful transcript fetch — so by the time the operator
clicks End Conversation, the new `TranscriptMemorySource` summary is
already persisted. Implemented as a `_trigger_memory_ingest_background`
shim using FastAPI's BackgroundTasks; non-fatal on failure.

### PR EM-d — One-click attach (`8ae4880`)

PR EM-b shipped compose + publish + attach as three separate routes;
the Memory tab originally required two button clicks (Preview → Publish
→ Attach). PR EM-d wrapped that into the `POST /memory/attach` route
and the Memory tab's single **"Publish & attach to campaign"** button.

### PR EM-e — Memory-aware realtime tools (`6568610`)

Added two tools to `DEFAULT_REALTIME_TOOLS`:

- `recall_recent_conversations` — operator says *"what have we talked
  about?"*; handler calls `GET /memory?source_type=transcript`, toasts
  up to 5 matches (optionally filtered by a topic query)
- `attach_memory_to_campaign` — operator says *"save what we just
  talked about"*; handler chains compose → publish → attach in one
  call, narrated by progress toasts

Tool catalog count: **6 → 8**.

### PR EM-e2 — Race fix (`fdd2b7a`)

The realtime session fires `client_event` tools faster than the
character record loads in some paths (the `RealtimeSpokesperson`
component doesn't receive `character` from `ConversationsTab` in the
v2 workspace). Both memory tools now fall back to
`campaign.character_id` — the campaign always carries it — so the
race doesn't toast "no active character".

### PR EM-e3 — Diagnostic timeout (`2f26f96`)

Bumped `_READY_POLL_TIMEOUT_S` 30 → 60s and added the
`last_seen_status` + `poll_count` diagnostic to the error toast so
the operator can distinguish "Runway is slow" (stuck on NOT_READY for
60s) from "Runway is broken" (no status info at all). This bump
turned out to be insufficient — see PR EM-h.

---

## Arc 2 — Conversation UX + Handoff (PR EM-f → EM-h)

### PR EM-f — Zoom-style overlay (`c955c83`)

Before: the `<AvatarCall>` mounted **inline** in the Conversations
tab and pushed everything below it further down the page. Mid-call
the operator was looking at the avatar with the campaigns list /
demo readiness panel visible beneath it — broke focus during what's
supposed to be a face-to-face conversation.

After: when `phase === 'live'`, the avatar mounts inside a new
`RealtimeOverlay` sub-component (fixed-position, `inset-0`, dim
backdrop, body scroll locked). Three zones:

1. Top bar — spokesperson name + countdown pill + close button
2. Stage — centered `max-w-3xl` avatar tile
3. Right side panel (collapsible via "Tips ▾") — prompt chips +
   mic tips + memory-aware command hints
4. Bottom controls — End Conversation button

End Conversation closes the overlay and returns to the underlying
tab. Lives at `frontend/src/components/RealtimeSpokesperson.jsx`
lines 354-478.

### PR EM-g — Character-to-character handoff (`c5b84bc`)

New realtime tool `handoff_to_character`. Avatar says *"Riggs Rally
is the one who handles fitness coaching, let me hand you to him
now"*, invokes the tool with `character_name: 'Riggs'`; the
frontend dispatcher resolves the name to a Character record (exact
match → substring → id), validates the target has a ready Runway
avatar AND owns at least one campaign, fires a `HANDOFF_EVENT` window
event, and the `SpokespersonWorkspace` listener navigates to
`/spokespeople/{id}?tab=conversations&campaign={id}&autostart=1`.

URL param consumption auto-switches the tab, selects the target's
most recently updated campaign, and lifts a `pendingAutostart`
flag that `<RealtimeSpokesperson>` reads to fire `handleStart()`
exactly once (`onAutostartConsumed` callback prevents loops).

Tool catalog count: **8 → 9**.

### PR EM-h — Real timeout cap + force-narrate descriptions (`fe771fd`)

Two related fixes against the same root cause: avatars going silent
on hackathon-day Runway congestion.

1. **Timeout 60 → 150s.** Verified with campaign `0a52aef38809` /
   session `fd579a9a-06ef-41f4-acb7-dd852465d413`: 96 polls of
   NOT_READY across the full 60s window. Runway's dev API is stuck
   under last-day load; 150s gives upstream room to flip without an
   operator re-click. The cap is irrelevant when Runway is healthy
   (first poll returns READY).

2. **Force-narrate tool descriptions.** Symptom: operator asked
   Donny *"what have we talked about?"* → `recall_recent_conversations`
   fired correctly, toasts surfaced "Donny recalls 1 conversation"
   with the saved summary, but the avatar itself went silent.

   Root cause: Runway's `client_event` tool path is **one-way**. The
   SDK delivers the avatar's tool invocation to our dispatcher, but
   Runway provides no mechanism to deliver the tool result back to
   the avatar's LLM. So the avatar has no feedback to narrate *after*
   the call — it must narrate *before*.

   The four fire-and-forget tools (`recall_knowledge`,
   `recall_recent_conversations`, `attach_memory_to_campaign`,
   `handoff_to_character`) now carry explicit guidance in their
   description:
   - "CRITICAL: this tool is fire-and-forget — you will NOT receive
     a response."
   - "Before invoking, SAY ALOUD what you're about to do (e.g.
     'Let me check what we talked about last time…')."
   - Sample phrases for each tool
   - "After invoking, keep the conversation going — DO NOT wait
     silently for a result."

   The four render tools (`render_spokesperson_ad` family) don't
   need this — they already had narration prompts baked in from
   PR EE.

---

## What's now live (current state, end of session 104)

### Backend
```
backend: http://localhost:8000 · runway_mock=false · llm_provider=ollama
         llm_model=llama3:latest · 84 application routes (was 79 at SESSION 103)
realtime tools advertised: 9 (was 6 at SESSION 103)
memory routes: 5 (GET list, POST ingest, DELETE entry, POST compose,
                   POST attach)
realtime READY cap: 150s (was 30s at SESSION 102, 60s briefly at EM-e3)
```

### Frontend
```
vite: http://localhost:5173 · build 590.87 kB · gzip 158.05 kB
Memory tab live on SpokespersonWorkspace between Knowledge and Campaigns
Conversations tab uses Zoom-style overlay (body scroll locked)
RealtimeSpokesperson accepts `autostart` / `onAutostartConsumed` props
SpokespersonWorkspace listens for HANDOFF_EVENT + consumes URL params
  (?tab=conversations&campaign=…&autostart=1)
```

### Realtime tool catalog (9 entries in `DEFAULT_REALTIME_TOOLS`)

| Tool | Wire shape | Narration guidance |
|---|---|---|
| `recall_knowledge` | fire-and-forget | force-narrate (PR EM-h) |
| `render_spokesperson_ad` | fire-and-forget | already narrated (PR EE) |
| `auto_write_and_render_ad` | fire-and-forget | already narrated (PR EK) |
| `render_long_spokesperson_ad` | fire-and-forget | already narrated (PR EK) |
| `auto_write_and_render_long_ad` | fire-and-forget | already narrated (PR EK) |
| `show_videos_tab` | fire-and-forget | n/a (instant UI) |
| `recall_recent_conversations` | fire-and-forget | force-narrate (PR EM-h) |
| `attach_memory_to_campaign` | fire-and-forget | force-narrate (PR EM-h) |
| `handoff_to_character` | fire-and-forget | force-narrate (PR EM-h) |

---

## What's parked

### Phase 3 — Semantic memory (post-submission, unchanged from SESSION 103)

- `PgVectorMemoryStore` — Postgres + pgvector. Same `MemoryStore`
  interface; embeddings via Ollama `nomic-embed-text`; cosine
  similarity replaces substring scoring
- `QueryWeightedComposer` — semantic ranking instead of pure recency
- Runway documents PATCH path — update an existing document rather
  than re-uploading the whole body when memory grows
- LLM-extracted facts source — after an ad renders, scan the script
  for new claims, persist as `auto_extracted` entries

### Tool result delivery (post-submission, NEW finding from EM-h)

Runway's `client_event` path is one-way today. If Runway adds a
`server_event` or `tool_result` channel in a future API version,
the four fire-and-forget tools could deliver their results back to
the avatar's LLM and the "force narrate before" mitigation becomes
optional. Worth probing the next Runway API version with a
diagnostic script.

---

## Cross-references

- SESSION 103 (memory foundation + submission video):
  `docs/handoffs/SESSION_103_SUBMISSION_VIDEO_AND_MEMORY_FOUNDATION_PR_EL_EM.md`
- SESSION 102 (the submission push proper):
  `docs/handoffs/SESSION_102_LOCAL_LLM_REALTIME_AGENT_PR_DS_TO_EK.md`
- Memory module: `backend/app/services/memory/`
- Memory routes: `backend/app/routers/characters.py` (lines 995-…)
- Memory UI: `frontend/src/components/MemoryPanel.jsx`
- Realtime overlay + autostart: `frontend/src/components/RealtimeSpokesperson.jsx`
- Realtime tool catalog: `backend/app/services/realtime_avatar_client.py`
  (`DEFAULT_REALTIME_TOOLS`, lines 338-466)
- Realtime tool dispatcher: `frontend/src/realtimeTools.js`

---

## Sentence from the operator, for the record

After landing the memory loop and seeing the first persisted
conversation summary surface:

> *"I can see it! There's the conversation I had about wanting a
> video made!"*

After the timeout-bump round trip and tool-description tightening
on the last day of the hackathon:

> *"commit this and i'll test. Make sure that you are maintaining
> context-kit since we are bouncing all over the place right now lol"*

Context-kit is maintained. Ship it.
