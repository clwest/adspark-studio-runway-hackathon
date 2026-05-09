# SESSION 014 — Avatar documentIds for Grounded Realtime (PR AI)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AI patch in flight on top of `6157512`
`feat: add captioned reels exports`; no commit yet — pending
explicit user approval)
**Builds on:** SESSION_013 (PR AH Captioned Reels), SESSION_012
(PR AG Vertical / Reels), SESSION_011 anchors at `ec446e4`.

## Goal

Land the Tier-1 #2 candidate from SESSION_011: ground the
realtime avatar in attached **brand/campaign documents** instead
of relying solely on the inline `personality` string. The avatar
becomes a persistent brand spokesperson that can answer questions
from a factual source rather than improvising over a long prompt.

Hard scope locks (carried forward from the brief):
- No transcript replay (still deferred).
- No new generation modes.
- No avatar PATCH-leak across campaigns by default (per-session
  documentIds is the primary path).
- No UI redesign — the grounding affordance is one card, one
  badge, one button.

## Endpoint inventory

PR AI adds **one new route** and changes the **realtime broker**
body shape. Route count: 61 → **62**.

```
POST /api/campaigns/{id}/realtime-document   (PR AI — new)
POST /api/campaigns/{id}/spokesperson-session (broker now sends
                                              documentIds when
                                              campaign has one)
```

## What changed

### Backend

- **`backend/app/services/documents_client.py` (new, ~210 LOC)**:
  - `DocumentResult` dataclass: `status` (`ready` / `failed` /
    `mock`), `document_id`, `error`, `mock_mode`.
  - `create_document(name, content, settings)` — `POST /v1/documents`
    with `{name, content}`. Trims to 40,000 chars / 120-char name.
    Mock mode returns deterministic `mock_doc_<sha256[:16]>` ids
    keyed off `name + content` so re-attaching with the same brief
    is idempotent and an edited script yields a new id.
  - `attach_documents_to_avatar(avatar_id, document_ids, settings)` —
    best-effort `PATCH /v1/avatars/{id}` with `{documentIds: […]}`.
    Skipped in mock mode. Failure is logged + non-fatal; the route
    relies on the per-session `documentIds` body for primary
    grounding so a PATCH miss doesn't break realtime.
  - `build_campaign_brief_markdown(campaign, character)` — composes
    the standard Markdown brief from business / product / audience
    / tone / selected concept / `commercial_script` / Character
    fields + a behaviour-rule block. Returns `(name, content)`
    ready for `create_document`.
- **`backend/app/services/realtime_avatar_client.py`**:
  - New `_grounded_personality(campaign, settings)` — slim
    personality (~300 chars) used when a document is attached;
    explicitly references "An attached campaign brief document
    carries the product, audience, hook, caption, CTA, and saved
    commercial script." so the avatar grounds answers there.
  - `create_session` now assembles `documentIds=[…]` and swaps in
    `_grounded_personality` when `campaign.runway_document_id` +
    `runway_document_status ∈ {ready, mock}`.
  - **Two-tier 400-fallback** (replaces the single PR AE retry):
    1. If `documentIds` was sent and Runway 400s, retry without
       `documentIds` (keep personality + startScript).
    2. If that still 400s, fall back to the bare `{model, avatar}`
       body — same as pre-PR-AE behaviour.
  - `_redact()` continues to scrub Bearer / sessionKey / JWT
    patterns from any logged upstream response.
- **`backend/app/routers/campaigns.py`**:
  - New route handler `post_attach_realtime_document` (~70 LOC):
    1. Build the Markdown brief from the campaign + attached
       Character.
    2. `runway_create_document(name, content, settings)`.
    3. On `failed`, persist a `failed` status with the upstream
       error and surface a 502.
    4. On `ready` / `mock`, persist the doc id + status + mock flag.
    5. Best-effort `runway_attach_documents` against the resolved
       avatar (skipped in mock + when avatar is mock/unset).
- **`backend/app/services/storage.py`**: new
  `update_realtime_document_fields` helper.
- **`backend/app/models.py`**: four new optional fields on
  `Campaign`: `runway_document_id`, `runway_document_status`
  (`ready` / `failed` / `mock`), `runway_document_error`,
  `runway_document_mock_mode`.

### Frontend

- **`frontend/src/api.js`** — `attachRealtimeDocument(campaignId)`
  helper.
- **`frontend/src/components/CampaignGallery.jsx`**:
  - One new busy flag: `realtimeDocBusy`.
  - One new handler: `handleAttachRealtimeDocument`.
  - Two new derivations on the saved card: `grounded`,
    `groundedMock`, `groundingFailed`.
  - **New "Realtime grounding" card** at the top of the Realtime
    tab with three states:
    - `Prompt-grounded` (grey pill) — default; broker uses
      personality + startScript only.
    - `Document-grounded` (emerald pill) — `documentIds=[id]`
      sent on every session create.
    - `Document-grounded · mock` (amber pill) — same wiring, but
      the operator can see the doc id is a mock so they don't
      mistake the demo for a live grounded session.
  - **`Attach grounding doc`** / **`Refresh grounding doc`**
    button (single button, label adapts to current state) with
    `data-testid="attach-realtime-doc"` and the badge tagged
    `data-testid="realtime-grounding"` for future test reach.
  - Inline error row when status is `failed`.
- **`frontend/tests/adspark-smoke.spec.js`** — new assertions on
  the Realtime tab confirm the grounding card renders with the
  default `Prompt-grounded` badge and the attach button.

### Docs

- `docs/INVENTORY.md` — finisher row + service inventory now
  document the documents_client; route count → 62; endpoint list +
  feature stack + RAG-limitation entry updated.
- `docs/OPERATOR_USAGE_MAP.md` — Realtime §8 expanded with
  campaign-context detail (PR AE + PR AI), attach-doc
  walkthrough, two-tier 400-fallback wording. Path F demo updated
  with the optional Attach-grounding-doc step.
- `docs/WHAT_IT_IS.md` — narrative anchor entry 16 reflects the
  PR AI grounding behaviour.
- `00-START-NEXT-SESSION.md` — Conversation-layer section + next-
  phases checklist + headline build sizes.
- `docs/handoffs/SESSION_014_AVATAR_DOCUMENT_GROUNDING.md` —
  this file.

## Mock behaviour

Mock mode (`RUNWAY_API_KEY=` `OPENAI_API_KEY=`
`IMAGE_GEN_PROVIDER=mock`) produces deterministic
`mock_doc_<sha256-of-name+content>[:16]` ids on every
`POST /api/campaigns/{id}/realtime-document` call. Verified end
to end during this session:

| Probe | Result |
|---|---|
| Default state of a fresh campaign | `runway_document_id = null` → badge shows `Prompt-grounded` |
| Mock attach | `runway_document_id = mock_doc_68d1b034a2c43802`, `runway_document_status = mock`, `runway_document_mock_mode = true` |
| Re-attach idempotency (same content) | identical id returned |
| Re-attach after editing `commercial_script` | new id generated (`mock_doc_3d118b392c7374a0`) |
| Realtime broker dry-run | mock mode raises 503 (expected); doc-id branch reachable in code via direct overrides probe |
| Personality shrink under grounding | full = 405 chars → grounded = 322 chars (~20 % smaller) |
| Body assembly | broker produces keys `['avatar', 'documentIds', 'model', 'personality', 'startScript']` with `documentIds=[mock_doc_…]` |

## Verification (this session)

Servers were killed and restarted fresh in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **62** (was 61 at PR AH) |
| `vite build` | 295.83 KB initial / 84.01 KB gzip + 561.97 KB lazy |
| Playwright mock smoke | `1 passed (23.0 s)` |
| End-to-end mock probe | doc create → idempotency → re-create on edit → broker body assembly all green |
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

Both processes were restarted before any new probe / smoke ran.
The previous PR AH worker had been started under stale code; the
new processes loaded `documents_client.py`, the new model fields,
and the updated broker.

## Limitations / follow-ups

- **PATCH /v1/avatars leaks across campaigns.** When a Character
  avatar is shared between Campaign A and Campaign B, attaching
  Doc-A then Doc-B via PATCH leaves the avatar bound to both.
  AdSpark mitigates this with the **per-session `documentIds`
  body as the primary path** — the broker always overrides
  whatever PATCH set. The PATCH itself is best-effort and only
  affects external direct-to-avatar callers. A Tier-2 polish
  could instead store a per-campaign avatar variant or skip the
  PATCH entirely.
- **Document content is regenerated, not authored.** The brief
  comes from the saved campaign + attached Character. Brands
  that want richer FAQs / product catalogues need a separate
  upload UI; deferred. Today's content is a deterministic
  Markdown summary.
- **No document deletion route.** Re-attaching with new content
  creates a new Runway document; the old id is replaced on the
  campaign record but the underlying Runway document persists in
  the account. A janitor route is one line if it ever matters.
- **Token budget (~50k tokens / avatar)** isn't enforced
  client-side. The 40k-char trim in `documents_client.py` is a
  generous safety margin against the wire limit but doesn't map
  exactly to tokens.
- **Mock mode docs are visible only via the badge + persisted
  fields.** The realtime broker still returns 503 in mock so the
  end-to-end live grounded conversation can't be exercised
  without a real Runway key. The probe + the direct-call coverage
  show the body assembly is correct.
- **No transcript retrieval (per scope lock).** The grounded
  realtime experience still has no "replay" surface.

## Recommended next slice

Tier-1 candidates remaining from SESSION_011:

1. **Conversation transcript retrieval** —
   `GET /v1/avatar_conversations/{id}` for "replay your chat"
   UX. Pairs naturally with the now-grounded realtime since the
   answers are factual + auditable.
2. **Brand colour storage** — a small Character / Campaign field
   that the existing `build_reels_export(backdrop_color=…)`
   parameter already accepts. Cheap polish that ties into PR AG +
   the grounded realtime brand consistency story.
3. **Custom voice cloning** (`POST /v1/voices` `from.type=audio`)
   — only worth doing once a brand actually has a 30-second
   founder voice sample on hand; not a demo blocker.
4. **Document attachment / refresh telemetry** in the Realtime
   tab — small log of when the doc was last refreshed and how
   many chars are being grounded.
