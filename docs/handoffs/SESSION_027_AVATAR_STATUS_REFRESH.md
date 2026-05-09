# SESSION 027 — Avatar Status Manual Refresh (PR AV)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AV patch in flight on top of `485310a`
`feat: repair detected voice drift in one click`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_026 (PR AU Voice Drift Repair),
SESSION_025 (PR AT Drift Detection), SESSION_024 (PR AS Avatar
Resource Introspection), SESSION_023 (PR AR Cloned Voice
Preview), SESSION_022 (PR AQ Avatar Voice Swap), and the rest
of SESSION_011–SESSION_021.

## Goal

PR AS verifies after PATCH. PR AT detects drift. PR AU repairs
drift. The voice arc still lacked a **read-only check** — an
operator who wanted to re-poll the avatar resource without
mutating it had to either re-clone or call apply-voice (both
of which trigger a PATCH).

PR AV closes that gap with a single read-only route +
matching button. The operator can confirm a previously-failed
verify has cleared, or watch a queued upstream change resolve,
without touching the binding.

Hard scope locks (carried forward from the brief):
- No PATCH side effects.
- No drift repair from this route.
- No voice A/B switching.
- No voice deletion / library management.
- No UI redesign.

## Endpoint inventory

PR AV adds **one new route**. Route count: 66 → **67**.

```
POST /api/characters/{id}/refresh-avatar-voice    (PR AV — new, read-only)
```

The route reuses two existing helpers from the voice-clone
client without ever invoking the third:

```
fetch_avatar_voice(...)             ← PR AS  (GET only)
compute_voice_drift_status(...)     ← PR AT  (pure)
apply_voice_to_avatar(...)          ← PR AQ  (NOT called here)
```

## What changed

### Backend

- **`backend/app/routers/characters.py`** — new route handler
  `post_refresh_avatar_voice`:
  - 404 — character not found.
  - 409 — no avatar bound (introspection requires an avatar id).
  - 409 — no cloned voice (drift compare requires both ids).
  - On success: persists 7 fields atomically
    (`avatar_voice_resolved_type` / `_resolved_id` /
    `_resolved_label` / `_verify_status` / `_verified_at` /
    `_verify_error` / `_drift_status`) and returns the updated
    Character.
  - **Never touches** `custom_voice_avatar_patch_status`,
    `custom_voice_avatar_patch_error`, or
    `custom_voice_avatar_patched_at` — those PR AQ fields
    survive every refresh unchanged. Inline comment in the
    code makes the read-only contract loud.
- **No changes** to `voice_clone_client.py`, `models.py`, or
  `character_store.py` — the existing helpers + generic
  `update(...)` already cover the surface PR AV needs.

### Frontend

- **`frontend/src/api.js`** —
  `refreshCharacterAvatarVoice(characterId)` helper.
- **`frontend/src/components/CharacterCard.jsx`**:
  - New props: `onRefreshAvatarVoice`.
  - New local state: `refreshBusy`, `refreshError` so the
    refresh row never collides with PR AQ apply (`patchPending2`)
    or PR AU repair (`repairBusy`).
  - **New "Refresh avatar status" button** (zinc, neutral
    colour to distinguish from the rose drift repair) gated on
    `customVoiceReady && avatarReady && Boolean(onRefreshAvatarVoice)`.
    `data-testid="custom-voice-refresh-avatar"`.
  - **Status row** below the button:
    - busy → *"posting to /refresh-avatar-voice…"* (zinc)
    - error → the message (rose)
    - `data-testid="custom-voice-refresh-status"`.
- **`frontend/src/components/CharacterStudio.jsx`** — new
  `handleRefreshAvatarVoice(c)` handler threaded into each
  library tile. Re-throws on error so the tile renders the
  inline status row in addition to the studio-level error
  banner.
- **`frontend/tests/adspark-smoke.spec.js`** — new resilient
  assertion: `refreshButtons <= voiceSectionCount`. The button
  renders any time a tile has both an avatar and a cloned
  voice; mock-mode fixture libraries usually have zero clones
  so the count is `0` in the default smoke pass.

### Docs

- `docs/INVENTORY.md` — endpoint list, route count → 67,
  feature stack reflect PR AV.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "Read-only refresh (PR AV)" subsection covering the route
  shape, gates, and the read-only proof.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AV is
  one finishing step on top of PR AS/AT/AU already documented
  in entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section,
  route count, build sizes.
- `docs/handoffs/SESSION_027_AVATAR_STATUS_REFRESH.md` — this
  file.

## Refresh flow behavior

```
operator clicks "Refresh avatar status" (PR AV)
   ↓ button disables, helper "posting to /refresh-avatar-voice…"
   ↓
POST /api/characters/{id}/refresh-avatar-voice
   ↓ gate: 404 / 409 (no avatar) / 409 (no voice)
   ↓
fetch_avatar_voice(record.runway_avatar_id, settings,
                   avatar_is_mock=…, expected_voice_id=…)
   ├─ mock: short-circuits to mock_verified with resolved id
   └─ real: GET /v1/avatars/{id} → walk voice block →
              verified | unverified | failed
   ↓
compute_voice_drift_status(record.custom_voice_id,
                            state.resolved_id,
                            state.status)
   ├─ "match"   — verified AND ids agree
   ├─ "drift"   — verified AND ids disagree
   └─ "unknown" — verification missing/failed or ids missing
   ↓
store.update(...) — 7 verify+drift fields only
   ↓ NOTE: patch_status / patch_error / patched_at are NOT
   ↓ in the update kwargs, so PR AQ state is preserved
   ↓
returns updated Character
   ↓ frontend updates in place
   ↓ verify+drift pills re-render with the new values
```

## Proof refresh is read/verify-only

The probe matrix exercises the strongest possible read-only
guarantee:

```python
# Setup: clone+apply, capture PR AQ patch state.
patch_before    = after["custom_voice_avatar_patch_status"]
patched_at_before = after["custom_voice_avatar_patched_at"]

# Run refresh five times back-to-back.
for i in range(5):
    refreshed = POST /refresh-avatar-voice
    assert refreshed["custom_voice_avatar_patch_status"] == patch_before
    assert refreshed["custom_voice_avatar_patched_at"] == patched_at_before

# All 5 assertions held: PR AQ fields are byte-identical across refreshes.
```

The route's `store.update(...)` call lists exactly seven
fields — all in the verify/drift family. The PR AQ patch
fields aren't in the kwargs, so the `update_*` storage helper
never receives them and the JSON record's `patch_*` fields
stay untouched. (This is the same mechanism PR AS / PR AT
used for the same atomic-update guarantee.)

## Mock behavior

| Probe | Result |
|---|---|
| Refresh on healthy character (mock avatar + cloned voice) | `verify_status=mock_verified`, `drift_status=match`, `patch_status` unchanged ✅ |
| Refresh without avatar bound | **409** *"no Runway avatar bound to this character yet — create the avatar before refreshing its status."* ✅ |
| Refresh without cloned voice | **409** *"no custom voice cloned for this character yet — drift comparison requires both ids."* ✅ |
| 5 back-to-back refreshes on healthy character | `patch_status` + `patched_at` byte-identical across all 5 calls ✅ |

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **67** (was 66 at PR AU) ✅ |
| `vite build` | 321.88 KB initial / 90.29 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (21.7 s)` ✅ |
| Probe matrix (4 branches) | all green ✅ |
| Hygiene scan (incl. `\.webm`) | empty ✅ |
| Drift guard | `✅ context-kit anchors look recent.` ✅ |

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200
```

After every backend code change in PR AV, the backend was
killed and restarted before the probe + smoke + build. Each
verification ran against fresh code. Servers are stopped at
the end of the session.

## Limitations / follow-ups

- **No automatic polling.** The button is operator-driven;
  there's no background interval or websocket push. A future
  polish could add a small "Auto-refresh every 30s" toggle
  for live drift watching during a real-mode session.
- **No real-mode failure exercised this session.** Mock probe
  proves the wire-level state machine; a real Runway key + a
  flaky GET endpoint would surface `failed` in the verify
  pill. Code review covered the failure branch.
- **No diff display.** The button updates the persisted record
  in place; if the resolved id changed between two refreshes
  the operator can only tell by watching the pill flip
  (or by inspecting the persisted JSON). A future polish
  could surface a small "last refresh: <timestamp>" caption
  next to the verify pill.
- **No batch refresh.** Each tile refreshes independently. If
  the library has 20 characters with avatars + voices, the
  operator would click 20 buttons. A library-level
  "Refresh all" affordance is Tier-3 polish.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT
/ AU / AV slices are all ✅ shipped. Next-tier candidates:

1. **Last-refresh-at caption** — tiny `last refreshed Ns ago`
   line next to the verify pill so the operator can tell at
   a glance how stale the verification is.
2. **Refresh-voice-preview route** — wire the existing
   `fetch_voice_preview` helper to a small route so a missing
   PR AR preview can be re-fetched without a full clone.
3. **Library-level "Refresh all" button** — bulk-trigger
   PR AV refresh for every character with avatar + cloned
   voice in a single click.
4. **Live mic level meter** — `AnalyserNode` + tiny canvas bar
   so the operator knows the mic is hot before recording.
5. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ.

Each is a 1–2 hour slice. None blocking.
