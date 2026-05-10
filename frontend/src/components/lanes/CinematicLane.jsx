import { useEffect, useRef, useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'
import Step1CampaignPanel from './Step1CampaignPanel.jsx'

/**
 * PR BK — Cinematic Ad lane scaffold (gated v2).
 *
 * Mounted by SpokespersonStudio when
 * `localStorage.adspark.activeMode === "cinematic"`. Mirrors
 * PR BI's SpokespersonLane shape with mode-specific copy + render
 * targets — three disabled placeholder buttons map to the three
 * cinematic outputs that already exist on the saved Campaign:
 *   - Cinematic Video       → cached `cached_video_url`
 *                             (silent image_to_video cut)
 *   - Voiced Cinematic      → `voiced_commercial_url`
 *                             (PR S/X ffmpeg mux)
 *   - Storyboard Commercial → `storyboard_video_url`
 *                             (PR Z 3-shot stitched concat)
 *
 * Backend untouched. Render buttons are disabled placeholders;
 * actual generation continues to flow through the legacy
 * gallery + the existing Runway routes until a follow-up slice
 * wires real submit handlers.
 *
 * Props:
 *   activeSpokesperson  Character | null  (set via PR U
 *                       "Use as Spokesperson")
 *   linkedCampaigns     Array<Campaign>   (campaigns whose
 *                       character_id matches the active
 *                       spokesperson)
 */
export default function CinematicLane({
  activeSpokesperson = null,
  linkedCampaigns = [],
  // PR BO — Voiced Cinematic build handler. Resolves with the
  // updated Campaign on success; throws with a friendly error
  // on failure (typically a 409 from the backend route when no
  // silent cinematic visual or no host clip exists yet).
  onBuildVoicedCinematic = null,
  // PR BP — Stitch Storyboard Commercial handler. ffmpeg concat
  // of the three cached per-shot MP4s; gated on every shot
  // status === 'ok'.
  onStitchStoryboard = null,
  // PR BT — Generate Real Cinematic Video handler. Fires real
  // Runway image_to_video (start + poll). Resolves with the
  // final task on SUCCEEDED, throws otherwise. Optional second
  // arg is a progress callback `({phase, task, attempts}) =>
  // void` we surface in the lane's status row.
  onGenerateCinematicVideo = null,
  // PR BQ — Inline brief editor save handler.
  onUpdateBrief = null,
  // PR CU — closes the empty-state dead-end. Same handler shape as
  // the spokesperson lane.
  onCreateCampaign = null,
}) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const sorted = [...campaigns].sort((a, b) => {
    const at = String(a.created_at || '')
    const bt = String(b.created_at || '')
    return bt.localeCompare(at)
  })
  const focused = sorted[0] || null
  const hasSpokesperson = Boolean(activeSpokesperson)
  const hasCampaign = Boolean(focused)
  const focusedScript = focused?.commercial_script || ''
  const scriptPreview =
    focusedScript.length > 220
      ? focusedScript.slice(0, 220) + '…'
      : focusedScript

  // PR BO — Voiced Cinematic gating mirrors v1 CampaignGallery's
  // `commercialBuildable` exactly:
  //   isCached         = focused.cached_video_url set
  //   hostReadyForCommercial =
  //       focused.host_status === 'ok' && focused.host_video_url
  //   hasUsableAvatar  = character_id || selected_avatar_id ||
  //                      (host_avatar_id with status ready/mock)
  //   buildable        = isCached && (hostReady || hasUsableAvatar)
  const voicedIsCached = Boolean(focused?.cached_video_url)
  const voicedHostReady = Boolean(
    focused?.host_video_url && focused?.host_status === 'ok',
  )
  const voicedHasUsableAvatar = Boolean(
    focused?.character_id ||
      focused?.selected_avatar_id ||
      (focused?.host_avatar_id &&
        ['ready', 'mock'].includes(focused?.host_avatar_status || '')),
  )
  const voicedBuildable =
    voicedIsCached && (voicedHostReady || voicedHasUsableAvatar)
  const voicedCached =
    focused?.voiced_commercial_status === 'ok' &&
    Boolean(focused?.voiced_commercial_url)
  const voicedFailed =
    focused?.voiced_commercial_status === 'failed' &&
    Boolean(focused?.voiced_commercial_error)
  const [voicedBusy, setVoicedBusy] = useState(false)
  const [voicedError, setVoicedError] = useState('')
  const voicedLabel = voicedBusy
    ? 'Building Voiced Cinematic…'
    : voicedCached
    ? 'Rebuild Voiced Cinematic'
    : 'Build Voiced Cinematic'
  const voicedCanFire = Boolean(
    onBuildVoicedCinematic && hasCampaign && voicedBuildable && !voicedBusy,
  )
  const voicedDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !voicedIsCached
    ? 'Generate the silent cinematic visual cut first (cached_video_url required).'
    : !voicedHostReady && !voicedHasUsableAvatar
    ? 'A host clip OR a usable avatar is required (host_status=ok, OR character_id / selected_avatar_id / host_avatar_id ready).'
    : !onBuildVoicedCinematic
    ? 'Wire the v2 onBuildVoicedCinematic handler before this button can fire.'
    : ''
  const handleBuildVoiced = async () => {
    if (!voicedCanFire) return
    setVoicedError('')
    setVoicedBusy(true)
    try {
      await onBuildVoicedCinematic(focused.id)
    } catch (e) {
      setVoicedError(`${e?.message || e}`)
    } finally {
      setVoicedBusy(false)
    }
  }

  // PR BP — Storyboard Commercial gating. The backend route
  // (POST /storyboard/stitch) requires every shot in
  // storyboard_shots to have status === 'ok'. ffmpeg-only —
  // no Runway credits.
  const storyShots = Array.isArray(focused?.storyboard_shots)
    ? focused.storyboard_shots
    : []
  const storyAllReady =
    storyShots.length > 0 && storyShots.every((s) => s.status === 'ok')
  const storyCached =
    focused?.storyboard_status === 'ok' &&
    Boolean(focused?.storyboard_video_url)
  const storyFailed =
    focused?.storyboard_status === 'failed' &&
    Boolean(focused?.storyboard_error)
  const [storyBusy, setStoryBusy] = useState(false)
  const [storyError, setStoryError] = useState('')
  const storyCanFire = Boolean(
    onStitchStoryboard && hasCampaign && storyAllReady && !storyBusy,
  )
  const storyLabel = storyBusy
    ? 'Stitching Storyboard…'
    : storyCached
    ? 'Restitch Storyboard Commercial'
    : 'Stitch Storyboard Commercial'
  const storyDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : storyShots.length === 0
    ? 'Plan a storyboard first in the legacy wizard (3 shots required).'
    : !storyAllReady
    ? `${storyShots.filter((s) => s.status === 'ok').length}/${storyShots.length} shots ready — generate the rest in the legacy wizard before stitching.`
    : !onStitchStoryboard
    ? 'Wire the v2 onStitchStoryboard handler before this button can fire.'
    : ''
  const handleStitchStoryboard = async () => {
    if (!storyCanFire) return
    setStoryError('')
    setStoryBusy(true)
    try {
      await onStitchStoryboard(focused.id)
    } catch (e) {
      setStoryError(`${e?.message || e}`)
    } finally {
      setStoryBusy(false)
    }
  }

  // PR BT — Cinematic Video gating. Fires real Runway
  // `image_to_video` (start + poll). Required source: a
  // saved campaign with `runway_prompt`. The reference image
  // is optional (text_to_video path when null), mirroring v1
  // App.handleGenerateVideo. Burns Runway credits per click;
  // mock mode short-circuits to a fast-resolving SUCCEEDED.
  //
  // PR BU — after the SUCCEEDED task lands, the studio handler
  // also POSTs the output URL to /cinematic-video so the
  // backend persists it onto the campaign (cached_video_url
  // flips to /api/campaigns/{id}/video). Persisted state
  // survives reloads + appears in the existing gallery video
  // player; the lane shows "open cinematic video ↗" pointing
  // at the persisted path.
  const videoPromptReady = Boolean((focused?.runway_prompt || '').trim())
  const videoCached = Boolean(focused?.cached_video_url)
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [videoTaskInfo, setVideoTaskInfo] = useState(null)
  // PR BU — phase tracks where in the lifecycle we are so the
  // status row can read "starting…" / "polling…" / "saving to
  // campaign…" / "saved to campaign" / "saved (persist failed,
  // session URL only)" without inferring from busy state.
  const [videoPhase, setVideoPhase] = useState('idle')
  // PR BU — fallback session URL kept for the rare case where
  // the persist call 502s but the SUCCEEDED Runway URL is still
  // valid (mock mode + a fake upstream is the obvious scenario).
  // When the campaign's `cached_video_url` is set we prefer that;
  // this only renders when persist-failed but the task SUCCEEDED.
  const [videoSessionUrl, setVideoSessionUrl] = useState('')
  // Cancellation flag so a mid-poll unmount doesn't try to
  // setState after the lane is gone (effect cleanup below).
  const videoActiveRef = useRef(true)
  useEffect(() => {
    videoActiveRef.current = true
    return () => {
      videoActiveRef.current = false
    }
  }, [])
  const videoCanFire = Boolean(
    onGenerateCinematicVideo && hasCampaign && videoPromptReady && !videoBusy,
  )
  // PR BU — label flips between Generate / Regenerate based on
  // the campaign's *persisted* cached_video_url, since the
  // session-only URL is now the exception path.
  const videoLabel = videoBusy
    ? 'Generating Real Cinematic Video…'
    : videoCached
    ? 'Regenerate Real Cinematic Video'
    : 'Generate Real Cinematic Video'
  const videoDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !videoPromptReady
    ? 'This campaign has no saved prompt — re-save it in the legacy wizard so we have something to send to Runway.'
    : !onGenerateCinematicVideo
    ? 'Wire the v2 onGenerateCinematicVideo handler before this button can fire.'
    : ''
  const handleGenerateVideo = async () => {
    if (!videoCanFire) return
    setVideoError('')
    setVideoSessionUrl('')
    setVideoTaskInfo(null)
    setVideoPhase('starting')
    setVideoBusy(true)
    try {
      const result = await onGenerateCinematicVideo(
        focused.id,
        (progress) => {
          if (!videoActiveRef.current) return
          if (progress.task) setVideoTaskInfo(progress.task)
          if (progress.phase) setVideoPhase(progress.phase)
        },
      )
      if (!videoActiveRef.current) return
      // PR BU — handler now returns
      //   { task, campaign, persistError? }
      // when SUCCEEDED. Lane prefers the persisted campaign's
      // cached_video_url (rendered via the focused campaign
      // re-fetch through the studio); only falls back to the
      // session URL when persist failed.
      if (result?.campaign) {
        setVideoPhase('persisted')
      } else {
        const url =
          Array.isArray(result?.task?.output) && result.task.output.length > 0
            ? String(result.task.output[0] || '').trim()
            : ''
        setVideoSessionUrl(url)
        setVideoPhase(result?.persistError ? 'persist-failed' : 'no-output')
      }
    } catch (e) {
      if (!videoActiveRef.current) return
      setVideoError(`${e?.message || e}`)
      setVideoPhase('failed')
    } finally {
      if (videoActiveRef.current) setVideoBusy(false)
    }
  }
  const videoStatusText = (() => {
    if (videoBusy) {
      if (videoPhase === 'persisting') return 'saving to campaign…'
      if (videoPhase === 'starting') return 'starting Runway image_to_video…'
      if (videoTaskInfo) {
        return `polling Runway… status=${videoTaskInfo.status} progress=${Math.round(
          (videoTaskInfo.progress || 0) * 100,
        )}%`
      }
      return 'starting Runway image_to_video…'
    }
    if (videoPhase === 'persisted') return 'saved to campaign'
    if (videoPhase === 'persist-failed')
      return 'saved (persist failed — session URL only)'
    return ''
  })()

  return (
    <section
      data-testid="cinematic-lane"
      data-mode="cinematic"
      className="rounded-xl ring-1 ring-fuchsia-400/30 bg-fuchsia-500/[0.04] p-3 space-y-3"
    >
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span aria-hidden="true">🎬</span>
            Create a cinematic video
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Generate a polished image-to-video cut for this campaign,
            mux in the spokesperson's narration, and optionally
            stitch a 3-shot storyboard. Real Runway credits when you
            click Generate.
          </p>
        </div>
        {hasSpokesperson && (
          <div
            className="flex items-center gap-2 rounded-lg ring-1 ring-fuchsia-400/30 bg-fuchsia-500/10 px-2 py-1"
            aria-label="active spokesperson"
          >
            {activeSpokesperson.portrait_url && (
              <img
                src={activeSpokesperson.portrait_url}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            )}
            <span className="text-[11px] text-fuchsia-200 font-mono">
              {activeSpokesperson.name || 'Active spokesperson'}
            </span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {/* Step 1 — Campaign Setup / Summary (PR DI) */}
        <Step1CampaignPanel
          focused={focused}
          hasSpokesperson={hasSpokesperson}
          onCreate={onCreateCampaign}
          onSave={onUpdateBrief}
          modeLabel="cinematic ad"
          testidPrefix="cinematic"
          counts={
            focused
              ? {
                  outputs: Array.isArray(focused.outputs)
                    ? focused.outputs.length
                    : 0,
                }
              : null
          }
        />

        {/* Step 2 — Visual Source */}
        <div
          data-testid="cinematic-lane-step-visual"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 2 · Visual Source
          </span>
          {focused?.cached_video_url ? (
            <>
              <div className="text-[11px] text-emerald-200 leading-snug">
                Silent visual cached and ready
              </div>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Click Regenerate Real Cinematic Video below to refresh
                the silent cut in place — the new MP4 saves directly
                onto this campaign.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {hasCampaign
                  ? 'No cinematic visual on this campaign yet.'
                  : 'Create or select a campaign to render a cinematic visual.'}
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Click Generate Real Cinematic Video below to render a
                new silent cut. Voiced and storyboard mixes layer on
                top once the silent cut is cached.
              </p>
            </>
          )}
          {focusedScript && (
            <pre className="whitespace-pre-wrap break-words text-[9px] text-zinc-300 font-mono leading-snug max-h-[5rem] overflow-y-auto rounded bg-black/30 ring-1 ring-zinc-800 p-1.5 mt-1">
              {scriptPreview}
            </pre>
          )}
        </div>

        {/* Step 3 — Render */}
        <div
          data-testid="cinematic-lane-step-render"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 3 · Render
          </span>
          <div className="space-y-1">
            {/* PR BT — Cinematic Video button is now wired to
                real Runway image_to_video. Same start + poll
                pattern v1 App.handleGenerateVideo uses. Burns
                credits per click; rose chrome to mirror PR BP's
                "this costs money" vocabulary. */}
            <button
              type="button"
              onClick={handleGenerateVideo}
              disabled={!videoCanFire}
              data-testid="cinematic-lane-video"
              data-render-target="cinematic-video"
              data-has-output={
                focused?.cached_video_url || videoSessionUrl ? 'true' : 'false'
              }
              data-source-ready={videoPromptReady ? 'true' : 'false'}
              data-busy={videoBusy ? 'true' : 'false'}
              data-persisted={focused?.cached_video_url ? 'true' : 'false'}
              data-burns-credits="true"
              title={
                videoCanFire
                  ? '⚠️ POST /api/runway/generate (image_to_video) — burns Runway credits per click. Polls until SUCCEEDED (≈ 30 s – 5 min cap).'
                  : videoDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (videoCanFire
                  ? 'ring-1 ring-rose-400/50 bg-rose-500/30 hover:bg-rose-500/45 text-rose-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">{videoLabel}</span>
              <span className="text-[9px] text-zinc-200/70">
                {videoBusy
                  ? 'generating…'
                  : videoCached
                  ? 'saved · burns credits'
                  : videoCanFire
                  ? 'burns credits'
                  : 'no prompt'}
              </span>
            </button>
            {videoCanFire && (
              <p
                data-testid="cinematic-lane-video-warning"
                className="text-[9px] text-rose-300 leading-snug"
              >
                ⚠️ Real Runway. Each click bills `image_to_video`.
              </p>
            )}
            {/* PR BO — Voiced Cinematic button is now wired.
                Enabled only when the focused campaign has the
                silent cinematic cut cached AND either a host
                clip or a usable avatar (mirrors v1's
                commercialBuildable). Fuchsia chrome to mirror
                the lane's mode-pill colour vocabulary. */}
            <button
              type="button"
              onClick={handleBuildVoiced}
              disabled={!voicedCanFire}
              data-testid="cinematic-lane-voiced"
              data-render-target="voiced-cinematic"
              data-has-output={focused?.voiced_commercial_url ? 'true' : 'false'}
              data-source-ready={voicedBuildable ? 'true' : 'false'}
              data-busy={voicedBusy ? 'true' : 'false'}
              title={
                voicedCanFire
                  ? 'POST /api/campaigns/{id}/commercial-with-voice — local ffmpeg mux of cached visual + host clip audio. No Runway calls.'
                  : voicedDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (voicedCanFire
                  ? 'ring-1 ring-fuchsia-400/40 bg-fuchsia-500/30 hover:bg-fuchsia-500/45 text-fuchsia-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">{voicedLabel}</span>
              <span className="text-[9px] text-zinc-200/70">
                {voicedBusy
                  ? 'building…'
                  : voicedCached
                  ? 'cached'
                  : voicedBuildable
                  ? 'ready'
                  : 'no source'}
              </span>
            </button>
            {/* PR BP — Storyboard Commercial button. ffmpeg-
                only stitch over the 3 cached per-shot MP4s.
                Enabled only when every shot has status='ok'.
                Per-shot generation still lives in classic UX
                (real Runway image_to_video, async polling). */}
            <button
              type="button"
              onClick={handleStitchStoryboard}
              disabled={!storyCanFire}
              data-testid="cinematic-lane-storyboard"
              data-render-target="storyboard"
              data-has-output={focused?.storyboard_video_url ? 'true' : 'false'}
              data-source-ready={storyAllReady ? 'true' : 'false'}
              data-busy={storyBusy ? 'true' : 'false'}
              title={
                storyCanFire
                  ? 'POST /api/campaigns/{id}/storyboard/stitch — ffmpeg concat of cached per-shot MP4s. No Runway calls.'
                  : storyDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (storyCanFire
                  ? 'ring-1 ring-amber-400/40 bg-amber-500/30 hover:bg-amber-500/45 text-amber-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">{storyLabel}</span>
              <span className="text-[9px] text-zinc-200/70">
                {storyBusy
                  ? 'stitching…'
                  : storyCached
                  ? 'cached'
                  : storyAllReady
                  ? 'ready'
                  : storyShots.length > 0
                  ? `${storyShots.filter((s) => s.status === 'ok').length}/${storyShots.length} shots`
                  : 'no plan'}
              </span>
            </button>
          </div>
          {/* PR BO — Voiced Cinematic status row. Renders one of:
              - rose error from the click handler
              - zinc "posting to /commercial-with-voice…" while busy
              - rose persisted-failure copy when backend recorded one
              - emerald download link when voiced commercial is cached */}
          {voicedError && (
            <p
              data-testid="cinematic-lane-voiced-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={voicedError}
            >
              {voicedError}
            </p>
          )}
          {!voicedError && voicedBusy && (
            <p
              data-testid="cinematic-lane-voiced-status"
              className="text-[10px] text-zinc-500 leading-snug"
            >
              posting to /commercial-with-voice…
            </p>
          )}
          {!voicedError && !voicedBusy && voicedFailed && (
            <p
              data-testid="cinematic-lane-voiced-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={focused.voiced_commercial_error}
            >
              Voiced cinematic failed: {focused.voiced_commercial_error}
            </p>
          )}
          {!voicedError && !voicedBusy && voicedCached && (
            <a
              href={focused.voiced_commercial_url}
              target="_blank"
              rel="noreferrer"
              download
              data-testid="cinematic-lane-voiced-link"
              className="text-[10px] text-spark hover:underline font-mono"
            >
              download voiced cinematic ↗
            </a>
          )}
          {/* PR BP — Storyboard status row */}
          {storyError && (
            <p
              data-testid="cinematic-lane-storyboard-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={storyError}
            >
              {storyError}
            </p>
          )}
          {!storyError && storyBusy && (
            <p
              data-testid="cinematic-lane-storyboard-status"
              className="text-[10px] text-zinc-500 leading-snug"
            >
              posting to /storyboard/stitch…
            </p>
          )}
          {!storyError && !storyBusy && storyFailed && (
            <p
              data-testid="cinematic-lane-storyboard-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={focused.storyboard_error}
            >
              Storyboard stitch failed: {focused.storyboard_error}
            </p>
          )}
          {!storyError && !storyBusy && storyCached && (
            <a
              href={focused.storyboard_video_url}
              target="_blank"
              rel="noreferrer"
              download
              data-testid="cinematic-lane-storyboard-link"
              className="text-[10px] text-spark hover:underline font-mono"
            >
              download storyboard commercial ↗
            </a>
          )}
          {/* PR BT/BU — Cinematic Video status row. Renders one of:
              - rose error from the click handler
              - zinc "polling Runway…" / "saving to campaign…" while busy
              - emerald "saved to campaign" once the SUCCEEDED
                output URL has been persisted onto the campaign
                (PR BU); link below points at the persisted
                /api/campaigns/{id}/video path so it survives
                reloads.
              - rose "saved (persist failed — session URL only)"
                fallback when persist 502s but the SUCCEEDED
                Runway URL is still streamable in this session. */}
          {videoError && (
            <p
              data-testid="cinematic-lane-video-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={videoError}
            >
              {videoError}
            </p>
          )}
          {!videoError && videoBusy && (
            <p
              data-testid="cinematic-lane-video-status"
              className="text-[10px] text-zinc-500 leading-snug"
            >
              {videoStatusText}
            </p>
          )}
          {!videoError && !videoBusy && videoPhase === 'persisted' && (
            <p
              data-testid="cinematic-lane-video-status"
              className="text-[10px] text-emerald-300 leading-snug"
            >
              {videoStatusText}
            </p>
          )}
          {!videoError && !videoBusy && videoPhase === 'persist-failed' && (
            <p
              data-testid="cinematic-lane-video-status"
              className="text-[10px] text-rose-300 leading-snug"
              title="POST /cinematic-video failed; the SUCCEEDED Runway URL is still usable for this session."
            >
              {videoStatusText}
            </p>
          )}
          {!videoError && !videoBusy && focused?.cached_video_url && (
            <a
              href={focused.cached_video_url}
              target="_blank"
              rel="noreferrer"
              download
              data-testid="cinematic-lane-video-link"
              data-persisted="true"
              className="text-[10px] text-spark hover:underline font-mono"
            >
              open cinematic video ↗
            </a>
          )}
          {!videoError &&
            !videoBusy &&
            !focused?.cached_video_url &&
            videoSessionUrl && (
              <a
                href={videoSessionUrl}
                target="_blank"
                rel="noreferrer"
                download
                data-testid="cinematic-lane-video-link"
                data-persisted="false"
                className="text-[10px] text-spark hover:underline font-mono"
              >
                open generated cinematic video ↗ (session only)
              </a>
            )}
          {focused?.realtime_transcript_fetched_at && (
            <p className="text-[9px] text-zinc-600 leading-snug">
              last touched{' '}
              <span className="font-mono text-zinc-500">
                {formatTouchedOrDash(focused.realtime_transcript_fetched_at)}
              </span>
            </p>
          )}
          {!hasCampaign && (
            <p className="text-[10px] text-zinc-500 leading-snug">
              Create or select a campaign to render a cinematic ad.
            </p>
          )}
        </div>
      </div>

      {!hasSpokesperson && !hasCampaign && (
        <p
          data-testid="cinematic-lane-empty-hint"
          className="text-[10px] text-zinc-500 leading-snug"
        >
          Pick an active spokesperson (Use as Spokesperson on a card)
          and link them to a campaign to populate this lane.
        </p>
      )}
    </section>
  )
}

function formatTouchedOrDash(iso) {
  if (!iso) return '—'
  return formatHistoryTimestamp(iso) || '—'
}
