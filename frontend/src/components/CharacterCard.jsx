import { useEffect, useRef, useState } from 'react'

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
}) {
  const c = character
  const portraitUrl = c.portrait_url
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

  const handleApplyVoice = async () => {
    if (!onApplyVoiceToAvatar) return
    setPatchPending2(true)
    try {
      await onApplyVoiceToAvatar(c)
    } finally {
      setPatchPending2(false)
    }
  }

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

  const _revokePreview = (url) => {
    if (!url || typeof URL === 'undefined' || !URL.revokeObjectURL) return
    try { URL.revokeObjectURL(url) } catch { /* ignore */ }
  }

  // Always-on cleanup so we never leak the mic stream when the tile
  // unmounts mid-record. Also revokes any lingering preview URL so the
  // browser drops its hold on the recorded Blob.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      try { recorderRef.current?.stop() } catch { /* ignore */ }
      streamRef.current?.getTracks?.().forEach((t) => t.stop())
      _revokePreview(previewUrl)
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
          </div>
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
