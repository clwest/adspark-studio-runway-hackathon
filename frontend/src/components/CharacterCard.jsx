import { useEffect, useRef, useState } from 'react'
// PR BD — Shared audit-row helpers live in ../uiHelpers.js so future
// spokesperson-first surfaces (PR BE+) can render the same swatches /
// timestamp formatter without re-defining them here.
import {
  HISTORY_ACTION_PILLS,
  formatHistoryTimestamp,
  historyDriftClass,
  historyStatusClass,
} from '../uiHelpers.js'

// PR AO — In-browser MediaRecorder support detection. Computed once at
// module load; the recording UI hides itself + falls back to upload-only
// when the surface is missing (older browsers, insecure contexts, etc).
function _detectRecordingSupport() {
  if (typeof window === 'undefined') return false
  if (typeof window.MediaRecorder === 'undefined') return false
  if (!navigator?.mediaDevices?.getUserMedia) return false
  return true
}
const RECORDING_SUPPORTED = _detectRecordingSupport()

// PR AY — Web Audio API support detection. Computed once at module
// load; the live mic level meter falls back to a single helper line
// when the surface is missing (older browsers, locked-down WebViews,
// etc). Recording itself still works regardless.
function _detectAudioContextSupport() {
  if (typeof window === 'undefined') return false
  const Ctor = window.AudioContext || window.webkitAudioContext
  return typeof Ctor === 'function'
}
const AUDIO_CONTEXT_SUPPORTED = _detectAudioContextSupport()

// Pick the best webm-flavoured mimetype the browser supports. The clone
// route accepts plain "audio/webm"; the codec hint helps Chrome / Firefox
// pick a sensible default. Fall through to undefined ⇒ MediaRecorder
// uses its own default (which the route's allowlist still accepts —
// we coerce on the way out).
const _PREFERRED_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]
function pickRecorderMime() {
  if (!RECORDING_SUPPORTED) return ''
  for (const m of _PREFERRED_MIME_CANDIDATES) {
    if (window.MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''  // empty string = let MediaRecorder choose
}

// Slugify a character name for the suggested voice-sample filename.
function _slug(name) {
  return (name || 'character')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    || 'character'
}

// PR AW — Voice verification freshness formatter. Pure helper that
// turns an ISO timestamp into "Last checked just now / 4m ago / 2h ago
// / 3d ago / Not checked yet". No date library — everything stays
// inside the existing JS surface so the bundle doesn't grow.
//
// Buckets:
//   < 45 s        → "just now"
//   < 60 m        → "Nm ago"
//   < 24 h        → "Nh ago"
//   else          → "Nd ago"
//
// Future timestamps (clock skew on a stale tab) clamp to "just now"
// so the label never reads negative time.
export function formatVerifyFreshness(isoString, nowMs = Date.now()) {
  if (!isoString) return 'Not checked yet'
  const ts = Date.parse(isoString)
  if (!Number.isFinite(ts)) return 'Not checked yet'
  const deltaMs = nowMs - ts
  if (deltaMs < 45_000) return 'Last checked just now'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `Last checked ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last checked ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Last checked ${days}d ago`
}

/**
 * Single character tile used by CharacterStudio (library grid) and the
 * Character picker that surfaces inside CampaignGallery's Brand
 * Spokesperson section.
 *
 * Renders portrait → name → template → voice → status pill, plus a
 * compact action row for Generate Portrait / Create Avatar / Attach
 * /  Delete depending on the character's current state. The
 * component is presentation-only — all mutations bubble up via
 * callbacks.
 */
export default function CharacterCard({
  character,
  onGeneratePortrait,
  onCreateAvatar,
  onAttach,
  onDelete,
  busyAction,
  attachedHere = false,
  compact = false,
  // PR U — Spokesperson-first flow. Tile lights up when this character
  // is the active spokesperson; "Use as Spokesperson" / "Active" button
  // calls onSetActive(true|false).
  isActive = false,
  onSetActive,
  // PR AN — Custom voice cloning. Library tiles (compact=false) expose
  // a small upload + clone affordance. The picker (compact=true) skips
  // it to keep that surface tight.
  onCloneVoice,
  // PR AQ — Apply already-cloned voice to the existing Runway avatar
  // (PATCH /v1/avatars/{id}). Library tiles can wire this so a manual
  // retry surfaces when the auto-patch failed.
  onApplyVoiceToAvatar,
  // PR AV — Read-only refresh of the avatar introspection + drift
  // recompute. Library tiles surface a small button when both an
  // avatar and a cloned voice exist.
  onRefreshAvatarVoice,
  // PR AX — Re-fetch the cloned voice preview URL without re-cloning.
  // Library tiles surface a small button whenever a cloned voice
  // exists (the backend route gates on custom_voice_id; mock mode
  // returns 200 with no URL change).
  onRefreshVoicePreview,
}) {
  const c = character
  // PR DS — cache-bust the portrait img so a regenerated file (same
  // path on disk) actually displays in the browser. Keyed off
  // ``updated_at`` (refreshed by the backend on every portrait write)
  // so the URL changes only when the underlying file changes.
  const portraitUrl = c.portrait_url
    ? `${c.portrait_url}${c.portrait_url.includes('?') ? '&' : '?'}v=${
        c.updated_at ? encodeURIComponent(c.updated_at) : 'static'
      }`
    : c.portrait_url
  const avatarStatus = c.runway_avatar_status
  const avatarReady = ['ready', 'mock'].includes(avatarStatus || '')
  const avatarMock = avatarStatus === 'mock'
  const avatarFailed = avatarStatus === 'failed'
  const hasPortrait = Boolean(portraitUrl)
  // PR AN — Custom voice cloning state. Local refs only; the upload
  // call bubbles up via onCloneVoice(file).
  const fileInputRef = useRef(null)
  const [voiceClonePending, setVoiceClonePending] = useState(false)
  const customVoiceId = c.custom_voice_id
  const customVoiceStatus = c.custom_voice_status
  const customVoiceMock = c.custom_voice_mock_mode === true
  const customVoiceReady = ['ready', 'mock'].includes(customVoiceStatus || '')
  const customVoiceFailed = customVoiceStatus === 'failed'
  // PR AQ — avatar PATCH status derived from the persisted character
  // record. ``patchStatus`` drives the second pill in the voice
  // section so the operator can tell at a glance whether the cloned
  // voice has actually been bound to the existing avatar.
  const patchStatus = c.custom_voice_avatar_patch_status
  const patchPending = patchStatus === 'pending_avatar'
  const patchApplied = patchStatus === 'applied'
  const patchMock = patchStatus === 'mock_patched'
  const patchFailed = patchStatus === 'failed'
  const [patchPending2, setPatchPending2] = useState(false)
  // PR AS — avatar resource introspection. After PR AQ's PATCH lands
  // we GET /v1/avatars/{id} to confirm the voice block actually
  // resolves to the cloned voice. ``verifyStatus`` drives a third
  // pill so the operator can tell at a glance whether the bind
  // survived the PATCH (vs. just trusting the 2xx).
  const verifyStatus = c.avatar_voice_verify_status
  const verifyResolvedId = c.avatar_voice_resolved_id
  const verifyResolvedType = c.avatar_voice_resolved_type
  const verifyResolvedLabel = c.avatar_voice_resolved_label
  // PR AT — drift detection. Compares custom_voice_id to
  // avatar_voice_resolved_id after every PATCH+verify. The pill
  // collapses the four PR AS verify states into three operator-
  // facing branches so a mismatch is impossible to miss.
  const driftStatus = c.avatar_voice_drift_status
  const driftMatch = driftStatus === 'match'
  const driftDrift = driftStatus === 'drift'
  const driftUnknown =
    driftStatus === 'unknown' ||
    verifyStatus === 'unverified' ||
    verifyStatus === 'failed'
  // The verification pill only makes sense when the avatar is
  // actually meant to be bound to the cloned voice (PR AQ patch
  // succeeded with applied / mock_patched). Pending / failed
  // patches show their own state via the PR AQ pill.
  const verifyShouldRender =
    customVoiceReady && (patchApplied || patchMock) && Boolean(verifyStatus)
  const verifyMock = verifyStatus === 'mock_verified'

  const handleApplyVoice = async () => {
    if (!onApplyVoiceToAvatar) return
    setPatchPending2(true)
    try {
      await onApplyVoiceToAvatar(c)
    } finally {
      setPatchPending2(false)
    }
  }
  // PR AU — Repair voice drift. Reuses the same apply-voice
  // backend handler (which already runs PATCH + verify + drift)
  // so a click here re-binds the cloned voice to the existing
  // avatar and re-classifies the drift state. Local error state is
  // mirrored from the parent through onApplyVoiceToAvatar(c).
  const [repairBusy, setRepairBusy] = useState(false)
  const [repairError, setRepairError] = useState('')
  const handleRepairDrift = async () => {
    if (!onApplyVoiceToAvatar) return
    setRepairBusy(true)
    setRepairError('')
    try {
      // PR BB — pass ``"repair"`` so the audit-trail entry is
      // labeled as a drift-repair instead of a regular apply retry.
      await onApplyVoiceToAvatar(c, 'repair')
    } catch (e) {
      setRepairError(`${e?.message || e}`)
    } finally {
      setRepairBusy(false)
    }
  }
  // PR AV — Read-only refresh of the avatar voice state. Distinct
  // from PR AQ apply / PR AU repair: this never triggers a PATCH.
  // Renders only when the character has both an avatar and a
  // cloned voice (the same gates the backend route enforces).
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const handleRefreshAvatar = async () => {
    if (!onRefreshAvatarVoice) return
    setRefreshBusy(true)
    setRefreshError('')
    try {
      await onRefreshAvatarVoice(c)
    } catch (e) {
      setRefreshError(`${e?.message || e}`)
    } finally {
      setRefreshBusy(false)
    }
  }
  const refreshButtonShouldRender =
    customVoiceReady && avatarReady && Boolean(onRefreshAvatarVoice)
  // PR BB — voice repair audit trail. Defaults to the 5-newest view;
  // the disclosure toggles to "show all" up to the 20-entry cap.
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const historyEntries = Array.isArray(c.voice_repair_history)
    ? c.voice_repair_history
    : []
  const historyVisible = historyExpanded
    ? historyEntries
    : historyEntries.slice(0, 5)
  // PR AZ — Freshness caption auto-tick. The PR AW caption renders
  // off `formatVerifyFreshness(verified_at, nowMs)` — keeping a local
  // `nowMs` state and bumping it every 60 s lets the caption tick
  // from "4m ago" to "5m ago" without an operator action and without
  // a backend round-trip. Gated on the same caption-visibility
  // condition so tiles that don't show the line don't carry a timer.
  const freshnessVisible = customVoiceReady && avatarReady
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!freshnessVisible) return undefined
    // Reset baseline on mount so a freshly-loaded card never reads
    // stale `nowMs` from the initial render. The interval then bumps
    // it once per minute so the caption advances buckets cleanly.
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
    // We intentionally avoid retriggering on every nowMs change — the
    // dependency on freshnessVisible is what gates the timer's
    // existence. ESLint's exhaustive-deps doesn't apply here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshnessVisible, c.avatar_voice_verified_at])
  // PR AX — preview-refresh state. Renders any time a custom voice
  // exists (no avatar required — the route only needs custom_voice_id).
  // ``previewRefreshNote`` carries a one-line success/no-op caption
  // when the operator clicks the button without a URL coming back.
  const [previewRefreshBusy, setPreviewRefreshBusy] = useState(false)
  const [previewRefreshError, setPreviewRefreshError] = useState('')
  const [previewRefreshNote, setPreviewRefreshNote] = useState('')
  const handleRefreshVoicePreview = async () => {
    if (!onRefreshVoicePreview) return
    setPreviewRefreshBusy(true)
    setPreviewRefreshError('')
    setPreviewRefreshNote('')
    const hadUrlBefore = Boolean(c.custom_voice_preview_url)
    try {
      const updated = await onRefreshVoicePreview(c)
      const hasUrlAfter = Boolean(updated?.custom_voice_preview_url)
      if (!hasUrlAfter) {
        setPreviewRefreshNote(
          hadUrlBefore
            ? 'Existing preview kept — Runway returned no fresh URL.'
            : 'Runway returned no preview URL — try again in a moment.',
        )
      } else if (!hadUrlBefore) {
        setPreviewRefreshNote('Preview URL fetched.')
      } else {
        setPreviewRefreshNote('Preview URL refreshed.')
      }
    } catch (e) {
      setPreviewRefreshError(`${e?.message || e}`)
    } finally {
      setPreviewRefreshBusy(false)
    }
  }
  const previewRefreshShouldRender =
    customVoiceReady && Boolean(onRefreshVoicePreview)

  const handleVoiceFile = async (file) => {
    if (!file || !onCloneVoice) return
    setVoiceClonePending(true)
    try {
      await onCloneVoice(c, file)
    } finally {
      setVoiceClonePending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // PR AO — In-browser audio recording. State machine:
  //   idle → recording → recorded → cloning → idle (after success/error)
  // Stream + recorder live in refs so React re-renders never disturb the
  // ongoing capture; chunks accumulate on a ref so the closures the
  // browser hands to ondataavailable/onstop don't go stale.
  const [recordState, setRecordState] = useState('idle')
  const [recordError, setRecordError] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  // PR AP — in-card preview URL for the captured Blob. Only set when
  // a recording finishes (state ⇒ 'recorded'); cleared (and revoked)
  // on discard / successful clone / unmount / a new recording start
  // so we never leak object URLs.
  const [previewUrl, setPreviewUrl] = useState('')
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const recordedBlobRef = useRef(null)
  const recordedMimeRef = useRef('audio/webm')
  const tickRef = useRef(null)
  // PR AY — Web Audio refs for the mic level meter. Held in refs (not
  // React state) so each animation frame can mutate the bar's width
  // directly without re-rendering the whole card. ``meterUnavailable``
  // flags graceful fallback when AudioContext / AnalyserNode setup
  // fails — recording still works, the bar just doesn't render.
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceNodeRef = useRef(null)
  const meterRafRef = useRef(null)
  const meterBarRef = useRef(null)
  const [meterUnavailable, setMeterUnavailable] = useState(false)

  const _stopMicMeter = () => {
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current)
      meterRafRef.current = null
    }
    try { sourceNodeRef.current?.disconnect?.() } catch { /* ignore */ }
    sourceNodeRef.current = null
    try { analyserRef.current?.disconnect?.() } catch { /* ignore */ }
    analyserRef.current = null
    if (audioCtxRef.current) {
      try {
        // close() returns a promise on most browsers; we don't await
        // it because the cleanup path is fire-and-forget.
        audioCtxRef.current.close?.()
      } catch { /* ignore */ }
      audioCtxRef.current = null
    }
    if (meterBarRef.current) {
      meterBarRef.current.style.width = '0%'
    }
  }

  const _startMicMeter = (stream) => {
    if (!AUDIO_CONTEXT_SUPPORTED || !stream) {
      setMeterUnavailable(true)
      return
    }
    setMeterUnavailable(false)
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctor()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      // 256 fft = 128 frequency bins, plenty for a single-bar meter
      // and cheap enough that the RAF loop never feels expensive.
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      audioCtxRef.current = ctx
      sourceNodeRef.current = source
      analyserRef.current = analyser

      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i]
        const avg = sum / buf.length // 0..255
        // Lift the floor so a quiet room still nudges the bar; compress
        // the top so a loud burst doesn't peg at 100% the whole time.
        const pct = Math.min(100, Math.max(0, (avg / 200) * 100))
        if (meterBarRef.current) {
          meterBarRef.current.style.width = `${pct.toFixed(1)}%`
        }
        meterRafRef.current = requestAnimationFrame(tick)
      }
      meterRafRef.current = requestAnimationFrame(tick)
    } catch {
      // Any setup failure → drop into fallback; recording still works.
      _stopMicMeter()
      setMeterUnavailable(true)
    }
  }

  const _revokePreview = (url) => {
    if (!url || typeof URL === 'undefined' || !URL.revokeObjectURL) return
    try { URL.revokeObjectURL(url) } catch { /* ignore */ }
  }

  // Always-on cleanup so we never leak the mic stream when the tile
  // unmounts mid-record. Also revokes any lingering preview URL so the
  // browser drops its hold on the recorded Blob, and tears down the
  // PR AY mic-level meter analyser/audio context.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      try { recorderRef.current?.stop() } catch { /* ignore */ }
      streamRef.current?.getTracks?.().forEach((t) => t.stop())
      _revokePreview(previewUrl)
      _stopMicMeter()
    }
    // Intentionally re-binds when previewUrl changes so the cleanup
    // closure carries the *current* URL (not whatever was in scope
    // at first mount). React handles the revoke-on-replace by
    // running the previous effect's cleanup before the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl])

  const _stopMicTracks = () => {
    streamRef.current?.getTracks?.().forEach((t) => t.stop())
    streamRef.current = null
  }

  const handleStartRecord = async () => {
    if (!onCloneVoice || !RECORDING_SUPPORTED) return
    setRecordError('')
    chunksRef.current = []
    recordedBlobRef.current = null
    // PR AP — drop the previous preview URL so a new take never
    // points React's <audio> at a stale Blob.
    if (previewUrl) {
      _revokePreview(previewUrl)
      setPreviewUrl('')
    }
    setElapsedSeconds(0)
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setRecordError(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission denied — upload an audio file instead.'
          : 'Could not access microphone — upload an audio file instead.',
      )
      return
    }
    streamRef.current = stream
    const mime = pickRecorderMime()
    recordedMimeRef.current = mime || 'audio/webm'
    let recorder
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
    } catch (e) {
      _stopMicTracks()
      setRecordError(`Recording unavailable — upload an audio file instead.`)
      return
    }
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    recorder.onstop = () => {
      const type = recordedMimeRef.current?.split(';')[0] || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      recordedBlobRef.current = blob
      _stopMicTracks()
      _stopMicMeter()  // PR AY
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
      // Empty blob (mic produced no audio) — drop back to idle with
      // a soft message rather than letting the user "use" silence.
      if (!blob || blob.size < 1024) {
        setRecordError(
          'Recording was empty — try again or upload an audio file instead.',
        )
        setRecordState('idle')
        return
      }
      // PR AP — mint a preview URL for the recorded state's audio
      // player. Revoked on discard / successful clone / unmount /
      // next recording start.
      try {
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
      } catch {
        // No object URL surface — recorded state still flips, but the
        // preview player just doesn't render. Operator can still
        // clone or discard.
      }
      setRecordState('recorded')
    }
    recorder.onerror = (ev) => {
      setRecordError(
        `Recording error: ${ev?.error?.message || 'unknown'} — upload instead.`,
      )
      _stopMicTracks()
      _stopMicMeter()  // PR AY
      if (tickRef.current) clearInterval(tickRef.current)
      setRecordState('idle')
    }
    recorderRef.current = recorder
    try {
      recorder.start()
    } catch (e) {
      _stopMicTracks()
      setRecordError('Could not start recording — upload instead.')
      return
    }
    setRecordState('recording')
    // PR AY — kick off the live mic-level meter tied to this stream.
    _startMicMeter(stream)
    const startedAt = Date.now()
    tickRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
  }

  const handleStopRecord = () => {
    if (recordState !== 'recording') return
    try {
      recorderRef.current?.stop()
    } catch { /* onstop runs the cleanup */ }
  }

  const handleDiscardRecording = () => {
    chunksRef.current = []
    recordedBlobRef.current = null
    setElapsedSeconds(0)
    setRecordError('')
    setRecordState('idle')
    // PR AP — revoke + clear the preview URL so the browser drops
    // its hold on the captured Blob immediately.
    if (previewUrl) {
      _revokePreview(previewUrl)
      setPreviewUrl('')
    }
    // PR AY — also tear down any lingering meter (defensive: stop
    // already fires from onstop, but discard can be called from the
    // recorded state too where the meter is already torn down).
    _stopMicMeter()
  }

  const handleUseRecording = async () => {
    const blob = recordedBlobRef.current
    if (!blob || !onCloneVoice) return
    const ext = (recordedMimeRef.current?.includes('mp4')) ? 'm4a' : 'webm'
    const file = new File(
      [blob],
      `adspark-voice-sample-${_slug(c.name)}.${ext}`,
      { type: blob.type || 'audio/webm' },
    )
    setRecordState('cloning')
    setRecordError('')
    try {
      await onCloneVoice(c, file)
      // Clear the recording surface now that the clone landed; the
      // status pill renders from the persisted character record.
      handleDiscardRecording()
    } catch (e) {
      setRecordError(`Clone failed: ${e?.message || e}`)
      setRecordState('recorded')
    }
  }

  return (
    <div
      className={`rounded-lg p-2 space-y-1.5 transition-all duration-150 ${
        isActive
          ? 'ring-2 ring-spark bg-spark/10 shadow-[0_0_0_1px_rgba(249,115,22,0.20)]'
          : attachedHere
          ? 'ring-2 ring-pink-400 bg-pink-500/10 shadow-[0_0_0_1px_rgba(236,72,153,0.15)]'
          : 'ring-1 ring-zinc-800 bg-zinc-950/50 hover:ring-pink-400/40 hover:bg-pink-500/5'
      } ${compact ? 'text-[10px]' : 'text-xs'}`}
    >
      {/* Portrait — when generating, show a pulsing skeleton with a
          short status caption. PR Q (Phase 3). */}
      <div className="aspect-square w-full rounded bg-zinc-900 overflow-hidden relative">
        {busyAction === 'portrait' ? (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-2 bg-pink-500/5 animate-pulse"
            aria-busy="true"
            aria-live="polite"
          >
            <div className="w-8 h-8 rounded-full ring-2 ring-pink-400/40 border-t-2 border-t-pink-300 animate-spin" />
            <span className="text-[9px] text-pink-300/80 font-mono">
              generating…
            </span>
          </div>
        ) : hasPortrait ? (
          <img
            src={portraitUrl}
            alt={c.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] italic">
            no portrait yet
          </div>
        )}
      </div>

      {/* Name + template */}
      <div className="min-w-0">
        <div className="text-zinc-100 truncate font-medium" title={c.name}>
          {c.name}
        </div>
        <div className="text-zinc-500 font-mono text-[9px]">
          {c.template} · {c.voice_preset}
        </div>
      </div>

      {/* Avatar status pill */}
      <div className="flex items-center gap-1 flex-wrap">
        {busyAction === 'avatar' && (
          <span
            className="text-[9px] rounded-full bg-pink-500/20 text-pink-300 px-1.5 py-0.5 font-mono animate-pulse"
            aria-busy="true"
          >
            binding avatar…
          </span>
        )}
        {busyAction !== 'avatar' && avatarReady && (
          <span
            className={`text-[9px] rounded-full px-1.5 py-0.5 font-mono ${
              avatarMock
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
          >
            avatar {avatarMock ? 'mock' : 'ready'}
          </span>
        )}
        {busyAction !== 'avatar' && avatarFailed && (
          <span className="text-[9px] rounded-full bg-rose-500/20 text-rose-300 px-1.5 py-0.5 font-mono">
            avatar failed
          </span>
        )}
        {busyAction !== 'avatar' && !avatarStatus && hasPortrait && (
          <span className="text-[9px] rounded-full bg-zinc-700/50 text-zinc-300 px-1.5 py-0.5 font-mono">
            avatar pending
          </span>
        )}
        {attachedHere && (
          <span className="text-[9px] rounded-full bg-pink-500/20 text-pink-300 px-1.5 py-0.5 font-mono">
            attached
          </span>
        )}
        {/* PR U — active spokesperson pill */}
        {isActive && (
          <span className="text-[9px] rounded-full bg-spark/25 text-spark px-1.5 py-0.5 font-mono">
            active
          </span>
        )}
      </div>

      {/* PR AN — Custom voice cloning. Library-only tile section
          (skipped on compact tiles inside the picker). Uploads a 10 s
          – 5 min audio sample to Runway's POST /v1/voices and persists
          the returned voice id on the character. The next created
          avatar will bind to the cloned voice instead of the preset. */}
      {!compact && onCloneVoice && (
        <div className="border-t border-zinc-800/60 pt-1.5 space-y-1" data-testid="custom-voice-section">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
              Voice
            </span>
            {customVoiceReady ? (
              <span
                data-testid="custom-voice-status"
                className={
                  customVoiceMock
                    ? 'text-[9px] rounded-full bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40 px-1.5 py-0.5 font-mono'
                    : 'text-[9px] rounded-full bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40 px-1.5 py-0.5 font-mono'
                }
                title={customVoiceId ? `voiceId=${customVoiceId}` : ''}
              >
                {customVoiceMock ? 'cloned · mock' : 'cloned'}
              </span>
            ) : customVoiceFailed ? (
              <span
                data-testid="custom-voice-status"
                className="text-[9px] rounded-full bg-rose-500/25 text-rose-200 ring-1 ring-rose-400/40 px-1.5 py-0.5 font-mono"
                title={c.custom_voice_error || ''}
              >
                clone failed
              </span>
            ) : (
              <span
                data-testid="custom-voice-status"
                className="text-[9px] rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 px-1.5 py-0.5 font-mono"
                title={`preset · ${c.voice_preset}`}
              >
                preset · {c.voice_preset}
              </span>
            )}
            {/* PR AQ — avatar PATCH status pill. Only visible when
                a custom voice is cloned; otherwise the preset pill
                above is the only signal. */}
            {customVoiceReady && patchApplied && (
              <span
                data-testid="custom-voice-avatar-patch-status"
                className="text-[9px] rounded-full bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40 px-1.5 py-0.5 font-mono"
                title="PATCH /v1/avatars/{id} succeeded — the existing avatar speaks with the cloned voice"
              >
                applied to avatar
              </span>
            )}
            {customVoiceReady && patchMock && (
              <span
                data-testid="custom-voice-avatar-patch-status"
                className="text-[9px] rounded-full bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40 px-1.5 py-0.5 font-mono"
                title="Mock-mode patch recorded — real Runway PATCH skipped"
              >
                applied · mock
              </span>
            )}
            {customVoiceReady && patchPending && (
              <span
                data-testid="custom-voice-avatar-patch-status"
                className="text-[9px] rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 px-1.5 py-0.5 font-mono"
                title="Voice cloned — Create Runway Avatar to bind it"
              >
                pending avatar
              </span>
            )}
            {customVoiceReady && patchFailed && (
              <span
                data-testid="custom-voice-avatar-patch-status"
                className="text-[9px] rounded-full bg-rose-500/25 text-rose-200 ring-1 ring-rose-400/40 px-1.5 py-0.5 font-mono"
                title={c.custom_voice_avatar_patch_error || 'PATCH failed'}
              >
                patch failed
              </span>
            )}
            {/* PR AS / PR AT — avatar resource introspection pill,
                consolidated by drift detection. Only renders when
                the patch state implies the bind should have landed
                (applied / mock_patched). The pill collapses the
                four PR AS verify states into three operator-facing
                branches so a mismatch is impossible to miss. */}
            {verifyShouldRender && driftMatch && (
              <span
                data-testid="custom-voice-avatar-resolved"
                data-drift="match"
                className={
                  verifyMock
                    ? 'text-[9px] rounded-full bg-amber-500/25 text-amber-200 ring-1 ring-amber-400/40 px-1.5 py-0.5 font-mono'
                    : 'text-[9px] rounded-full bg-emerald-500/30 text-emerald-100 ring-1 ring-emerald-400/50 px-1.5 py-0.5 font-mono'
                }
                title={
                  verifyResolvedId
                    ? `voice.${verifyResolvedType || '?'} = ${verifyResolvedId}`
                    : verifyResolvedLabel || 'avatar voice block resolved'
                }
              >
                {verifyMock
                  ? 'Avatar using cloned voice · mock'
                  : 'Avatar using cloned voice'}
              </span>
            )}
            {verifyShouldRender && driftDrift && (
              <span
                data-testid="custom-voice-avatar-drift"
                data-drift="drift"
                className="text-[9px] rounded-full bg-rose-500/30 text-rose-100 ring-1 ring-rose-400/50 px-1.5 py-0.5 font-mono"
                title={
                  `expected voice.${customVoiceId} but avatar resolves to ` +
                  (verifyResolvedId || '?')
                }
              >
                Avatar voice mismatch
              </span>
            )}
            {verifyShouldRender && driftUnknown && (
              <span
                data-testid="custom-voice-avatar-unverified"
                data-drift="unknown"
                className={
                  verifyStatus === 'failed'
                    ? 'text-[9px] rounded-full bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40 px-1.5 py-0.5 font-mono'
                    : 'text-[9px] rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 px-1.5 py-0.5 font-mono'
                }
                title={c.avatar_voice_verify_error || 'avatar response carried no voice block'}
              >
                Avatar voice unverified
              </span>
            )}
            {customVoiceReady && (patchApplied || patchMock) && !verifyStatus && (
              <span
                data-testid="custom-voice-avatar-unverified"
                data-drift="pending"
                className="text-[9px] rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 px-1.5 py-0.5 font-mono"
                title="Verification not yet attempted"
              >
                Avatar voice pending
              </span>
            )}
          </div>
          {/* PR AW — voice verification freshness label. Renders any
              time the character has both a cloned voice and an
              avatar (same gate as PR AV's refresh button). When no
              verify has run yet the line falls through to "Not
              checked yet" rather than disappearing — operators can
              tell at a glance how stale the verification is. */}
          {freshnessVisible && (
            <p
              data-testid="custom-voice-verify-freshness"
              className="text-[9px] text-zinc-500 font-mono"
              title={c.avatar_voice_verified_at || 'no verification timestamp'}
            >
              {/* PR AZ — auto-ticked nowMs so the caption advances
                  buckets without an operator action. */}
              {formatVerifyFreshness(c.avatar_voice_verified_at, nowMs)}
            </p>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              data-testid="custom-voice-upload"
              onChange={(e) => handleVoiceFile(e.target.files?.[0])}
              disabled={voiceClonePending || Boolean(busyAction)}
              className="text-[9px] text-zinc-300 file:rounded file:border-0 file:bg-zinc-800 file:text-zinc-100 file:text-[9px] file:px-2 file:py-0.5 file:mr-1 disabled:opacity-50"
              title="Upload a 10 s – 5 min audio sample (≤ 10 MB) — supported: mp3 / wav / m4a / aac / webm / ogg"
            />
            <button
              type="button"
              data-testid="custom-voice-create"
              onClick={() => fileInputRef.current?.click()}
              disabled={voiceClonePending || Boolean(busyAction)}
              className="text-[9px] rounded bg-emerald-500/30 hover:bg-emerald-500/45 text-emerald-100 ring-1 ring-emerald-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
              title="Open the file picker, then we'll POST /v1/voices with from.type=audio"
            >
              {voiceClonePending
                ? 'Cloning…'
                : customVoiceReady
                ? 'Re-clone'
                : 'Clone voice'}
            </button>
          </div>
          {customVoiceFailed && c.custom_voice_error && (
            <p className="text-[9px] text-rose-300" title={c.custom_voice_error}>
              {c.custom_voice_error}
            </p>
          )}
          {/* PR AQ — manual retry surface. Auto-patch already runs
              after every clone; this button only appears when the
              auto attempt failed so the operator can re-trigger
              without re-uploading. */}
          {customVoiceReady && patchFailed && onApplyVoiceToAvatar && (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={handleApplyVoice}
                disabled={patchPending2 || Boolean(busyAction)}
                data-testid="custom-voice-apply-avatar"
                className="text-[9px] rounded bg-rose-500/30 hover:bg-rose-500/45 text-rose-100 ring-1 ring-rose-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
                title="Retry PATCH /v1/avatars/{id} with the cloned voice"
              >
                {patchPending2 ? 'Applying…' : 'Apply to existing avatar'}
              </button>
              {c.custom_voice_avatar_patch_error && (
                <p
                  className="text-[9px] text-rose-300"
                  title={c.custom_voice_avatar_patch_error}
                >
                  {c.custom_voice_avatar_patch_error}
                </p>
              )}
            </div>
          )}
          {customVoiceReady && patchPending && avatarReady && (
            <p className="text-[9px] text-amber-300">
              Voice cloned but no avatar bound yet — Create Runway Avatar to bind.
            </p>
          )}
          {/* PR AU — Drift repair. Surfaces only on the
              "Avatar voice mismatch" branch so the operator can
              one-click re-PATCH the existing avatar with the
              cloned voice. Reuses the same apply-voice route
              that PR AQ + PR AS + PR AT already hang off, so
              a successful repair flows through PATCH → verify →
              drift recompute and the rose pill flips back to
              emerald without any operator hand-holding. */}
          {customVoiceReady && (patchApplied || patchMock) && driftDrift && onApplyVoiceToAvatar && (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={handleRepairDrift}
                disabled={repairBusy || patchPending2 || Boolean(busyAction)}
                data-testid="custom-voice-repair-drift"
                className="text-[9px] rounded bg-rose-500/30 hover:bg-rose-500/45 text-rose-100 ring-1 ring-rose-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
                title="Re-apply the cloned voice to the existing avatar via PATCH /v1/avatars/{id} + verify"
              >
                {repairBusy ? 'Repairing…' : 'Repair voice drift'}
              </button>
              {repairError && (
                <p
                  data-testid="custom-voice-repair-status"
                  className="text-[9px] text-rose-300"
                  title={repairError}
                >
                  {repairError}
                </p>
              )}
              {!repairError && repairBusy && (
                <p
                  data-testid="custom-voice-repair-status"
                  className="text-[9px] text-zinc-500"
                >
                  posting to /apply-voice…
                </p>
              )}
            </div>
          )}

          {/* PR AV — Read-only refresh button. Renders any time the
              character has both an avatar and a cloned voice (the
              backend route returns 409 otherwise so the gate matches
              the wire contract). Distinct from PR AQ apply + PR AU
              repair: this never PATCHes the avatar — only re-runs
              the introspection + drift recompute. */}
          {refreshButtonShouldRender && (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={handleRefreshAvatar}
                disabled={refreshBusy || patchPending2 || repairBusy || Boolean(busyAction)}
                data-testid="custom-voice-refresh-avatar"
                className="text-[9px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 ring-1 ring-zinc-600 px-2 py-0.5 font-semibold disabled:opacity-50"
                title="Re-run GET /v1/avatars/{id} + drift recompute. Read-only — no PATCH."
              >
                {refreshBusy ? 'Refreshing…' : 'Refresh avatar status'}
              </button>
              {refreshError && (
                <p
                  data-testid="custom-voice-refresh-status"
                  className="text-[9px] text-rose-300"
                  title={refreshError}
                >
                  {refreshError}
                </p>
              )}
              {!refreshError && refreshBusy && (
                <p
                  data-testid="custom-voice-refresh-status"
                  className="text-[9px] text-zinc-500"
                >
                  posting to /refresh-avatar-voice…
                </p>
              )}
            </div>
          )}
          {!customVoiceReady && !customVoiceFailed && (
            <p className="text-[9px] text-zinc-500">
              Upload a sample to clone a custom voice for this character.
              Used the next time you Create Runway Avatar.
            </p>
          )}
          {customVoiceReady && !avatarReady && (
            <p className="text-[9px] text-emerald-300">
              Voice ready — Create Runway Avatar to bind it.
            </p>
          )}

          {/* PR AR — Cloned voice preview. When Runway returns a
              previewUrl during the clone poll, render an inline
              <audio controls>; otherwise (mock mode + real-mode
              poll timeouts) fall back to a one-line helper so the
              operator knows preview just isn't available rather
              than something being broken. Distinct from the PR AP
              recorded-take preview which lives inside the recording
              row (above) and disappears once the clone lands. */}
          {customVoiceReady && c.custom_voice_preview_url && (
            <div className="space-y-0.5 pt-0.5">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
                Cloned voice preview
              </p>
              <audio
                src={c.custom_voice_preview_url}
                controls
                preload="metadata"
                data-testid="custom-voice-preview"
                className="w-full h-7"
              />
            </div>
          )}
          {customVoiceReady && !c.custom_voice_preview_url && (
            <p
              className="text-[9px] text-zinc-500 pt-0.5"
              data-testid="custom-voice-preview-unavailable"
              title={
                customVoiceMock
                  ? 'Mock-mode clones never expose a previewUrl.'
                  : 'Runway did not return a preview URL during this clone.'
              }
            >
              {customVoiceMock
                ? 'Preview unavailable in mock mode.'
                : 'Preview unavailable for this cloned voice.'}
            </p>
          )}
          {/* PR AX — Refresh preview button. Renders any time a
              cloned voice exists (the backend route gates on
              custom_voice_id; mock mode returns 200 without a URL
              and preserves any existing one). Sits next to the
              cloned-voice preview audio / unavailable copy so the
              operator can re-fetch without going back to the audio
              picker. */}
          {previewRefreshShouldRender && (
            <div className="space-y-0.5 pt-0.5">
              <button
                type="button"
                onClick={handleRefreshVoicePreview}
                disabled={previewRefreshBusy || Boolean(busyAction)}
                data-testid="custom-voice-refresh-preview"
                className="text-[9px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 ring-1 ring-zinc-600 px-2 py-0.5 font-semibold disabled:opacity-50"
                title="GET /v1/voices/{voice_id} to re-fetch the preview URL. Read-only."
              >
                {previewRefreshBusy ? 'Refreshing…' : 'Refresh preview'}
              </button>
              {previewRefreshError && (
                <p
                  data-testid="custom-voice-refresh-preview-status"
                  className="text-[9px] text-rose-300"
                  title={previewRefreshError}
                >
                  {previewRefreshError}
                </p>
              )}
              {!previewRefreshError && previewRefreshBusy && (
                <p
                  data-testid="custom-voice-refresh-preview-status"
                  className="text-[9px] text-zinc-500"
                >
                  posting to /refresh-voice-preview…
                </p>
              )}
              {!previewRefreshError && !previewRefreshBusy && previewRefreshNote && (
                <p
                  data-testid="custom-voice-refresh-preview-status"
                  className="text-[9px] text-zinc-400"
                  title={previewRefreshNote}
                >
                  {previewRefreshNote}
                </p>
              )}
            </div>
          )}

          {/* PR AO — In-browser audio recording. Sits below the file
              picker so the upload path stays the obvious primary
              affordance; the recording row is a faster shortcut when
              the operator has a mic. Falls back to a one-line message
              when MediaRecorder / mic is unavailable. */}
          {RECORDING_SUPPORTED ? (
            <div className="space-y-1 pt-1 border-t border-zinc-800/40">
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
                  Or record
                </span>
                {recordState === 'recording' && (
                  <span
                    data-testid="custom-voice-record-status"
                    className="text-[9px] rounded-full bg-rose-500/25 text-rose-100 ring-1 ring-rose-400/40 px-1.5 py-0.5 font-mono animate-pulse"
                    aria-live="polite"
                  >
                    recording · {elapsedSeconds}s
                  </span>
                )}
                {recordState === 'recorded' && (
                  <span
                    data-testid="custom-voice-record-status"
                    className="text-[9px] rounded-full bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40 px-1.5 py-0.5 font-mono"
                  >
                    sample ready · {elapsedSeconds}s
                  </span>
                )}
                {recordState === 'cloning' && (
                  <span
                    data-testid="custom-voice-record-status"
                    className="text-[9px] rounded-full bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40 px-1.5 py-0.5 font-mono animate-pulse"
                  >
                    cloning…
                  </span>
                )}
                {recordState === 'idle' && (
                  <span
                    data-testid="custom-voice-record-status"
                    className="text-[9px] rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 px-1.5 py-0.5 font-mono"
                  >
                    idle
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {recordState === 'idle' && (
                  <button
                    type="button"
                    data-testid="custom-voice-record-start"
                    onClick={handleStartRecord}
                    disabled={voiceClonePending || Boolean(busyAction)}
                    className="text-[9px] rounded bg-rose-500/30 hover:bg-rose-500/45 text-rose-100 ring-1 ring-rose-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
                    title="Record a 10-30 s sample with your mic"
                  >
                    Start recording
                  </button>
                )}
                {recordState === 'recording' && (
                  <button
                    type="button"
                    data-testid="custom-voice-record-stop"
                    onClick={handleStopRecord}
                    className="text-[9px] rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 ring-1 ring-zinc-500 px-2 py-0.5 font-semibold"
                    title="Stop recording"
                  >
                    Stop
                  </button>
                )}
                {/* PR AY — Live mic level meter. Renders inline next
                    to the Stop button while recording. The bar's
                    width is mutated directly via the ref by a RAF
                    loop in _startMicMeter so React doesn't re-render
                    on every analyser tick. Falls back to a single
                    helper line when AudioContext / AnalyserNode setup
                    fails — recording itself still works regardless. */}
                {recordState === 'recording' && !meterUnavailable && (
                  <div
                    data-testid="custom-voice-mic-level"
                    className="flex items-center gap-1 flex-1 min-w-[80px] max-w-[160px]"
                    aria-label="microphone level"
                  >
                    <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
                      Mic level
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden ring-1 ring-zinc-700">
                      <div
                        ref={meterBarRef}
                        data-testid="custom-voice-mic-level-bar"
                        className="h-full bg-emerald-400/80 transition-[width] duration-75 ease-out"
                        style={{ width: '0%' }}
                      />
                    </div>
                  </div>
                )}
                {recordState === 'recording' && meterUnavailable && (
                  <span
                    data-testid="custom-voice-mic-level"
                    className="text-[9px] text-zinc-500"
                    title="AudioContext/AnalyserNode unavailable in this browser"
                  >
                    Mic level unavailable
                  </span>
                )}
                {recordState === 'recorded' && (
                  <>
                    <button
                      type="button"
                      data-testid="custom-voice-record-use"
                      onClick={handleUseRecording}
                      disabled={voiceClonePending || Boolean(busyAction)}
                      className="text-[9px] rounded bg-emerald-500/30 hover:bg-emerald-500/45 text-emerald-100 ring-1 ring-emerald-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
                      title="Send this recording to /v1/voices for cloning"
                    >
                      Clone from recording
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardRecording}
                      className="text-[9px] text-zinc-500 hover:text-zinc-300"
                      title="Discard this take and record again"
                    >
                      discard
                    </button>
                  </>
                )}
                {/* PR AP — In-card playback preview. Native <audio
                    controls> bound to the captured Blob via
                    URL.createObjectURL so the operator can listen
                    before spending a Runway clone. The URL is revoked
                    on discard / successful clone / unmount / next
                    recording start. Only rendered in 'recorded' state
                    when a URL exists; falls back gracefully when the
                    object-URL surface is missing. */}
                {recordState === 'recorded' && previewUrl && (
                  <audio
                    src={previewUrl}
                    controls
                    preload="metadata"
                    data-testid="custom-voice-record-preview"
                    className="w-full mt-1 h-7"
                  />
                )}
                {recordState === 'cloning' && (
                  <span className="text-[9px] text-zinc-500">
                    posting to /v1/voices…
                  </span>
                )}
              </div>
              {recordState === 'recorded' && previewUrl && (
                <p
                  className="text-[9px] text-zinc-500"
                  data-testid="custom-voice-record-preview-help"
                >
                  Preview your take before cloning.
                </p>
              )}
              {recordError && (
                <p className="text-[9px] text-rose-300" title={recordError}>
                  {recordError}
                </p>
              )}
            </div>
          ) : (
            <p
              className="text-[9px] text-zinc-500 pt-1 border-t border-zinc-800/40"
              data-testid="custom-voice-record-status"
            >
              Recording unavailable — upload an audio file instead.
            </p>
          )}

          {/* PR BB — Voice repair audit trail. Compact list of the
              most recent clone/apply/repair/refresh events on this
              character. Newest first; default 5 visible with a
              "Show all" link when there are more (capped at 20 by
              the backend store). The list itself is small enough
              that no virtualisation / pagination is needed. */}
          {historyEntries.length > 0 && (
            <div
              data-testid="custom-voice-history"
              className="space-y-0.5 pt-1 border-t border-zinc-800/40"
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
                  Voice history
                </p>
                {historyEntries.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setHistoryExpanded((v) => !v)}
                    className="text-[9px] text-zinc-500 hover:text-pink-300"
                    title={
                      historyExpanded
                        ? 'Collapse to the 5 most recent entries.'
                        : `Show all ${historyEntries.length} entries (capped at 20).`
                    }
                  >
                    {historyExpanded
                      ? 'Show 5 newest'
                      : `Show all (${historyEntries.length})`}
                  </button>
                )}
              </div>
              <ul className="space-y-0.5">
                {historyVisible.map((entry, idx) => (
                  <li
                    key={`${entry.timestamp}-${idx}`}
                    data-testid="custom-voice-history-entry"
                    className="flex items-center gap-1 text-[9px] leading-snug flex-wrap"
                    title={`${entry.timestamp || ''}${
                      entry.error ? ' — ' + entry.error : ''
                    }`}
                  >
                    <span
                      className={`rounded px-1 py-0.5 font-mono ${
                        HISTORY_ACTION_PILLS[entry.action] ||
                        HISTORY_ACTION_PILLS.refresh
                      }`}
                    >
                      {entry.action}
                    </span>
                    {entry.status && (
                      <span
                        className={`rounded px-1 py-0.5 font-mono ${historyStatusClass(
                          entry.status,
                        )}`}
                      >
                        {entry.status}
                      </span>
                    )}
                    {entry.drift_status && (
                      <span
                        className={`rounded px-1 py-0.5 font-mono ${historyDriftClass(
                          entry.drift_status,
                        )}`}
                        title={`drift_status=${entry.drift_status}`}
                      >
                        {entry.drift_status}
                      </span>
                    )}
                    <span className="ml-auto text-zinc-500 font-mono">
                      {formatHistoryTimestamp(entry.timestamp, nowMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action row — context-aware */}
      <div className="flex items-center gap-1 flex-wrap pt-0.5">
        {!hasPortrait && onGeneratePortrait && (
          <button
            type="button"
            onClick={() => onGeneratePortrait(c)}
            disabled={busyAction === 'portrait' || Boolean(busyAction)}
            className="rounded bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'portrait' ? 'Generating…' : 'Generate Portrait'}
          </button>
        )}
        {/* PR DS — Regenerate Portrait: rerolls the still image only.
            Same backend route as the initial generate; overwrites the
            existing file at the same path. Cache-bust query param on
            ``portraitUrl`` above ensures the new file actually shows.
            Zinc/secondary styling so it doesn't compete with the
            primary "Use Character" / "Create Avatar" actions. */}
        {hasPortrait && onGeneratePortrait && (
          <button
            type="button"
            data-testid="character-card-regenerate-portrait"
            onClick={() => onGeneratePortrait(c)}
            disabled={busyAction === 'portrait' || Boolean(busyAction)}
            title="Reroll the portrait image. Does not touch the avatar or voice."
            className="rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'portrait' ? 'Regenerating…' : '↺ Regenerate Portrait'}
          </button>
        )}
        {hasPortrait && !avatarReady && onCreateAvatar && (
          <button
            type="button"
            onClick={() => onCreateAvatar(c)}
            disabled={busyAction === 'avatar' || Boolean(busyAction)}
            className="rounded bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'avatar' ? 'Creating Avatar…' : avatarFailed ? 'Retry Avatar' : 'Create Runway Avatar'}
          </button>
        )}
        {/* PR DU — Rebuild Avatar: rebind the Runway avatar to the
            current (possibly-regenerated) portrait. Without this, a
            Regenerate Portrait + render produces the OLD face because
            videos lip-sync against the original avatar, which was
            built from the old portrait. Reuses the existing
            ``onCreateAvatar`` callback — the backend route overwrites
            ``runway_avatar_id`` with the fresh binding; the old
            avatar stays on the Runway account but is no longer
            referenced by Character OS. Zinc/secondary styling. */}
        {hasPortrait && avatarReady && onCreateAvatar && (
          <button
            type="button"
            data-testid="character-card-rebuild-avatar"
            onClick={() => onCreateAvatar(c)}
            disabled={busyAction === 'avatar' || Boolean(busyAction)}
            title="Rebuild the Runway avatar from the current portrait. Required after Regenerate Portrait."
            className="rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'avatar' ? 'Rebuilding…' : '↻ Rebuild Avatar'}
          </button>
        )}
        {avatarReady && onAttach && !attachedHere && (
          <button
            type="button"
            onClick={() => onAttach(c)}
            disabled={busyAction === 'attach' || Boolean(busyAction)}
            className="rounded bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            {busyAction === 'attach' ? 'Attaching…' : 'Use Character'}
          </button>
        )}
        {avatarReady && attachedHere && onAttach && (
          <button
            type="button"
            onClick={() => onAttach(null)}
            disabled={busyAction === 'attach' || Boolean(busyAction)}
            className="rounded border border-pink-400/50 text-pink-300 hover:bg-pink-500/10 text-[10px] px-2 py-1 disabled:opacity-50"
          >
            Detach
          </button>
        )}
        {/* PR U — Use as Spokesperson / Active toggle. Only available
            on full (non-compact) tiles in the Studio library; the
            per-campaign attach picker uses compact mode and keeps the
            "Use Character" affordance instead. */}
        {!compact && onSetActive && hasPortrait && (
          isActive ? (
            <button
              type="button"
              onClick={() => onSetActive(false)}
              className="rounded border border-spark/60 text-spark hover:bg-spark/10 text-[10px] px-2 py-1"
              title="Stop using this character as the active spokesperson"
            >
              Active — clear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSetActive(true)}
              className="rounded bg-spark/80 hover:bg-spark text-ink text-[10px] font-semibold px-2 py-1"
              title="Use this character as the active spokesperson — drives the visual prompt + auto-attaches when you save the campaign"
            >
              Use as Spokesperson
            </button>
          )
        )}
        {onDelete && !compact && (
          <button
            type="button"
            onClick={() => onDelete(c)}
            disabled={Boolean(busyAction)}
            className="ml-auto text-[9px] text-zinc-500 hover:text-rose-300 disabled:opacity-50"
            title="Local delete only — does not remove the avatar from Runway"
          >
            delete
          </button>
        )}
      </div>
    </div>
  )
}
