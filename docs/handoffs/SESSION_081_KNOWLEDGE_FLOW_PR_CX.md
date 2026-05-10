# SESSION 081 — PR CX Minimum Viable Knowledge Flow

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CX patch in flight on top of
`d9e556c` `fix: replace concatenated portrait templates
with clean composer (PR CW)`; commit + push pending
after this handoff lands)

**Why this slice ran:** Final-day demo prep. The
Knowledge tab was the last tab still rendering a
`<TabComingSoon>` placeholder ("Knowledge sources will
appear here.") — the product gap that prevented the
demo from showing how a spokesperson learns about a
brand / product. PR CX gives operators a real
knowledge surface: paste-only, persisted, surfaced
next to the script editor.

## What changed

### Backend — Knowledge model + 2 routes

- New `KnowledgeSource` Pydantic model (`models.py`) +
  `KnowledgeSourceCreate` request body. Fields:
  `id` (12-char hex generated server-side), `title`
  (1–120 chars, required), `source_type`
  (`brand_note` / `product` / `audience` / `offer` /
  `campaign_fact` / `other`, default `brand_note`),
  `content` (1–8000 chars, required), `created_at`,
  `updated_at`.
- New `Character.knowledge_sources: list[KnowledgeSource]`
  field (default empty). Capped at 20 entries by the
  store helper to keep `characters.json` bounded.
- New `CharacterStore.append_knowledge_source(...)` and
  `delete_knowledge_source(...)` helpers (atomic
  read–write under the existing threading lock).
- New routes:
  - `POST /api/characters/{id}/knowledge` — append
    one source. Returns the updated `Character`.
  - `DELETE /api/characters/{id}/knowledge/{source_id}`
    — remove one source. Returns the updated
    `Character`.
- Backend route count **71 → 73**.

### Frontend — Knowledge tab + lane reference panel

- New `frontend/src/components/KnowledgePanel.jsx` —
  the Knowledge tab UI:
  - Header with `+ Add Knowledge Source` CTA + 1-line
    summary (`N saved sources available to campaigns…`
    when populated, or `Teach Donny about a product,
    business, offer, or brand voice. Campaign scripts
    can use this context later.` on empty).
  - Inline form with three fields (title /
    source-type select / content textarea) +
    `Save source` / `Cancel` buttons. Save POSTs to
    the backend route + propagates the updated
    record up to the workspace.
  - Saved-source list: title + type pill +
    `saved · available to campaigns` status pill +
    short content preview (≤280 chars) + `delete`
    affordance + relative-time line.
  - Empty-state copy (per spec): `No sources yet.
    Click + Add Knowledge Source above to give …
    something to reference.`
- `SpokespersonWorkspace.jsx` — replaced the
  Knowledge `<TabComingSoon>` mount with the new
  `<KnowledgePanel>`. `onCharacterChanged` callback
  merges the updated record into the local
  `characters` slice so the lane re-renders against
  the new knowledge_sources list without re-fetching.
- `SpokespersonLane.jsx` Step 2 — new
  `<details>` reference disclosure rendered when the
  active spokesperson has at least one saved
  knowledge source. Summary reads `N knowledge
  source(s) available — open for reference`. Expands
  to show up to 5 sources (title + 200-char preview)
  inline above the script CTA. Operator can read
  while typing the script — no auto-injection, no
  fake RAG.
- `api.js` — `addCharacterKnowledge` +
  `deleteCharacterKnowledge` helpers wrapping the
  two new routes.

### Tests

- `backend/tests/test_create_avatar_mock.py` — four
  new pytests:
  - `test_knowledge_source_round_trip` — add a
    source, confirm the response carries it,
    re-fetch via `GET /api/characters/{id}` to
    confirm disk persistence, then DELETE cleanly.
  - `test_knowledge_source_404_when_character_missing`
    — POST against a non-existent character id
    raises 404.
  - `test_knowledge_source_404_when_source_missing`
    — DELETE against a non-existent source id
    raises 404.
  - `test_knowledge_source_validation` — empty
    title or empty content both raise 422.

## Files changed

```
 backend/app/models.py                              | 35 ++++++++++
 backend/app/routers/characters.py                  | 63 +++++++++++++++++-
 backend/app/services/character_store.py            | 49 ++++++++++++++
 backend/tests/test_create_avatar_mock.py           | 76 +++++++++++++++++
 frontend/src/api.js                                | 13 ++++
 frontend/src/components/SpokespersonWorkspace.jsx  | 21 ++++--
 frontend/src/components/lanes/SpokespersonLane.jsx | 53 ++++++++++++-
 frontend/src/components/KnowledgePanel.jsx (new)
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR CX block)
 docs/handoffs/SESSION_081_KNOWLEDGE_FLOW_PR_CX.md (new)
```

## Backend route / model changes

- New `KnowledgeSource` + `KnowledgeSourceCreate`
  Pydantic models.
- New `Character.knowledge_sources` field (default
  empty).
- New routes: `POST /api/characters/{id}/knowledge`,
  `DELETE /api/characters/{id}/knowledge/{source_id}`.
- Backend route count **71 → 73**.

## Exact Knowledge tab UX

```
┌── Knowledge ──────────────────────[ + Add Knowledge Source ]──┐
│  N saved sources available to campaigns. The lane shows them │
│  next to the script editor for reference.                    │
│  (or, when empty: Teach Donny about a product, business,     │
│  offer, or brand voice. Campaign scripts can use this        │
│  context later.)                                             │
└──────────────────────────────────────────────────────────────┘

[ inline form when adding ]
┌───────────────────────────────────────────────────────────────┐
│  SOURCE TITLE *                                              │
│  [_________________________________________________________] │
│  SOURCE TYPE                                                 │
│  [ Brand note ▾ ]                                            │
│  CONTENT *  · 0/8000                                         │
│  [_________________________________________________________] │
│  [ Save source ] [ Cancel ]                                  │
└───────────────────────────────────────────────────────────────┘

[ saved-source list ]
┌─ CEO Buzz brand voice  [Brand note]   saved · available  delete ┐
│  Punchy, fast-talking, energy-drink confidence. Catchphrases:  │
│  'Let's get loud' / 'One click. You're in.'                    │
│  142 chars · added 12s ago                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Lane integration

When the active spokesperson has at least one saved
knowledge source, the Spokesperson lane's Step 2 ·
Script card mounts a small `<details>` element above
the script CTA:

```
Step 2 · Script
[ ▸ 1 knowledge source available — open for reference ]
   ┌─ CEO Buzz brand voice ─────────────────────────────┐
   │ Punchy, fast-talking, energy-drink confidence...  │
   └────────────────────────────────────────────────────┘
[ + Save script ]   ← unchanged from PR CU
```

Up to 5 sources rendered inline; an overflow line
("+ N more in Knowledge tab") appears above 5. **No
auto-injection** — operators copy/paste from the
disclosure into the script textarea or type fresh.
That's per the spec ("Do not fake RAG, do not claim
embeddings exist unless they do").

## Verification

| Check | Result |
|---|---|
| Backend route count | **73** (+2 vs PR CW) |
| Backend pytest | **17/17 passed (~0.48 s)** — 13 pre-existing + 4 new PR CX tests. |
| Live API round-trip probe | ✅ Create char → POST `/knowledge` → GET `/characters/{id}` confirmed source persists across the disk write → DELETE char (cleanup). |
| `vite build` | 499.56 KB initial / 135.20 KB gzip + 561.97 KB lazy chunk (+8.90 KB / +1.90 KB vs PR CW — `KnowledgePanel` + lane disclosure + API helpers). |
| Mock smoke | **3/3 passed (~30.5 s)** — Test 1 27.2 s, Test 2 1.9 s, Test 3 775 ms. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| Real Runway calls fired | **0** — knowledge surface is JSON-only. |

## Manual walkthrough

1. **Open `/`** — pick any spokesperson with a
   portrait (e.g. Donny `4c92eaf2c114` if seeded, or
   create one fresh).
2. **Switch to Knowledge tab.** Empty state copy:
   `Teach <Name> about a product, business, offer, or
   brand voice. Campaign scripts can use this context
   later.`
3. **Click `+ Add Knowledge Source`.** Form expands.
4. **Fill the fields.** Title required, type defaults
   to `Brand note`, content required.
5. **Click `Save source`.** The form collapses; the
   new source appears in the list with the green
   `saved · available to campaigns` pill. Page refresh
   confirms persistence.
6. **Switch to Campaigns tab** → `+ New Campaign` →
   `Spokesperson Ad`. Step 2 · Script card now shows
   a `1 knowledge source available — open for
   reference` disclosure above the `+ Save script`
   CTA. Click to expand → see the saved title +
   preview.
7. **Type a campaign script** in the Step 2 textarea
   that references the knowledge content. Save.
8. **Return to Knowledge tab.** Source row stays.
   Click `delete` → `window.confirm` → row goes
   away. Refresh confirms the delete persists.

## Whether knowledge persists after refresh

✅ Yes — verified by both:
- The `test_knowledge_source_round_trip` pytest does
  a `GET /api/characters/{id}` after the POST and
  asserts the source is still there (i.e. the
  threading-locked `_write` actually flushed to
  disk).
- The live API probe added a source against a
  real-mode backend, then re-fetched and saw the
  source on the response.

## Whether campaign / script flow can see knowledge

✅ Yes, via the lane Step 2 reference disclosure.
Knowledge sources are surfaced **next to** the script
editor (not auto-injected). Operator can read /
copy / paste freely. This is the explicit non-RAG
behavior the spec asked for.

## Remaining gaps (intentionally deferred)

- **No website-URL or PDF import.** Manual paste only,
  per the spec's "Manual paste is enough for final-day
  demo testing" + "Do not introduce complex embeddings
  unless already available." Adding URL fetch / PDF
  parsing is a one-PR follow-up but not needed today.
- **No auto-injection into script generation.**
  There's no app-side script generator today — the
  Step 2 textarea is operator-typed. So the spec's
  "include saved knowledge text in local script
  generation context if script generation is
  app-side" reduces to "show next to the script box"
  — done.
- **No edit-in-place for saved sources.** Operators
  delete + re-add to revise. A small inline edit
  affordance is a one-PR follow-up.
- **No knowledge surface on Cinematic / Dialogue
  lanes.** Only Spokesperson Ad's Step 2 mounts the
  disclosure (that's the lane the user is
  prioritising for the demo). The other two lanes
  receive the same `activeSpokesperson` prop but
  don't yet render the knowledge panel — single
  copy-paste in a follow-up if needed.
- **No display of which campaign(s) used a source.**
  `saved · available to campaigns` is a static pill;
  there's no usage tracking. Out of scope for today.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```
