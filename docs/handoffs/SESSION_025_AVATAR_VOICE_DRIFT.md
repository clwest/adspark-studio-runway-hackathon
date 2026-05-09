# SESSION 025 — Avatar Voice Drift Detection (PR AT)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AT patch in flight on top of `2321fd7`
`feat: verify avatar voice bind after patch`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_024 (PR AS Avatar Resource Introspection),
SESSION_023 (PR AR Cloned Voice Preview), SESSION_022 (PR AQ
Avatar Voice Swap), SESSION_021 (PR AP Recording Preview),
SESSION_020 (PR AO Browser Recording), SESSION_019 (PR AN Custom
Voice Cloning), and SESSION_011–SESSION_018.

## Goal

PR AS verifies the avatar voice block after a PATCH but trusts
the resolved id without comparing it to the character's cloned
id. PR AT closes the loop: a single drift-aware pill in
Character Studio so operators can see at a glance whether the
avatar is **really** speaking with the cloned voice or has
silently reverted to a different binding.

PR AT is intentionally a **finishing slice**:
- One pure helper.
- One persisted Character field.
- No new routes (computed inside the existing PR AS
  `_verify_avatar_voice_after_patch`).
- One pill consolidation on the frontend.

Hard scope locks (carried forward from the brief):
- No voice library management.
- No voice deletion.
- No A/B voice swap.
- No UI redesign.

## Endpoint inventory

PR AT adds **no new routes**. Route count stays at **66**.

Drift state is computed inside the same shared route helper
(`_verify_avatar_voice_after_patch`) that PR AS already runs.
Both `POST /clone-voice` and `POST /apply-voice` call it; both
now persist `avatar_voice_drift_status` atomically alongside the
PR AS verify fields.

## What changed

### Backend

- **`backend/app/services/voice_clone_client.py`**:
  - **`compute_voice_drift_status(custom_voice_id, resolved_id, verify_status)`** —
    pure 3-state classifier. Case-insensitive id comparison after
    whitespace strip; whitespace-only ids treated as missing.
    Verification statuses other than `verified` /
    `mock_verified` short-circuit to `unknown`.
  - `DRIFT_VERIFIED_STATUSES = ("verified", "mock_verified")`
    constant so the wire vocabulary stays loud.
- **`backend/app/models.py`** — one new optional `Character`
  field:
  ```python
  avatar_voice_drift_status: Optional[Literal["match", "drift", "unknown"]]
  ```
- **`backend/app/routers/characters.py`**:
  - `_verify_avatar_voice_after_patch` return widened from
    `(state, verified_at)` to
    `(state, verified_at, drift_status)`. The
    `pending_avatar` skip path returns `("unknown" drift)`.
  - `post_clone_voice` and `post_apply_voice_to_avatar` both
    unpack the new tuple member and persist
    `avatar_voice_drift_status=drift_status` atomically with
    the existing PR AS fields.

### Frontend

- **`frontend/src/components/CharacterCard.jsx`**:
  - New derivations: `driftStatus`, `driftMatch`, `driftDrift`,
    `driftUnknown`. The `verifyVerified` / `verifyUnverified` /
    `verifyFailed` granularity from PR AS is consumed by
    `driftUnknown` instead of rendered separately.
  - **Consolidated pill render** with three operator-facing
    branches:
    | Branch | Pill copy | Colour | testid |
    |---|---|---|---|
    | `match` (mock) | "Avatar using cloned voice · mock" | amber | `custom-voice-avatar-resolved` |
    | `match` (real) | "Avatar using cloned voice" | emerald | `custom-voice-avatar-resolved` |
    | `drift` | "Avatar voice mismatch" | rose | `custom-voice-avatar-drift` |
    | `unknown` | "Avatar voice unverified" | grey / rose | `custom-voice-avatar-unverified` |
    | (no verify yet) | "Avatar voice pending" | grey | `custom-voice-avatar-unverified` |
  - Drift pill tooltip surfaces the expected vs resolved ids:
    *"expected voice.X but avatar resolves to Y"*.
  - `data-drift` attribute on every pill (`match` / `drift` /
    `unknown` / `pending`) for finer-grained future tests.
- **`frontend/tests/adspark-smoke.spec.js`** — extended the
  resilient assertion to cover the new `custom-voice-avatar-drift`
  testid alongside the existing resolved + unverified pills.
  Combined count across all three is still bounded by the
  patch-pill count.

### Docs

- `docs/INVENTORY.md` — service-inventory row + feature stack
  reflect PR AT; route-count narrative confirms unchanged at 66.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 verify pill
  table updated with the drift state matrix; new "Drift detection
  logic (PR AT)" subsection.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AT is one
  finishing step on top of PR AN/AQ/AS already documented in
  entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section + build
  sizes / route count.
- `docs/handoffs/SESSION_025_AVATAR_VOICE_DRIFT.md` — this file.

## Drift detection logic

```
compute_voice_drift_status(custom_voice_id, resolved_id, verify_status)
  └─ verify_status not in {"verified", "mock_verified"}   → "unknown"
  └─ custom_voice_id missing / whitespace-only            → "unknown"
  └─ resolved_id missing / whitespace-only                → "unknown"
  └─ ids match (case-insensitive after whitespace strip)  → "match"
  └─ otherwise                                            → "drift"
```

Why case-insensitive: Runway's voice ids look like
`voice_a1b2c3d4` but a future server-side rename to a UUID-like
upper-case format shouldn't trigger spurious drift. The cost of
the looser comparison is minimal (collision probability with
case-only differences is ~zero in real ids).

Why whitespace-strip: extraction tolerates variations from
PR AR / PR AS that may yield surrounding whitespace; the drift
helper keeps that contract.

## Mock behavior

Mock mode short-circuits inside PR AS's `fetch_avatar_voice` so
the resolved id is **always** equal to the supplied
`expected_voice_id` (which is the character's
`custom_voice_id`). So mock-mode end-to-end clone+apply always
produces `match`. Drift can only happen in real mode (where the
GET returns a different resolved id).

| Probe | Result |
|---|---|
| Helper `compute_voice_drift_status` (12 cases) | all green ✅ |
| Mock clone+auto-apply | drift_status = `match` ✅ |
| Pending avatar (no bind) | drift_status = `unknown` ✅ |
| Manual mutation + re-apply (mock) | drift_status = `match` (mock helper resolves new id) — drift exercised at helper level only ✅ |

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **66** (unchanged) ✅ |
| `vite build` | 319.70 KB initial / 89.89 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (22.0 s)` ✅ |
| Helper coverage probe | 12/12 cases match expected ✅ |
| End-to-end probe matrix | clone+apply mock → match; pending avatar → unknown; mutation re-apply → match ✅ |
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

After every backend code change in PR AT, the backend was
killed and restarted before the probe + smoke + build. Servers
are stopped at the end of the session.

## Limitations / follow-ups

- **Mock mode never triggers drift.** PR AS's mock helper
  resolves the avatar voice to the supplied
  `expected_voice_id`, so end-to-end mock probes always
  produce `match`. The helper-level coverage proves the drift
  branch; a real Runway key would exercise drift in the route
  layer. Acceptable: drift is operationally a real-world
  concern, not a mock-mode rendering question.
- **No alert / notification on drift.** The pill flips colour
  but there's no operator notification (toast, banner, etc).
  A future polish could wire a small alert for repeat drift.
- **No automatic remediation.** When drift is detected the
  operator has to manually click `Apply to existing avatar`
  again or recreate the avatar. A `repair-drift` route could
  re-run the apply automatically.
- **No drift history.** Each PATCH+verify overwrites the
  drift status; we don't record a timeline of drift events.
- **No granular "what drifted" copy** beyond the tooltip. The
  pill just says *"Avatar voice mismatch"*; the tooltip
  surfaces expected vs resolved ids but a popover with both
  + the verify timestamp could land in a future polish.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT
slices are all ✅ shipped. Next-tier candidates:

1. **Drift remediation route** — `POST /api/characters/{id}/repair-voice-drift`
   that re-runs the PR AQ apply + PR AS verify when drift is
   detected. Pairs with a `Repair drift` button that only
   renders on the rose pill.
2. **Refresh-voice-preview route** — wire the existing
   `fetch_voice_preview` helper to a small route so a missing
   PR AR preview can be re-fetched without a full clone.
3. **Live mic level meter** — `AnalyserNode` + tiny canvas bar
   so the operator knows the mic is hot before recording.
4. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ so operators maintain multiple
   session replays per campaign.
5. **Avatar status refresh** — manual button to re-run
   `GET /v1/avatars/{id}` without a fresh apply.

Each is a 1–2 hour slice. None blocking.
