import { useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'
import LaneBriefEditor from './LaneBriefEditor.jsx'

/**
 * PR BL — Dialogue Scene lane scaffold (gated v2).
 *
 * Mounted by SpokespersonStudio when
 * `localStorage.adspark.activeMode === "dialogue"`. Mirrors
 * PR BI / PR BK shape with three steps tailored to multi-character
 * scenes (Brief / Cast / Lines & Stitch) and three disabled
 * placeholder render buttons:
 *   - Generate Dialogue Lines  → per-line `avatar_videos` render
 *   - Stitch Dialogue Scene    → `dialogue_scene_video_url`
 *                                (PR AF ffmpeg concat with audio)
 *   - Captioned Reels          → `dialogue_scene_reels_url`
 *                                (PR AG/AH 720×1280 + per-line
 *                                 burned-in captions)
 *
 * Backend untouched. Render buttons are disabled placeholders;
 * actual generation continues to flow through the legacy
 * gallery's Dialogue tab + the existing `/dialogue/*` routes
 * until a follow-up slice wires real submit handlers.
 */
export default function DialogueLane({
  activeSpokesperson = null,
  linkedCampaigns = [],
  // PR BP — three lane action handlers. None burn Runway
  // credits at the lane level: planDialogue is template-driven
  // (no upstream calls); stitch + reels are ffmpeg-only over
  // existing per-line MP4s. Per-line generation
  // (avatar_videos × N) still lives in classic UX.
  onPlanDialogue = null,
  onStitchDialogue = null,
  onBuildDialogueReels = null,
  // PR BQ — Inline brief editor save handler.
  onUpdateBrief = null,
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
  const lines = Array.isArray(focused?.dialogue_lines)
    ? focused.dialogue_lines
    : []
  const lineCount = lines.length
  // Cast = unique character_id / character_name pairs across
  // dialogue lines. Falls back to the line's avatar_id when no
  // character_id is set.
  const castMap = new Map()
  for (const ln of lines) {
    const key =
      ln.character_id || ln.avatar_id || `line-${ln.id || lines.indexOf(ln)}`
    if (!castMap.has(key)) {
      castMap.set(key, ln.character_name || 'Unnamed cast member')
    }
  }
  const castMembers = Array.from(castMap.values())

  // PR BP — three-button gating + state.
  //
  // Plan: backend returns the same plan for repeat calls when
  // dialogue_lines already exist; "Planned" pill flips on once
  // a campaign has any lines. Cheap to call.
  const planAlready = lineCount > 0
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState('')
  const planCanFire = Boolean(
    onPlanDialogue && hasCampaign && !planBusy,
  )
  const planLabel = planBusy
    ? 'Planning Dialogue Lines…'
    : planAlready
    ? 'Re-plan Dialogue Lines'
    : 'Plan Dialogue Lines'
  const planDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !onPlanDialogue
    ? 'Wire the v2 onPlanDialogue handler before this button can fire.'
    : ''
  const handlePlanLines = async () => {
    if (!planCanFire) return
    setPlanError('')
    setPlanBusy(true)
    try {
      await onPlanDialogue(focused.id)
    } catch (e) {
      setPlanError(`${e?.message || e}`)
    } finally {
      setPlanBusy(false)
    }
  }

  // Stitch: backend route requires every dialogue line to have
  // status === 'ok'. Per-line generation lives in classic UX.
  const stitchAllReady =
    lineCount > 0 && lines.every((l) => l.status === 'ok')
  const stitchCached =
    focused?.dialogue_scene_status === 'ok' &&
    Boolean(focused?.dialogue_scene_video_url)
  const stitchFailed =
    focused?.dialogue_scene_status === 'failed' &&
    Boolean(focused?.dialogue_scene_error)
  const [stitchBusy, setStitchBusy] = useState(false)
  const [stitchError, setStitchError] = useState('')
  const stitchCanFire = Boolean(
    onStitchDialogue && hasCampaign && stitchAllReady && !stitchBusy,
  )
  const stitchLabel = stitchBusy
    ? 'Stitching Dialogue Scene…'
    : stitchCached
    ? 'Restitch Dialogue Scene'
    : 'Stitch Dialogue Scene'
  const stitchDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : lineCount === 0
    ? 'Plan dialogue lines first.'
    : !stitchAllReady
    ? `${lines.filter((l) => l.status === 'ok').length}/${lineCount} lines ready — render the rest in the legacy wizard before stitching.`
    : !onStitchDialogue
    ? 'Wire the v2 onStitchDialogue handler before this button can fire.'
    : ''
  const handleStitchScene = async () => {
    if (!stitchCanFire) return
    setStitchError('')
    setStitchBusy(true)
    try {
      await onStitchDialogue(focused.id)
    } catch (e) {
      setStitchError(`${e?.message || e}`)
    } finally {
      setStitchBusy(false)
    }
  }

  // Reels: requires the stitched scene video. Backend 409s
  // otherwise.
  const reelsCached =
    focused?.dialogue_scene_reels_status === 'ok' &&
    Boolean(focused?.dialogue_scene_reels_url)
  const reelsFailed =
    focused?.dialogue_scene_reels_status === 'failed' &&
    Boolean(focused?.dialogue_scene_reels_error)
  const [reelsBusy, setReelsBusy] = useState(false)
  const [reelsError, setReelsError] = useState('')
  const reelsCanFire = Boolean(
    onBuildDialogueReels && hasCampaign && stitchCached && !reelsBusy,
  )
  const reelsLabel = reelsBusy
    ? 'Building Captioned Reels…'
    : reelsCached
    ? 'Rebuild Captioned Reels'
    : 'Build Captioned Reels'
  const reelsDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !stitchCached
    ? 'Stitch the dialogue scene first.'
    : !onBuildDialogueReels
    ? 'Wire the v2 onBuildDialogueReels handler before this button can fire.'
    : ''
  const handleBuildReels = async () => {
    if (!reelsCanFire) return
    setReelsError('')
    setReelsBusy(true)
    try {
      await onBuildDialogueReels(focused.id)
    } catch (e) {
      setReelsError(`${e?.message || e}`)
    } finally {
      setReelsBusy(false)
    }
  }

  return (
    <section
      data-testid="dialogue-lane"
      data-mode="dialogue"
      className="rounded-xl ring-1 ring-sky-400/30 bg-sky-500/[0.04] p-3 space-y-3"
    >
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <h4 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span aria-hidden="true">🎭</span>
            Plan a dialogue scene
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Build a Hook / Beat / Closer skit across multiple
            spokespeople. Plan and stitch the scene here; per-line
            renders run in the legacy wizard until inline rendering
            lands.
          </p>
        </div>
        {hasSpokesperson && (
          <div
            className="flex items-center gap-2 rounded-lg ring-1 ring-sky-400/30 bg-sky-500/10 px-2 py-1"
            aria-label="active spokesperson"
          >
            {activeSpokesperson.portrait_url && (
              <img
                src={activeSpokesperson.portrait_url}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            )}
            <span className="text-[11px] text-sky-200 font-mono">
              {activeSpokesperson.name || 'Active spokesperson'}
            </span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {/* Step 1 — Brief */}
        <div
          data-testid="dialogue-lane-step-brief"
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

        {/* Step 2 — Cast */}
        <div
          data-testid="dialogue-lane-step-cast"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 2 · Cast
          </span>
          {castMembers.length > 0 ? (
            <>
              <div className="text-[11px] text-zinc-300 leading-snug">
                {castMembers.length}{' '}
                {castMembers.length === 1 ? 'speaker' : 'speakers'}
              </div>
              <ul
                className="space-y-0.5 max-h-[5rem] overflow-y-auto pr-1"
                data-testid="dialogue-lane-cast-list"
              >
                {castMembers.slice(0, 6).map((name, idx) => (
                  <li
                    key={`${name}-${idx}`}
                    className="text-[10px] text-zinc-400 font-mono truncate"
                    title={name}
                  >
                    {name}
                  </li>
                ))}
                {castMembers.length > 6 && (
                  <li className="text-[10px] text-zinc-600 font-mono">
                    +{castMembers.length - 6} more
                  </li>
                )}
              </ul>
              <p className="text-[10px] text-zinc-500 leading-snug pt-1">
                Cast is inferred from the dialogue lines saved on
                this campaign. Editing speakers per line lands in a
                follow-up slice.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {hasCampaign
                  ? 'No dialogue lines planned on this campaign yet.'
                  : 'Pick a campaign to plan its dialogue.'}
              </p>
              <p className="text-[10px] text-zinc-500 leading-snug">
                Click Plan Dialogue Lines below to seed a Hook / Beat
                / Closer structure — speakers will surface here
                automatically once the plan saves.
              </p>
            </>
          )}
        </div>

        {/* Step 3 — Lines & Stitch */}
        <div
          data-testid="dialogue-lane-step-lines"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Step 3 · Lines & Stitch
            </span>
            {lineCount > 0 && (
              <span className="text-[9px] text-zinc-600 font-mono">
                {lineCount} {lineCount === 1 ? 'line' : 'lines'}
              </span>
            )}
          </div>
          <div className="space-y-1">
            {/* PR BP — Plan Dialogue Lines (no Runway credits) */}
            <button
              type="button"
              onClick={handlePlanLines}
              disabled={!planCanFire}
              data-testid="dialogue-lane-lines"
              data-render-target="dialogue-lines"
              data-has-output={
                lines.some((l) => l.video_url) ? 'true' : 'false'
              }
              data-source-ready={hasCampaign ? 'true' : 'false'}
              data-busy={planBusy ? 'true' : 'false'}
              title={
                planCanFire
                  ? 'Seed a 3-line Hook / Beat / Closer plan from the saved campaign brief. No Runway credits. Per-line rendering still happens in the legacy wizard.'
                  : planDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (planCanFire
                  ? 'ring-1 ring-sky-400/40 bg-sky-500/30 hover:bg-sky-500/45 text-sky-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">{planLabel}</span>
              <span className="text-[9px] text-zinc-200/70">
                {planBusy
                  ? 'planning…'
                  : planAlready
                  ? `${lineCount} planned`
                  : hasCampaign
                  ? 'ready'
                  : 'no campaign'}
              </span>
            </button>
            {/* PR BP — Stitch Dialogue Scene (ffmpeg only) */}
            <button
              type="button"
              onClick={handleStitchScene}
              disabled={!stitchCanFire}
              data-testid="dialogue-lane-stitch"
              data-render-target="dialogue-stitch"
              data-has-output={
                focused?.dialogue_scene_video_url ? 'true' : 'false'
              }
              data-source-ready={stitchAllReady ? 'true' : 'false'}
              data-busy={stitchBusy ? 'true' : 'false'}
              title={
                stitchCanFire
                  ? 'POST /api/campaigns/{id}/dialogue/stitch — ffmpeg concat with audio preserved. No Runway calls.'
                  : stitchDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (stitchCanFire
                  ? 'ring-1 ring-sky-400/40 bg-sky-500/30 hover:bg-sky-500/45 text-sky-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">{stitchLabel}</span>
              <span className="text-[9px] text-zinc-200/70">
                {stitchBusy
                  ? 'stitching…'
                  : stitchCached
                  ? 'cached'
                  : stitchAllReady
                  ? 'ready'
                  : lineCount > 0
                  ? `${lines.filter((l) => l.status === 'ok').length}/${lineCount} lines`
                  : 'no plan'}
              </span>
            </button>
            {/* PR BP — Captioned Reels (ffmpeg only) */}
            <button
              type="button"
              onClick={handleBuildReels}
              disabled={!reelsCanFire}
              data-testid="dialogue-lane-reels"
              data-render-target="dialogue-reels"
              data-has-output={
                focused?.dialogue_scene_reels_url ? 'true' : 'false'
              }
              data-source-ready={stitchCached ? 'true' : 'false'}
              data-busy={reelsBusy ? 'true' : 'false'}
              title={
                reelsCanFire
                  ? 'POST /api/campaigns/{id}/dialogue-scene/reels — ffmpeg pad/letterbox + per-line drawtext captions. No Runway calls.'
                  : reelsDisabledReason
              }
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (reelsCanFire
                  ? 'ring-1 ring-sky-400/40 bg-sky-500/30 hover:bg-sky-500/45 text-sky-100'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-not-allowed disabled:opacity-80')
              }
            >
              <span className="truncate">
                {reelsLabel} · 720×1280
              </span>
              <span className="text-[9px] text-zinc-200/70">
                {reelsBusy
                  ? 'building…'
                  : reelsCached
                  ? 'cached'
                  : stitchCached
                  ? 'ready'
                  : 'no scene'}
              </span>
            </button>
          </div>
          {/* PR BP — combined status row for plan + stitch + reels.
              Only one of these renders at a time; if multiple are
              busy concurrently they stack. */}
          {planError && (
            <p
              data-testid="dialogue-lane-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={planError}
            >
              Plan: {planError}
            </p>
          )}
          {stitchError && (
            <p
              data-testid="dialogue-lane-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={stitchError}
            >
              Stitch: {stitchError}
            </p>
          )}
          {reelsError && (
            <p
              data-testid="dialogue-lane-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={reelsError}
            >
              Reels: {reelsError}
            </p>
          )}
          {!planError && !stitchError && !reelsError && (planBusy || stitchBusy || reelsBusy) && (
            <p
              data-testid="dialogue-lane-status"
              className="text-[10px] text-zinc-500 leading-snug"
            >
              {planBusy && 'posting to /dialogue/plan…'}
              {stitchBusy && 'posting to /dialogue/stitch…'}
              {reelsBusy && 'posting to /dialogue-scene/reels…'}
            </p>
          )}
          {!planBusy && !stitchBusy && !reelsBusy && stitchFailed && (
            <p
              data-testid="dialogue-lane-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={focused.dialogue_scene_error}
            >
              Stitch failed: {focused.dialogue_scene_error}
            </p>
          )}
          {!planBusy && !stitchBusy && !reelsBusy && reelsFailed && (
            <p
              data-testid="dialogue-lane-status"
              className="text-[10px] text-rose-300 leading-snug"
              title={focused.dialogue_scene_reels_error}
            >
              Reels failed: {focused.dialogue_scene_reels_error}
            </p>
          )}
          {stitchCached && !stitchBusy && (
            <a
              href={focused.dialogue_scene_video_url}
              target="_blank"
              rel="noreferrer"
              download
              data-testid="dialogue-lane-stitch-link"
              className="text-[10px] text-spark hover:underline font-mono"
            >
              download dialogue scene ↗
            </a>
          )}
          {reelsCached && !reelsBusy && (
            <a
              href={focused.dialogue_scene_reels_url}
              target="_blank"
              rel="noreferrer"
              download
              data-testid="dialogue-lane-reels-link"
              className="text-[10px] text-spark hover:underline font-mono"
            >
              download captioned reels ↗
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
              Create or select a campaign to render a dialogue scene.
            </p>
          )}
        </div>
      </div>

      {!hasSpokesperson && !hasCampaign && (
        <p
          data-testid="dialogue-lane-empty-hint"
          className="text-[10px] text-zinc-500 leading-snug"
        >
          Pick an active spokesperson (Use as Spokesperson on a card)
          and link them to a campaign with a planned dialogue to
          populate this lane.
        </p>
      )}
    </section>
  )
}

function formatTouchedOrDash(iso) {
  if (!iso) return '—'
  return formatHistoryTimestamp(iso) || '—'
}
