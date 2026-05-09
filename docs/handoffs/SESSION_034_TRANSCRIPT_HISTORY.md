# SESSION 034 — Per-Campaign Transcript History (PR BC)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BC patch in flight on top of `8702660`
`feat: voice repair history audit trail`; commit + push pending
after this handoff lands)
**Builds on:** SESSION_018 (PR AJ — Conversation Transcript
Retrieval + Replay UX), SESSION_020 (PR AL — Transcript Export /
Share), and SESSION_033 (PR BB — Voice Repair History Audit Trail).

## Goal

PR AJ caches one transcript per campaign — the most recent
fetch overwrites the prior turns + status. AdSpark is becoming
persistent AI spokesperson infrastructure, so campaign
conversations should be reviewable over time rather than
losing every prior session as a new fetch lands.

PR BC adds the smallest possible surface: a per-campaign
`realtime_transcript_history` audit list (capped at the most
recent 20 entries) that mirrors PR BB's voice-history shape.
Every successful (or resolved-failure) fetch of
`POST /realtime-transcript` appends a compact entry; the
existing latest-fetch fields remain authoritative for the
preview + export buttons so the rest of the UX is unchanged.

Hard scope locks (carried forward from the brief):
- Small backend model + storage addition (no new routes).
- Compact UI disclosure (no analytics dashboard).
- Memory learning is out of scope.
- Recording URLs are NOT surfaced.
- No app redesign.

## Endpoint inventory

PR BC adds **no new routes**. Route count stays at **68**. The
existing `POST /api/campaigns/{id}/realtime-transcript` route
gains audit-trail appends inside each branch of its existing
state machine.

## What changed

### Backend

- **`backend/app/models.py`** — adds `TranscriptHistoryEntry`
  Pydantic model with the brief-mandated seven fields:
  `fetched_at` (datetime, ISO format), `conversation_id`,
  `status ∈ {ok, failed, mock, empty, no_session}`,
  `turn_count`, `turns: list[TranscriptTurn]`, `mock_mode`,
  `error`. Adds
  `realtime_transcript_history: list[TranscriptHistoryEntry] = []`
  on Campaign.

- **`backend/app/services/storage.py`** — adds
  `TRANSCRIPT_HISTORY_MAX = 20` plus `append_transcript_history(
  campaign_id, entry, *, max_entries)` that inserts newest-
  first, slices to the cap, and returns the post-append
  Campaign so the route can include the freshly-added row in
  its response. Returns `None` when the campaign id is
  unknown.

- **`backend/app/routers/campaigns.py`** —
  - new shared `_append_transcript_history_safe(...)` helper
    that wraps `store.append_transcript_history(...)` in
    `try/except`. An audit failure is logged but never aborts
    the underlying transcript fetch flow.
  - early `409 no-session` branch (real-mode fetch with no
    persisted conversation id) — appends an entry with
    `status="no_session"` so even pre-session attempts show
    up in the trail.
  - `failed`/`empty`/`no_session` mid-branch (returned by
    `runway_fetch_transcript`) — appends an entry with the
    matching `status` and the error message; the `failed`
    branch still raises 502 after the append (audit comes
    first).
  - `ok` / `mock` success branch — appends an entry with the
    full structured turns array so future surfaces can render
    historical replays without a second backend round-trip.
  - all branches now return the post-append Campaign so the
    HTTP response includes the freshly-added history row (the
    initial implementation returned the pre-append snapshot,
    which broke the smoke assertion).

### Frontend

- **`frontend/src/components/CampaignGallery.jsx`** —
  - reads `c.realtime_transcript_history` defensively (empty
    array fallback) into a local `transcriptHistory` const.
  - new `transcriptHistoryExpanded` `useState(false)` for the
    "Show all (N)" toggle.
  - new disclosure block rendered inside the existing
    `transcript-card` div, directly under the
    `fetched-at` caption. Hidden when
    `transcriptHistory.length === 0` so a fresh campaign card
    looks unchanged.
  - each row renders four compact pieces — status pill
    (colour-coded per literal status: ok→emerald,
    mock→amber, failed→rose, empty/no_session→zinc),
    `N turns` count, truncated conversation id (first 12
    chars + ellipsis), and a compact fetched-time
    (`YYYY-MM-DD HH:MM`).

### Tests

- **`frontend/tests/adspark-smoke.spec.js`** — new
  resilient assertions inside the existing transcript-fetch
  block (after the export status banner check):
  1. `transcript-history` testid is visible after the smoke's
     fetch.
  2. The disclosure contains the literal copy
     "Transcript history".
  3. At least one `transcript-history-entry` row exists,
     count between 1 and 20 inclusive.
  4. The first entry's text content starts with one of the
     five literal status values.
  5. The latest preview (`transcript-turns`) and export
     button (`transcript-copy-markdown` enabled) are
     unaffected by the new disclosure.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BC; route
  count narrative confirms unchanged at 68; models / store /
  CampaignGallery rows updated with the new helpers.
- `docs/OPERATOR_USAGE_MAP.md` — new "Per-campaign transcript
  history (PR BC)" subsection inside the existing Realtime
  flow with the entry shape, append-branch matrix, mock
  behaviour, and the colour-coded UI render example.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR BC is a
  diagnostic surface that doesn't change product behaviour.
- `00-START-NEXT-SESSION.md` — Conversation-layer section +
  build sizes / route count.
- `docs/handoffs/SESSION_034_TRANSCRIPT_HISTORY.md` — this
  file.

## History entry shape

```
TranscriptHistoryEntry (pydantic)

  fetched_at:        datetime  (UTC; serialised as ISO string in JSON)
  conversation_id:   str | None
  status:            "ok" | "failed" | "mock" | "empty" | "no_session" | None
  turn_count:        int
  turns:             list[TranscriptTurn]   (full structured turns; empty for failure states)
  mock_mode:         bool | None
  error:             str | None
```

The store caps the list at the 20 most recent entries; older
entries are evicted on insert.

## Where entries are appended

| Branch of `POST /realtime-transcript` | Entry status |
|---|---|
| Real-mode early return — no `runway_conversation_id` AND no body override | `"no_session"` |
| `runway_fetch_transcript` returned `failed` | `"failed"` (turns empty, error captured) |
| `runway_fetch_transcript` returned `empty` | `"empty"` (turns empty, error captured) |
| `runway_fetch_transcript` returned `no_session` | `"no_session"` (turns empty) |
| `runway_fetch_transcript` returned `ok` | `"ok"` (full turns array) |
| `runway_fetch_transcript` returned `mock` | `"mock"` (full turns array) |

The append goes through `_append_transcript_history_safe(...)` —
a thin wrapper that wraps the store write in `try/except` so
an audit failure logs a warning but never aborts the
underlying transcript fetch flow.

## Mock behaviour

Mock-mode fetches synthesise a deterministic 3-turn replay
from `business / product / audience / hook / commercial_script /`
the attached Character; the conversation id is a stable
`mock_conv_<sha-of-campaign-id>` so re-fetches return the
same handle.

PR BC's audit trail keeps every mock fetch as a distinct
entry — there's intentionally **no dedupe**. The 20-entry cap
covers the unbounded-rows case without requiring
content-aware deduplication. Each row carries `mock_mode:
true` so a future surface can distinguish mock-driven rows
from real recordings.

Sample mock entry from the targeted probe:

```
{
  fetched_at: '2026-05-09T20:17:26.602276Z',
  conversation_id: 'mock_conv_44bb8b6bdeccc938',
  status: 'mock',
  turn_count: 3,
  turns: [
    { role: 'avatar', speaker: 'Brand Spokesperson',
      text: 'Hi there. I am here to talk about Local coffee shop and Morning blend...' },
    { role: 'user', speaker: 'Visitor',
      text: 'What makes Morning blend different?' },
    { role: 'avatar', speaker: 'Brand Spokesperson',
      text: 'Your day, upgraded by Morning blend. Try it today →.' },
  ],
  mock_mode: true,
  error: null,
}
```

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 333.15 KB initial / 93.29 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (21.6 s)` |
| Backend audit-trail probe | 7/7 steps pass |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

The 7-step backend probe (`/tmp/_bc_probe.sh`) covered:

```
1. Baseline state for the target campaign
2. POST /realtime-transcript           -> append 1 entry
3. 2 more POSTs                         -> 3 distinct entries (no dedupe)
4. 25 rapid POSTs                       -> history_len = 20 (capped)
5. Latest fields still update           -> latest_status / latest_turns /
                                           latest_fetched_at /
                                           latest_conversation_id all live
6. Inspect entry shape                  -> 7 keys present + correct types
7. Bogus campaign id 404                -> server stays up; no append
```

A separate failure was caught + fixed during verification:
the route initially returned the pre-append Campaign (the one
returned by `update_realtime_transcript_fields`) which didn't
include the freshly-appended history. The smoke assertion
caught this; the fix is to have `append_transcript_history`
return the post-append Campaign and use that as the route's
response when available.

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200 (via localhost)
```

After the post-append return-value fix, the backend was
restarted to pick up the change. Smoke + build + targeted
probe all ran against fresh processes. The probe mutated
several campaigns' `realtime_transcript_history`; the smoke
assertion is resilient (count between 1 and 20) so it stays
green for both pre- and post-mutation states. Servers are
stopped at end of session.

## Limitations / follow-ups

- **List-only.** Clicking a history row does not load that
  entry's turns into the preview block above. The latest
  fetch always drives the preview + Copy Markdown / Download
  TXT exports. Loading older entries would require a small
  "preview override" state that mirrors the PR AL export
  helpers; out of scope for V1.
- **No dedupe.** Repeated fetches against the same
  conversation id append distinct rows. The 20-entry cap
  covers the unbounded-rows case; a future slice could add
  content-hash-aware dedupe if needed.
- **No filter / search.** With only 20 entries per campaign
  the UI doesn't need any search affordance. A library-wide
  audit dashboard is explicitly out of scope.
- **Recording URLs are NOT surfaced.** Runway's transcript
  endpoint can include audio/video URLs in some shapes; PR BC
  intentionally omits them. The audit list carries only the
  structured turns.
- **No JSON / CSV export.** The list is meant to be glanceable
  in-place; an export surface would be a separate slice.
- **Cap is hard-coded at 20.** Configurable via the
  `max_entries` argument to `append_transcript_history(...)`
  but not exposed as a setting / env var.
- **Append is best-effort.** A store-write failure logs a
  warning but doesn't surface anywhere in the UI. Acceptable:
  the audit trail is a diagnostic aid, not a guarantee.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT /
AU / AV / AW / AX / AY / AZ / BA / BB / BC slices are all ✅
shipped. Next-tier candidates:

1. **History row click → preview override** — loading a prior
   transcript into the preview block + Copy / Download
   buttons, with a "back to latest" link. ~50 LOC frontend.
2. **Peak-hold indicator on PR AY meter** — small red dot
   lingering ~500 ms at peak position so the operator can
   see clipping bursts.
3. **Library-level voice pill summary** — one-line `"X
   characters ready · Y unverified · Z drifted"` line at
   the top of the library so the operator can scan health
   at a glance without inspecting each tile.
4. **Bulk refresh keyboard shortcut** — `R` while focused on
   the library re-fires the PR BA action; small UX win.
5. **Transcript history JSON export** — small button next to
   Copy Markdown / Download TXT that exports the full audit
   trail as JSON for offline review.

Each is a 1–2 hour slice. None blocking.
