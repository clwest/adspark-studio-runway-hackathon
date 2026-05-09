# Runway Avatar API — Deep Review (2026-05-09)

**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Status:** Research synthesis — combines AdSpark production code,
prior research spikes, and live `docs.dev.runwayml.com` fetches.
**Companion to:** `RUNWAY_API_CAPABILITY_MAP.md`,
`RUNWAY_CHARACTER_HOST_SPIKE.md` (PR F),
`RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` (PR I),
`CHARACTER_STUDIO_SPIKE.md` (PR K), `FLOW_INTEGRATION_AUDIT.md` (PR AD).

This is the **single canonical reference** for everything Runway's
Avatar / Characters family can do, what AdSpark already uses, and
what's still on the table.

---

## 1. The mental model — Avatars vs Characters vs Performances

Runway's terminology is overloaded. Anchor on this:

| Term | What it is | API surface |
|---|---|---|
| **Avatar** | A persistent persona resource (image + voice + personality). Created once, reused everywhere. | `/v1/avatars*` |
| **Character** | Same as Avatar, but the word Runway uses in user-facing UI / Developer Portal. Conceptually identical. | (UI label only) |
| **Avatar Video** | Async render of an Avatar speaking a script — one MP4 with synced video + audio. | `/v1/avatar_videos` |
| **Realtime Session** | Live WebRTC conversation with an Avatar (≤ 5 min). | `/v1/realtime_sessions*` |
| **Avatar Conversation** | Persisted transcript + recording of a completed realtime session. | `/v1/avatar_conversations*` (read/delete) |
| **Performance** (Act-Two) | A *different* primitive — drives a character image/video with a separate human-acting **driving video**. Not script-based. | `/v1/character_performance` |
| **Voice** | Standalone voice resource — runway-live-preset, custom-clone (audio sample), or custom-design (text prompt). | `/v1/voices*` + `/v1/voices/preview` |
| **Document** | RAG knowledge attached to an Avatar so realtime sessions can answer from grounded text/markdown. | `/v1/documents*` |

**The single most important distinction**: `avatar_videos` (async,
HTTP polling, scripted) vs `realtime_sessions` (live WebRTC, mic +
optional cam + screen, conversational). Identity is locked at
Avatar create time and is consistent across both surfaces — that's
the architectural advantage over `image_to_video`, where identity
drifts every generation.

---

## 2. Full endpoint matrix

### 2.1 Avatar CRUD

| Method + path | Purpose | AdSpark uses? |
|---|---|---|
| `POST /v1/avatars` | Create an Avatar from a single reference image + voice + personality | ✅ PR F + PR K |
| `GET /v1/avatars` | List the account's created Avatars (paginated) | ✅ PR I+ (Avatar Picker) |
| `GET /v1/avatars/{id}` | Fetch one Avatar (for status polling on create) | ✅ PR F |
| `PATCH /v1/avatars/{id}` | Update name / personality / voice / **`documentIds`** for RAG | ❌ |
| `DELETE /v1/avatars/{id}` | Remove an Avatar from the account | ❌ |

### 2.2 Avatar render surfaces

| Method + path | Purpose | AdSpark uses? |
|---|---|---|
| `POST /v1/avatar_videos` | Async render of Avatar speaking text or audio → MP4 | ✅ PR F (via `/spokesperson-ad` alias) |
| `POST /v1/realtime_sessions` | Create a realtime conversation session | ✅ PR I |
| `GET /v1/realtime_sessions/{id}` | Poll session status to READY | ✅ PR I |
| `POST /v1/realtime_sessions/{id}/consume` | Exchange `sessionKey` for one-shot WebRTC credentials (`url`, `token`, `roomName`) | ✅ PR I (in client SDK) |
| `DELETE /v1/realtime_sessions/{id}` | Tear down a session | ✅ PR I |

### 2.3 Conversation persistence (post-realtime)

| Method + path | Purpose | AdSpark uses? |
|---|---|---|
| `GET /v1/avatar_conversations` | List recorded conversations | ❌ |
| `GET /v1/avatar_conversations/{id}` | Fetch transcript + recording URL for one conversation | ❌ |
| `DELETE /v1/avatar_conversations/{id}` | Delete a recorded conversation | ❌ |
| `GET /v1/avatars/{id}/conversations/{conversationId}` | Same data, scoped under the avatar | ❌ |

### 2.4 Telemetry

| Method + path | Purpose | AdSpark uses? |
|---|---|---|
| `GET /v1/avatar_usage` | Per-account avatar quota / usage counters | ❌ |

### 2.5 Voice (creates the voice resources Avatars consume)

| Method + path | Purpose | AdSpark uses? |
|---|---|---|
| `POST /v1/voices` | Create a custom voice — text-design OR audio-clone | ✅ PR H (per-campaign Brand Voice) |
| `GET /v1/voices` | List voices | ❌ |
| `GET /v1/voices/{id}` | Fetch one voice (poll READY) | ✅ PR H |
| `PATCH /v1/voices/{id}` | Rename / update | ❌ |
| `DELETE /v1/voices/{id}` | Delete voice | ❌ |
| `POST /v1/voices/preview` | Audition a voice before committing | ❌ (Brand Voice already returns a `previewUrl`) |

### 2.6 Knowledge / RAG

| Method + path | Purpose | AdSpark uses? |
|---|---|---|
| `POST /v1/documents` | Create a RAG document (`name`, `content`) | ❌ |
| `GET /v1/documents` | List documents | ❌ |
| `GET /v1/documents/{id}` | Fetch a document | ❌ |
| `PATCH /v1/documents/{id}` | Update document | ❌ |
| `DELETE /v1/documents/{id}` | Remove document | ❌ |
| (attach via) `PATCH /v1/avatars/{id}` `{documentIds: [...]}` | Bind documents to an Avatar | ❌ |

### 2.7 Sibling primitive worth noting

| Method + path | Purpose | Relation to Avatars |
|---|---|---|
| `POST /v1/character_performance` | **Act-Two** — drive a character image/video with a separate driving performance video | Different primitive — no script input, requires acting footage |

---

## 3. Avatar object schema (what `POST /v1/avatars` accepts)

Per `docs.dev.runwayml.com/characters/concepts/`:

```json
{
  "name": "AdSpark Brand Spokesperson",        // string, account-unique label
  "referenceImage": "<URL or data URI>",        // single image; ≤ 5 MB in practice
  "voice": {
    "type": "runway-live-preset",               // OR "custom" (with `voiceId`)
    "presetId": "vincent"                       // when type=runway-live-preset
    // OR: "voiceId": "<id from /v1/voices>"   // when type=custom
  },
  "personality": "Concise, friendly product spokesperson.", // ≤ 10,000 chars system-prompt
  "documentIds": ["doc_abc"],                   // optional — RAG bindings
  "tools": [ ... ]                              // optional — tool calling defs
}
```

### Reference image requirements (per docs)

- **Aspect ratio**: 1088×704 recommended (the gwm1_avatars output dim).
- **Content rules**: clear, centered face, good lighting, no obstructions.
  Multiple-people images get rejected. Empirically the avatar processor
  uses face detection — non-portrait images (landscapes, product shots)
  fail with "image does not contain a recognisable face."
- **Size**: AdSpark caps at 5 MB for data URIs (PR K decision); Runway
  doesn't publish a hard cap.
- **Format**: PNG / JPEG. AdSpark embeds as base64 data URI for cached
  campaign portraits.

### Voice options (per `characters/custom-voice/`)

Three voice types live behind `voice.type`:

1. **`runway-live-preset`** — Runway's curated 30 voice presets.
   AdSpark's `SUPPORTED_VOICE_PRESETS` enumerates the lowercase ids
   (`vincent`, `victoria`, `clara`, `drew`, `skye`, `max`, `morgan`,
   `felix`, `mia`, `marcus`, `summer`, `ruby`, `aurora`, `jasper`,
   `leo`, `adrian`, `nina`, `emma`, `blake`, `david`, `maya`,
   `nathan`, `sam`, `georgia`, `petra`, `adam`, `zach`, `violet`,
   `roman`, `luna`).
2. **`custom-clone`** — `POST /v1/voices` with `from.type: "audio"`
   and a 10 s – 5 min audio sample (≤ 10 MB). Runway returns a
   `voiceId` and a `previewUrl` MP3. Plug `voiceId` into the Avatar's
   `voice.voiceId`.
3. **`custom-design`** — `POST /v1/voices` with `from.type: "text"`
   and a description like "A warm, friendly voice with a slight
   British accent." Uses `from.model` of `eleven_ttv_v3` (latest)
   or `eleven_multilingual_ttv_v2`.

### Personality field

Up to **10,000 characters** of system-prompt text. Accepts free-form
prose ("You are the brand spokesperson for FocusNest. Keep answers
concise and warm…"). Can be **overridden per-session** via
`POST /v1/realtime_sessions` `personality` without modifying the
underlying Avatar — useful for A/B-testing tone without minting new
Avatar resources.

### Knowledge / RAG attachment

Per `characters/documents/`:
- Up to **50,000 tokens** of knowledge per Avatar.
- Documents support **plain text + Markdown** today.
- Attach via `PATCH /v1/avatars/{id}` with `{documentIds: [...]}`.
- Attached docs are visible during realtime sessions (Avatar grounds
  answers in the document text). Not currently used by `avatar_videos`
  (one-shot scripted speech).

### Tool calling (per `characters/tools/`)

Tools are JSON function-call definitions (`{name, arguments}`)
attached at session create time. Two execution modes:
- **Client tools** — execute in the browser (UI overlays, navigation).
- **Server tools** — execute on your backend; result feeds back into
  the conversation.

The Avatar's LLM decides when to invoke a tool based on user intent.
Documented as "combined in the same session" (per-session config),
though the docs leave open whether they can also be attached at
Avatar create time.

### Avatar lifecycle states

`POST /v1/avatars` returns immediately; the avatar processes async.
Statuses observed in production:
- `PENDING` — newly minted, not yet ready
- `PROCESSING` — image being analysed
- `READY` — usable for `avatar_videos` + `realtime_sessions`
- `FAILED` — face check failed / unsupported image content

AdSpark polls `GET /v1/avatars/{id}` every 5 s for up to 180 s.

---

## 4. `POST /v1/avatar_videos` — async scripted render

### Production request body (verified, AdSpark live)

```python
# backend/app/services/character_host_client.py:428
body = {
    "model": "gwm1_avatars",
    "avatar": {"type": "custom", "avatarId": avatar_id},
    "speech": {"type": "text", "text": script},
}
```

### Documented request body shape

| Field | Type | Notes |
|---|---|---|
| `model` | string | `gwm1_avatars` is the only documented model |
| `avatar.type` | enum | `custom` for account-created avatars; preset characters (Tooth, Mina) require Runway's portal — they are **not** API-listable today (see §6) |
| `avatar.avatarId` | uuid | the id from `POST /v1/avatars` |
| `speech.type` | enum | `text` (script) or `audio` (URL/runway://upload-uri/data:audio/...) |
| `speech.text` | string | up to **300 chars** — AdSpark's `_MAX_SCRIPT_CHARS` matches Runway's gating |
| `speech.audio` | string | when `speech.type=audio` |

### Async lifecycle

`POST` returns `{id}` immediately. Poll `GET /v1/tasks/{id}` until
`status` is one of `SUCCEEDED | FAILED | CANCELED`. AdSpark uses 5 s
intervals + 0–800 ms jitter, capped at 6 min total wall clock. Real
Brewster runs complete in ~30–45 s.

### Output

- Single MP4, **video + audio in one stream**.
- **Video**: h264, **1088×704** (gwm1_avatars fixed dim), variable
  frame rate ~25–30 fps.
- **Audio**: AAC 48 kHz mono.
- **Duration**: matches the spoken script — typically 1–15 s for
  typical ad copy.

### Mock-mode parity in AdSpark

`character_host_client._generate_mock` synthesises a 5 s lavfi
placeholder with the host name drawn over a coloured background.
Real audio stream is silent (lavfi anullsrc) so `commercial-with-voice`
gates on `has_audio_stream(host_path)` and refuses to mux silent
placeholders into a "voiced" commercial.

---

## 5. `POST /v1/realtime_sessions` — live WebRTC conversation

### Request body (verified from docs)

```json
{
  "model": "gwm1_avatars",
  "avatar": {
    "type": "custom",
    "avatarId": "<id>"
  },
  "personality": "...",      // optional, overrides Avatar default
  "startScript": "Greet me when I join.",  // optional, opening line
  "tools": [ ... ]           // optional, function-call defs
}
```

The docs note the `personality` and `startScript` overrides are the
escape hatch for "same Avatar, different campaign context" without
creating extra Avatars. **AdSpark currently sends only
`{model, avatar}`** — adding `personality + startScript` injection
based on the saved campaign would close the "avatar has zero campaign
context" gap flagged in `FLOW_INTEGRATION_AUDIT.md` Flow 5.

### Three-step session lifecycle

```
Browser              FastAPI broker             Runway
───────              ──────────────             ──────
1. Click "Start"  → 2. POST /v1/realtime_sessions
                  ← 3. {id}
                    4. poll GET /v1/realtime_sessions/{id} until status=READY
                    5. response includes sessionKey
                    6. POST /v1/realtime_sessions/{id}/consume
                       Authorization: Bearer {sessionKey}
                  ← 7. {url, token, roomName}
                       (one-shot — call again returns 410)
8. WebRTC connect to (url, roomName, token)
                                 → live A/V to Runway
```

Status enum: `NOT_READY → READY → RUNNING → COMPLETED | FAILED | CANCELLED`.
Default poll cap in AdSpark: 30 s (per `realtime_avatar_client.py`).

### Hard limits

- **5 minutes** maximum session duration. The browser SDK surfaces
  `expiresAt` on the session record; AdSpark's frontend countdown
  uses this for the live timer.
- **One-shot consume** — the `(url, token, roomName)` triple cannot
  be re-fetched. If the browser drops, the user must restart the session.
- **Custom-voice avatars cannot use webcam or screen share.** Visual
  input is gated on preset voices only.
- **Browser support**: Chrome 74+, Firefox 78+, Safari 14.1+,
  Edge 79+. Mic mandatory; cam optional.

### Multimodal input (per `characters/screens/`)

The avatar can take **mic audio + webcam video + screen share** in
the same WebRTC session. Use cases the docs cite: identifying
objects, running games, reviewing design layouts, providing live
guidance. Resolution / FPS / frame-processing details are not
publicly documented.

### LiveKit transport (per `characters/livekit/`)

Realtime sessions run over **LiveKit** under the hood. The
`@runwayml/avatars-react` SDK is a thin wrapper. For full pipeline
control (custom STT / LLM / TTS) Runway exposes a LiveKit Agents
plugin (`livekit-plugins-runway` Python or `@livekit/agents-plugin-runway`
Node) that lets you treat the Avatar as a LiveKit agent and
orchestrate the rest yourself. AdSpark stays on the React SDK.

### Other realtime surfaces

- **Embedded Widget** (`characters/widget/`) — single `<script>`
  drop-in, no backend needed. Configurable via Developer Portal:
  allowed origins, max duration (default 120 s), max daily calls
  per visitor, theming, screen-share toggle. Best for marketing
  pages.
- **Video meetings** (`characters/video-meeting/`) — Avatar joins
  Zoom / Google Meet / Microsoft Teams as a regular participant
  (~5 s join time). Reads names + audio + video from the meeting,
  responds with lip-synced video + speech + gestures. Can be muted
  or removed by hosts.

---

## 6. `GET /v1/avatars` — listing limitations

**Critical finding from PR I+ probes**: this endpoint returns **only
account-created custom Avatars**. Runway's in-app preset characters
(Music Superstar, Cat Character, Fashion Designer, Cooking Teacher,
Tooth, Mina, etc.) are **not exposed via the public API**. Slug-style
preset ids are rejected by `avatar_videos` with "Invalid UUID".

**Implication**: AdSpark cannot offer a "browse Runway's preset
character library" UX. Users must either:
1. Upload a portrait → `POST /v1/avatars` to mint their own Avatar.
2. Use the embedded widget / Runway portal directly.

AdSpark's Avatar Picker (PR I+) ships 4 hard-coded mock presets in
mock mode for UX continuity, but real mode lists only custom
account avatars.

---

## 7. `GET /v1/avatar_conversations` — transcripts + recordings

After a realtime session ends, the `sessionId` doubles as
`conversationId`. The conversation record exposes:
- `transcript` — turn-by-turn text history
- `recordingUrl` — full session recording (duration ≤ 5 min)

Endpoints:
- `GET /v1/avatar_conversations` — paginated list
- `GET /v1/avatar_conversations/{id}` — one conversation
- `DELETE /v1/avatar_conversations/{id}` — remove
- `GET /v1/avatars/{id}/conversations/{conversationId}` — scoped under the avatar

**AdSpark doesn't use these today.** Worth wiring up if we ever ship:
- "Replay your conversation with the brand spokesperson"
- Conversation analytics ("what did users ask about?")
- Auto-generated FAQ documents from conversation logs

---

## 8. Voice resources (`/v1/voices*`)

### `POST /v1/voices`

```json
{
  "name": "Donkey Betz Brand Voice",   // ≤ 100 chars
  "from": {
    "type": "text",                    // OR "audio"
    "model": "eleven_ttv_v3",          // when type=text
    "prompt": "A warm, friendly..."
    // OR for clone:
    // "type": "audio",
    // "audioUri": "https://... | runway://... | data:audio/..."
  }
}
```

Audio inputs accept:
- HTTPS public URLs
- `runway://` upload URIs (from `POST /v1/uploads`)
- `data:audio/...;base64,...` data URIs

Voice cloning audio: **10 s – 5 min, ≤ 10 MB**.

### Lifecycle

`PROCESSING → READY` (or `FAILED` with `failureReason`). Poll
`GET /v1/voices/{id}` until `READY`; the READY record carries a
`previewUrl` MP3 the UI can play directly. AdSpark's
`audio_client.design_brand_voice` does this end-to-end.

### `POST /v1/voices/preview`

Auditions a voice **before** committing. Useful when you want to
hear a designed voice without storing it. AdSpark doesn't use this
today — once Brand Voice design returns, the `previewUrl` is already
playable, so a separate preview call is redundant for our flow.

### Preset voice preview gap

There is **no documented endpoint that returns sample audio for a
`runway-live-preset` id without first creating a voice or avatar**.
PR AA's voice picker therefore ships curated text descriptions
instead of fake-firing avatar creates just for previews.

---

## 9. `/v1/character_performance` (Act-Two) — adjacent, not avatar

Despite living next to the Avatar family, **Act-Two is a different
primitive**:

```json
{
  "model": "act_two",
  "character": {
    "type": "image",
    "uri": "<character image URL>"
  },
  "drivingPerformance": {
    "type": "video",
    "uri": "<recorded acting/performance video>"
  },
  "ratio": "1280:720",
  "expressionIntensity": 1
}
```

- **Driving video** carries body + facial movement; the model
  transfers it onto the character image/video.
- **No text input**. There is no script.
- **Multi-character dialogues** are documented as an Act-Two pattern
  but require multiple driving videos + orchestration.

Wrong primitive for "spokesperson reads a script" (that's
`avatar_videos`). Right primitive for "user uploads themselves
acting and we stylize them as a brand mascot" — a future product
direction not currently on the AdSpark roadmap.

---

## 10. Rate limits, quotas, telemetry

### `GET /v1/avatar_usage`

Returns per-account avatar quota usage (counts created, conversation
minutes consumed, etc.). **Not used by AdSpark today**. Pairing it
with the existing `/v1/organization` `monthly_credit_cap` chip would
let the Mode banner surface a "X of Y avatar minutes used this month"
indicator alongside the credit cap.

### `GET /v1/organization` + `POST /v1/organization/usage`

AdSpark already proxies the GET path (PR D) for the monthly credit
cap pill. The POST `/usage` endpoint returns granular credit
consumption breakdowns by feature — useful for a "credits by ad mode"
dashboard if we ever ship one.

### Per-avatar rate limits

Not publicly documented. Empirically:
- Avatar create: ~30 – 90 s to READY.
- avatar_videos: ~30 – 60 s for short scripts; up to a few minutes
  for longer ones.
- realtime_sessions: 5 min hard cap, no per-account hourly cap docs.

---

## 11. What AdSpark currently uses

| Capability | Surface | First shipped |
|---|---|---|
| Avatar create from generated portrait | `POST /v1/avatars` | PR F (per-campaign), PR K (Character Studio) |
| Avatar status polling | `GET /v1/avatars/{id}` | PR F |
| Avatar listing (Picker) | `GET /v1/avatars` | PR I+ |
| Scripted spokesperson video | `POST /v1/avatar_videos` | PR F |
| Realtime conversation broker | `POST /v1/realtime_sessions` | PR I |
| Realtime session consume | `POST /v1/realtime_sessions/{id}/consume` | PR I |
| Realtime session delete | `DELETE /v1/realtime_sessions/{id}` | PR I |
| Custom voice design | `POST /v1/voices` (text-design) | PR H |
| Voice cached preview | `previewUrl` from designed voice | PR H |
| Multilingual dub | `POST /v1/voice_dubbing` | PR H |
| Org metadata | `GET /v1/organization` | PR D |

**11 of ~25 documented endpoints** in the Avatar/Characters family
are wired into production today.

---

## 12. What AdSpark could ship next (ranked by impact-per-effort)

### Tier 1 — small additions, high demo lift

1. **Realtime `personality` + `startScript` injection**
   *(Flow 5 P1 from `FLOW_INTEGRATION_AUDIT.md`)*
   Pass per-campaign system prompt + opening line into
   `POST /v1/realtime_sessions`. Closes the "avatar has zero campaign
   context" gap. ~30 LOC backend.
2. **Avatar `documentIds` for grounded realtime**
   `POST /v1/documents` with the campaign brief + Q&A FAQ;
   `PATCH /v1/avatars/{id}` to attach. Avatar can answer brand
   questions from grounded text. ~80 LOC.
3. **Conversation transcript retrieval**
   After a realtime session ends, `GET /v1/avatar_conversations/{id}`
   to surface a "what did the spokesperson say?" recap. Pairs with
   the existing 5-min cap UX.
4. **Avatar PATCH** — rename, swap personality, swap voice on an
   existing Avatar without minting a new Runway resource.
5. **Custom voice cloning UX** — pair `POST /v1/voices` with
   `from.type=audio` so a brand can clone their own founder's voice
   from a 10 s – 5 min sample. Currently we only support text-design.

### Tier 2 — bigger UX builds

6. **Avatar conversations gallery** — list past conversations with
   transcripts + recordings. Useful for support / education products.
7. **Tool calling in realtime** — wire `tools` array so the avatar
   can navigate the AdSpark UI mid-conversation ("show me the Cinematic
   Ad", "play the Spokesperson Ad").
8. **Webcam / screen-share affordances** — currently hidden. Show
   the user when their preset-voice avatar can see them. Custom-voice
   avatars stay gated.
9. **Embedded widget integration** — wrap a saved campaign as a
   chattable embed for the brand's marketing site. Single `<script>`
   tag, no backend changes.
10. **LiveKit Agents path** — replace the React SDK realtime with a
    Python LiveKit agent that owns its own STT / LLM / TTS pipeline,
    reusing the Avatar as the visual layer only. Lets us inject custom
    knowledge / business logic Runway's GWM-1 doesn't.
11. **Video meeting bot** — invite the Avatar to a Zoom call via the
    documented meeting integration. "Brewster joins your launch call
    and demos the product" demo.
12. **Avatar usage chip** — surface `GET /v1/avatar_usage` next to
    the existing credit-cap pill.

### Tier 3 — out of scope for ad generation

13. **Act-Two character_performance** — drives Avatars with user-
    recorded performance videos. Different product direction (creator
    cosplay / personality transfer), not core to "AI commercial
    studio".
14. **Multi-character dialogue** — Act-Two pattern; needs multiple
    driving videos + orchestration. Cute but expensive.

---

## 13. Limits / gotchas

| Topic | Limit | Source |
|---|---|---|
| Personality length | 10,000 chars | `characters/concepts/` |
| Knowledge per avatar | 50,000 tokens | `characters/documents/` |
| `avatar_videos` script | 300 chars (effective cap) | AdSpark observed; matches `_MAX_SCRIPT_CHARS` |
| Voice clone audio | 10 s – 5 min, ≤ 10 MB | `characters/custom-voice/` |
| Realtime session | 5 min hard cap | `characters/concepts/` |
| Realtime consume | one-shot | `characters/integration/` |
| Custom-voice avatars + webcam/screen | unsupported | `characters/screens/` |
| Reference image content | clear, centered face | `characters/create-your-own/` |
| Reference image aspect | 1088×704 recommended | `characters/concepts/` |
| Preset character listing | not exposed via API | observed (PR I+) |
| Knowledge content types | text + Markdown only (PDF / URL planned) | `characters/documents/` |
| API version header | `X-Runway-Version: 2024-11-06` | AdSpark production |

---

## 14. Architectural insights for AdSpark

1. **Identity stability is the killer feature of the Avatar family.**
   Once an Avatar resource exists, every `avatar_videos` and
   `realtime_session` against it produces the same character. This is
   why PR AB renamed the Avatar Host Clip to "Spokesperson Ad" — the
   identity-stable surface deserves headline billing, not a footnote.

2. **`avatar_videos` and `realtime_sessions` are the same persona,
   different transports.** Same `avatarId`, same voice, same
   personality — one is async MP4, the other is live WebRTC. AdSpark's
   resolution chain (`character > selected > host_avatar_id`)
   correctly funnels both surfaces through one identity.

3. **Documents close the "avatar doesn't know the campaign" gap.**
   Today, Brewster speaks the script in `avatar_videos` (lip sync) but
   has zero campaign context in `realtime_sessions`. Attaching a
   campaign-derived document (business / product / hook / caption /
   CTA / personality) via `PATCH /v1/avatars` would let the realtime
   spokesperson answer brand questions naturally, not just the
   pre-scripted opening line.

4. **Custom voice cloning is a real differentiator.** AdSpark already
   supports text-design voices; cloning the brand's founder from a
   30-second voicemail would be a 1-day add and produce a
   "spokesperson sounds exactly like our CEO" demo.

5. **Realtime is a marketing widget, not a campaign artefact.**
   Consider exposing the embedded widget per saved campaign so a brand
   can publish a "Talk to Brewster about CEO Buzz" page. One `<script>`
   tag, Developer Portal config, no backend changes needed.

6. **Act-Two is for creator products, not ad commercial generation.**
   It's a useful "pose a character image with my driving video"
   primitive but would distract from the directing-an-ad workflow.
   Keep on the deferred list.

---

## 15. Quick reference — the API call you most often need

### Generate a Spokesperson Ad

```bash
# 1. Create the avatar (once per character)
curl -X POST https://api.dev.runwayml.com/v1/avatars \
  -H "Authorization: Bearer $RUNWAY_API_KEY" \
  -H "X-Runway-Version: 2024-11-06" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Brewster the Raccoon",
    "referenceImage": "data:image/png;base64,...",
    "voice": {"type": "runway-live-preset", "presetId": "drew"},
    "personality": "Sleep-deprived founder energy, witty, blunt."
  }'
# returns {id, status: "PROCESSING", ...}

# 2. Poll until READY
curl https://api.dev.runwayml.com/v1/avatars/$AVATAR_ID

# 3. Render a scripted ad
curl -X POST https://api.dev.runwayml.com/v1/avatar_videos \
  -H "Authorization: Bearer $RUNWAY_API_KEY" \
  -H "X-Runway-Version: 2024-11-06" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gwm1_avatars",
    "avatar": {"type": "custom", "avatarId": "'$AVATAR_ID'"},
    "speech": {"type": "text", "text": "Meet CEO Buzz. Built for founders running on impossible deadlines..."}
  }'
# returns {id: <task_id>}

# 4. Poll task to SUCCEEDED, download the MP4 from output[0]
curl https://api.dev.runwayml.com/v1/tasks/$TASK_ID
```

### Start a realtime session (server side)

```bash
# 1. Create
curl -X POST https://api.dev.runwayml.com/v1/realtime_sessions \
  -H "Authorization: Bearer $RUNWAY_API_KEY" \
  -H "X-Runway-Version: 2024-11-06" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gwm1_avatars",
    "avatar": {"type": "custom", "avatarId": "'$AVATAR_ID'"},
    "personality": "You are the spokesperson for FocusNest. Keep answers concise.",
    "startScript": "Hey — what would you like to know about FocusNest?"
  }'

# 2. Poll until READY (response includes sessionKey when ready)
curl https://api.dev.runwayml.com/v1/realtime_sessions/$SESSION_ID

# 3. Consume — one-shot WebRTC credentials
curl -X POST https://api.dev.runwayml.com/v1/realtime_sessions/$SESSION_ID/consume \
  -H "Authorization: Bearer $SESSION_KEY" \
  -H "X-Runway-Version: 2024-11-06"
# returns {url, token, roomName} — hand this triple to the browser

# 4. Browser uses @runwayml/avatars-react with the triple to connect
# 5. DELETE the session when done (best-effort)
```

---

## 16. Source verification

This document was synthesized from:

- **AdSpark production code** (`character_host_client.py`,
  `avatar_listing_client.py`, `realtime_avatar_client.py`,
  `character_studio_client.py`, `audio_client.py`).
- **Prior research spikes** (PR F: `RUNWAY_CHARACTER_HOST_SPIKE.md`,
  PR I: `RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md`, PR K:
  `CHARACTER_STUDIO_SPIKE.md`).
- **Live `docs.dev.runwayml.com` fetches** on 2026-05-09 covering:
  `/api`, `/characters/`, `/characters/concepts/`,
  `/characters/quickstart/`, `/characters/create-your-own/`,
  `/characters/integration/`, `/characters/widget/`,
  `/characters/livekit/`, `/characters/video-meeting/`,
  `/characters/documents/`, `/characters/custom-voice/`,
  `/characters/tools/`, `/characters/screens/`,
  `/api-details/api_changelog/`.
- **Empirical probes** from PR F / PR I / PR AB / PR AA real-mode
  hero runs (Brewster, CEO Buzz, FocusNest campaigns).

Where docs and observed behaviour diverged, **observed behaviour wins**
(empirically: preset characters are not API-listable; AdSpark's
`SUPPORTED_VOICE_PRESETS` is canonical for the 30 preset ids;
`avatar_videos` script length effectively caps at 300 chars).

---

## 17. PR AE — Realtime Campaign Context Injection (2026-05-09)

Tier-1 item §12.1 from this doc landed. The realtime broker
(`backend/app/services/realtime_avatar_client.py`) now composes
`personality` + `startScript` overrides from the saved campaign +
attached character + commercial_script and merges them into the
`POST /v1/realtime_sessions` body.

### Override payload (verified)

```python
# overrides emitted by _build_session_overrides(campaign, settings)
{
  "personality": "<system-prompt-style string ≤ 9,500 chars>",
  "startScript": "<opening line ≤ 280 chars>"
}
```

The personality string follows the Runway-recommended ordering
(business → character voice → script + concept → behaviour rule):

```
You are {character.name}, the brand {character.template} for {business}.
The product is {product}. The audience: {audience}. Tone: {tone}.
Speak in your {voice_preset} voice.
Personality cue: {character.personality}
Campaign hook: {hook}
Supporting caption: {caption}
Call to action: {cta}
Saved commercial script: {commercial_script}
Stay concise, warm, and brand-honest. When the user asks about the
product or audience, answer with the cues above. If asked something
unrelated, redirect politely back to the campaign.
```

Every line is conditional — empty fields drop out cleanly so the
helper degrades gracefully on incomplete campaigns. Empty-campaign
edge case still emits a coherent fallback ("You are the brand
spokesperson. Stay concise…" + "Hi, I'm your spokesperson. I'm
here to talk about X and X.").

### startScript composition

1. First sentence of `commercial_script` when present (truncated to
   280 chars on a sentence/word boundary).
2. Templated fallback `"Hi, I'm {character.name}. I'm here to talk
   about {business} and {product}."` when no script exists but a
   business name is set.
3. Empty when neither is set — `startScript` key drops out of the
   body (Runway uses its default greeting).

### Defensive fallback

If Runway returns **HTTP 400** with the override keys present, the
broker logs (with `_redact()` to scrub Bearer tokens / sessionKey
JWTs) and **retries once with the bare `{model, avatar}` body**.
Same as pre-PR-AE behaviour. Keeps realtime working even if Runway
removes or renames the override keys without notice.

### Logging hygiene

A new `_redact(text, limit=200)` helper strips:
- `Bearer <token>` → `Bearer <redacted>`
- `sk_*` / `rwk_*` / `key_*` / `sessionKey*` → `<redacted>`
- `eyJ…` JWT-shaped strings → `<redacted-jwt>`

Used on any external response text we log.

### Frontend copy

`RealtimeSpokesperson.jsx` caption (gated + idle paths) updated to:

> "This avatar knows the campaign brief and saved script. Ask it
>  about the product, audience, or pitch."

Suggested-prompt chips reframed as *starter questions* rather than
context patches.

### Verification

- Backend smoke-import: 51 routes (no schema/route change).
- Contract test (real-mode probe path) on a CEO Buzz fixture:
  personality 729 chars including business / product / audience /
  saved script, startScript = "Meet CEO Buzz." (first sentence).
  Empty-campaign path emits coherent fallback.
- Frontend Playwright smoke: 1 passed (~21 s) with the new caption
  assertion.

### Remaining limitations

- **No persistent transcript yet.** `GET /v1/avatar_conversations`
  remains unwired; no "replay your conversation" UX.
- **No RAG document attachment.** `POST /v1/documents` +
  `PATCH /v1/avatars/{id}` `documentIds=[...]` still on the deferred
  list (§12.2). Personality strings carry the campaign brief
  inline today, which is fine for short campaigns but won't scale
  to long catalogues.
- **No per-session A/B testing of personalities.** The override is
  derived deterministically from the saved campaign. If we ever want
  side-by-side personality variants, surface a `personality_variant`
  selector + persist the chosen variant on the session record.
