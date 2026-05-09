# SESSION 019 — Custom Voice Cloning Foundation (PR AN)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AN patch in flight on top of `3e12d27`
`feat: contrast-aware reels caption styling`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_018 (PR AM Caption Contrast), SESSION_017
(PR AL Transcript Export), SESSION_016 (PR AK Brand Colour),
SESSION_015 (PR AJ Transcript Replay), SESSION_014 (PR AI Avatar
Documents), SESSION_013 (PR AH Captioned Reels), SESSION_012
(PR AG Vertical Reels), SESSION_011 anchors at `ec446e4`.

## Goal

Lay the foundation for **persistent voice identity** in AdSpark.
PR AN-AM gave brand campaigns identity (colour, captions,
documents, transcripts, replay); PR AN gives them a **cloned
voice** — a founder's, mascot's, or recurring spokesperson's
voice — bound at the Character layer so it carries across every
campaign that reuses the character.

PR AN is intentionally a **foundation** slice:
- Single backend route (multipart upload).
- Single compact UI affordance per Character library tile.
- Custom voice id used at avatar-create time (no PATCH avatar today).
- Mock-friendly so smoke + offline demos exercise the wiring
  without burning credits.

Hard scope locks (carried forward from the brief):
- No full voice library management.
- No in-browser audio recording (file upload only).
- No voice deletion.
- No UI redesign.

## Endpoint inventory

PR AN adds **one new route**. Route count: 64 → **65**.

```
POST /api/characters/{id}/clone-voice    (PR AN — new, multipart)
```

The existing `POST /api/characters/{id}/create-avatar` route
gains a side-effect: when the character has a `custom_voice_id`,
the underlying avatar create body posts
`voice: {type: "custom", voiceId: ...}` instead of
`voice: {type: "runway-live-preset", ...}`.

## What changed

### Backend

- **`backend/app/services/voice_clone_client.py` (new, ~165 LOC)**:
  - `VoiceCloneResult` dataclass mirrors the persisted enum
    (`ready` / `failed` / `mock`).
  - `mock_voice_id(name, audio_bytes)` — deterministic
    `mock_voice_<sha256(name + bytes)[:16]>`.
  - `_create_voice_real(name, audio_bytes, mime, settings)` —
    `POST /v1/voices` with body `{name, from: {type: "audio",
    audio: <data:url>}}`, then poll READY for up to 90 s.
  - `clone_voice_from_audio(name, audio_bytes, mime, settings)` —
    public entry, never raises; mock short-circuits before any
    HTTP.
  - `MAX_AUDIO_BYTES = 15 MB` (Runway docs say 10 MB; we accept
    a generous local cap so users see a friendly 413 instead of
    a wire truncation).
  - `SUPPORTED_AUDIO_MIMES` allowlist: mp3 / wav / m4a / mp4 /
    aac / webm / ogg.
- **`backend/app/models.py`**:
  - Five new optional fields on `Character`: `custom_voice_id`,
    `custom_voice_name`, `custom_voice_status`,
    `custom_voice_error`, `custom_voice_mock_mode`.
- **`backend/app/services/character_studio_client.py`**:
  - `_create_avatar_real(...)` gains an optional
    `custom_voice_id` kwarg. When set, the avatar create body
    binds to the cloned voice
    (`voice: {type: "custom", voiceId: ...}`); otherwise it
    keeps the runway-live-preset binding.
  - `create_avatar(...)` threads `character.custom_voice_id`
    into the call so the wiring is automatic.
- **`backend/app/routers/characters.py`**:
  - Adds the `clone-voice` POST route (multipart). Validates
    mime + size, reads bytes async via `UploadFile`, calls
    `clone_voice_from_audio(...)`, persists the result via the
    existing generic `CharacterStore.update(...)` helper.
  - Failure modes: 404 / 413 / 415 / 422 / 502 with clear
    actionable messages.
- **`backend/app/services/character_store.py`** unchanged — the
  existing `update(character_id, **fields)` helper accepts the
  new custom_voice_* fields without modification.

### Frontend

- **`frontend/src/api.js`** — `cloneCharacterVoice(characterId,
  file, name)` helper. Native `fetch` with `FormData` (mirrors
  the existing `uploadImage` pattern from PR R).
- **`frontend/src/components/CharacterCard.jsx`**:
  - New props: `onCloneVoice`.
  - New local state: `voiceClonePending`, `fileInputRef`.
  - Voice-state derivations: `customVoiceReady`,
    `customVoiceMock`, `customVoiceFailed`.
  - **New "Voice" section** under the avatar status pill (only on
    full library tiles — `compact=true` picker tiles skip it).
    Shows the status pill, native file picker, Clone button,
    and a one-line helper / failure row. `data-testid` hooks
    `custom-voice-section`, `custom-voice-upload`,
    `custom-voice-create`, `custom-voice-status`.
- **`frontend/src/components/CharacterStudio.jsx`**:
  - New `handleCloneVoice(c, file)` handler — calls
    `api.cloneCharacterVoice(...)` and updates the in-memory
    `characters` array so the status pill re-renders inline.
  - Threaded as `onCloneVoice` into each `<CharacterCard>` in the
    library grid.
- **`frontend/tests/adspark-smoke.spec.js`** — new conditional
  assertion block (Section 7b.5d). Counts `custom-voice-section`
  test ids; if any exist (the smoke runs against a `data` dir
  that already carries the canonical Brewster / Piper /
  Sir Landsloplot fixtures), asserts the upload + button +
  status pill all render on the first tile.

### Docs

- `docs/INVENTORY.md` — service inventory, route count → 65,
  endpoint list, feature stack all reflect PR AN.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 expanded
  with a "Cloning a custom voice (PR AN)" subsection covering
  the upload UI, accepted mimes, route shape, failure modes,
  and the avatar-binding handoff.
- `docs/WHAT_IT_IS.md` — narrative anchor entry 8 (Reusable
  Brand Character) updated to mention PR AN.
- `00-START-NEXT-SESSION.md` — new "Character layer" section
  above the Conversation layer, headline build sizes / route
  count updated.
- `docs/handoffs/SESSION_019_CUSTOM_VOICE_FOUNDATION.md` — this
  file.

## Voice creation payload approach

Real-mode wire shape (matching the existing PR H text-design
pattern in `audio_client.py`):

```http
POST /v1/voices  HTTP/1.1
Content-Type: application/json
{
  "name": "AdSpark — Brewster the Raccoon",
  "from": {
    "type": "audio",
    "audio": "data:audio/mpeg;base64,SUQzAwAAAA…"
  }
}
```

The audio file from the multipart upload is read into bytes,
base64-encoded, and prefixed with the data-URL `data:<mime>;base64,`
header. Runway returns `{id, status, …}`; we poll the detail
endpoint up to 90 s for `READY` (mirrors the text-design poll
loop).

Mock mode never makes the call. The route hashes
`sha256(name.encode() + b"::" + audio_bytes)[:16]` into a
deterministic id and writes status `mock` directly.

## How custom voice IDs are stored and used

```
operator selects audio file → multipart POST /clone-voice
   route validates mime + size + non-empty
   ↓
   clone_voice_from_audio(name, bytes, mime, settings)
     ├── mock: mock_voice_<sha256(name + bytes)[:16]>
     └── real: POST /v1/voices  →  poll READY
   ↓
   CharacterStore.update(character_id,
       custom_voice_id=…, custom_voice_status=…, custom_voice_name=…,
       custom_voice_error=None, custom_voice_mock_mode=…)
   ↓
   character JSON record now carries custom_voice_id

later, operator clicks Create Runway Avatar:
   character_studio_client.create_avatar(...)
     → _create_avatar_real(..., custom_voice_id=character.custom_voice_id)
     → POST /v1/avatars body
        if custom_voice_id: voice = {type: "custom", voiceId: ...}
        else:               voice = {type: "runway-live-preset", presetId: ...}
   ↓
   subsequent /v1/avatar_videos and /v1/realtime_sessions
   bound to that avatar speak with the cloned voice — without any
   route-level changes to the spokesperson / dialogue / realtime flows.
```

The Character is the natural home (not Campaign) because voice is
identity, not creative direction — a single character speaks the
same way across every campaign that reuses it.

## Mock behavior

| Probe | Result |
|---|---|
| First clone (audio sample A) | `mock_voice_a80ba42f57069daa`, status `mock`, `mock_mode=true` ✅ |
| Re-clone with **same** audio | identical id (idempotent) ✅ |
| Re-clone with **different** audio | new id ✅ |
| Unsupported mime (`text/plain`) | **415** with allowlist ✅ |
| Empty audio body | **422** "audio sample is empty" ✅ |
| Avatar create after clone | character.custom_voice_id is read; in real mode body would emit `voice: {type: "custom", voiceId: ...}`; mock keeps `runway_avatar_status=mock` and the voice id stays on the character record ✅ |

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| Backend imports clean | route count loads ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **65** (was 64 at PR AM) ✅ |
| `vite build` | 308.74 KB initial / 87.34 KB gzip + 561.97 KB lazy chunk ✅ |
| Playwright mock smoke | `1 passed (23.5 s)` ✅ |
| Targeted backend probe | all branches green: clone / idempotency / new audio / 415 / 422 / avatar create ✅ |
| Hygiene scan (incl. `\.wav`/`\.m4a`) | empty ✅ |
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

After every backend code change in PR AN (new module, route,
avatar-create wiring), the backend was killed and restarted
before re-running the probe and the smoke. Each verification
ran against fresh code. Servers are stopped at the end of the
session.

## Limitations / follow-ups

- **No avatar PATCH on existing avatars.** Cloning a voice for a
  character that already has a Runway avatar bound to a preset
  doesn't retro-apply the cloned voice — the operator clicks
  **Create Runway Avatar** again. Future polish:
  `PATCH /v1/avatars/{id}` with `{voice: {type: "custom",
  voiceId: ...}}` once Runway's PATCH semantics are confirmed
  for voice updates.
- **No in-browser recording.** Operators upload an existing audio
  file. A future `MediaRecorder`-based slice could capture
  directly from the mic.
- **No deletion.** Cloning a new voice replaces the persisted id
  but doesn't remove the old voice resource from the Runway
  account. Tier-3 polish.
- **No voice library / preview.** Runway returns a `previewUrl`
  on text-designed voices; the audio-clone path does too. We
  don't surface it today (the Spokesperson Ad is the fastest
  way to hear the voice in context). Tier-2 polish.
- **No per-campaign override.** Voice lives on the Character;
  two campaigns reusing the same character share the same
  cloned voice. Intentional.
- **Mock mode is shape-only.** The Spokesperson Ad / Dialogue /
  Realtime flows in mock continue to use ffmpeg lavfi
  placeholders that don't actually carry the cloned audio. Real
  mode is the authoritative listen.

## Recommended next slice

The Tier-1 (Reels / Captions / RAG / Transcript) + AK polish +
AL portability + AM contrast + AN custom-voice slices are all
✅ shipped. Next-tier candidates:

1. **In-browser audio recording for voice cloning** — small
   `MediaRecorder` UI on top of the existing PR AN file picker
   so brands can capture a 30 s sample without leaving the
   page. ~80 LOC frontend + no backend changes.
2. **Avatar PATCH for voice swap** — once a voice is cloned,
   apply it to the existing avatar via
   `PATCH /v1/avatars/{id}` instead of requiring a re-create.
   Pairs with PR AI's existing PATCH binding for documents.
3. **Per-campaign transcript history** — today PR AJ caches one
   transcript per campaign. A small archive list (or `keep`
   flag) would let operators maintain multiple session replays.
4. **Voice preview surface** — show the Runway `previewUrl` in
   the Voice section so the operator can hear the clone before
   binding it to an avatar.

Each is a 1–2 hour slice. None blocking.
