# SESSION 015 — Conversation Transcript Retrieval + Replay UX (PR AJ)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AJ patch in flight on top of `108ca3b`
`feat: add grounded realtime avatar documents`; commit + push
pending explicit user approval)
**Builds on:** SESSION_014 (PR AI Avatar Documents), SESSION_013
(PR AH Captioned Reels), SESSION_012 (PR AG Vertical Reels),
SESSION_011 anchors at `ec446e4`.

## Goal

Close the realtime story for AdSpark's persistent AI spokesperson
arc: once the avatar can be **grounded** in a brand brief
document (PR AI), conversations need to become **auditable** and
**replayable** instead of disappearing the moment a session ends.

PR AJ wires `GET /v1/avatar_conversations/{id}` end to end and
adds a compact replay UX to the Realtime tab. Per the deep
review, Runway's `sessionId` doubles as the `conversationId`, so
no new ids need to be invented — AdSpark just needs to capture
the id we already get from the broker.

Hard scope locks (carried forward from the brief):
- No memory learning yet.
- No analytics dashboards.
- No UI redesign — one extra card on the Realtime tab.
- Compact UX, no new pages.

## Endpoint inventory

PR AJ adds **one new route** + tweaks one existing route's side
effects. Route count: 62 → **63**.

```
POST /api/campaigns/{id}/realtime-transcript    (PR AJ — new)
POST /api/campaigns/{id}/spokesperson-session   (now persists
                                                 session_id as
                                                 runway_conversation_id)
```

## What changed

### Backend

- **`backend/app/services/transcript_client.py` (new, ~190 LOC)**:
  - `TranscriptResult` dataclass: `status` (`ok` / `failed` /
    `mock` / `empty` / `no_session`), `conversation_id`, `turns`,
    `error`, `mock_mode`, `fetched_at`.
  - `mock_conversation_id(campaign_id)` — deterministic
    `mock_conv_<sha256(campaign_id)[:16]>`.
  - `_mock_turns(campaign, character)` — builds a 3-turn replay:
    avatar opener (uses `character.name` + `business` + `product`
    + concept hook), user question (asks why product is different
    for the audience), avatar grounded answer (woven from hook /
    first-sentence-of-script / CTA).
  - `_normalise_turns(payload)` — tolerant Runway response
    mapper: handles `transcript[]` of dicts with
    `role`/`speaker`, `text`/`content`, `timestamp`/`at` fields,
    plus a string-fallback that splits by line. Filters empty
    turns; clamps roles to `{avatar, user, system}`.
  - `fetch_transcript(campaign, settings, *, character,
    conversation_id_override)` — mock short-circuit + real
    `GET /v1/avatar_conversations/{id}` with branches for 200 /
    404 (empty) / non-2xx / network error / non-JSON.
- **`backend/app/models.py`**:
  - New `TranscriptTurn` BaseModel with `role` / `speaker` /
    `text` / `timestamp`. Defined before `Campaign` so the
    forward reference doesn't need `model_rebuild`.
  - Six new optional fields on `Campaign`:
    `runway_conversation_id`, `realtime_transcript_status`,
    `realtime_transcript_error`,
    `realtime_transcript_fetched_at`,
    `realtime_transcript_turns: list[TranscriptTurn]`,
    `realtime_transcript_mock_mode`.
- **`backend/app/services/storage.py`**:
  - `update_runway_conversation_id(campaign_id, conversation_id)` —
    side-effect helper called from the broker route after
    `realtime_create_session` succeeds.
  - `update_realtime_transcript_fields(campaign_id, …)` — full
    fan of fields, with sentinel semantics
    (`realtime_transcript_turns=None` leaves cached turns
    untouched; `[]` explicitly clears).
- **`backend/app/routers/campaigns.py`**:
  - `post_spokesperson_session` now calls
    `store.update_runway_conversation_id(campaign_id,
    session.session_id)` after a successful broker run, wrapped
    in a defensive `try/except` so persistence failure cannot
    break the live realtime hand-off.
  - New route handler `post_fetch_realtime_transcript` (~80 LOC):
    builds the result via `runway_fetch_transcript`, persists
    every status path, and surfaces 409 (no session) / 502
    (failed) / 200 (ok / mock / empty / no_session-with-cached-
    state) per the brief's failure-mode requirements.
  - `TranscriptFetchBody` Pydantic model with optional
    `conversation_id` override (max 128 chars).

### Frontend

- **`frontend/src/api.js`** — `fetchRealtimeTranscript(campaignId,
  body)` helper.
- **`frontend/src/components/CampaignGallery.jsx`**:
  - One new busy flag: `transcriptBusy`.
  - One new handler: `handleFetchTranscript`.
  - State derivations: `transcriptStatus`, `transcriptTurns`,
    `transcriptHasTurns`, `transcriptIsMock`, `transcriptFailed`,
    `transcriptEmpty`, `transcriptNoSession`.
  - **New "Conversation transcript" card** on the Realtime tab,
    placed directly below the PR AI grounding card. State pill
    with five values: `Replay ready · N turns` (emerald) /
    `Replay ready · mock · N turns` (amber) / `No session yet` /
    `No transcript yet` / failed-state error row.
  - Scrollable colour-coded turn list (`max-h-44 overflow-y-auto`):
    avatar = violet, visitor = sky, system = grey. Per-turn
    speaker label in monospace caps + body text.
  - Fetched-at timestamp footer (clipped to ISO seconds).
  - `data-testid="transcript-card"`,
    `data-testid="fetch-transcript"`,
    `data-testid="transcript-state"`,
    `data-testid="transcript-turns"` for the smoke.
- **`frontend/tests/adspark-smoke.spec.js`**:
  - Default state assertion: `No transcript yet` pill visible.
  - Click `Fetch transcript` → wait for `Replay ready · mock ·
    3 turns` → assert turn list renders.

### Docs

- `docs/INVENTORY.md` — service inventory, route count → 63,
  endpoint list, feature stack, transcript-limitation entry
  flipped to ✅.
- `docs/OPERATOR_USAGE_MAP.md` — Realtime §8 expanded with the
  replay state machine + payload shape; Path F gained a step 7
  for the post-session transcript fetch.
- `docs/WHAT_IT_IS.md` — narrative anchor entry 16 reflects the
  PR AJ replay layer.
- `00-START-NEXT-SESSION.md` — Conversation-layer section,
  next-phases checklist all ✅, headline build sizes / route
  count.
- `docs/handoffs/SESSION_015_TRANSCRIPT_REPLAY.md` — this file.

## How transcript IDs/data are created/stored

```
realtime session create  ─┐
   POST /v1/realtime_sessions
   ↓
   Runway returns {id, sessionKey, expiresAt}    ← sessionId == conversationId (deep review §7)
   ↓
   broker route persists ── store.update_runway_conversation_id(campaign_id, session.session_id)
                                ↓
                                Campaign.runway_conversation_id = "<sessionId>"

later, replay click ──→ POST /api/campaigns/{id}/realtime-transcript
   route reads campaign.runway_conversation_id
   transcript_client.fetch_transcript(...)
     ├─ mock mode: returns deterministic 3-turn replay built from campaign brief
     ├─ no id (real mode): returns no_session (route → 409)
     └─ real mode: GET /v1/avatar_conversations/{id} → _normalise_turns(payload)
   route persists turns + status + fetched_at + mock_mode
   → returns updated Campaign
```

## Mock behavior

| Probe | Result |
|---|---|
| Default state of fresh campaign | `runway_conversation_id = null`, `realtime_transcript_status = null` → badge `No transcript yet` |
| First mock fetch | id `mock_conv_3300a3358d19bf2d`, status `mock`, 3 turns rendered, `fetched_at` set |
| Re-fetch idempotency (same campaign id) | identical conversation id; same turn count |
| Override `conversation_id` body | persisted id swaps to the override, mock turns regenerated from the same campaign brief |
| Real-mode 404 from Runway | `status=empty` persisted; UI shows the "Runway has no recorded turns yet" amber line; cached turns left intact |
| Real-mode network error | `status=failed` persisted; route returns 502 |
| Real-mode no session yet | route returns 409 with actionable message; UI badge shows `No session yet` |

Mock turns sample (probe campaign):
```
[avatar] Brand Spokesperson  | Hi there. I'm here to talk about AJ Transcript Probe and ReplayKit.
                                Replay every spokesperson conversation, instantly.
[user]   Visitor             | What makes ReplayKit different for product managers
                                reviewing ad sessions?
[avatar] Brand Spokesperson  | Replay every spokesperson conversation, instantly. ...
                                Try AdSpark replay today.
```

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **63** (was 62 at PR AI) |
| `vite build` | 299.67 KB initial / 84.87 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (23.3 s)` |
| End-to-end mock probe | default `no transcript` → fetch returns 3 mock turns → idempotent re-fetch → conversation_id override path all green |
| Hygiene scan | `git ls-files \| grep -E '(\.env$\|backend/data\|\.mp4$\|\.mp3$\|\.png$)'` empty |
| Drift guard | `✅ context-kit anchors look recent.` |

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200
```

Servers were restarted before the route-count check, before the
mock probe, and before the Playwright smoke — every verification
ran against fresh code.

## Limitations / follow-ups

- **No recording URL surfaced.** Runway's
  `GET /v1/avatar_conversations/{id}` returns both
  `transcript[]` and `recordingUrl`. PR AJ persists turns only
  to keep the Campaign payload compact + privacy-shaped. A future
  slice could surface a deletable / expirable cached recording —
  out of scope here.
- **Mock turns are deterministic, not stochastic.** Re-fetching
  in mock mode always returns the same 3 turns derived from the
  campaign brief. That's deliberate (ID stability + smoke
  determinism) but means the replay UX can't show "live drift"
  in mock. Real mode shows whatever the avatar said.
- **Conversation id override is trusted.** The route does not
  attempt to validate that the supplied `conversation_id` belongs
  to the operator's avatar / account; it just hands it to
  Runway. Fine for V1 since the override path is operator-driven
  and Runway enforces account boundaries on its end.
- **No transcript export / sharing UX.** Turns render inline
  only; no "copy as Markdown" or "download as TXT" affordance
  yet. Trivial follow-up.
- **No transcript invalidation on Refresh grounding doc.** PR AI's
  `Refresh grounding doc` doesn't auto-clear the cached turns —
  the operator clicks `Refresh transcript` on their own when
  they care. Acceptable: the document affects future sessions,
  not past recordings.
- **No auto-fetch when a session ends.** The frontend doesn't
  poll; the operator has to click `Fetch transcript` after
  hanging up. A small "auto-fetch on session end" hook is
  candidate Tier-2 polish; deferred to keep the slice compact.

## Recommended next slice

The four Tier-1 candidates from SESSION_011 are now all ✅. The
next-tier list:

1. **Brand colour storage** — small Character / Campaign field
   that the existing `build_reels_export(backdrop_color=…)` and
   future caption / drawtext styling already accept. Cheap polish
   that lifts the demo polish significantly.
2. **Transcript export / share** — copy-as-Markdown + download-
   as-TXT affordance on the new replay card. Could pair with a
   small "Send to email" stub.
3. **Custom voice cloning** (`POST /v1/voices` `from.type=audio`)
   — meaningful when a brand has a 30-second founder voice
   sample. Real-mode-only feature; mock would skip cleanly.
4. **Word-level caption timing** — once transcripts carry
   per-turn `timestamp` fields from real Runway data, those
   timings could feed back into PR AH's caption schedule for
   tighter sync on the Spokesperson Reels.

Each of these is a 1–2 hour slice. None is blocking.
