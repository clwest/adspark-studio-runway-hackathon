# SESSION 033 — Voice Repair History Audit Trail (PR BB)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BB patch in flight on top of `9d0a99d`
`feat: library-level refresh-all for voice statuses`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_021 (PR AN — Custom Voice Cloning),
SESSION_022 (PR AQ — Avatar PATCH for Custom Voice Swap),
SESSION_024 (PR AS — Avatar Resource Introspection),
SESSION_025 (PR AT — Voice Drift Detection),
SESSION_026 (PR AU — Voice Drift Repair Action),
SESSION_027 (PR AV — Avatar Status Refresh),
and SESSION_032 (PR BA — Character Library Refresh All).

## Goal

The voice arc has accumulated five distinct mutating actions
(clone, apply, repair, refresh) and four state-tracking pills
(patch, verify, drift, freshness). PR AW gave operators a
"last checked" caption for the most recent verify, but there
was no record of *what* the operator (or the auto-flow under
the hood) did before that — only the end state.

PR BB adds the smallest possible audit trail: a per-character
`voice_repair_history` list, capped at the 20 most recent
entries, populated automatically as each voice route fires.
The list renders as a compact disclosure inside the voice
section so the operator can scan recent activity directly
from the character tile.

Hard scope locks (carried forward from the brief):
- Small backend model + storage addition (no new routes).
- Compact UI disclosure (no full audit dashboard, no
  analytics).
- No batch repair.
- No Character Studio redesign.

## Endpoint inventory

PR BB adds **no new routes**. Route count stays at **68**. The
existing voice routes gained one optional body field (apply-
voice's `mode`); their HTTP behaviour is otherwise unchanged.

## What changed

### Backend

- **`backend/app/models.py`** — adds `VoiceRepairHistoryEntry`
  Pydantic model with the brief-mandated nine fields:
  `timestamp`, `action ∈ {clone, apply, repair, refresh,
  verify}`, `before_voice_id`, `after_voice_id`,
  `resolved_voice_id`, `drift_status ∈ {match, drift,
  unknown}`, `status` (free-form to absorb the action's
  primary outcome string), `error`, `mock_mode`. Adds
  `voice_repair_history: list[VoiceRepairHistoryEntry] = []`
  to `Character`.

- **`backend/app/services/character_store.py`** — adds
  `VOICE_HISTORY_MAX = 20` plus `append_voice_history(
  character_id, entry, *, max_entries)` that inserts newest-
  first, slices to the cap, and bumps `updated_at` inside the
  same `_LOCK` the rest of the store uses. Returns `True` on
  success, `False` when the id is unknown.

- **`backend/app/routers/characters.py`** —
  - new `ApplyVoiceBody { mode: Optional["apply" | "repair"] }`
    so the PR AU repair button can label its trail entry
    distinctly. Plain POST with no body still works (default
    `None` → labeled as `"apply"`).
  - new shared `_append_voice_history_safe(...)` helper that
    wraps `store.append_voice_history(...)` in `try/except`.
    An audit failure is logged but never aborts the underlying
    flow.
  - clone-voice success branch — appends `action="clone"`
    with `before_voice_id` (prior id), `after_voice_id`
    (newly cloned id), `resolved_voice_id`, `drift_status`,
    `status` (`ready`/`mock`), `mock_mode`.
  - clone-voice failure branch (502) — appends
    `action="clone"` with `status="failed"` + `error` so the
    failed attempt shows up in the audit trail.
  - apply-voice success branch — appends
    `action="apply"` (default) or `action="repair"` (when
    `body.mode == "repair"`). Captures
    `before_voice_id=record.avatar_voice_resolved_id` (the
    id resolved before this action), `after_voice_id`
    (the id we tried to apply), `resolved_voice_id` (post-
    apply), `drift_status`, `status` (the apply result),
    `error`, `mock_mode`.
  - refresh-avatar-voice — appends `action="refresh"` with
    `after_voice_id=None` (refresh never mutates the bind),
    `before_voice_id` (prior resolved id, so drift before vs
    after is visible), `resolved_voice_id`, `drift_status`,
    `status` (`verified`/`mock_verified`/`unverified`/
    `failed`), `error`, `mock_mode`.

### Frontend

- **`frontend/src/api.js`** — `applyCharacterVoiceToAvatar`
  now accepts an optional `mode` argument. When set, it's
  forwarded as `{ mode }` in the JSON body so the backend can
  label the audit entry as `apply` vs `repair`.

- **`frontend/src/components/CharacterStudio.jsx`** —
  `handleApplyVoiceToAvatar(c, mode)` threads the mode
  through to the API helper. Default callers (the PR AQ
  failure-retry button) keep working without changes.

- **`frontend/src/components/CharacterCard.jsx`** —
  - `handleRepairDrift` now passes `'repair'` to
    `onApplyVoiceToAvatar(c, 'repair')` so the trail entry
    is labeled correctly.
  - new `formatHistoryTimestamp(iso, nowMs)` helper (same
    bucket structure as PR AW's `formatVerifyFreshness` minus
    the `"Last checked "` prefix).
  - new `HISTORY_ACTION_PILLS` colour map plus
    `historyStatusClass(status)` and `historyDriftClass(drift)`
    so each row's pills render with consistent semantics.
  - new `historyExpanded` state (default `false`); the
    disclosure renders the 5 newest entries by default and a
    `Show all (N)` toggle expands to the full list (capped at
    20 by the store).
  - new disclosure block at the bottom of the voice section
    that renders the list. Hidden entirely when
    `voice_repair_history` is empty so a fresh character tile
    looks unchanged.

### Tests

- **`frontend/tests/adspark-smoke.spec.js`** — new resilient
  assertions inside the existing `if (voiceSectionCount > 0)`
  block. The disclosure may or may not exist depending on
  fixture state, so the assertion bounds the count by the
  voice-section count and (when at least one disclosure is
  present) verifies:
  1. The wrapper contains the literal copy "Voice history".
  2. At least one `custom-voice-history-entry` row exists.
  3. The total rows in the first disclosure is between 1 and
     20 (inclusive).
  4. The first entry's pill content starts with one of
     `clone | apply | repair | refresh | verify`.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BB; route
  count narrative confirms unchanged at 68; models / store /
  router / CharacterCard rows updated with the new helpers.
- `docs/OPERATOR_USAGE_MAP.md` — new "Voice repair audit
  trail (PR BB)" subsection with the entry shape, append
  matrix, mock behaviour, and the colour-coded UI render
  example.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR BB is a
  diagnostic surface that doesn't change product behaviour.
- `00-START-NEXT-SESSION.md` — Character-layer section + build
  sizes / route count.
- `docs/handoffs/SESSION_033_VOICE_REPAIR_HISTORY.md` — this
  file.

## History entry shape

```
VoiceRepairHistoryEntry (pydantic)

  timestamp:           datetime  (UTC; serialised as ISO string in JSON)
  action:              "clone" | "apply" | "repair" | "refresh" | "verify"
  before_voice_id:     str | None    (id present before this action)
  after_voice_id:      str | None    (id we tried to apply; None for refresh)
  resolved_voice_id:   str | None    (what GET /v1/avatars saw afterwards)
  drift_status:        "match" | "drift" | "unknown" | None
  status:              str | None    (action's primary outcome)
  error:               str | None
  mock_mode:           bool | None
```

The store caps the list at the 20 most recent entries; older
entries are evicted on insert. `updated_at` bumps on every
append.

## Where entries are appended

| Route | Append `action` |
|---|---|
| `POST /clone-voice` (success branch) | `"clone"` |
| `POST /clone-voice` (failure 502)  | `"clone"` (status="failed") |
| `POST /apply-voice` (no body / `mode="apply"`) | `"apply"` |
| `POST /apply-voice` (`mode="repair"`) | `"repair"` |
| `POST /refresh-avatar-voice`        | `"refresh"` |

The `verify` action label is reserved in the model but not yet
appended automatically — the verify pass is folded into the
clone / apply / refresh entries (their `resolved_voice_id` +
`status` already capture the verify outcome). A future slice
could add explicit verify-only entries if a verify-without-
mutation surface lands.

## Mock behaviour

Every helper that feeds into the audit trail short-circuits
deterministically in mock mode:

- `clone_voice_from_audio` returns
  `mock_voice_<sha256(name+bytes)[:16]>` so re-uploads of the
  same sample produce the same id.
- `apply_voice_to_avatar` returns
  `apply_result.status="mock_patched"` without HTTP.
- `fetch_avatar_voice` returns
  `state.status="mock_verified"` and
  `state.resolved_id=expected_voice_id` so the drift compare
  always reports `match`.

The trail rows on a mock-mode tile read like:

```
[clone]    [mock]              [match]      just now
[apply]    [mock_patched]      [match]      5m ago
[repair]   [mock_patched]      [match]      6m ago
[refresh]  [mock_verified]     [match]      8m ago
```

`mock_mode: true` flags each entry so a future surface (or a
log-grep) can distinguish mock rows without inspecting the id
prefix.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 331.17 KB initial / 92.88 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (21.0 s)` (re-run after probe mutation: still passing) |
| Backend audit-trail probe | 8/8 steps pass |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

The 8-step backend probe (`/tmp/_bb_probe.sh`) covered:

```
1. Baseline history_len = 0
2. POST /apply-voice (no body)            -> action='apply'   appended
3. POST /apply-voice (mode='repair')      -> action='repair'  appended
4. POST /refresh-avatar-voice             -> action='refresh' appended
5. 25 rapid refreshes                     -> history_len = 20 (capped)
6. POST /apply-voice on no-voice character -> HTTP 409, no append (route 409s before append)
7. POST /clone-voice (multipart)           -> action='clone'  appended
8. Inspect entry shape                    -> all 9 keys present + correct types
```

Sample entry from step 8:

```
keys: ['action', 'after_voice_id', 'before_voice_id',
       'drift_status', 'error', 'mock_mode',
       'resolved_voice_id', 'status', 'timestamp']
  action: 'refresh'
  before_voice_id: 'mock_voice_1521ddcc3e67e2ec'
  after_voice_id: None
  resolved_voice_id: 'mock_voice_1521ddcc3e67e2ec'
  drift_status: 'match'
  status: 'mock_verified'
  error: None
  mock_mode: True
  timestamp: '2026-05-09T19:59:16.217467Z'
```

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200 (via localhost)
```

After implementation, the backend was restarted to pick up the
new model + routes. Smoke + build + targeted probe ran against
fresh processes. The probe mutated `data/characters.json` and
the smoke was re-run after that mutation to confirm the
resilient assertions hold for both empty-history and populated-
history library states. Servers are stopped at end of session.

## Limitations / follow-ups

- **No automatic `verify` entries yet.** The verify pass is
  always coupled to a mutating action (clone / apply / refresh
  all run verify implicitly), so its outcome is folded into
  the `resolved_voice_id` + `status` of the parent entry. A
  future explicit verify-only surface would warrant a
  standalone `action="verify"` row.
- **Cap is hard-coded at 20.** Configurable via the
  `max_entries` argument to `append_voice_history(...)` but
  not exposed as a setting / env var. 20 is enough for a long
  demo session; a busy production tenant would want it
  configurable.
- **No per-entry expand for the error message.** The full
  error message lives in the row's `title` tooltip
  (hover-only), not in a click-to-expand row. Acceptable for
  V1 — the audit trail is meant to be skimmable, not a
  detailed error log.
- **No filter / search.** With only 20 entries per character
  the UI doesn't need any search affordance. A library-wide
  audit dashboard is explicitly out of scope (brief lock).
- **No CSV / JSON export.** The list is meant to be glanceable
  in-place; an export surface would be a separate slice.
- **`mock_mode` is not visually distinct in the UI.** The flag
  is persisted but the row colours are driven by `status`
  alone — `mock_patched` already reads slightly different
  from `applied`, which is enough for now.
- **Append is best-effort.** A store-write failure logs a
  warning but doesn't surface anywhere in the UI. Acceptable:
  the audit trail is a diagnostic aid, not a guarantee.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT /
AU / AV / AW / AX / AY / AZ / BA / BB slices are all ✅
shipped. Next-tier candidates:

1. **Per-campaign transcript history** — tiny archive list
   (or `keep` flag) on PR AJ so operators can keep multiple
   session replays per campaign. Mirrors PR BB's shape but
   for conversation transcripts.
2. **Peak-hold indicator on PR AY meter** — small red dot
   lingering ~500 ms at peak position so the operator can
   see clipping bursts.
3. **Library-level voice pill summary** — one-line `"X
   characters ready · Y unverified · Z drifted"` line at
   the top of the library so the operator can scan health
   at a glance without inspecting each tile.
4. **Bulk refresh keyboard shortcut** — `R` while focused on
   the library re-fires the PR BA action; small UX win.
5. **History row error tooltip → inline expand** — current
   row title tooltip is hover-only; click-to-expand the
   error message would be useful for failed-clone diagnosis
   on touch devices.

Each is a 1–2 hour slice. None blocking.
