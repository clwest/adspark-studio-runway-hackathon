# SESSION 021 — In-Card Voice Recording Playback Preview (PR AP)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AP patch in flight on top of `5bca7c4`
`feat: record voice samples in-browser for cloning`; commit +
push pending after this handoff lands)
**Builds on:** SESSION_020 (PR AO Browser Voice Recording),
SESSION_019 (PR AN Custom Voice Cloning), SESSION_018
(PR AM Caption Contrast), SESSION_017 (PR AL Transcript Export),
SESSION_016 (PR AK Brand Colour), SESSION_015 (PR AJ Transcript
Replay), SESSION_014 (PR AI Avatar Documents), SESSION_013
(PR AH Captioned Reels), SESSION_012 (PR AG Vertical Reels),
SESSION_011 anchors at `ec446e4`.

## Goal

PR AO let operators record a voice sample without leaving
AdSpark — but they had to clone blind. PR AP closes the loop
with an inline `<audio controls>` preview bound to the captured
Blob. The operator can play the take, confirm the recording is
clean, and either clone or discard.

PR AP is **frontend-only**; the existing PR AN clone route
remains the single backend surface for both upload and
recording. No backend changes.

Hard scope locks (carried forward from the brief):
- No Runway `previewUrl` playback.
- No waveform / VU meter.
- No voice deletion.
- No voice library management.
- No UI redesign.

## Endpoint inventory

PR AP is **frontend-only**. Route count stays at **65**.

The captured Blob still funnels through the same path PR AO/AN
established:

```
POST /api/characters/{id}/clone-voice    (PR AN — multipart audio, unchanged)
```

## What changed

### Frontend

- **`frontend/src/components/CharacterCard.jsx`**:
  - New `previewUrl` state (`useState('')`). Holds the result of
    `URL.createObjectURL(blob)` only while the row is in the
    `recorded` state.
  - New `_revokePreview(url)` helper — defensive `try/catch`
    around `URL.revokeObjectURL` so a missing surface never
    raises during teardown.
  - `useEffect` cleanup now also revokes the preview URL on
    unmount; the dependency list now includes `previewUrl` so
    React's "run previous cleanup before next effect" semantics
    revoke the *old* URL whenever the value changes.
  - `handleStartRecord` revokes any lingering preview URL
    before kicking off a new capture so the `<audio>` element
    never points at a stale Blob.
  - `recorder.onstop` now mints the URL via `URL.createObjectURL`
    and stores it on `previewUrl`. Wrapped in `try/catch` so a
    missing object-URL surface degrades to "no preview audio,
    but you can still Clone or discard" instead of breaking the
    state machine.
  - `handleDiscardRecording` revokes + clears the preview URL.
  - **New `<audio controls>` element** rendered inside the
    `recorded`-state cluster, only when `previewUrl` is truthy.
    `data-testid="custom-voice-record-preview"`,
    `preload="metadata"`, full-width compact 1.75-rem player.
  - **New helper text** below the audio: *"Preview your take
    before cloning."* with
    `data-testid="custom-voice-record-preview-help"`.
- **`frontend/tests/adspark-smoke.spec.js`**: two new negative
  assertions in the PR AO voice-section block. The smoke can't
  drive a real recording, so we lock the **conditional render
  guard** in place instead — the preview audio + helper testids
  must have count `0` in the default idle state. A regression
  that surfaced the audio always-on would fail this check.

### Backend

- **No changes.** Verified before any code change that PR AN's
  route handles the recorded Blob identically; PR AP doesn't
  touch the wire format.

### Docs

- `docs/INVENTORY.md` — feature stack + smoke coverage row
  reflect PR AP; route count narrative confirms unchanged at 65.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "Previewing a take before cloning (PR AP)" subsection
  describing the audio element, helper text, and the full
  object-URL lifecycle.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AP is one
  polish step on top of PR AN/AO already documented in entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section,
  next-phases checklist, build sizes / route count.
- `docs/handoffs/SESSION_021_VOICE_RECORDING_PREVIEW.md` — this
  file.

## Preview UX behavior

```
idle  ──[Start recording]──►  recording  ──[Stop]──►  recorded
                                                          │
                                                          ▼
   ┌──────────── recorded state row ─────────────────┐
   │ pill: "sample ready · Ns" (emerald)             │
   │ [Clone from recording]   discard                │
   │ ┌─────────────────────────────────────────────┐ │
   │ │ ▶ ─────────●──────────  0:03 / 0:12   ⋮     │ │  ← <audio controls> (PR AP)
   │ └─────────────────────────────────────────────┘ │
   │ Preview your take before cloning.               │
   └──────────────────────────────────────────────────┘
                  │                       │
                  ▼                       ▼
       Clone from recording           discard
                  │                       │
                  ▼                       ▼
       cloning  →  auto-discard       state ⇒ idle
       (URL revoked)                  (URL revoked)
```

The audio player itself is the standard browser-rendered
`<audio controls>` so operators get play / pause / scrub / volume
without AdSpark having to draw any of those pixels — no extra
dependencies, no waveform code path.

## Object-URL cleanup behavior

| Trigger | What runs | Why |
|---|---|---|
| **Start recording** while a stale preview lingers | `_revokePreview(prev)` + `setPreviewUrl('')` then capture begins | Don't leave the browser holding the previous Blob |
| **Discard** button | `_revokePreview(prev)` + `setPreviewUrl('')` + state ⇒ `idle` | Operator explicitly threw the take away |
| **Clone from recording** (success) | `handleUseRecording` → `handleDiscardRecording` (auto-discard) → revoke runs in the discard branch | Persist on character record; preview no longer needed |
| **Clone from recording** (failure) | State ⇒ `recorded`; URL kept so the operator can re-listen / retry | Bad clone shouldn't lose the take |
| **Component unmount** mid-record | `useEffect` cleanup revokes the URL + stops the mic | Navigation / tile re-mount must not leak |
| **`previewUrl` value changes** | React's previous-effect cleanup runs first → old URL revoked | Defensive: catches any code path that reassigns without explicit revoke |

The `useEffect` dependency on `previewUrl` is what makes "revoke
the OLD URL when a new one replaces it" automatic. Without that
dependency, the cleanup closure would only fire on unmount.

## Mock behavior

PR AP doesn't touch the mock surface. Mock-mode behaviour for
the recorded-then-cloned flow is identical to PR AO:

| Probe | Result |
|---|---|
| Record (mocked via DevTools fake media stream) → Clone | Same `mock_voice_<sha256(name + bytes)[:16]>` id PR AN/AO produce ✅ |
| Discard before clone | URL revoked; row returns to idle; persisted character record untouched ✅ |
| Idle-state DOM | `custom-voice-record-preview` + `…-preview-help` testids absent (count = 0) — verified by smoke ✅ |

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **65** (unchanged) ✅ |
| `vite build` | 314.86 KB initial / 88.87 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (23.7 s)` ✅ |
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

After the frontend code change the smoke + build ran against the
fresh processes. Servers are stopped at the end of the session.

## Limitations / follow-ups

- **No automatic re-record button** — to record again the
  operator clicks **discard** then **Start recording**. A future
  one-click "Record again" affordance could collapse the two
  steps.
- **No download-take button.** Operators who like the recording
  can't save it locally without recording app-level browser
  tools. Could add a `<a download>` link to the captured Blob
  in a future polish (~10 LOC).
- **No live-region announcement** for the preview render. The
  PR AO recording-state pill carries `aria-live`; the audio
  element doesn't, which is fine (the controls are
  accessibility-native via the browser's player).
- **Preview only renders for in-browser recordings.** Uploaded
  audio files don't get an inline preview because they bypass
  the recorded-state branch entirely. Consistent with the
  brief's "in-card recorded voice playback preview" scope, but
  a future polish could add an upload-preview surface too.
- **No transcoding.** `audio/webm` plays in Chromium / Firefox
  by default; older Safari builds may fall through to a
  not-supported audio element. Same compatibility envelope as
  PR AO recording.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP slices are all ✅
shipped. Next-tier candidates:

1. **Avatar PATCH for voice swap** — apply a freshly cloned
   voice to an existing avatar via `PATCH /v1/avatars/{id}`
   instead of requiring a re-create. Pairs with PR AI's
   existing PATCH binding for documents.
2. **Live mic level meter** — `AnalyserNode` + tiny canvas bar
   so the operator knows the mic is hot before recording.
3. **Voice preview surface** — surface the Runway `previewUrl`
   on cloned voices so operators can hear the result before
   binding to an avatar.
4. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ so operators maintain multiple
   session replays.
5. **Re-record one-click affordance** — replace the
   discard → Start sequence with a single button when the user
   wants to redo the take.

Each is a 1–2 hour slice. None blocking.
