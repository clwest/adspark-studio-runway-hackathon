# SESSION 007 — Realtime Spokesperson + Avatar Picker + Audio Pack

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Closes the loop on:** SESSION_006 (post-PR-F push + prepare-for-next)
**Branch shipped on (then merged to main):** `feature/pr-i-realtime-spokesperson`
**Final tag:** `hackathon-submission-v4` at `89918c3`
**Docs commit:** PR-J (`feature/pr-j-docs-refresh`)

## Goal

Three features beyond PR F V2 / `hackathon-submission-v2`:

1. **Phase H** — Brand Voice Studio + Multilingual Dub Pack.
2. **Phase I** — Talk to Brand Spokesperson V1 (realtime WebRTC).
3. **Avatar Picker** — let users reuse any account-listed Runway
   avatar instead of forcing every campaign through fresh
   `POST /v1/avatars`. Plus a fix for the previously-broken
   "Retry with stock portrait" button.

All three landed; `main` ended this session at `89918c3` with tag
`hackathon-submission-v4`. Docs refreshed in PR-J on the same
session.

## PR-by-PR summary (since SESSION_006)

| PR | Branch | Commit | Tag |
|---|---|---|---|
| **H** | `feature/pr-h-voiceover-and-dub` | `515701f` | `hackathon-submission-v3` |
| **I (probe)** | `feature/pr-i-realtime-spokesperson` | `7736e43` | — |
| **I (feat)** | (same branch) | `3b36886` | — |
| **I+ picker + retry-fix** | (same branch) | `89918c3` | **`hackathon-submission-v4`** |
| **J docs refresh** | `feature/pr-j-docs-refresh` | (this commit) | — |

## Endpoint schema findings (locked)

Recorded in detail in
`docs/research/RUNWAY_API_CAPABILITY_MAP.md` Appendices C + D and
`docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md`. Concise summary:

### `POST /v1/voices` text design — works

```jsonc
{
  "name": "...",
  "from": {
    "type": "text",
    "prompt": "<≥20 char description>",
    "model": "eleven_multilingual_ttv_v2"
  }
}
```

`{id}` returned; poll `GET /v1/voices/{id}` to `READY` (~10 s);
preview MP3 URL in payload.

### `POST /v1/voice_dubbing` — works

```jsonc
{
  "model": "eleven_voice_dubbing",
  "audioUri": "<URL or data: URI>",
  "targetLang": "<one of 29 ISO 639-1 codes>"
}
```

29 supported languages from validator-dumped enum. ~25 s upstream.

### `POST /v1/text_to_speech` — DEFERRED

Schema confirms `model: "eleven_multilingual_v2"` + `promptText`
required, but `voice.type` discriminator is gated. 30+ probe
attempts didn't unlock it. The Brand Voice + dub pipeline gives full
multilingual voice delivery despite this.

### `POST /v1/realtime_sessions` — works

```jsonc
{
  "model": "gwm1_avatars",
  "avatar": { "type": "custom", "avatarId": "<UUID>" }
}
```

`{id}` returned. `GET /v1/realtime_sessions/{id}` transitions
`NOT_READY → READY` in ~1.5 s; READY response carries `sessionKey`
(JWT) + `expiresAt` directly. There is **no `/consume` endpoint** —
that was superseded by direct GET. `DELETE` returns 204. 5-min hard
cap. Participant-join window ~20–30 s before
`TALKING_AVATAR.NO_PARTICIPANT`.

### `GET /v1/avatars` — works

Returns account-created customs only. Slug-style preset characters
(`music-superstar`, `cat-character`, `fashion-designer`,
`cooking-teacher`) are **not API-accessible** — UUID validation
rejects them and no preset endpoint exists.

## What was done

### Phase H — Brand Voice Studio + Multilingual Dub Pack (commit `515701f`)

**Backend**:
- `services/audio_client.py` (new) — `design_brand_voice()` and
  `dub_brand_voice()` with mock fallbacks (ffmpeg lavfi anullsrc → silent
  MP3). `SUPPORTED_DUB_LANGS` 29-language tuple. Local image-cache URL →
  data URI conversion for the dub audioUri.
- `routers/campaigns.py` adds:
  - `POST /api/campaigns/{id}/brand-voice` (Phase 1)
  - `POST /api/campaigns/{id}/dub` (Phase 2; gated on Phase 1 ready;
    400 on unsupported lang)
  - `GET /api/campaigns/{id}/audio/{kind}` for streaming
- `storage.py` — `update_brand_voice_fields` and `update_dub_fields`
  (per-language merge mirrors PR B's `finished_videos` pattern)
- `models.py` — Campaign gains 8 PR-H fields, all optional, backward-
  compatible

**Frontend**:
- `CampaignGallery.jsx` adds the teal "Audio Pack" subsection with
  Phase 1 (Design Brand Voice + inline `<audio>` preview + voice id
  chip + re-design link) and Phase 2 (10-language grid: Spanish,
  French, German, Portuguese, Japanese, Mandarin, Hindi, Arabic,
  Korean, Italian; backend supports all 29)

**Verification**:
- Mock end-to-end via curl
- Real hero-run on campaign `9a717c675ec6`: brand_voice_id
  `72296398-…`, preview MP3 1.88 MB, Spanish + French dubs distinct
  by md5
- Vite + Playwright smoke green

### Phase I — Talk to Brand Spokesperson V1 (commits `7736e43` + `3b36886`)

**Probe** (commit `7736e43`):
- Locked the `/v1/realtime_sessions` schema via two short-lived real
  sessions (cancelled before WebRTC connect; ~minimal credit spend).
- Wrote `docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` with
  full findings.

**Feature** (commit `3b36886`):
- `services/realtime_avatar_client.py` (new) — three-party broker.
  `create_session()` POSTs `/v1/realtime_sessions`, polls GET to
  READY (30 s cap), returns `{session_id, session_key, expires_at,
  avatar_id}` to the router. `delete_session()` is best-effort.
- `routers/campaigns.py` adds:
  - `POST /api/campaigns/{id}/spokesperson-session` (200 with
    client-safe payload in real mode; 409 if avatar not ready;
    503 in mock mode; 502 on upstream)
  - `DELETE /api/campaigns/{id}/spokesperson-session/{session_id}`
    (always 200 with `{ok}`)
- Frontend installs `@runwayml/avatars-react ^0.15.0` (frontend-only
  dep). Lazy-loaded via `React.lazy` so SDK errors stay isolated.
- `src/components/RealtimeSpokesperson.jsx` (new) — five states
  (idle/creating/live/ending/failed) plus a gated state for
  mock/non-ready avatars. `<AvatarCall sessionKey={…} audio
  video={false}>` with mic-only V1. 5-min countdown. End
  Conversation calls broker DELETE before tearing down.
- `src/api.js` adds `startSpokespersonSession` +
  `endSpokespersonSession`.

**Verification**:
- Mock backend: 409/503/404 paths all correct
- Real broker on campaign `9a717c675ec6`: 248-char `sessionKey`
  JWT returned, 5-min `expiresAt`, backend log shows zero `rwk_` /
  `stk_` / `sessionKey` leaks
- Browser-side WebRTC handshake requires manual click-test (per
  DEMO_SCRIPT.md Path E pre-flight)

### Avatar Picker + Retry-with-Stock Fix (commit `89918c3`)

**Probe**:
- `GET /v1/avatars` returns 7 custom avatars on the test account. No
  presets surface in any way — slug ids fail UUID validation in
  `/v1/avatar_videos`; no separate preset-listing endpoint exists.

**Backend**:
- `services/avatar_listing_client.py` (new) — `list_avatars()`
  curates `GET /v1/avatars` to a safe shape; mock mode returns 4
  hard-coded preset entries with stdlib data-URI thumbnails.
- `routers/runway` adds `GET /api/runway/avatars`.
- `routers/campaigns` adds `POST /api/campaigns/{id}/select-avatar`.
- `character_host_client.active_avatar_id()` /
  `active_avatar_status()` — selected_avatar_id wins over
  host_avatar_id when set. Both host clip + realtime broker use
  these helpers.
- `models.py` — Campaign gains 4 PR I+ `selected_avatar_*` fields.

**Retry-with-stock fix**:
- Bug: gallery's "Retry with stock portrait" button only sent
  `{force_recreate: true}`; backend `_pick_source` still fell through
  to campaign's `reference_image_url`, so retries kept failing with
  the same dead URL.
- Fix: `CreateAvatarBody` gains `image_source` field. When
  `image_source: "stock"`, the router routes
  `settings.runway_host_portrait_url` through as
  `image_url_override`. Frontend retry button now sends
  `{force_recreate: true, image_source: "stock"}`.

**Frontend**:
- `src/components/AvatarPicker.jsx` (new) — fetches `/api/runway/avatars`
  on mount; 4-up grid; click selects; clear button.
- `CampaignGallery.jsx` mounts `<AvatarPicker>` at top of Brand
  Spokesperson section; `avatarReady` derives from selection OR
  custom; "ready" panel shows selected avatar info when picker is
  in play.

**Verification**:
- Mock list returns 4 preset entries
- Mock select-avatar persists; downstream host-video + realtime
  prefer the selected id
- Real list returned 7 custom avatars
- Real select to avatar `13e3c138-…` (different from
  `host_avatar_id 6f18ad26-…`); realtime broker afterwards returned
  the selected id, confirming picker selection wins
- Selection cleared at end of probe so demo state stays canonical
- Backend log: zero secret leaks across list/select/realtime/delete

## Current branch / tag state

```
main  (HEAD)                                       89918c3
└── refs/tags/hackathon-submission     7ed949e
└── refs/tags/hackathon-submission-v2  e6ca02b
└── refs/tags/hackathon-submission-v3  515701f
└── refs/tags/hackathon-submission-v4  89918c3   ← canonical full submission

feature/pr-f-character-host-v1                    e6ca02b   (merged, on origin)
feature/pr-h-voiceover-and-dub                    515701f   (merged, on origin)
feature/pr-i-realtime-spokesperson                89918c3   (merged, on origin)
feature/pr-j-docs-refresh                         <PR-J>    (PR-J docs commit; this branch)
research/runway-character-host                    22a7a64   (on origin)
```

## Verification status

- ✅ Backend import: clean, 28 routes registered
- ✅ Vite production build: clean, 40 modules, ~190 KB initial JS /
  ~58 KB gzip + ~562 KB lazy chunk
- ✅ Playwright smoke (mock): 1 passed in ~22 s. Asserts PR A–I
  surface including Audio Pack + Avatar Picker + disabled-state
  realtime button
- ✅ Phase H real hero-run on campaign `9a717c675ec6` (full audio
  pipeline)
- ✅ Phase I real broker calls cancelled cleanly; backend log shows
  zero secret leaks
- ✅ Avatar Picker real list + select + realtime end-to-end (selected
  avatar wins over `host_avatar_id`)
- ⚠️ Browser-side WebRTC handshake from `<AvatarCall>` requires a
  human click-test before the demo recording. See
  `DEMO_SCRIPT.md` Path E pass criteria.

## Manual realtime browser checklist

(For the next session's demo recording.)

**Pre-flight** (off camera):
1. Backend running in real mode (`runway_mock: false`).
2. Vite running, page loaded.
3. Mode banner readiness chip emerald.
4. Campaign `9a717c675ec6` (or any with READY avatar) visible.
5. Pre-warm mic permission: click Start Conversation once → Allow
   → End Conversation. Browser remembers.
6. DevTools open in another tab for live security check.

**Click flow**:
1. Scroll to a saved card with READY avatar.
2. Click Start Conversation.
3. Wait ~3 s for `<AvatarCall>` lazy-load.
4. Speak: *"Pitch this campaign in one sentence."*
5. Listen for avatar response.
6. Click End Conversation.

**Pass criteria**:
- Avatar video feed renders within ~5 s of clicking Start
- Audio works both directions (mic indicator active when speaking;
  audible avatar response)
- Avatar produces an on-topic response
- End Conversation cleanly returns to idle
- Countdown ticks down from ~5:00
- Other gallery cards remain functional during and after the call
- Console has zero `rwk_`, `RUNWAY_API_KEY`, `Bearer rwk_`, or
  `sessionKey` literals
- Network tab: only one POST to `/spokesperson-session`, one DELETE
  on End, plus the WebRTC handshake to Runway media servers

**Fallback**: see `DEMO_SCRIPT.md` Path E "Fallback if realtime
fails mid-recording" — the Avatar Host Clip uses the same Runway
Avatar speaking the same pitch via async `/v1/avatar_videos`. The
headline still works.

## What NOT to build next unless explicitly approved

- WebRTC features beyond V1 mic-only (webcam toggle, screen share,
  multi-participant rooms)
- Act-Two `/v1/character_performance` (wrong primitive)
- Multi-character dialogue
- Custom voice cloning (audio-clone path)
- Direct text-to-speech narration (gated discriminator)
- Audio mixing into ad clips
- Server-side `/v1/uploads`
- Stability.ai integration
- Auth / multi-user / public deploy
- Smart-framing for cross-aspect Pack crops
- Background-task finishing
- Avatar marketplace
- Knowledge documents (`/v1/documents`)
- Conversation transcripts (`/v1/avatar_conversations`)

## Recommended next commercial phases

If continuing post-hackathon:

1. **Public hosted deploy** — Vercel + Render/Fly with ffmpeg in the
   runtime image. Removes "you have to clone the repo" friction.
2. **Direct TTS narration** once Runway exposes
   `/v1/text_to_speech` voice.type discriminator. One service-level
   addition; the Brand Voice + dub pipeline degrades to it
   automatically.
3. **Audio + video mix** — ffmpeg `amix` voice + dub MP3s onto
   Pack videos for self-contained multilingual deliverables.
4. **Webcam toggle on realtime** — one prop change in
   `<AvatarCall>`.
5. **Knowledge documents** so the realtime spokesperson can answer
   brand FAQs with grounded retrieval.
6. **Auth + per-user campaign isolation** — only structural place
   the current architecture has to grow before commercialisation.

Pricing tier sketches in `SUBMISSION.md` "Why this matters" / Future
roadmap (Free / Creator / Brand / Enterprise).

## Curated Avatar Library (2026-05-08, post-merge)

After the v4 push, the Avatar Picker was visually noisy: 8 avatars in
the account, all created from the same default
`RUNWAY_HOST_PORTRAIT_URL` Unsplash photo during PR-A-through-I
probes, all using the `vincent` voice preset, all named "AdSpark
Brand Spokesperson". Functionally the picker worked; visually it
looked like duplicate noise. Three curated avatars were created and
four orphans were deleted to make the picker meaningful.

### Created (additive — never delete or rename without checking
campaigns.json references)

| Avatar id | Name | Voice preset | Source portrait |
|---|---|---|---|
| `e71a1e97-f6ee-4923-a0a1-543c56488448` | AdSpark Founder | vincent | `photo-1507003211169-0a1dd7228f2d` |
| `aae74963-984e-456e-9013-a02cb9da85d2` | AdSpark Creative Director | victoria | `photo-1494790108377-be9c29b29330` |
| `03de8c24-6d18-40ef-ad8c-dab0b23ca065` | AdSpark Local Guide | drew | `photo-1500648767791-00dcc994a43e` |

All three processed PROCESSING → READY in ~30–45 s and are visible
at the top of `GET /v1/avatars` (the list is sorted createdAt-desc).
None are referenced by any campaign — they're available for the
picker only.

### Deleted (orphan-only sweep)

Verified zero campaign references before deletion. All four returned
HTTP 204 from `DELETE /v1/avatars/{id}`:

| Avatar id | Name | Status before delete | Reason orphan |
|---|---|---|---|
| `636bf16e-f5d7-4e4e-888c-bd850b57794a` | AdSpark Brand Spokesperson | FAILED | PR-F probe with non-portrait input; never referenced |
| `e0684c6a-1bd8-48ed-828f-138ab2d30082` | AdSpark Host | READY | PR-F-V1 first-pass, replaced by V2 reframe |
| `943df2b4-60ba-4f88-bc0c-82c7b387e1c2` | AdSpark Probe Host v3 | READY | PR-F probe; never bound to a campaign |
| `ed880edd-8f83-448f-9a86-e9e0e864c6ab` | AdSpark Probe Host | FAILED | PR-F probe with flat charcoal placeholder; never referenced |

### Untouched (campaign-referenced)

The four remaining `AdSpark Brand Spokesperson` avatars all share
the same Vincent face but are referenced by real campaigns. **Do
not delete without rewriting their host_avatar_id references first.**

| Avatar id | Referenced by |
|---|---|
| `6f18ad26-5976-4891-b085-61c1646c1251` | `9a717c675ec6` (the hero/demo campaign) |
| `13e3c138-0c45-417c-8f80-ebcff8c9705c` | `311968dc615b` |
| `5fa94bca-86d2-47fd-a70f-ca2892938773` | `131aa193fe28` |
| `70bbe01d-d7f3-4aa0-be47-4f516a2f7edb` | `ad879b62d566` |

### Notes for future sessions

- **Runway preset characters are not API-accessible** as of the
  PR-I+ probe (`/v1/avatar_videos` + `/v1/realtime_sessions` validate
  `avatar.avatarId` as a UUID). The "preset" UX is currently faked
  in mock mode only; real mode lists the account's customs. The
  curated avatars above are the workaround that gives the picker
  visible variety.
- The picker re-uses **any** account-created READY avatar via
  `GET /v1/avatars` — so creating more curated avatars is purely
  additive (no code change needed).
- If `RUNWAY_HOST_PORTRAIT_URL` ever rotates to a different photo,
  future Create-Brand-Spokesperson clicks will produce a new
  duplicate-style "AdSpark Brand Spokesperson" entry for the new
  face. To prevent that, replacing the single env var with a
  rotation pool (~10 LOC service-level change) is a small future
  improvement, but not required for the demo recording.

## Reference docs

- `README.md` — quickstart + Mermaid diagram + endpoint table.
- `SUBMISSION.md` — judge-facing pitch + dual-baseline tag story.
- `00-START-NEXT-SESSION.md` — current state + run commands +
  do-not-build guardrails.
- `DEMO_SCRIPT.md` — five-path screen-recording script (A/B/C/D/E).
- `docs/WHAT_IT_IS.md`, `docs/INVENTORY.md` — refreshed in PR J.
- `docs/research/RUNWAY_API_CAPABILITY_MAP.md` — Appendix D locks
  Phase H/I + Avatar Picker findings.
- `docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` — original
  PR I.0 probe note.
- `docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` — PR F avatar
  schema (still relevant).
