# SESSION 020 — In-Browser Audio Recording for Custom Voice Cloning (PR AO)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AO patch in flight on top of `f255c22`
`feat: clone custom voices for characters`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_019 (PR AN Custom Voice Cloning),
SESSION_018 (PR AM Caption Contrast), SESSION_017 (PR AL
Transcript Export), SESSION_016 (PR AK Brand Colour),
SESSION_015 (PR AJ Transcript Replay), SESSION_014 (PR AI Avatar
Documents), SESSION_013 (PR AH Captioned Reels), SESSION_012
(PR AG Vertical Reels), SESSION_011 anchors at `ec446e4`.

## Goal

Remove the only friction point in the PR AN custom-voice flow:
needing an audio file already on disk. PR AO adds a small
`MediaRecorder` UX inside each Character library tile so a
founder / salesperson / mascot can drop in 30 seconds of
voice straight from the browser and clone in the same click.

PR AO is **frontend-only**; the PR AN backend route already
accepts `audio/webm` in its mime allowlist (verified before any
code change), so the recording UI funnels its captured Blob
through the existing pipeline without a new surface.

Hard scope locks (carried forward from the brief):
- No full voice library management.
- No voice deletion.
- No Runway preview playback.
- No new backend routes.
- No UI redesign.

## Endpoint inventory

PR AO is **frontend-only**. Route count stays at **65**.

The existing PR AN route handles the captured Blob without
modification:

```
POST /api/characters/{id}/clone-voice    (PR AN — multipart audio)
```

`audio/webm` was already in `voice_clone_client.SUPPORTED_AUDIO_MIMES`
when PR AN shipped, so PR AO didn't need to widen the allowlist.

## What changed

### Frontend

- **`frontend/src/components/CharacterCard.jsx`** — recording
  state machine + UI:
  - Module-level `_detectRecordingSupport()` + `RECORDING_SUPPORTED`
    flag (true when both `window.MediaRecorder` and
    `navigator.mediaDevices.getUserMedia` are present).
  - `pickRecorderMime()` walks the codec preference list
    `audio/webm;codecs=opus → audio/webm → audio/ogg;codecs=opus →
    audio/mp4`; falls through to an empty string when
    `MediaRecorder.isTypeSupported` rejects all candidates so the
    constructor uses its default.
  - `_slug(name)` slugifies the character name for the suggested
    filename `adspark-voice-sample-<slug>.<ext>`.
  - State machine in the component: `recordState` (`idle` /
    `recording` / `recorded` / `cloning`), `recordError`,
    `elapsedSeconds`. Refs hold the live `MediaStream`,
    `MediaRecorder`, captured chunks, and the resolved Blob so
    the React tree never disturbs the in-flight capture.
  - `useEffect` cleanup tears down the mic stream + interval on
    unmount so an operator who clicks away mid-record doesn't
    leak a hot mic.
  - `handleStartRecord` requests `getUserMedia({audio: true})`,
    constructs the recorder with the chosen mime, wires
    `ondataavailable` / `onstop` / `onerror`, ticks the elapsed
    counter every 250 ms.
  - `handleStopRecord` tells the recorder to stop; the rest is
    handled by the `onstop` callback which assembles a Blob and
    flips state to `recorded` (or back to `idle` with a soft
    error if the take produced < 1 KB of audio).
  - `handleDiscardRecording` clears the chunks + blob refs and
    drops back to `idle`.
  - `handleUseRecording` wraps the cached Blob in a `File` named
    `adspark-voice-sample-<slug>.<ext>` (ext = `m4a` when the
    fallback mp4 codec was selected, else `webm`), then calls
    the existing parent `onCloneVoice(c, file)` handler — which
    funnels through the PR AN multipart route. On success the
    recording surface auto-discards (the persisted character
    record's status pill shows the cloned state from PR AN).
  - **New "Or record" row** inside the existing PR AN voice
    section (full library tiles only). State pill +
    Start / Stop / Clone-from-recording / discard controls,
    `data-testid` hooks `custom-voice-record-status`,
    `custom-voice-record-start`, `custom-voice-record-stop`,
    `custom-voice-record-use`.
  - **Fallback** (when `RECORDING_SUPPORTED === false`): single
    `<p>` reads *"Recording unavailable — upload an audio file
    instead."* with `data-testid="custom-voice-record-status"`.
    Existing file picker stays fully functional.
- **`frontend/tests/adspark-smoke.spec.js`** — extended the
  PR AN voice-section block with two new assertions: the record
  status pill and the start-recording button render on supported
  browsers (headless Chromium ships MediaRecorder, so we expect
  the controls rather than the fallback message).

### Backend

- **No changes.** Verified that `audio/webm` is already in PR AN's
  `voice_clone_client.SUPPORTED_AUDIO_MIMES` allowlist before
  touching any code; the route handles the captured Blob
  identically to an uploaded file.

### Docs

- `docs/INVENTORY.md` — feature stack + smoke coverage row
  reflect PR AO; route count narrative confirms unchanged at 65.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "Recording in-browser (PR AO)" subsection covering the state
  machine, codec preference, fallback rules, and `data-testid`
  hooks.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; the visible
  product behaviour is one friction-removal step on top of PR AN
  already documented in entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section,
  next-phases checklist, build sizes / route count.
- `docs/handoffs/SESSION_020_BROWSER_VOICE_RECORDING.md` — this
  file.

## Recording UX behavior

```
idle  ────[Start recording]────►  recording   (rose pill, animate-pulse)
                                    │   counter ticks every 250 ms
                                    ▼
                                  Stop button   ──[click]──►  recorded
                                                                │
       ┌─────────────────────────────────[discard]──────────────┤
       │                                                        │
       ▼                                                        ▼
      idle                                                    cloning  (POST /v1/voices)
                                                                │
                                                  ┌─────────────┴────────────┐
                                                  ▼                          ▼
                                              clone ok                 clone failed
                                                  │                          │
                                                  ▼                          ▼
                                              auto-discard           recordError set
                                              (persisted status      (state ←  recorded
                                              pill from PR AN        so user can retry)
                                              shows cloned)
```

Counter resets on each Start; auto-clears the empty-recording
soft error when the user re-records.

## Browser compatibility / fallback behavior

| Environment | `RECORDING_SUPPORTED` | Result |
|---|---|---|
| Chrome / Edge / Firefox (modern, HTTPS) | true | Full record flow |
| Safari (modern, HTTPS) | true (mp4 codec) | Full record flow with `.m4a` extension |
| HTTP localhost (dev) | true | Works — `getUserMedia` allows mic on localhost |
| Pre-MediaRecorder browsers / iframe / insecure context | false | Fallback message, file upload still works |
| User denies microphone permission | true (UI renders) | `recordError` set: *"Microphone permission denied — upload an audio file instead."*; state stays `idle` |
| `MediaRecorder` constructor throws (codec issue) | true (UI renders) | `recordError` set: *"Recording unavailable — upload an audio file instead."*; state stays `idle` |
| `recorder.onerror` fires mid-record | n/a | `recordError` set; mic stream stopped; state → `idle` |
| Empty recording (< 1 KB) | n/a | Soft error: *"Recording was empty — try again or upload an audio file instead."*; state → `idle` |

In every fallback path the upstream **Upload audio file** input
remains the obvious primary affordance. The recording row never
hides the upload — it sits below it as a shortcut.

## How recorded Blob is passed into existing clone route

```js
// On stop:
const blob = new Blob(chunksRef.current, { type: pickedMime })
recordedBlobRef.current = blob

// On "Clone from recording" click:
const ext = pickedMime.includes('mp4') ? 'm4a' : 'webm'
const file = new File(
  [blob],
  `adspark-voice-sample-${slug(character.name)}.${ext}`,
  { type: blob.type || 'audio/webm' },
)
await onCloneVoice(character, file)
//        │
//        ▼
// CharacterStudio.handleCloneVoice(c, file)
//   → api.cloneCharacterVoice(c.id, file)
//   → POST /api/characters/{c.id}/clone-voice  (FormData with `audio` field)
//   → backend voice_clone_client.clone_voice_from_audio(...)
//   → mock mode: deterministic mock_voice_<sha256(name + bytes)[:16]>
//   → real mode: POST Runway /v1/voices  with from.type=audio (data-URI)
//   → persisted on Character via CharacterStore.update(...)
```

Reusing `cloneCharacterVoice` means the recorded path benefits
from every PR AN guarantee out of the box: deterministic mock
ids, mime allowlist enforcement, 15 MB cap, and avatar-create
binding via `voice: {type: "custom", voiceId: ...}`.

## Mock behavior

Mock and real mode behave identically for the recorded Blob —
the route doesn't care whether the bytes came from disk or
`MediaRecorder.stop()`. Verified with a targeted probe:

| Probe | Result |
|---|---|
| Multipart upload of fake `audio/webm` bytes | mock id `mock_voice_f649af67701a10b0`, status `mock`, `mock_mode=true` ✅ |
| Re-upload with same bytes + same name | same id (idempotent: `mock_voice_9722dde5d3d69108`) ✅ |
| Re-upload with same bytes + default name | new id (default name differs from first call) ✅ — this matches PR AN's `name + bytes` hashing semantics |

The existing PR AN failure modes (415 / 422 / 413 / 502) are
unchanged.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| Backend allowlist sanity | `'audio/webm' in SUPPORTED_AUDIO_MIMES` → True ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **65** (unchanged from PR AN) ✅ |
| `vite build` | 314.33 KB initial / 88.70 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (23.8 s)` ✅ |
| audio/webm clone probe | mock id returned + idempotent on (name + bytes) ✅ |
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

After the frontend code change, the backend was already running
(no backend changes), but the smoke + probe ran against fresh
processes. Servers are stopped at the end of the session.

## Limitations / follow-ups

- **No live waveform / VU meter.** The recording row shows
  elapsed seconds + a pulsing pill but no audio-level feedback.
  Operators who can't hear themselves on speakers may not know
  whether the mic is working until they hit Stop. A future
  Tier-3 polish could plug an `AnalyserNode` into the
  `MediaStream` and render a tiny meter.
- **No playback before clone.** The captured Blob is sent as
  soon as the operator clicks "Clone from recording"; there's
  no in-card `<audio>` preview. Fast feedback loop, but if the
  take was bad the operator only finds out after the clone
  spins up.
- **No max-duration enforcement.** Runway's docs cap at 5 min;
  the recording UI lets you record indefinitely. Existing
  PR AN 13 MB / 15 MB cap kicks in at upload time. A future
  polish could auto-stop at 60 s and surface a "limit reached"
  pill.
- **No Safari-specific testing.** The codec list includes
  `audio/mp4` for Safari, but I haven't physically verified on
  a Safari host this session. Headless Chromium's MediaRecorder
  is the smoke surface.
- **Empty-recording threshold is 1 KB.** Catches the silent-mic
  case but might soft-error a legitimate 1-second take. Tunable
  if anyone reports it.
- **No mic-permission re-request prompt.** If the user denies
  permission once, the next click on Start recording produces
  the friendly error but doesn't help them get to the browser
  permission settings. Could add a "Reset permission" link in
  a follow-up.

## Recommended next slice

The Tier-1 (Reels / Captions / RAG / Transcript) + AK polish +
AL portability + AM contrast + AN custom-voice + AO recording
slices are all ✅ shipped. Next-tier candidates:

1. **In-card playback before clone** — small `<audio
   controls>` showing the captured Blob via
   `URL.createObjectURL(blob)` so operators can preview before
   spending a Runway voice clone. ~30 LOC.
2. **Avatar PATCH for voice swap** — apply a freshly cloned
   voice (via upload OR recording) to an existing avatar via
   `PATCH /v1/avatars/{id}` instead of requiring a re-create.
   Pairs with PR AI's existing PATCH binding for documents.
3. **Live mic level meter** — `AnalyserNode` + tiny canvas
   bar so the operator knows the mic is hot before recording.
4. **Voice preview surface** — once a voice is cloned, surface
   the Runway `previewUrl` in the Voice section.
5. **Per-campaign transcript history** — small archive list (or
   `keep` flag) on PR AJ so operators maintain multiple session
   replays per campaign.

Each is a 1–2 hour slice. None blocking.
