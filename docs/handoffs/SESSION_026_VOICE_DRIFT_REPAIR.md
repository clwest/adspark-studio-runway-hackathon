# SESSION 026 — Voice Drift Repair Action (PR AU)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AU patch in flight on top of `632b696`
`feat: detect drift between cloned and avatar voice`; commit +
push pending after this handoff lands)
**Builds on:** SESSION_025 (PR AT Voice Drift Detection),
SESSION_024 (PR AS Avatar Resource Introspection), SESSION_023
(PR AR Cloned Voice Preview), SESSION_022 (PR AQ Avatar Voice
Swap), SESSION_021 (PR AP Recording Preview), SESSION_020
(PR AO Browser Recording), SESSION_019 (PR AN Custom Voice
Cloning), and the rest of SESSION_011–SESSION_018.

## Goal

PR AT detects drift but doesn't fix it. PR AU closes the
clone → apply → preview → verify → detect loop with a one-click
**repair** action so an operator who sees the rose
*"Avatar voice mismatch"* pill never has to leave Character
Studio to re-bind the cloned voice.

PR AU is the smallest possible slice that delivers the brief:
- One frontend button (rose, mirrors the drift pill).
- One handler that reuses the existing apply-voice helper.
- Compact busy/error state.
- No new backend route.

Hard scope locks (carried forward from the brief):
- No voice A/B switching.
- No voice library management.
- No voice deletion.
- No UI redesign.

## Endpoint inventory

PR AU adds **no new routes**. Route count stays at **66**.

The existing `POST /api/characters/{id}/apply-voice` already
runs the full pipeline:

```
POST /apply-voice
  ├─ PR AQ — apply_voice_to_avatar (PATCH /v1/avatars/{id})
  ├─ PR AS — fetch_avatar_voice (GET /v1/avatars/{id} → resolved fields)
  └─ PR AT — compute_voice_drift_status (resolved vs custom)
       → returns updated Character with patch + verify + drift fields
```

Repair == apply. The button label changes for the operator's
sake but the wire effect is identical, so introducing a
parallel `/repair-voice-drift` alias would add a route count
without functional value. The brief explicitly preferred
reuse: *"Prefer reusing POST /api/characters/{id}/apply-voice
if it already performs PATCH avatar voice, verify avatar voice,
compute drift."*

## What changed

### Frontend

- **`frontend/src/components/CharacterCard.jsx`**:
  - New local state: `repairBusy`, `repairError`.
  - New `handleRepairDrift` handler — same body as the existing
    PR AQ `handleApplyVoice`, with its own busy + error state
    so the rose drift button never collides with PR AQ's
    "Apply to existing avatar" button (which only renders on
    the `failed` patch branch).
  - **New "Repair voice drift" button** rendered below the
    pill row, gated on
    `customVoiceReady && (patchApplied || patchMock) && driftDrift && onApplyVoiceToAvatar`.
    Disabled while the request is in flight. `data-testid="custom-voice-repair-drift"`.
  - **Status row** below the button:
    - busy → *"posting to /apply-voice…"* (zinc)
    - error → the message (rose)
    - `data-testid="custom-voice-repair-status"`.
- **`frontend/tests/adspark-smoke.spec.js`** — new resilient
  assertion: `repairButtons <= verifyDrift`. Mock fixture
  libraries usually have zero drift so the button never
  renders; an operator who manually mutates `characters.json`
  to simulate drift would see one button per drift pill,
  never more.

### Backend

- **No changes.** The brief named the
  `POST /apply-voice` route as the preferred reuse target;
  it already returns the four fields the brief lists
  (`custom_voice_avatar_patch_status`,
  `avatar_voice_verify_status`, `avatar_voice_resolved_id`,
  `avatar_voice_drift_status`).

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR AU; route
  count narrative confirms unchanged at 66.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "One-click drift repair (PR AU)" subsection.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AU is one
  finishing step on top of PR AN/AQ/AS/AT already documented in
  entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section + build
  sizes / route count.
- `docs/handoffs/SESSION_026_VOICE_DRIFT_REPAIR.md` — this
  file.

## Existing apply route reused vs new repair route added

**Reused.** `POST /api/characters/{id}/apply-voice` is
semantically identical to the operator-facing "repair"
intent — the route already runs PATCH + verify + drift and
returns the updated Character with all four fields the brief
called out:

```json
{
  ...
  "custom_voice_avatar_patch_status": "applied",
  "avatar_voice_verify_status":       "verified",
  "avatar_voice_resolved_id":         "voice_<id>",
  "avatar_voice_drift_status":        "match"
}
```

The frontend just calls the existing helper
`api.applyCharacterVoiceToAvatar(characterId)` from the rose
button instead of introducing a new alias route + helper.

## Repair flow behavior

```
operator sees rose "Avatar voice mismatch" pill (PR AT)
   ↓
clicks "Repair voice drift" (PR AU)
   ↓ button disables, helper text "posting to /apply-voice…"
   ↓
POST /api/characters/{id}/apply-voice
   ↓ (PR AQ) PATCH /v1/avatars/{id} {voice: {type: "custom", voiceId: <id>}}
   ↓ (PR AS) GET /v1/avatars/{id} → resolved type/id/label
   ↓ (PR AT) compute_voice_drift_status(custom, resolved, verify_status)
   ↓
returns updated Character record
   ↓ frontend updates in place; rose pill flips back to emerald
   ↓ if PATCH or verify failed, the existing PR AQ patch-failed pill +
     PR AS unverified pill render instead — operator sees what's
     actually broken
```

In mock mode, the verify helper synthesises the resolved id
from the supplied `expected_voice_id` (which is the character's
current `custom_voice_id`), so `apply-voice` always converges
to `match`. End-to-end drift→repair→match is provable via direct
JSON mutation (see "Mock behavior" below).

## Mock behavior

Verified via probe matrix:

| Probe | Result |
|---|---|
| Manually inject `drift` state via JSON mutation, then `POST /apply-voice` | `drift_status` flips back to `match`; `resolved_id` === `custom_voice_id` ✅ |
| `POST /apply-voice` without cloned voice | **409** (PR AQ contract preserved) ✅ |
| `POST /apply-voice` with cloned voice but no avatar | `pending_avatar` + `drift_status=unknown` (PR AQ contract preserved) ✅ |
| Normal `apply-voice` on non-drifted character | `match` (no regression) ✅ |

The repair button itself only renders on the rose pill, so the
operator never sees it on a healthy character.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **66** (unchanged) ✅ |
| `vite build` | 320.61 KB initial / 90.05 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (26.0 s)` ✅ |
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

After the frontend code change, the backend stayed live (no
backend changes). Smoke + build + probe all ran against fresh
processes. Servers stopped at end of session.

## Limitations / follow-ups

- **No "what changed" trace.** The repair button flips the
  pill but doesn't surface a "before / after" diff (e.g.
  *"avatar was bound to voice_X, now bound to voice_Y"*). A
  future polish could persist a `voice_repair_history` slot
  and surface a small log on hover.
- **No automatic retry on transient failure.** A flaky Runway
  endpoint mid-repair surfaces the error inline; the operator
  clicks again. Acceptable for V1; a circuit-breaker / retry
  budget could land later.
- **No batch repair.** If 5 characters drifted simultaneously
  the operator clicks each tile's repair button individually.
  Tier-3 polish.
- **Repair button only renders for ready avatars.** Drift on a
  character with a failed/missing avatar is impossible (drift
  requires `verified` / `mock_verified`), so this isn't a
  practical gap — but a future edge-case audit could cover it.
- **Mock mode never produces drift end-to-end through the
  routes.** Drift is exercised via direct JSON mutation. The
  helper-level (`compute_voice_drift_status`) coverage proves
  the branch; a real Runway key is the only way to see drift
  arise organically.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT /
AU slices are all ✅. Next-tier candidates:

1. **Avatar status manual refresh** — small button to re-run
   `GET /v1/avatars/{id}` without a fresh apply, so an
   operator can poll the avatar resource on demand.
2. **Refresh-voice-preview route** — wire the existing
   `fetch_voice_preview` helper to a route so a missing
   PR AR preview can be re-fetched without a full clone.
3. **Live mic level meter** — `AnalyserNode` + tiny canvas bar
   so the operator knows the mic is hot before recording.
4. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ.
5. **Voice repair history** — tiny audit trail on the
   character record so each repair produces a short log row
   (`{timestamp, before_id, after_id}`); pairs with PR AU.

Each is a 1–2 hour slice. None blocking.
