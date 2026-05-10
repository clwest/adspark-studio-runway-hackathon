# SESSION 087 — PR DD Context-Kit Realtime Grounding

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `1605ed3` (`feat: ad variants — separate
campaign context from mutable scripts (PR DC)`). PR DD patch in
flight on top; commit + push pending operator approval after this
handoff lands.

**Why this slice ran:** Earlier in the session we researched whether
context-kit anchors (`docs/WHAT_IT_IS.md`, `00-START-NEXT-SESSION.md`,
`docs/INVENTORY.md`, `docs/handoffs/SESSION_*`) could be fed into a
spokesperson so the avatar could answer "How was this project built?"
The finding: PR AI's `/realtime-document` route is the only surface
that grounds the live realtime avatar, but it filters content through
`build_campaign_brief_markdown` — a brief-shape that compresses
documentation prose into bullets. The Character `KnowledgeSource[]`
list (PR CX) is UI-only and doesn't reach the avatar. Path B from
that research: add a tiny additive raw route + a repo-side upload
helper. This PR implements exactly that, scoped tight.

## What changed

### Backend route (additive, 1 new endpoint)

`POST /api/campaigns/{campaign_id}/realtime-document/raw`

Sibling to the existing `/realtime-document` (PR AI). Accepts:

```python
class RawRealtimeDocumentBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1)
```

Behaviour:

1. 404 if campaign missing.
2. 422 if `name` or `content` is whitespace-only (Pydantic's
   `min_length=1` already rejects empty strings; the route's
   `.strip()` check catches whitespace-only payloads before they
   reach the documents client and surface as a 502).
3. Calls existing `runway_create_document(name, content, settings)`
   from `documents_client.py` — internally trims to
   `DOCUMENT_MAX_CHARS=40_000`.
4. On failure: persist failed state via
   `update_realtime_document_fields` + raise 502 (matches existing
   route).
5. On success: persist `runway_document_id` + `status` + `error=None`
   + `mock_mode` on the Campaign + return updated Campaign.

### Why no avatar PATCH

The existing structured route does a best-effort
`PATCH /v1/avatars/{id}` so direct-against-avatar sessions inherit
the brief. PR DD's raw route deliberately omits this: avatars are
often shared across campaigns, and PATCH'ing context-kit project docs
onto the avatar would leak project documentation into unrelated
campaigns. Grounding stays strictly per-session via the broker's
`documentIds` injection.

### Route URL — note on naming

The brief named this route `POST /api/campaigns/{id}/attach-realtime-document/raw`.
The existing PR AI route is at `/realtime-document` (not
`/attach-realtime-document`); the brief's path was carried over from
an earlier memory note that misnamed PR AI's route. Implemented as
`/realtime-document/raw` to match the actual codebase pattern as a
sibling. If the brief's literal path is preferred, this is a one-line
change.

### Companion script

`scripts/upload-context-kit-demo-grounding.py` — stdlib-only, no
extra deps, runs from the repo root.

**Files included** (in order, concatenated with `## File: <path>`
section headers so the avatar can cite sources):

1. `docs/WHAT_IT_IS.md` — full file (~16.5k chars).
2. `00-START-NEXT-SESSION.md` — head only (6k cap).
3. `docs/INVENTORY.md` — head only (8k cap).
4. Latest 2 numbered handoffs from `docs/handoffs/SESSION_NNN_*.md`
   by mtime (each 8k cap).

The assembled payload is trimmed to 40k chars (matches the documents
client's `DOCUMENT_MAX_CHARS`) at a paragraph boundary when possible,
with a `[truncated to 40k chars]` marker on the tail.

**The `\n\n` trim bug:** `_head_only` originally used
`text.rfind("\n\n", 0, max_chars)` which landed at ~30 chars for both
START and INVENTORY (both files have a title + blank + one very long
paragraph; the only `\n\n` in the first 6k chars is the title break).
Fixed: require the cut to be at least 50% of `max_chars` before
accepting; fall back to single-`\n` then to a hard slice.

**CLI:**

```bash
python scripts/upload-context-kit-demo-grounding.py \
    --campaign-id <id> [--base-url URL] [--name DOC_NAME] [--dry-run]
```

`--dry-run` prints the manifest + raw section total + final trimmed
size + first 500 chars; no HTTP. Real run POSTs and prints the
returned `runway_document_id` / `status` / `mock_mode`.

### Demo checklist

`docs/DEMO_CHECKLIST.md` got a new Section 6 — "Context-Kit
Self-Demo" — covering the optional "How was this project built?"
walkthrough: create a dedicated `How Character OS Was Built`
campaign, run the upload script, open the Conversations tab, ask
about project history.

### Tests

Four new pytests in `backend/tests/test_create_avatar_mock.py`
(same file the PR CY / PR CX / PR DC tests live in):

- `test_realtime_document_raw_round_trip` — happy path; mock-mode
  returns `runway_document_status="mock"` + a `mock_doc_<sha>` id
  + `mock_mode=True`. Re-attaching with different content yields a
  new deterministic id (sha256 of `name + "\n" + content`).
- `test_realtime_document_raw_404_when_campaign_missing` — 404 for
  unknown campaign id.
- `test_realtime_document_raw_validation` — Pydantic 422 on empty
  `name` or empty `content`; route 422 on whitespace-only `content`
  with `"non-empty"` in the detail.
- `test_realtime_document_raw_truncates_to_40k` — POSTs 60k chars,
  reproduces the expected `mock_doc_<sha>` id from the trimmed
  content (`oversized.strip()[:DOCUMENT_MAX_CHARS]`) and asserts
  identity — proves the 40k trim happens before the hash digest.

## Files changed

```
 backend/app/routers/campaigns.py                              | +106
 backend/tests/test_create_avatar_mock.py                      | +110
 docs/DEMO_CHECKLIST.md                                        |  +46
 scripts/upload-context-kit-demo-grounding.py                  | new (~245 LoC)
 00-START-NEXT-SESSION.md                                      | (head pointer)
 docs/INVENTORY.md                                             | (PR DD block)
 docs/handoffs/SESSION_087_CONTEXT_KIT_GROUNDING_PR_DD.md      | new
```

Backend route layer: **75 → 76**.

Untouched:
- `/legacy` (per brief)
- Realtime broker (`realtime_avatar_client.py`)
- All models (`models.py`)
- Storage (`storage.py`) — reuses `update_realtime_document_fields`
- Frontend — no UI changes; the workspace already surfaces
  grounded-document state on the campaign record via existing
  PR AI plumbing
- The existing structured `/realtime-document` route — unchanged
- `KnowledgeSource[]` — unchanged (still UI-only by design)
- The new ad-variant model from PR DC — unchanged

## Verification

| Check | Result |
|---|---|
| Backend route count | **76** (+1 vs PR DC) |
| Backend pytest | **28/28 passed (~1.25s)** — 24 prior + 4 new PR DD tests |
| `vite build` | not run (no frontend touched) |
| Mock smoke | not run (no UI changes; would have killed the operator's running real-mode backend with no PR-DD-specific value) |
| Script `--dry-run` | files included: 5; raw section total 45,723 chars; final payload 39,898 chars; tail-section trimmed at 40k boundary; preview clean |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` (1 commit since touch, threshold 5) |
| Real-mode startup | running pid 22537, `runway_mock=false` |
| Real Runway document upload fired | **0** — awaiting explicit operator approval per project rule. Mock-mode path validated via pytest |

### Script dry-run output (captured 2026-05-10)

```
Files included:
  - docs/WHAT_IT_IS.md  (16,514 chars)
  - 00-START-NEXT-SESSION.md  (5,948 chars)
  - docs/INVENTORY.md  (7,969 chars)
  - docs/handoffs/SESSION_086_AD_VARIANTS_PR_DC.md  (7,313 chars)
  - docs/handoffs/SESSION_085_DEMO_STABILIZATION_PR_DB.md  (7,979 chars)

Raw section total: 45,723 chars
Final payload:     39,898 chars (cap 40,000)
Tail section trimmed at 40k boundary (marker appended).
```

### Live backend note

The currently-running backend (pid 22537, started before this PR
landed) does **not** have the new route loaded — uvicorn is running
without `--reload`. Operator should restart with
`bash scripts/start-local-real.sh` to pick up the new route before
running the upload script for real.

## Exact demo steps (after restart + commit)

1. `bash scripts/start-local-real.sh` — picks up the new route +
   confirms `runway_mock=false`.
2. Open `http://localhost:5173/` → click Donny (or any spokesperson
   with a ready Runway avatar) → **Campaigns** tab.
3. `+ New Campaign` → **🎙️ Spokesperson Ad**. Fill:
   - Business: `AdSpark Studio`
   - Product: `Persistent AI spokesperson infrastructure`
   - Audience: `Hackathon judges`
   - Tone: `Honest, technical, brief`
   - Save brief.
4. Note the new campaign id from the URL or list row.
5. In a terminal:
   ```bash
   python scripts/upload-context-kit-demo-grounding.py \
       --campaign-id <id> --dry-run
   ```
   Confirm 5 files included, ~40k chars final payload, preview reads
   cleanly.
6. Real upload (this fires one real `POST /v1/documents`):
   ```bash
   python scripts/upload-context-kit-demo-grounding.py \
       --campaign-id <id>
   ```
   Expected: `runway_document_status: ready`, a real UUID-looking
   `runway_document_id`.
7. Back in the browser, click the dedicated campaign →
   **Conversations** tab → **Start Conversation**.
8. After the avatar greets, ask any of:
   - "How was this project built?"
   - "What does context-kit do?"
   - "What changed during the hackathon?"
   - "What is PR AI?" / "What is PR DC?" (testing handoff coverage)
9. The avatar should ground in the uploaded Markdown and cite source
   filenames (e.g. `docs/WHAT_IT_IS.md`, `SESSION_086_*.md`).
10. End conversation cleanly.

To refresh after new PRs land: re-run the script. Each upload
replaces the campaign's `runway_document_id`.

## Remaining work / future PRs

- **Real upload validation.** Pending operator approval. The
  pytest-validated mock path exercises every code path; the
  remaining unknown is just whether Runway accepts ~40k chars of
  mostly-Markdown content end-to-end.
- **Optional: surface "Document grounded by: context-kit"** badge
  on the Conversations tab. PR AI already has a "grounded" indicator;
  PR DD inherits it for free since both routes write the same fields.
  No UI change needed unless we want to distinguish raw-grounded vs
  brief-grounded.
- **Optional: per-PR refresh hook.** A pre-commit / pre-push hook
  that re-runs the upload script against a known demo campaign would
  keep context-kit grounding always current. Easy add but
  out-of-scope here.

## Server status (final)

Real-mode backend was already running when this slice started and
remains running:

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false · openai_mock=true
vite:    not probed (no frontend changes)
```

Restart the backend with `bash scripts/start-local-real.sh` before
running the upload script in real mode — the running process
predates the new route.
