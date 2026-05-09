# SESSION 037 — Spokesperson Knowledge Tab Wiring (PR BF)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BF patch in flight on top of `e2ed1ee`
`feat: spokesperson studio scaffold (gated v2 surface)`; commit +
push pending after this handoff lands)
**Builds on:** SESSION_017 (PR AI — Avatar documentIds for
grounded realtime), SESSION_018 (PR AJ — Conversation
Transcript Retrieval), SESSION_034 (PR BC — Per-Campaign
Transcript History), SESSION_035 (PR BD — UX v2 Flag), and
SESSION_036 (PR BE — SpokespersonStudio Scaffold).

## Goal

PR BE introduced the gated v2 SpokespersonStudio with three-tab
SpokespersonCards. Identity worked; Knowledge + Appearances were
placeholder copy. PR BF wires the **Knowledge tab** so each
spokesperson surfaces what they know across the campaign
graph.

A persistent AI spokesperson is more than a portrait + voice — they
accumulate context across the campaigns they appear in. Knowledge
exposes that context: which grounding documents are bound to this
avatar (PR AI), how many recorded transcripts exist (PR AJ +
PR BC), and when the last conversation was checked.

This is the third gated v2 slice. Backend untouched. Default v1
load is unchanged. PR BG wires Appearances next; PR BH then
introduces the mode-first creation modal (the first slice that
visibly diverges from v1 beyond Stage 1).

## Endpoint inventory

PR BF adds **no new routes**. Route count stays at **68**.
Frontend-only. Reads existing `GET /api/campaigns` and filters
client-side by `character_id`.

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - `refresh()` now fans out `Promise.all([listCharacters,
    listCampaigns])` so a single mount load fetches both lists
    in parallel.
  - new `campaignsByCharacter` index built once per render
    (`reduce` over `campaigns` keyed on `character_id`); cards
    receive only their own slice.
  - each `<SpokespersonCard>` receives a new `linkedCampaigns`
    prop; empty array fallback when nothing links.

- **`frontend/src/components/SpokespersonCard.jsx`** —
  - new prop `linkedCampaigns = []`.
  - new local helpers (kept inline, not promoted to
    `uiHelpers.js` because they read campaign shape directly):
    - `formatKnowledgeTime(iso)` — wraps `formatHistoryTimestamp`
      from uiHelpers; falls back to `"—"` for missing /
      unparseable timestamps.
    - `groundingLabel(campaign)` — maps `runway_document_id` +
      `runway_document_status` (+ `runway_document_mock_mode`)
      to one of four pill states: `Prompt-grounded` / `Document-
      grounded` / `Document-grounded · mock` / `Failed`.
      Mirrors the vocabulary the v1 Realtime grounding card
      uses in CampaignGallery so v1 + v2 surfaces report the
      same status.
    - `campaignLabel(campaign)` — `Business · Product` (each
      truncated to 28 chars), or whichever side is set, or
      `Untitled campaign · <id-prefix>` as the last fallback.
    - `summariseKnowledge(linkedCampaigns)` — returns
      `{ linkedCount, groundedCount, transcriptCount,
      lastFetchedAt }` for the summary line.
  - Knowledge tab content replaced. Summary line uses the
    summariseKnowledge stats; per-campaign rows render below.
    Empty state when `linkedCampaigns.length === 0`.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched (still passes 26.3 s).
  - the v2 test's Knowledge-tab block replaced with the new
    disjunction: exactly one of `spokesperson-knowledge-summary`
    or `spokesperson-knowledge-empty` must render. When
    summary, asserts the `N campaigns · M grounded · K
    transcripts` substring + ≥1 `spokesperson-knowledge-row`.
    When empty, asserts the `No linked campaigns yet` copy.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BF; route
  count narrative confirms unchanged at 68;
  SpokespersonStudio.jsx + SpokespersonCard.jsx rows updated
  with Knowledge wiring details.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged; the
  v2 surface is gated and the operator-facing flow doc gets
  updated wholesale once the v2 path becomes the default
  (PR BN).
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BF; build sizes / route count.
- `docs/handoffs/SESSION_037_SPOKESPERSON_KNOWLEDGE_TAB.md` —
  this file.

## Data linkage behaviour

```
SpokespersonStudio.refresh():
  ↓ Promise.all([api.listCharacters(), api.listCampaigns()])
  ↓ setCharacters(charsResp.characters)
  ↓ setCampaigns(campsResp.campaigns)

Per render:
  ↓ campaignsByCharacter = campaigns.reduce((acc, c) => {
      if (c.character_id) acc[c.character_id] ||= []; acc[c.character_id].push(c)
      return acc
    }, {})

For each character render:
  ↓ <SpokespersonCard linkedCampaigns={campaignsByCharacter[c.id] || []}>

Inside SpokespersonCard's Knowledge tab:
  ↓ knowledge = summariseKnowledge(linkedCampaigns)
  ↓ if (linkedCampaigns.length > 0):
    ↓ render summary line ({linkedCount} campaigns · {groundedCount}
      grounded · {transcriptCount} transcripts · last fetch ...)
    ↓ render per-campaign rows
  ↓ else:
    ↓ render empty state with friendly setup hint
```

The match key is **`Campaign.character_id`** — the existing
attach-character relation already used by the v1 saved card,
the spokesperson resolution chain, and the avatar PATCH path.
No new linkage was added; PR BF just reads what's already
there.

## Knowledge tab behaviour

Summary line (renders only when ≥1 linked campaign):

```
N campaigns · M grounded · K transcripts · last fetch <relative-time>
```

- `N` = linkedCampaigns.length
- `M` = campaigns where `runway_document_id` is set AND
  `runway_document_status` ∈ {`ready`, `mock`}
- `K` = sum of `realtime_transcript_history.length` across all
  matched campaigns
- `last fetch` = max of `realtime_transcript_fetched_at` across
  all matched campaigns; omitted when no campaign has a
  fetched timestamp

Per-campaign row:

```
[Business · Product]   [grounding pill]   N transcripts   <relative>
```

Grounding pill states:

| Conditions | Label | Colour |
|---|---|---|
| `runway_document_status === "failed"` | `Failed` | rose |
| `runway_document_id` set + `status === "mock"` | `Document-grounded · mock` | amber |
| `runway_document_id` set + `status === "ready"` (or `mock_mode === false`) | `Document-grounded` | emerald |
| otherwise (no doc bound) | `Prompt-grounded` | zinc |

Each row carries a `data-campaign-id` attribute + a tooltip
with the raw fetched-at ISO timestamp so an operator can copy
the exact value if needed.

## Empty-state behaviour

When a spokesperson is linked to zero campaigns:

```
[ Knowledge ]                                    unlinked

No linked campaigns yet.
Attach this spokesperson to a campaign — grounding documents
(PR AI) and transcript history (PR BC) will surface here
automatically as the campaign runs.
```

This is intentionally not framed as an error — most newly-
created spokespeople won't be linked yet. The setup hint
explicitly references PR AI + PR BC so an operator who needs
context can trace the full path.

The `unlinked` chip in the upper-right of the Knowledge tab
echoes the same state without using the word "linked" twice
in the same sentence; when ≥1 linked, the chip flips to
`{N} linked`.

## Verification (this session)

Servers were killed and restarted in mock mode before testing.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 345.90 KB initial / 96.20 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (27.4 s)` — v1 26.3 s, v2 492 ms |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now exercises both Knowledge branches against the
fixture state via the disjunction assertion. With the current
characters.json:
- `Piper Voltage` (linked to FocusNet via `character_id`) → hits
  the summary branch (`1 campaigns · 0 grounded · 0
  transcripts`).
- `Brewster the Raccoon` (linked to CEO Buzz) → also summary
  branch.
- `Sir Landsloplot` (no linked campaigns) → empty state branch.

The smoke only inspects `firstCard` so the assertion runs
against whichever spokesperson sits at index 0; the disjunction
covers both possibilities so the test stays green regardless.

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200 (via localhost)
```

After implementation, smoke + build ran against fresh
processes. Servers are stopped at end of session.

## Limitations / follow-ups

- **Client-side filter is O(campaigns).** With ~13 fixture
  campaigns this is fine; a tenant with hundreds of campaigns
  would benefit from a backend filter route
  (`GET /api/characters/{id}/campaigns`). Defer to a future
  slice if it becomes a concern.
- **No drill-in.** Clicking a Knowledge row currently does
  nothing — opening the campaign in the gallery is a future
  slice (will fold neatly into PR BG's Appearances tab when
  campaigns become navigable from the spokesperson surface).
- **No real-time refresh.** SpokespersonStudio fetches
  campaigns once at mount; later changes (new transcript
  fetched, grounding document attached) require either the
  parent's `onCharactersChanged` callback to fire (which
  re-runs `refresh()`) or a manual page reload. Current
  parent already calls `refreshCampaigns()` after attach /
  detach events so most cases work; a stale Knowledge tab is
  possible if an operator runs the v1 transcript-fetch from
  another tab.
- **Grounding label is single-axis.** "Document-grounded ·
  mock" vs "Document-grounded" is the only mock-aware
  distinction; we don't surface the document name / id in the
  pill itself (lives in the row's `title` tooltip via the
  campaign id). Acceptable for the compact list view; a
  click-to-expand affordance is a future polish.
- **Transcript count includes failed fetches.** PR BC's
  `realtime_transcript_history` records every
  `POST /realtime-transcript` call including 502 / empty /
  no_session resolutions. The Knowledge summary doesn't
  filter these out — `K transcripts` is the raw history count
  per the brief. The per-row tooltip surfaces the latest
  status; future polish could split the count into "ok / mock
  / failed" buckets.

## Recommended next slice

**PR BG — Spokesperson Appearances tab wiring.**

Replaces the Appearances placeholder with a list of campaign
cards for every linked campaign, each carrying:

- inferred mode badge (`Spokesperson Ad` / `Cinematic` /
  `Dialogue Scene` / `Mixed` derived from which output URLs
  are populated on the campaign — `host_video_url` /
  `cached_video_url` / `dialogue_scene_video_url`)
- last-touched relative time
- click-through that opens the campaign in the legacy gallery
  (until PR BJ–BL ship the lane-first saved cards)

Reuses the same `linkedCampaigns` prop wired in PR BF.
Estimated ~150 LOC. No backend changes. v1 default smoke
unaffected; v2 smoke extended with a disjunction similar to
Knowledge.

After PR BG: PR BH introduces the mode-first creation modal —
the first slice that visibly diverges from v1 beyond Stage 1.
