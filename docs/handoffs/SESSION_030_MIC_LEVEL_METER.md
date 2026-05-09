# SESSION 030 — Live Mic Level Meter for Voice Recording (PR AY)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AY patch in flight on top of `9d86f2e`
`feat: refresh missing cloned voice preview`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_029 (PR AX Refresh Voice Preview),
SESSION_028 (PR AW Verify Freshness Label), SESSION_027 (PR AV
Avatar Status Refresh), SESSION_021 (PR AP Recording Preview),
SESSION_020 (PR AO Browser Recording), SESSION_019 (PR AN Custom
Voice Cloning), and the rest of SESSION_011–SESSION_026.

## Goal

PR AO captures audio. PR AP previews the captured Blob. PR AR
exposes the cloned voice. The remaining gap was *while recording*:
operators couldn't tell from the UI whether the browser was
actually receiving audio until they hit Stop and discovered the
mic was muted, the wrong device, or in a permissions-denied
state.

PR AY closes that gap with a tiny live mic-level meter that
renders inline next to the Stop button. One AnalyserNode, one
RAF loop, one direct-DOM-mutation bar — no React state per
frame, no waveform, no fancy visualization.

Hard scope locks (carried forward from the brief):
- No waveform recording.
- No audio enhancement.
- No voice library management.
- No UI redesign.

## Endpoint inventory

PR AY adds **no new routes**. Route count stays at **68**. The
slice is purely a UI affordance over the existing PR AO
`MediaStream`.

## What changed

### Frontend

- **`frontend/src/components/CharacterCard.jsx`**:
  - Module-level `_detectAudioContextSupport()` +
    `AUDIO_CONTEXT_SUPPORTED` flag. Computed once at module load.
  - New refs: `audioCtxRef`, `analyserRef`, `sourceNodeRef`,
    `meterRafRef`, `meterBarRef`. Held in refs (not state) so
    each animation frame can mutate the bar's `style.width`
    directly without re-rendering the whole card.
  - New `meterUnavailable` state — set to `true` only when
    `AUDIO_CONTEXT_SUPPORTED === false` or any setup throws.
    Drives the *"Mic level unavailable"* fallback.
  - **`_startMicMeter(stream)`**:
    - Constructs `AudioContext` (with `webkitAudioContext`
      fallback).
    - `createMediaStreamSource` → `createAnalyser` chain with
      `fftSize = 256` (128 frequency bins, cheap to read every
      frame) and `smoothingTimeConstant = 0.6` (light hysteresis
      so the bar doesn't jitter on quiet rooms).
    - RAF loop reads `getByteFrequencyData(buf)`, averages the
      bins, normalises to a 0..100 % range with a lifted floor +
      compressed ceiling so a quiet room nudges the bar and a
      loud burst doesn't peg at 100% the whole time, and writes
      `meterBarRef.current.style.width = `${pct}%`` directly.
    - On any setup throw → `_stopMicMeter()` + `setMeterUnavailable(true)`.
  - **`_stopMicMeter()`** — fully idempotent teardown:
    - `cancelAnimationFrame(meterRafRef.current)`.
    - `sourceNodeRef.current?.disconnect()`.
    - `analyserRef.current?.disconnect()`.
    - `audioCtxRef.current?.close()`.
    - Resets the bar's width to `'0%'` so a future take starts
      from a clean visual baseline.
    - All four steps wrapped in `try/catch` so a partial setup
      never blocks teardown.
  - **Lifecycle wiring** — `_startMicMeter(stream)` is called
    once inside `handleStartRecord` right after
    `setRecordState('recording')`. `_stopMicMeter()` is called
    from every termination path that already had `_stopMicTracks`:
    - `recorder.onstop` → meter stops cleanly.
    - `recorder.onerror` → meter stops with the recording.
    - `handleDiscardRecording` → defensive stop (already torn
      down by onstop, but safe to re-call).
    - `useEffect` cleanup → meter stops on unmount.
  - **New UI block** rendered inline in the recording-row
    button cluster while `recordState === 'recording'`:
    - Wrapper `data-testid="custom-voice-mic-level"`,
      `aria-label="microphone level"`.
    - Inner bar `data-testid="custom-voice-mic-level-bar"`,
      `transition-[width] duration-75 ease-out` so the visual
      smooths out across RAF ticks even on slow frames.
    - Helper text *"Mic level"* in the same micro-typography
      as the rest of the row.
  - **Fallback line** — when `meterUnavailable === true` the
    block collapses to a single `text-zinc-500`
    *"Mic level unavailable"* (with `data-testid="custom-voice-mic-level"`
    so the smoke can target either render).
- **`frontend/tests/adspark-smoke.spec.js`** — two new negative
  assertions: `custom-voice-mic-level` and
  `custom-voice-mic-level-bar` testids must have count `0` in
  the default idle state. The smoke can't drive a real
  recording; the conditional render guard is what we're
  protecting against regression.

### Backend

- **No changes.** PR AY is purely a frontend slice over the
  PR AO `MediaStream`.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR AY; route
  count narrative confirms unchanged at 68.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "Live mic level meter (PR AY)" subsection covering the
  AnalyserNode setup, lifecycle teardown matrix, and
  fallback path.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AY is one
  finishing UX detail on top of PR AN/AO already documented in
  entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section + build
  sizes / route count.
- `docs/handoffs/SESSION_030_MIC_LEVEL_METER.md` — this file.

## Mic meter behavior

```
operator clicks Start recording (PR AO)
  ↓ getUserMedia({audio: true}) → stream
  ↓ new MediaRecorder(stream); recorder.start()
  ↓ setRecordState('recording')
  ↓ _startMicMeter(stream):
      const ctx = new (AudioContext || webkitAudioContext)()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      // RAF loop:
      tick = () => {
        analyser.getByteFrequencyData(buf)        // 0..255 per bin
        const avg = sum(buf) / buf.length         // 0..255
        const pct = clamp(0, 100, (avg / 200) * 100)
        meterBarRef.current.style.width = `${pct}%`
        requestAnimationFrame(tick)
      }
  ↓ UI renders:
      <div data-testid="custom-voice-mic-level">
        <span>Mic level</span>
        <div class="bar-track">
          <div ref={meterBarRef}
               data-testid="custom-voice-mic-level-bar"
               style={{ width: '0%' }} />
        </div>
      </div>
```

The lifted floor (`/ 200` instead of `/ 255`) means a tile
recorded in a quiet room still nudges the bar enough to confirm
the mic is live; the implicit ceiling clamp prevents loud bursts
from staying pegged. `transition-[width] duration-75` on the
inner bar smooths the visual without delaying the ground truth
the operator is watching for.

## Cleanup behavior

```
_stopMicMeter():
  if (meterRafRef.current)
    cancelAnimationFrame(meterRafRef.current); meterRafRef.current = null;
  try { sourceNodeRef.current?.disconnect() } catch { /* ignore */ }
  sourceNodeRef.current = null;
  try { analyserRef.current?.disconnect() } catch { /* ignore */ }
  analyserRef.current = null;
  if (audioCtxRef.current) {
    try { audioCtxRef.current.close() } catch { /* ignore */ }
    audioCtxRef.current = null;
  }
  if (meterBarRef.current) meterBarRef.current.style.width = '0%';
```

Called from **every** termination path that ends a recording:

| Trigger | Hook |
|---|---|
| Stop button | `recorder.onstop` |
| Discard button | `handleDiscardRecording` |
| Clone success | `handleUseRecording` → auto-discard |
| Component unmount | `useEffect` cleanup |
| Recorder error | `recorder.onerror` |

`AudioContext.close()` returns a Promise on most browsers; the
cleanup is fire-and-forget, so we don't await it. The bar reset
to `'0%'` ensures the next recording starts from a clean visual
baseline even if React keeps the same ref between mounts.

## Fallback behavior

```
_detectAudioContextSupport():
  if (typeof window === 'undefined') return false
  return typeof (window.AudioContext || window.webkitAudioContext) === 'function'

if (!AUDIO_CONTEXT_SUPPORTED || setup throws):
  setMeterUnavailable(true)
```

UI then renders a single text line:

```jsx
{recordState === 'recording' && meterUnavailable && (
  <span data-testid="custom-voice-mic-level"
        title="AudioContext/AnalyserNode unavailable in this browser">
    Mic level unavailable
  </span>
)}
```

Recording itself still works: `MediaRecorder` doesn't depend on
`AudioContext`. The operator just doesn't get the visual
feedback. This makes PR AY strictly additive — older browsers,
locked-down WebViews, and any future API regression all fail
gracefully.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) ✅ |
| `vite build` | 326.27 KB initial / 91.61 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (21.4 s)` ✅ |
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
backend changes). Smoke + build + hygiene all ran against fresh
processes. Servers are stopped at the end of the session.

## Limitations / follow-ups

- **No clip / peak indicator.** The bar shows the smoothed
  average; very brief peaks (clipping) don't visually pop. A
  future polish could add a tiny red dot at peak frequency or
  a peak-hold marker.
- **No frequency content readout.** Just an average — operators
  can't tell from this meter alone whether the audio is
  speech-band, room rumble, or sibilance. Acceptable for V1.
- **Fixed dB compression.** The `/ 200` divisor + clamp is a
  hardcoded floor lift; not all microphones produce
  comparable levels. A future polish could add manual gain
  adjustment, but this slice intentionally avoided audio
  enhancement.
- **No on-device device picker.** Operators can't pick which
  mic to use from this UI; the browser uses the default
  `getUserMedia` pick. macOS has a system-level picker
  separately.
- **Smoke can't exercise the running meter.** Headless
  Chromium would need fake media-stream flags to drive a
  real recording. The smoke covers the conditional render
  guard (negative assertions) and trusts the targeted code
  review for the RAF loop + cleanup paths.
- **AudioContext autoplay policy.** Some browsers require a
  user gesture before `AudioContext` can resume. The meter
  setup happens inside `handleStartRecord`, which is itself
  triggered by an explicit click, so the context starts in
  the `running` state without a separate `resume()` call.
- **Cleanup isn't idempotent across re-mounts in StrictMode.**
  React 18 StrictMode dev runs effects twice; our cleanup is
  defensive (every step wrapped in try/catch + ref-clear), so
  a double-fire is safe.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT /
AU / AV / AW / AX / AY slices are all ✅ shipped. Next-tier
candidates:

1. **Auto-tick freshness caption** — `setInterval(60_000)` to
   bump PR AW's "4m ago" to "5m ago" without an operator
   action. Pure UI; no backend.
2. **Library-level "Refresh all"** — bulk-trigger PR AV +
   PR AX for every character with avatar + cloned voice in a
   single click.
3. **Voice repair history** — tiny audit trail on the
   character record so each repair produces a `{timestamp,
   before_id, after_id}` log row.
4. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ.
5. **Peak-hold indicator on PR AY meter** — small red dot
   that lingers ~500 ms at the peak position so the operator
   can see clipping bursts.

Each is a 1–2 hour slice. None blocking.
