# Runway Realtime Spokesperson — V1 Spike

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-i-realtime-spokesperson`
**Status:** RESEARCH ONLY at the time of writing this section. Backend
+ frontend implementation begins after this note is committed.

> Background: PR F V2 ships a per-campaign Brand Spokesperson Runway
> Avatar that records an Avatar Host Clip via async `/v1/avatar_videos`.
> Phase I adds a small, opt-in **realtime conversation** layer on top —
> "Talk to your Brand Spokesperson" — using `/v1/realtime_sessions` +
> the `@runwayml/avatars-react` SDK.  No existing async flow changes.

---

## TL;DR

Realtime works, end-to-end, with the existing PR F V2 avatar id. The
session creation shape is a **near-clone of `avatar_videos`** —
`{model: "gwm1_avatars", avatar: {type: "custom", avatarId}}`. There
is **no separate `/consume` endpoint**; the WebRTC credentials arrive
inside the GET session-detail response when status flips to `READY`.
A single short token (`sessionKey`, JWT-shaped) is everything the
browser needs to hand to `<AvatarCall sessionKey={…} />` and connect.
**5-minute session duration cap** plus a shorter "no participant
joined" timeout (≈20–30 s) means the broker must hand the
`sessionKey` to the browser fast and the browser must connect
immediately. Mic-only is the safe default; webcam is optional via the
SDK.

**GO on building V1** as scoped — broker route + isolated
`RealtimeSpokesperson.jsx` component wrapping `<AvatarCall>`.

---

## Live probe results

Two real sessions were created during this probe; both were cancelled
before completing a WebRTC connection. Net spend was a few seconds of
Runway compute — well under one credit per attempt.

### `POST /v1/realtime_sessions` — confirmed

Accepted body shape:

```jsonc
{
  "model": "gwm1_avatars",
  "avatar": { "type": "custom", "avatarId": "<existing avatar id>" }
}
```

- `model` is a single allowed value: `"gwm1_avatars"` (same enum used
  by `/v1/avatar_videos` and the realtime SDK).
- `avatar.type` discriminator is `"custom"` (same as
  `avatar_videos`).  Field name inside is `avatarId` (not `id`).
- Re-uses the existing `Campaign.host_avatar_id` from PR F V2 — no
  new avatar needs to be created for realtime.
- Rejecting the avatar object outright with a string id ("avatarId
  expected") confirms `avatar` must be an object.

Response:

```json
{ "id": "f41ac336-0b5a-4133-a5a4-489f17330b4d" }
```

That's it on creation — no credentials yet. The session has just
been allocated; it transitions through statuses and the credentials
appear later.

### `GET /v1/realtime_sessions/{id}` — status + credentials

Status state machine (observed):

```
NOT_READY  →  READY  →  RUNNING  →  COMPLETED
                    └→  FAILED   (e.g. "No participants joined the session")
                    └→  CANCELLED   (after DELETE)
```

NOT_READY payload — three fields:

```jsonc
{ "id": "...", "createdAt": "...", "status": "NOT_READY" }
```

READY payload — adds two:

```jsonc
{
  "id": "f41ac336-0b5a-4133-a5a4-489f17330b4d",
  "createdAt": "2026-05-08T19:50:32.535Z",
  "status": "READY",
  "expiresAt": "2026-05-08T19:55:34.531Z",
  "sessionKey": "stk_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImY0MWFjMzM2LTBiNWEtNDEzMy1hNWE..."
}
```

- **`sessionKey` is the only client credential needed.** It's a
  signed JWT-shaped opaque token that the `@runwayml/avatars-react`
  SDK takes directly. There is no separate `serverUrl` / `roomName`
  / `token` triple — the SDK derives connection details from the
  signed token.
- **`expiresAt` is ~5 minutes** from `createdAt` — that's the hard
  session duration cap.
- The transition NOT_READY → READY is **fast** (~1.5 s in the probe).

**There is no `POST /v1/realtime_sessions/{id}/consume` endpoint.**
A direct probe of `.../consume` returns `404 Cannot POST`. Earlier
docs that referenced `consume` are now superseded: the credentials
are surfaced in the GET response itself.

### Participant-join timeout

The first probe's session went straight to `FAILED` with:

```jsonc
{
  "status": "FAILED",
  "failure": "No participants joined the session",
  "failureCode": "TALKING_AVATAR.NO_PARTICIPANT"
}
```

This happened with a 3-second polling delay. Empirically the
participant-join window is ≈20–30 s. **The broker must hand
`sessionKey` to the browser immediately** and the browser must
WebRTC-connect right away — no human-in-the-loop click between
broker call and SDK mount.

### `DELETE /v1/realtime_sessions/{id}` — cancellation works

Returns `204 No Content`. The CANCELLED state replaces whatever the
prior status was. Useful for "End Conversation" button + cleanup.

---

## SDK strategy

**Server side**: AdSpark's existing `httpx` is sufficient. No need to
add `@runwayml/sdk` (the official Node SDK) — our broker can call the
three endpoints directly. We already do this for image/video/avatar
tasks.

**Client side**: **`@runwayml/avatars-react` is required** unless we
want to write a custom LiveKit-style WebRTC client from scratch
(infeasible in V1 scope). The component shape we'll consume is:

```jsx
import { AvatarCall } from "@runwayml/avatars-react"

<AvatarCall
  sessionKey={sessionKey}     // from broker
  micEnabled={true}
  cameraEnabled={false}       // mic-only V1
  onEnd={() => …}
/>
```

The package is documented as React 18+, ESM, no peer dependency
issues. We'll lazy-load it (`React.lazy` + `Suspense`) so the rest
of `CampaignGallery` is unaffected if the package fails to load.

**npm install scope**: a single dev dep added to `frontend/package.json`.
~200 KB tree-shakable, matches our existing Vite + React stack.

---

## Localhost feasibility

Confirmed feasible. Runway hosts STUN/TURN; we don't run any media
infrastructure. WebRTC works over `http://localhost:5173` because
modern browsers allow `getUserMedia` over localhost without HTTPS.

The mic permission prompt will fire the first time per origin. For
demo-recording, pre-warm the prompt by visiting the page once before
recording starts.

---

## Auth / security

The broker pattern is the entire model:

- **`RUNWAYML_API_SECRET` never leaves FastAPI.** The broker holds
  it; the React app sees only `sessionKey`.
- **`sessionKey` is a JWT-shaped string with built-in expiry**
  (≈5 min). A leaked key is near-immediately useless and tied to
  exactly one session.
- **Session is single-room, one-shot.** Re-reading the session's GET
  endpoint after a successful WebRTC connect could in principle
  return a stale `sessionKey` — we'll DELETE the session on
  client-side End Conversation to be defensive.
- **Frontend gates the call** on `host_avatar_status in {ready, mock}`.
  Mock mode returns 503 from the broker so the UI never tries to
  open a WebRTC connection without a real key.

---

## Cost behaviour

Every session creation appears to incur a small per-second compute
charge once status flips to READY. The probe used ≈20 s of READY
time across two sessions and the org's `monthly_credit_cap` chip
remained at 200,000 — credit count itself isn't exposed by Runway, so
we can't surface real-time spend.

For V1 we'll surface a 5-min countdown to the user during a session,
matching the documented session duration cap.

---

## Phase I V1 scope (locked)

### Backend

- New `services/realtime_avatar_client.py`:
  - `create_session(campaign, settings)` → calls
    `POST /v1/realtime_sessions` with the campaign's
    `host_avatar_id`, polls GET to READY, returns
    `{session_id, session_key, expires_at}` (renamed from Runway's
    camelCase to our snake_case).  Mocks raise a structured
    "unavailable" error that the router maps to 503.
  - `delete_session(session_id, settings)` → DELETE for clean
    teardown when the user clicks End Conversation.

- New route `POST /api/campaigns/{id}/spokesperson-session`:
  - **404** unknown campaign.
  - **409** if `host_avatar_status` not in `{ready, mock}` (Phase 1
    of PR F must run first).
  - **503** mock mode (`{realtime_available: false, reason}`).
  - **502** upstream Runway error.
  - **200** with body `{session_id, session_key, expires_at,
    avatar_id}` in real mode.

- New route `DELETE /api/campaigns/{id}/spokesperson-session/{session_id}`:
  - Forwards to Runway DELETE, returns 204. Idempotent — already-
    cancelled sessions remain "cancelled."

### Frontend

- New `src/components/RealtimeSpokesperson.jsx`:
  - Lazy-loads `@runwayml/avatars-react` so SDK errors don't break
    `CampaignGallery`.
  - States: `idle`, `creating`, `live`, `ending`, `failed`,
    `unavailable`.
  - Start button → broker call → on success, mount `<AvatarCall
    sessionKey={…} cameraEnabled={false}>` with auto mic-permission.
  - End button → SDK `.end()` → DELETE the session via broker.
  - 5-min countdown shown during `live`.

- New gallery card subsection "Talk to Brand Spokesperson" beneath
  Avatar Host Clip:
  - Visible only when `host_avatar_status` is `ready` (real avatar).
  - Disabled in mock with copy "Realtime requires a real Runway
    key — running in mock mode."

### Mock strategy

Mock mode short-circuits to 503 with `realtime_available: false`. The
button is rendered but disabled, with a tooltip explaining the gate.
Playwright asserts the section + disabled button render, never
opens WebRTC.

---

## Open questions for the implementer

1. Does `<AvatarCall>` accept a `cameraEnabled={false}` prop, or do we
   need to use `<AvatarSession>` + `useLocalMedia()` for mic-only?
   (Public docs lean toward yes; one short test will confirm.)
2. Does the SDK fire an `onError` callback we can hook for graceful
   degradation? (Probably yes; default-error to UI's `failed` state.)
3. Does cancelling a session that's already RUNNING return a different
   status (`COMPLETED` vs `CANCELLED`)? Cosmetic; the broker's
   DELETE call is correct either way.

These do **not** block V1 — they're polish-pass items.

---

## What this spike confirmed

- ✅ Endpoint shape: `POST /v1/realtime_sessions` body, GET status,
  DELETE cancel.
- ✅ Auth: Bearer + X-Runway-Version, same as everywhere else.
- ✅ Avatar reuse: PR F V2's `host_avatar_id` works without
  modification.
- ✅ Localhost: works for both broker calls and the `<AvatarCall>`
  WebRTC connection.
- ✅ Mic-only: feasible.
- ✅ Cleanup: DELETE returns 204.
- ✅ Mock fallback: clean 503 path with no WebRTC plumbing in CI.

## What this spike rules out for V1

- ❌ Two-avatar conversations (would require two sessions + relay;
  not first-class in the API).
- ❌ Custom voice cloning gates on the realtime path (the avatar's
  voice is set at creation time in PR F; not user-facing here).
- ❌ Full transcript surfacing via `/v1/avatar_conversations` —
  documented but out of V1 scope.
- ❌ Webcam on by default (toggle deferred to V1.5; mic-only is the
  safe demo default).

---

## Sources

- `docs.dev.runwayml.com/characters/integration/` — three-party
  broker pattern + SDK names.
- `docs.dev.runwayml.com/api/` — endpoint nav.
- This session's six-step probe (locked schema; sessions cancelled
  cleanly).

No real Runway API calls beyond the listed probes were made for this
document. No code was modified at the time of writing this section.
No `unified-donkey-betz` runtime references introduced.
