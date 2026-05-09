# SESSION 024 — Avatar Resource Introspection After Voice Patch (PR AS)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AS patch in flight on top of `5aa5579`
`feat: surface cloned voice preview audio`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_023 (PR AR Cloned Voice Preview),
SESSION_022 (PR AQ Avatar Voice Swap), SESSION_021 (PR AP
Recording Preview), SESSION_020 (PR AO Browser Recording),
SESSION_019 (PR AN Custom Voice Cloning), and the rest of
SESSION_011–SESSION_018.

## Goal

PR AQ trusts a 2xx `PATCH /v1/avatars/{id}` response as proof
that the cloned voice bound to the avatar. PR AR surfaced the
clone result audibly. PR AS adds the **verification step** that
closes the persistent-voice-identity loop end-to-end:

```
record/upload (AN/AO/AP) →
  clone (AN, preview captured AR) →
    apply (AQ PATCH) →
      verify (AS — this slice)
```

Hard scope locks (carried forward from the brief):
- No voice library management.
- No voice deletion.
- No A/B voice swap.
- No UI redesign.

## Endpoint inventory

PR AS adds **no new routes**. Route count stays at **66**.

The verification runs as a side-effect inside the existing
`POST /clone-voice` (after the auto-PATCH) and
`POST /apply-voice` (after the manual PATCH). Both routes
already had the `apply_voice_to_avatar(...)` call from PR AQ;
PR AS chains a `fetch_avatar_voice(...)` call after it.

## What changed

### Backend

- **`backend/app/services/voice_clone_client.py`**:
  - **`AvatarVoiceState`** dataclass mirrors the persisted
    enum (`verified` / `mock_verified` / `unverified` /
    `failed`) plus `resolved_type` / `resolved_id` /
    `resolved_label` / `error`.
  - **`_extract_voice_block(payload)`** — tolerant key walker
    that accepts `voice` / `voiceBlock` / `voice_block`.
    Returns `None` for missing / non-dict inputs.
  - **`_resolve_voice_fields(block)`** — pulls
    `(type, voiceId, label)` out of a voice block. Tolerant of
    `type` / `voiceType`, `voiceId` / `voice_id` / `id`,
    `name` / `label` / `presetId`. First non-empty match per
    slot; missing values stay `None` so the persistence layer
    can write a partial record.
  - **`fetch_avatar_voice(avatar_id, settings, *,
    avatar_is_mock, expected_voice_id)`** — public entry.
    Mock-aware (any mock id or `runway_mock` short-circuits to
    `mock_verified`). Real-mode runs `GET /v1/avatars/{id}`
    and walks the response. Never raises; HTTP / network /
    parse errors all surface as `failed`. An empty / shape-
    drift voice block surfaces as `unverified`.
- **`backend/app/models.py`** — six new optional `Character`
  fields:
  ```python
  avatar_voice_resolved_type:  Optional[str]
  avatar_voice_resolved_id:    Optional[str]
  avatar_voice_resolved_label: Optional[str]
  avatar_voice_verify_status:  Optional[Literal["verified", "mock_verified", "unverified", "failed"]]
  avatar_voice_verified_at:    Optional[datetime]
  avatar_voice_verify_error:   Optional[str]
  ```
- **`backend/app/routers/characters.py`**:
  - New module-level helper
    `_verify_avatar_voice_after_patch(record, expected_voice_id, settings, apply_status)`
    that gates the GET on the apply state (`pending_avatar` →
    skip). Returns `(state, verified_at | None)`.
  - `post_clone_voice` and `post_apply_voice_to_avatar` both
    call the helper after their PATCH and persist all six
    fields atomically alongside the existing PR AQ patch
    fields.
- **`backend/app/services/character_store.py`** unchanged — the
  generic `update(character_id, **fields)` helper handles the
  new fields without modification.

### Frontend

- **`frontend/src/components/CharacterCard.jsx`**:
  - New derivations: `verifyStatus`, `verifyVerified`,
    `verifyMock`, `verifyUnverified`, `verifyFailed`,
    `verifyResolvedId`, `verifyResolvedType`,
    `verifyResolvedLabel`, `verifyShouldRender` (gates on
    cloned voice + applied/mock_patched state).
  - **Third pill** in the voice-section pill row, sitting
    after PR AQ's patch-status pill:
    - `Avatar using cloned voice` (emerald) when verified
    - `Avatar using cloned voice · mock` (amber) when mock_verified
    - `Avatar voice unverified` (grey or rose) when
      unverified / failed
    - `Avatar voice pending` (grey) when patch landed but
      verification hasn't run yet
  - Tooltips surface the resolved id/type or the verify
    error so the operator can debug without opening
    DevTools.
  - `data-testid` hooks: `custom-voice-avatar-resolved`
    (success states), `custom-voice-avatar-unverified`
    (failure states).
- **`frontend/tests/adspark-smoke.spec.js`** — new resilient
  assertion: `verifyResolved + verifyUnverified <= patchPills`.
  Holds whether the library has zero clones, all mock clones,
  or real-mode mixes.

### Docs

- `docs/INVENTORY.md` — service-inventory row for
  `voice_clone_client.py` + feature stack reflect PR AS;
  route-count narrative confirms unchanged at 66.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "Verifying the avatar bind (PR AS)" subsection covering the
  state machine, the tolerant payload extraction, and the
  failure modes.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AS is one
  finishing step on top of PR AN/AQ already documented in
  entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section + build
  sizes / route count.
- `docs/handoffs/SESSION_024_AVATAR_VOICE_INTROSPECTION.md` —
  this file.

## Introspection payload / extraction behavior

```
GET /v1/avatars/{avatar_id}  →  {id, status, voice|voiceBlock|voice_block: {...}, ...}
                                  │
                                  ▼ _extract_voice_block(payload)
                                  │   first match: voice → voiceBlock → voice_block
                                  │
                                  ▼ _resolve_voice_fields(block)
                                  │   type      ← block.type / block.voiceType
                                  │   voiceId   ← block.voiceId / block.voice_id / block.id
                                  │   label     ← block.name / block.label / block.presetId
                                  │
                                  ▼ AvatarVoiceState
                                      status:        verified
                                      resolved_type: "custom"
                                      resolved_id:   "voice_..."
                                      resolved_label: "Founder Voice" (when present)
```

If `_extract_voice_block` returns `None` or
`_resolve_voice_fields` returns all `None`, the helper writes
`unverified` with `error="avatar response carried no voice
block"`. Real-mode HTTP / network / non-JSON errors surface as
`failed`. Mock paths skip the GET entirely and synthesise
`mock_verified` from the `expected_voice_id` argument.

The route layer caps the introspection at apply states that
imply a bind: `applied` and `mock_patched`. `pending_avatar`
skips the GET (no avatar to introspect) and stores `failed`
with `error="no avatar bound"` — but the PR AQ
`pending_avatar` pill still renders correctly above it because
the verify pill has a `verifyShouldRender` guard that requires
applied/mock_patched.

## Mock behavior

| Probe | Result |
|---|---|
| Clone+auto-apply for mock avatar | `verify_status=mock_verified`, `resolved_type=custom`, `resolved_id=<voice_id>`, `resolved_label="mock · <voice_id>"`, `verified_at` populated ✅ |
| Manual `POST /apply-voice` on mock avatar | `verify_status=mock_verified` re-recorded ✅ |
| `POST /apply-voice` without cloned voice | **409** unchanged (PR AQ contract) ✅ |
| Clone-first then create-avatar | `custom_voice_id` retained through avatar create — PR AN binding preserved ✅ |
| `_extract_voice_block` against `voice` / `voiceBlock` / `voice_block` / `{}` / `"garbage"` | 5/5 expected ✅ |
| `_resolve_voice_fields` with mixed key casings + whitespace + empty | 4/4 expected ✅ |

The mock-mode label keeps the `mock · ` prefix so an operator
glancing at the resolved tooltip can tell the binding wasn't
actually verified upstream.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **66** (unchanged) ✅ |
| `vite build` | 319.56 KB initial / 89.79 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (23.0 s)` ✅ |
| Probe matrix (4 branches + 9 helper cases) | all green ✅ |
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

Backend was killed and restarted before the probe + smoke +
build. Each verification ran against fresh code. Servers are
stopped at the end of the session.

## Limitations / follow-ups

- **Real-mode path not exercised this session.** The mock
  smoke + helper coverage prove the wire-level state machine;
  the real-mode `verified` branch needs a live Runway key + a
  real avatar id, which is out of scope.
- **No retry on `unverified`.** A genuinely empty voice block
  on the avatar response stays `unverified`. The operator can
  trigger another `POST /apply-voice` (which re-runs both the
  PATCH and the verify) but there's no automatic refresh.
- **No comparison with the cloned voice id.** The verify state
  records the resolved id; we don't currently flag a mismatch
  between `custom_voice_id` and `avatar_voice_resolved_id`. A
  future polish could split the pill into `verified` (ids
  match) vs `verified · drift` (avatar bound to a different
  voice).
- **No per-field tooltip.** The pill carries one tooltip with
  the resolved id/type or error; a richer popover with all
  three resolved fields could land in a future polish.
- **Verification doesn't fire on idle character loads.** Only
  fires inside the clone/apply routes. Stale character records
  loaded from disk keep whatever `verify_status` was persisted
  last; the operator's next clone or apply will refresh it.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS slices
are all ✅ shipped. Next-tier candidates:

1. **Voice-id drift detection** — flag `verified · drift`
   when `avatar_voice_resolved_id != custom_voice_id` after
   PATCH. Helps operators spot Runway server-side issues
   that silently revert the bind.
2. **Refresh-voice-preview route** — wire
   `fetch_voice_preview` to a small `POST /api/characters/{id}/refresh-voice-preview`
   so a missing PR AR preview can be re-fetched without a
   full clone.
3. **Live mic level meter** — `AnalyserNode` + tiny canvas bar
   so the operator knows the mic is hot before recording.
4. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ so operators maintain multiple
   session replays per campaign.
5. **Avatar status refresh** — `GET /v1/avatars/{id}` on
   demand (manual button) to refresh the resolved state
   without re-running the apply flow.

Each is a 1–2 hour slice. None blocking.
