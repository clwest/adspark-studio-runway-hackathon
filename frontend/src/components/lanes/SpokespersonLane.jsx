import { useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'

/**
 * PR BI — Spokesperson Ad lane scaffold (gated v2).
 *
 * Mounted by SpokespersonStudio when
 * `localStorage.adspark.activeMode === "spokesperson"`. Renders a
 * compact 3-step scaffold (Brief / Script / Render) so the
 * mode-first UX feels actionable without a full lane builder.
 * Render buttons are disabled placeholders in this slice — actual
 * generation continues to flow through the legacy gallery + the
 * existing `/spokesperson-ad` + `/spokesperson-ad/reels` routes
 * until PR BJ wires the real submit handlers.
 *
 * Backend untouched. No real API calls fire from this component.
 *
 * Props:
 *   activeSpokesperson  Character | null  (the spokesperson set
 *                       active via PR U "Use as Spokesperson")
 *   linkedCampaigns     Array<Campaign>   (campaigns whose
 *                       character_id matches the active
 *                       spokesperson)
 */
export default function SpokespersonLane({
  activeSpokesperson = null,
  linkedCampaigns = [],
  // PR BN — Captioned Reels build handler. Resolves with the
  // updated Campaign on success; throws with a friendly error
  // message on failure (typically a 409 from the backend route
  // when no spokesperson source video exists yet).
  onBuildReels = null,
}) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  // Pick the most recently-touched campaign as the lane's "focused"
  // record so the operator gets a concrete preview of brief +
  // script + render state. ISO-string compare is correct.
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
    focusedScript.length > 220 ? focusedScript.slice(0, 220) + '…' : focusedScript

  // PR BN — Reels readiness derivations.
  // Source video exists when the spokesperson host clip is cached
  // + ffprobe-able (host_status === 'ok' AND host_video_url set).
  // Mirrors the gating that backend's /spokesperson-ad/reels uses
  // when it pulls the source — without source the route 409s.
  const reelsSourceReady = Boolean(
    focused?.host_video_url && focused?.host_status === 'ok',
  )
  const reelsCached =
    focused?.spokesperson_reels_status === 'ok' &&
    Boolean(focused?.spokesperson_reels_url)
  const reelsFailed =
    focused?.spokesperson_reels_status === 'failed' &&
    Boolean(focused?.spokesperson_reels_error)
  const [reelsBusy, setReelsBusy] = useState(false)
  const [reelsError, setReelsError] = useState('')
  const reelsLabel = reelsBusy
    ? 'Building Captioned Reels…'
    : reelsCached
    ? 'Rebuild Captioned Reels'
    : 'Build Captioned Reels'
  const reelsCanFire = Boolean(
    onBuildReels && hasCampaign && reelsSourceReady && !reelsBusy,
  )
  const reelsDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !reelsSourceReady
    ? 'Generate the Spokesperson Ad cut first (host_video_url + host_status=ok required).'
    : !onBuildReels
    ? 'Wire the v2 onBuildReels handler before this button can fire.'
    : ''
  const handleBuildReels = async () => {
    if (!reelsCanFire) return
    setReelsError('')
    setReelsBusy(true)
    try {
      await onBuildReels(focused.id)
    } catch (e) {
      setReelsError(`${e?.message || e}`)
    } finally {
      setReelsBusy(false)
    }
  }

  return (
    <section
      data-testid="spokesperson-lane"
      data-mode="spokesperson"
      className="rounded-xl ring-1 ring-emerald-400/30 bg-emerald-500/[0.04] p-3 space-y-3"
    >
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span aria-hidden="true">🎙️</span>
            Spokesperson Ad lane
            <span
              className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40 px-2 py-0.5 font-mono"
              title="Mounted while localStorage.adspark.activeMode === 'spokesperson'"
            >
              scaffold · PR BI
            </span>
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Lip-synced talking-avatar render + captioned vertical
            reels export. Generation lives behind PR BJ; for now this
            lane previews what the Brief → Script → Render flow will
            look like.
          </p>
        </div>
        {hasSpokesperson && (
          <div
            className="flex items-center gap-2 rounded-lg ring-1 ring-emerald-400/30 bg-emerald-500/10 px-2 py-1"
            aria-label="active spokesperson"
          >
            {activeSpokesperson.portrait_url && (
              <img
                src={activeSpokesperson.portrait_url}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            )}
            <span className="text-[11px] text-emerald-200 font-mono">
              {activeSpokesperson.name || 'Active spokesperson'}
            </span>
          </div>
        )}
      </header>

      {/* 3-step scaffold. Each step is a column on md+ screens, a
          stacked card on small screens. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {/* Step 1 — Brief */}
        <div
          data-testid="spokesperson-lane-step-brief"
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
                Brief capture will reuse the existing campaign form;
                editing rolls into PR BJ.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                No linked campaign yet.
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Brief capture will reuse the existing campaign form.
                Until PR BJ ships, create or open a saved campaign in
                the classic UX.
              </p>
            </>
          )}
        </div>

        {/* Step 2 — Script */}
        <div
          data-testid="spokesperson-lane-step-script"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 2 · Script
          </span>
          {focusedScript ? (
            <>
              <pre className="whitespace-pre-wrap break-words text-[10px] text-zinc-300 font-mono leading-snug max-h-[6rem] overflow-y-auto rounded bg-black/30 ring-1 ring-zinc-800 p-1.5">
                {scriptPreview}
              </pre>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Lane uses the saved Commercial Script (PR AC). Editor
                inline-mounts in PR BJ; today, edit via the classic
                Stage 3 PromptPreview.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {hasCampaign
                  ? 'No Commercial Script saved on this campaign yet.'
                  : 'The Commercial Script editor lives in classic UX Stage 3 PromptPreview.'}
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Lane uses the saved Commercial Script (PR AC). The
                spokesperson speaks it verbatim during avatar_videos
                render.
              </p>
            </>
          )}
        </div>

        {/* Step 3 — Render */}
        <div
          data-testid="spokesperson-lane-step-render"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 3 · Render
          </span>
          <div className="space-y-1">
            <button
              type="button"
              disabled
              data-testid="spokesperson-lane-horizontal"
              data-render-target="horizontal"
              data-has-output={focused?.host_video_url ? 'true' : 'false'}
              title="Render wiring lands with PR BJ. Use the classic gallery to render today."
              className="w-full flex items-center justify-between gap-2 text-[11px] rounded ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 px-2 py-1 font-mono cursor-not-allowed disabled:opacity-80"
            >
              <span className="truncate">Horizontal Spokesperson Ad</span>
              <span className="text-[9px] text-zinc-500">
                {focused?.host_video_url ? 'cached' : 'placeholder'}
              </span>
            </button>
            {/* PR BN — Reels button is now wired. Enabled only
                when a focused campaign has a cached spokesperson
                source MP4. Tooltip explains why disabled when
                the gating fails (no campaign / no source / no
                handler). Uses violet chrome to mirror the v1
                gallery button's colour vocabulary. */}
            <button
              type="button"
              onClick={handleBuildReels}
              disabled={!reelsCanFire}
              data-testid="spokesperson-lane-reels"
              data-render-target="reels"
              data-has-output={focused?.spokesperson_reels_url ? 'true' : 'false'}
              data-source-ready={reelsSourceReady ? 'true' : 'false'}
              data-busy={reelsBusy ? 'true' : 'false'}
              title={
                reelsCanFire
                  ? 'POST /api/campaigns/{id}/spokesperson-ad/reels — local ffmpeg pad/letterbox + drawtext captions. No Runway calls.'
                  : reelsDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (reelsCanFire
                  ? 'ring-1 ring-violet-400/40 bg-violet-500/30 hover:bg-violet-500/45 text-violet-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">
                {reelsLabel}
              </span>
              <span className="text-[9px] text-zinc-200/70">
                {reelsBusy
                  ? 'building…'
                  : reelsCached
                  ? 'cached'
                  : reelsSourceReady
                  ? 'ready'
                  : 'no source'}
              </span>
            </button>
          </div>
          {/* Reels status row — shows live error from the click,
              the persisted backend failure (PR AG/AH), and the
              download link when reels are cached. */}
          {reelsError && (
            <p
              data-testid="spokesperson-lane-reels-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={reelsError}
            >
              {reelsError}
            </p>
          )}
          {!reelsError && reelsBusy && (
            <p
              data-testid="spokesperson-lane-reels-status"
              className="text-[10px] text-zinc-500 leading-snug"
            >
              posting to /spokesperson-ad/reels…
            </p>
          )}
          {!reelsError && !reelsBusy && reelsFailed && (
            <p
              data-testid="spokesperson-lane-reels-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={focused.spokesperson_reels_error}
            >
              Reels export failed: {focused.spokesperson_reels_error}
            </p>
          )}
          {!reelsError && !reelsBusy && reelsCached && (
            <a
              href={focused.spokesperson_reels_url}
              target="_blank"
              rel="noreferrer"
              download
              data-testid="spokesperson-lane-reels-link"
              className="text-[10px] text-spark hover:underline font-mono"
            >
              download captioned reels ↗
            </a>
          )}
          {focused?.realtime_transcript_fetched_at && (
            <p className="text-[9px] text-zinc-600 leading-snug">
              last touched{' '}
              <span className="font-mono text-zinc-500">
                {formatKnowledgeTimeOrDash(focused.realtime_transcript_fetched_at)}
              </span>
            </p>
          )}
          {!hasCampaign && (
            <p className="text-[10px] text-zinc-500 leading-snug">
              Create or select a campaign to render a spokesperson ad.
            </p>
          )}
        </div>
      </div>

      {/* Footer hint — shows only when neither active spokesperson
          nor linked campaign exists. Keeps the lane visibly useful
          for demo even without state. */}
      {!hasSpokesperson && !hasCampaign && (
        <p
          data-testid="spokesperson-lane-empty-hint"
          className="text-[10px] text-zinc-500 leading-snug"
        >
          Pick an active spokesperson (Use as Spokesperson on a card)
          and link them to a campaign to populate this lane.
        </p>
      )}
    </section>
  )
}

/**
 * Local thin wrapper around the shared `formatHistoryTimestamp`
 * helper. Returns a single em-dash for missing inputs so the row
 * never renders an empty string.
 */
function formatKnowledgeTimeOrDash(iso) {
  if (!iso) return '—'
  return formatHistoryTimestamp(iso) || '—'
}
