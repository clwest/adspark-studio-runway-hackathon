import { useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'

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
            Cinematic Ad lane
            <span
              className="text-[10px] rounded-full bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/40 px-2 py-0.5 font-mono"
              title="Mounted while localStorage.adspark.activeMode === 'cinematic'"
            >
              scaffold · PR BK
            </span>
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Silent image_to_video cut + voiced cinematic mux +
            optional 3-shot storyboard concat. The Cinematic lane
            previews the Brief → Visual Source → Render flow; render
            handlers ship in a follow-up slice.
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
        {/* Step 1 — Brief */}
        <div
          data-testid="cinematic-lane-step-brief"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Step 1 · Brief
            </span>
            {hasCampaign && (
              <span className="text-[9px] text-zinc-600 font-mono">
                latest
              </span>
            )}
          </div>
          {hasCampaign ? (
            <>
              <div className="text-xs text-zinc-200 font-semibold leading-snug">
                {focused.business || 'Untitled campaign'}
              </div>
              {focused.product && (
                <div className="text-[10px] text-zinc-400 leading-snug">
                  {focused.product.length > 60
                    ? focused.product.slice(0, 60) + '…'
                    : focused.product}
                </div>
              )}
              <p className="text-[10px] text-zinc-500 leading-snug pt-1">
                Brief capture reuses the existing campaign form;
                editing rolls into the lane builder follow-up slice.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                No linked campaign yet.
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Brief capture will reuse the existing campaign form.
                Until the lane builder ships, create or open a saved
                campaign in the classic UX.
              </p>
            </>
          )}
        </div>

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
                Silent visual cut cached
              </div>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Sourced from `image_to_video` (gen4_turbo / gen4.5).
                Re-render via the classic gallery's Visuals tab.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {hasCampaign
                  ? 'No silent visual cached on this campaign yet.'
                  : 'Visual source picker (Generate / Upload / Use Character / Text-only) lives in classic UX Stage 3.'}
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Visual flows through `image_to_video` for the silent
                cinematic cut; PR S/X mux adds host-clip audio.
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
            <button
              type="button"
              disabled
              data-testid="cinematic-lane-video"
              data-render-target="cinematic-video"
              data-has-output={focused?.cached_video_url ? 'true' : 'false'}
              title="Render wiring lands with the cinematic lane builder. Use the classic gallery to render today."
              className="w-full flex items-center justify-between gap-2 text-[11px] rounded ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 px-2 py-1 font-mono cursor-not-allowed disabled:opacity-80"
            >
              <span className="truncate">Cinematic Video</span>
              <span className="text-[9px] text-zinc-500">
                {focused?.cached_video_url ? 'cached' : 'placeholder'}
              </span>
            </button>
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
            <button
              type="button"
              disabled
              data-testid="cinematic-lane-storyboard"
              data-render-target="storyboard"
              data-has-output={focused?.storyboard_video_url ? 'true' : 'false'}
              title="Render wiring lands with the cinematic lane builder. Use the classic gallery to render today."
              className="w-full flex items-center justify-between gap-2 text-[11px] rounded ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 px-2 py-1 font-mono cursor-not-allowed disabled:opacity-80"
            >
              <span className="truncate">Storyboard Commercial</span>
              <span className="text-[9px] text-zinc-500">
                {focused?.storyboard_video_url ? 'cached' : 'placeholder'}
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
