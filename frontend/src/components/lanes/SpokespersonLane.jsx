import { useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'
import LaneBriefEditor from './LaneBriefEditor.jsx'

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
  // PR BP — Generate Real Spokesperson Ad handler. ⚠️ Burns
  // Runway credits — fires `POST /v1/avatar_videos` via the
  // existing /spokesperson-ad route. The lane shows credit-burn
  // warning copy on the button.
  onGenerateSpokesperson = null,
  // PR BQ — Inline brief editor save handler. POSTs to the new
  // /brief route; no Runway calls. Step 1 mounts <LaneBriefEditor>
  // when the focused campaign exists.
  onUpdateBrief = null,
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

  // PR BP — Real Spokesperson Ad gating. Required source: a
  // usable avatar (character_id / selected_avatar_id /
  // host_avatar_id ready). Mirrors v1's spokesperson-ad
  // precondition. Existing host_video_url means a "regenerate"
  // copy + warning the operator about double-billing.
  const horizontalHasUsableAvatar = Boolean(
    focused?.character_id ||
      focused?.selected_avatar_id ||
      (focused?.host_avatar_id &&
        ['ready', 'mock'].includes(focused?.host_avatar_status || '')),
  )
  const horizontalCached = Boolean(focused?.host_video_url)
  const [horizontalBusy, setHorizontalBusy] = useState(false)
  const [horizontalError, setHorizontalError] = useState('')
  const horizontalCanFire = Boolean(
    onGenerateSpokesperson &&
      hasCampaign &&
      horizontalHasUsableAvatar &&
      !horizontalBusy,
  )
  const horizontalLabel = horizontalBusy
    ? 'Generating Real Spokesperson Ad…'
    : horizontalCached
    ? 'Regenerate Real Spokesperson Ad'
    : 'Generate Real Spokesperson Ad'
  const horizontalDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !horizontalHasUsableAvatar
    ? 'A usable avatar is required (character_id / selected_avatar_id / host_avatar_id ready).'
    : !onGenerateSpokesperson
    ? 'Wire the v2 onGenerateSpokesperson handler before this button can fire.'
    : ''
  const handleGenerateHorizontal = async () => {
    if (!horizontalCanFire) return
    setHorizontalError('')
    setHorizontalBusy(true)
    try {
      await onGenerateSpokesperson(focused.id)
    } catch (e) {
      setHorizontalError(`${e?.message || e}`)
    } finally {
      setHorizontalBusy(false)
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
            // PR BQ — inline brief editor (4 fields + save / cancel).
            // Lives directly inside Step 1 so the operator never
            // round-trips back to the classic UX for brief edits.
            <LaneBriefEditor
              campaign={focused}
              onSave={onUpdateBrief}
            />
          ) : (
            <p className="text-[11px] text-zinc-400 leading-snug">
              Create or select a campaign to edit the brief.
            </p>
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
            {/* PR BP — Horizontal Spokesperson Ad button is now
                wired to real Runway. Burns credits per click —
                the route fires POST /v1/avatar_videos and waits
                for the task to reach READY. Rose chrome to
                signal "this costs money"; tooltip + adjacent
                caption double-confirm before the click. */}
            <button
              type="button"
              onClick={handleGenerateHorizontal}
              disabled={!horizontalCanFire}
              data-testid="spokesperson-lane-horizontal"
              data-render-target="horizontal"
              data-has-output={focused?.host_video_url ? 'true' : 'false'}
              data-source-ready={horizontalHasUsableAvatar ? 'true' : 'false'}
              data-busy={horizontalBusy ? 'true' : 'false'}
              data-burns-credits="true"
              title={
                horizontalCanFire
                  ? '⚠️ POST /v1/avatar_videos — burns Runway credits per click. Generation is sync (~30–60 s).'
                  : horizontalDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (horizontalCanFire
                  ? 'ring-1 ring-rose-400/50 bg-rose-500/30 hover:bg-rose-500/45 text-rose-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">{horizontalLabel}</span>
              <span className="text-[9px] text-zinc-200/70">
                {horizontalBusy
                  ? 'generating…'
                  : horizontalCached
                  ? 'cached · burns credits'
                  : horizontalCanFire
                  ? 'burns credits'
                  : 'no avatar'}
              </span>
            </button>
            {horizontalCanFire && (
              <p
                data-testid="spokesperson-lane-horizontal-warning"
                className="text-[9px] text-rose-300 leading-snug"
              >
                ⚠️ Real Runway. Each click bills `avatar_videos`.
              </p>
            )}
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
          {/* PR BP — Horizontal status row. Renders one of:
              - rose error from the click handler
              - zinc "posting to /spokesperson-ad…" while busy */}
          {horizontalError && (
            <p
              data-testid="spokesperson-lane-horizontal-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={horizontalError}
            >
              {horizontalError}
            </p>
          )}
          {!horizontalError && horizontalBusy && (
            <p
              data-testid="spokesperson-lane-horizontal-status"
              className="text-[10px] text-zinc-500 leading-snug"
            >
              posting to /spokesperson-ad… (real Runway, may take 30–60 s)
            </p>
          )}
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
