import { useEffect, useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'
import LaneBriefCreator from './LaneBriefCreator.jsx'
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
  // PR CU — closes the empty-state dead-end. Same shape as the
  // other lanes.
  onCreateCampaign = null,
  // PR DA (Demo Pillars) — per-line text/character edit + per-line
  // render. Closes the gap that used to force operators back to
  // /legacy to render dialogue lines before stitching.
  onSaveDialogueLine = null,
  onGenerateDialogueLine = null,
  availableCharacters = [],
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

  // PR DH — inferred cast = character_ids already used by saved
  // lines. Used to (a) auto-seed the cast picker so existing scenes
  // show their speakers as already selected, and (b) badge cards as
  // "in scene" even when the operator hasn't manually picked them.
  const inferredCastIds = Array.from(
    new Set(
      lines
        .map((ln) => ln.character_id)
        .filter((id) => id),
    ),
  )

  // Selected cast — local UI state. Initial value seeds from
  // inferredCastIds so existing scenes "just work" without forcing a
  // re-pick. Operator can toggle cards to add/remove. State resets
  // when the focused campaign changes (different scene = different
  // cast).
  const [selectedCastIds, setSelectedCastIds] = useState(inferredCastIds)
  useEffect(() => {
    setSelectedCastIds(inferredCastIds)
    // Intentionally tied to the focused campaign id so the picker
    // re-syncs to the new scene's inferred cast on campaign switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id])
  const toggleCast = (cid) => {
    setSelectedCastIds((cur) =>
      cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid],
    )
  }

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
    ? 'Creating scene lines…'
    : planAlready
    ? 'Reset scene lines'
    : 'Create Scene Lines'
  const planDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !onPlanDialogue
    ? 'Wire the v2 onPlanDialogue handler before this can fire.'
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
    ? 'Stitching final scene…'
    : stitchCached
    ? 'Re-stitch Final Scene'
    : 'Stitch Final Scene'
  const stitchDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : lineCount === 0
    ? 'Create scene lines first.'
    : !stitchAllReady
    ? `Render each line first, then stitch the final scene locally with ffmpeg (${lines.filter((l) => l.status === 'ok').length}/${lineCount} lines rendered).`
    : !onStitchDialogue
    ? 'Wire the v2 onStitchDialogue handler before this can fire.'
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
    ? 'Exporting captioned reel…'
    : reelsCached
    ? 'Re-export Captioned Reel'
    : 'Export Captioned Reel'
  const reelsDisabledReason = !hasCampaign
    ? 'Pick a linked campaign first.'
    : !stitchCached
    ? 'Stitch the final scene first.'
    : !onBuildDialogueReels
    ? 'Wire the v2 onBuildDialogueReels handler before this can fire.'
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
            Direct a dialogue scene
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Pick a cast, write the scene as a Hook → Beat → Closer
            skit, render each actor's line, then stitch the final
            scene. Each rendered line burns one Runway credit;
            stitching and captioned reels are local ffmpeg only.
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
            <LaneBriefCreator
              onCreate={onCreateCampaign}
              modeLabel="dialogue scene"
              testidPrefix="dialogue"
              hasSpokesperson={hasSpokesperson}
            />
          )}
        </div>

        {/* Step 2 — Cast (PR DH: interactive picker) */}
        <div
          data-testid="dialogue-lane-step-cast"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Step 2 · Cast
          </span>
          {hasCampaign ? (
            <CastPicker
              availableCharacters={availableCharacters}
              selectedCastIds={selectedCastIds}
              onToggleCast={toggleCast}
              inferredCastIds={inferredCastIds}
            />
          ) : (
            <p className="text-[11px] text-zinc-400 leading-snug">
              Pick or create a campaign in Step 1 — then cast 2-3
              spokespeople for the scene.
            </p>
          )}
        </div>

        {/* Step 3 — Scene Lines (PR DH rename: was "Lines & Stitch") */}
        <div
          data-testid="dialogue-lane-step-lines"
          className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Step 3 · Scene Lines & Render
            </span>
            {lineCount > 0 && (
              <span className="text-[9px] text-zinc-600 font-mono">
                {lineCount} {lineCount === 1 ? 'line' : 'lines'} ·{' '}
                {lines.filter((l) => l.status === 'ok').length} rendered
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

            {/* PR DA (Demo Pillars) — per-line editor list. Renders
                between Plan and Stitch when at least one line exists.
                Each line is editable (text + speaker dropdown) and
                rendered via the existing /dialogue/generate-line
                route. Backend supports it; UI was the gap. */}
            {lineCount > 0 && (
              <>
                {/* PR DB — hackathon demo preset. One-click loader
                    that populates the three planned lines with the
                    submission-video copy + auto-assigns
                    Donny / Riggs / Miles when those characters
                    have ready avatars. Idempotent: safe to click
                    again if the operator edited a line and wants
                    to reset. */}
                <DialogueDemoPreset
                  campaignId={focused?.id}
                  lines={lines}
                  availableCharacters={availableCharacters}
                  onSaveDialogueLine={onSaveDialogueLine}
                />
                {/* PR DH — script preview lets the operator read the
                    full ordered scene before clicking Render Line.
                    Shows speaker + text + rendered checkmark per
                    line. No state of its own; reads from props. */}
                <ScriptPreview
                  lines={lines}
                  availableCharacters={availableCharacters}
                />
                <DialogueLinesEditor
                  campaignId={focused?.id}
                  lines={lines}
                  availableCharacters={availableCharacters}
                  onSaveDialogueLine={onSaveDialogueLine}
                  onGenerateDialogueLine={onGenerateDialogueLine}
                />
              </>
            )}

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
                  ? 'exporting…'
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
              {planBusy && 'creating scene lines…'}
              {stitchBusy && 'stitching final scene…'}
              {reelsBusy && 'exporting captioned reel…'}
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
              download final scene ↗
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
              download captioned reel ↗
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


/**
 * PR DH — Interactive cast picker for Step 2.
 *
 * Replaces the PR BL read-only "cast inferred from saved lines"
 * display with selectable character cards. Operator picks 2-3
 * spokespeople for the scene before authoring lines.
 *
 * Scope: visual + intent-capture only. Selection is local UI state;
 * it does not gate the speaker dropdowns in the lines editor (that
 * stays open to any ready character so already-saved scenes don't
 * break). The picker pre-selects characters who already appear in
 * saved lines so the existing-scene case "just works".
 *
 * Each card shows thumbnail / name / role/template / avatar status.
 * Cards for characters without a ready avatar are disabled with an
 * inline reason — they cannot be cast in a real-mode dialogue scene
 * because `/dialogue/generate-line` 409s without a ready avatar.
 */
function CastPicker({
  availableCharacters = [],
  selectedCastIds = [],
  onToggleCast,
  inferredCastIds = [],
}) {
  const chars = Array.isArray(availableCharacters) ? availableCharacters : []
  // Show up to 8 characters, ready-first. A scene needs >= 2 speakers
  // to feel like a scene; the brief says 2-3 is the sweet spot.
  const sorted = [...chars].sort((a, b) => {
    const ar =
      a.runway_avatar_id && ['ready', 'mock'].includes(a.runway_avatar_status || '')
        ? 0
        : 1
    const br =
      b.runway_avatar_id && ['ready', 'mock'].includes(b.runway_avatar_status || '')
        ? 0
        : 1
    if (ar !== br) return ar - br
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
  const visible = sorted.slice(0, 8)
  const hiddenCount = Math.max(0, sorted.length - visible.length)

  if (visible.length === 0) {
    return (
      <p className="text-[11px] text-zinc-500 leading-snug">
        No spokespeople in the library yet. Create one from the
        homepage and click <span className="font-mono">Create
        Avatar</span> before casting a scene.
      </p>
    )
  }

  return (
    <div className="space-y-1.5" data-testid="dialogue-lane-cast-picker">
      <p className="text-[11px] text-zinc-300 leading-snug">
        Choose the spokespeople who appear in this scene.
      </p>
      <ul
        className="grid grid-cols-2 gap-1.5"
        data-testid="dialogue-lane-cast-grid"
      >
        {visible.map((c) => {
          const ready =
            c.runway_avatar_id &&
            ['ready', 'mock'].includes(c.runway_avatar_status || '')
          const picked = selectedCastIds.includes(c.id)
          const inferred = inferredCastIds.includes(c.id)
          const role = String(c.template || '').replace(/_/g, ' ') || 'character'
          const disabledReason = !ready
            ? c.runway_avatar_status === 'processing'
              ? 'Avatar processing — wait for it to flip to ready.'
              : c.runway_avatar_status === 'failed'
              ? 'Avatar create failed — retry from the workspace.'
              : 'No Runway avatar yet — open the spokesperson and click Create Avatar.'
            : ''
          const cardCls = picked
            ? 'ring-2 ring-pink-400 bg-pink-500/10'
            : ready
            ? 'ring-1 ring-zinc-700 bg-zinc-900/60 hover:ring-zinc-500'
            : 'ring-1 ring-zinc-800 bg-zinc-950/50 opacity-60'
          return (
            <li
              key={c.id}
              data-testid="dialogue-lane-cast-card"
              data-character-id={c.id}
              data-picked={picked ? 'true' : 'false'}
              data-ready={ready ? 'true' : 'false'}
            >
              <button
                type="button"
                onClick={() => ready && onToggleCast?.(c.id)}
                disabled={!ready}
                title={ready ? (picked ? 'Click to remove from scene cast' : 'Click to add to scene cast') : disabledReason}
                className={`w-full text-left rounded p-1.5 transition-all flex items-center gap-1.5 ${cardCls} ${
                  ready ? 'cursor-pointer' : 'cursor-not-allowed'
                }`}
              >
                {c.portrait_url ? (
                  <img
                    src={c.portrait_url}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span
                    className="h-8 w-8 rounded-full bg-zinc-800 text-zinc-500 text-[10px] flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    {String(c.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] text-zinc-100 font-medium truncate">
                    {c.name || 'Unnamed'}
                  </span>
                  <span className="block text-[9px] text-zinc-400 font-mono truncate">
                    {role} · {c.runway_avatar_status || 'no avatar'}
                  </span>
                </span>
                {picked && (
                  <span
                    aria-hidden="true"
                    className="text-pink-300 text-xs shrink-0"
                    title="Picked"
                  >
                    ✓
                  </span>
                )}
                {!picked && inferred && ready && (
                  <span
                    aria-hidden="true"
                    className="text-amber-400 text-[9px] font-mono shrink-0"
                    title="Already appears in a saved line"
                  >
                    in scene
                  </span>
                )}
              </button>
              {!ready && (
                <p className="text-[9px] text-amber-300/80 leading-snug pt-0.5 pl-1">
                  {disabledReason}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      {hiddenCount > 0 && (
        <p className="text-[9px] text-zinc-600 font-mono">
          +{hiddenCount} more in library (not shown — pick from the
          first 8 above)
        </p>
      )}
      <p className="text-[10px] text-zinc-500 leading-snug">
        Picked: {selectedCastIds.length}.{' '}
        {selectedCastIds.length < 2
          ? 'A scene needs at least 2 speakers.'
          : selectedCastIds.length > 3
          ? 'A 3-speaker scene fits the office-style format best.'
          : 'Open Step 3 to author lines for these speakers.'}
      </p>
    </div>
  )
}


/**
 * PR DH — Script preview block.
 *
 * Renders the saved dialogue lines as a screenplay-style script so
 * the operator can read the scene before clicking Render Line. Each
 * row shows SPEAKER (uppercased) + the line text in quotes. Empty
 * rows render with a muted placeholder so the structure stays
 * visible even before the demo preset has loaded.
 */
function ScriptPreview({ lines, availableCharacters }) {
  if (!Array.isArray(lines) || lines.length === 0) return null
  const charsById = new Map()
  for (const c of availableCharacters || []) {
    if (c?.id) charsById.set(c.id, c)
  }
  return (
    <div
      data-testid="dialogue-lane-script-preview"
      className="rounded ring-1 ring-zinc-800 bg-zinc-950/40 px-2 py-1.5 space-y-1"
    >
      <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
        Script preview
      </span>
      <ol className="space-y-1">
        {lines.map((ln, idx) => {
          const speaker =
            ln.character_name ||
            charsById.get(ln.character_id)?.name ||
            null
          const speakerLabel = speaker
            ? speaker.toUpperCase()
            : `LINE ${idx + 1}`
          const text = String(ln.text || '').trim()
          const rendered = ln.status === 'ok'
          return (
            <li key={ln.id || idx} className="text-[10px] leading-snug">
              <div className="flex items-baseline gap-2">
                <span
                  className={`font-mono font-semibold shrink-0 ${
                    speaker ? 'text-pink-300' : 'text-zinc-600'
                  }`}
                  style={{ minWidth: '4.5rem' }}
                >
                  {speakerLabel}
                </span>
                <span
                  className={`flex-1 italic ${
                    text ? 'text-zinc-200' : 'text-zinc-600'
                  }`}
                >
                  {text ? `"${text}"` : '(no line text yet)'}
                </span>
                {rendered && (
                  <span
                    className="text-emerald-400 text-[9px] font-mono shrink-0"
                    title="Line rendered"
                  >
                    ✓ rendered
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * PR DB — Hackathon demo preset. Surfaces the submission-video
 * copy for the "office montage" dialogue scene and auto-assigns
 * the three speakers when those characters exist in the library
 * with ready Runway avatars.
 *
 * Render is gated: needs at least 3 ready avatars in the
 * library AND at least 3 planned dialogue lines. Operator still
 * has to click Generate per line to burn credits — the preset
 * just removes the typing.
 */
const HACKATHON_DEMO_LINES = [
  {
    slot: 0,
    speaker: 'Donny',
    text:
      'We were supposed to make one ad. Then Chris gave us a workspace, ' +
      'campaigns, memory, and a deadline.',
  },
  {
    slot: 1,
    speaker: 'Riggs',
    text:
      'Many AI coding sessions, one coherent build. Mostly. The dev tooling kept us aligned across PRs.',
  },
  {
    slot: 2,
    speaker: 'Miles',
    text:
      'The result is Character OS: persistent AI spokespeople that learn ' +
      'the brand, create campaigns, and show up again.',
  },
]

// Backend constraint: dialogue_service._DEFAULT_LINE_COUNT = 3 with
// labels Hook/Beat/Closer. The PR DH brief listed a fourth Donny
// closer ("So yes, we are the demo. And apparently also the dev
// team."); that line is unused at the UI layer until a follow-up PR
// bumps the backend line count. Kept here as a reference comment so
// the demo copy isn't lost.

function findCharByName(chars, name) {
  const target = String(name || '').trim().toLowerCase()
  return (
    (chars || []).find((c) => {
      const cn = String(c?.name || '').trim().toLowerCase()
      // Match exact OR first-name to tolerate "Donny Sparks" → "Donny".
      return (
        cn === target ||
        cn.split(/\s+/)[0] === target ||
        cn.startsWith(`${target} `)
      )
    }) || null
  )
}

function DialogueDemoPreset({
  campaignId,
  lines,
  availableCharacters,
  onSaveDialogueLine,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  // Resolve each demo speaker against the library — only show
  // the preset when all three are present with ready avatars.
  const speakerMatches = HACKATHON_DEMO_LINES.map((entry) => {
    const match = findCharByName(availableCharacters, entry.speaker)
    const ready =
      match &&
      match.runway_avatar_id &&
      ['ready', 'mock'].includes(match.runway_avatar_status || '')
    return { entry, match, ready }
  })
  const allReady = speakerMatches.every((s) => s.ready)
  const planHasEnoughLines = (lines?.length || 0) >= HACKATHON_DEMO_LINES.length

  // Track if the loaded copy is already in the planned lines so
  // we can flip the label to "Reload" + colour-state to "loaded".
  const alreadyLoaded = HACKATHON_DEMO_LINES.every((entry, idx) => {
    const line = lines?.[idx]
    if (!line) return false
    return (
      String(line.text || '').trim() === entry.text &&
      Boolean(line.character_id) &&
      line.character_id === speakerMatches[idx].match?.id
    )
  })

  const canFire = Boolean(
    onSaveDialogueLine && campaignId && allReady && planHasEnoughLines && !busy,
  )
  const label = busy
    ? 'Loading Hackathon Office Scene…'
    : alreadyLoaded
    ? 'Reload Hackathon Office Scene'
    : 'Load Hackathon Office Scene'
  const disabledReason = !planHasEnoughLines
    ? 'Create scene lines first.'
    : !allReady
    ? `Office Scene needs Donny / Riggs / Miles with ready avatars. Missing: ${speakerMatches
        .filter((s) => !s.ready)
        .map((s) => s.entry.speaker)
        .join(', ')}.`
    : !onSaveDialogueLine
    ? 'Wire onSaveDialogueLine before this can fire.'
    : ''

  const handleLoad = async () => {
    if (!canFire) return
    setError('')
    setStatus('')
    setBusy(true)
    try {
      // Save lines sequentially so the campaigns slice ends up
      // matching the final write order (and so the lane re-renders
      // each row's textarea + dropdown via the useEffect sync in
      // DialogueLineRow without race conditions).
      for (let i = 0; i < HACKATHON_DEMO_LINES.length; i += 1) {
        const entry = HACKATHON_DEMO_LINES[i]
        const targetLine = lines[i]
        if (!targetLine) continue
        const speakerId = speakerMatches[i].match?.id
        // Skip if this exact slot is already loaded — avoids
        // resetting status from ok back to idle on a no-op
        // Reload click.
        if (
          alreadyLoaded &&
          String(targetLine.text || '').trim() === entry.text &&
          targetLine.character_id === speakerId
        ) {
          continue
        }
        await onSaveDialogueLine(campaignId, targetLine.id, {
          text: entry.text,
          character_id: speakerId,
        })
      }
      setStatus('Loaded. Now click Generate line on each row.')
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="dialogue-lane-demo-preset"
      data-can-fire={canFire ? 'true' : 'false'}
      data-already-loaded={alreadyLoaded ? 'true' : 'false'}
      className="rounded ring-1 ring-amber-400/30 bg-amber-500/[0.05] px-2 py-1.5 space-y-1"
    >
      <p className="text-[10px] text-amber-200 leading-snug">
        <span className="font-semibold">Hackathon Office Scene</span>{' '}
        — drops in the three-line office-style skit (Donny → Riggs →
        Miles) and auto-assigns speakers. Backend caps a scene at 3
        lines; rendering each line still burns one Runway credit.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={handleLoad}
          disabled={!canFire}
          data-testid="dialogue-lane-demo-preset-load"
          title={canFire ? 'Load the demo lines + auto-assign speakers. No Runway credits.' : disabledReason}
          className={
            'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
            (canFire
              ? 'bg-amber-500/30 hover:bg-amber-500/45 text-amber-100 ring-1 ring-amber-400/40'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
        >
          {label}
        </button>
        {!canFire && disabledReason && (
          <span className="text-[9px] text-amber-300/80 leading-snug">
            {disabledReason}
          </span>
        )}
        {status && (
          <span className="text-[9px] text-emerald-300 leading-snug">
            {status}
          </span>
        )}
        {error && (
          <span
            className="text-[9px] text-rose-300 leading-snug"
            title={error}
          >
            {error}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * PR DA (Demo Pillars) — per-line editor for Dialogue Scene.
 *
 * Each line gets:
 *   - text textarea (≤300 chars to match Runway's avatar_videos
 *     speech cap)
 *   - speaker dropdown populated from the workspace's
 *     `availableCharacters` slice (filtered server-side to only
 *     those with a ready Runway avatar — backend
 *     `/dialogue/save-line` 409s otherwise)
 *   - status pill (idle / pending / running / ok / failed)
 *   - "Save line" button — POSTs /dialogue/line/{line_id}
 *   - "Generate line" button — POSTs /dialogue/generate-line/{line_id}
 *     ⚠️ Burns Runway credits (one /v1/avatar_videos task per line)
 *
 * Closes the gap that used to require operators to drop into
 * /legacy to render per-line clips before the v2 lane could
 * stitch them. Saving a line resets that line's status to `idle`
 * (backend handles this automatically), so the operator must
 * Generate again after editing.
 */
function DialogueLinesEditor({
  campaignId,
  lines,
  availableCharacters,
  onSaveDialogueLine,
  onGenerateDialogueLine,
}) {
  const readyChars = (availableCharacters || []).filter(
    (c) =>
      c.runway_avatar_id &&
      ['ready', 'mock'].includes(c.runway_avatar_status || ''),
  )
  return (
    <ul
      data-testid="dialogue-lane-lines-editor"
      data-line-count={lines.length}
      className="space-y-1.5 pt-1"
    >
      {lines.map((line) => (
        <DialogueLineRow
          key={line.id}
          campaignId={campaignId}
          line={line}
          readyChars={readyChars}
          onSave={onSaveDialogueLine}
          onGenerate={onGenerateDialogueLine}
        />
      ))}
    </ul>
  )
}

function DialogueLineRow({
  campaignId,
  line,
  readyChars,
  onSave,
  onGenerate,
}) {
  const [draftText, setDraftText] = useState(line.text || '')
  const [draftCharId, setDraftCharId] = useState(line.character_id || '')
  const [savingLine, setSavingLine] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  // PR DA — keep local form state in sync with parent slice so
  // /generate-line refreshes (which mutate the line) propagate
  // back into the textarea + dropdown.
  useEffect(() => {
    setDraftText(line.text || '')
    setDraftCharId(line.character_id || '')
  }, [line.id, line.text, line.character_id])

  const dirty =
    (draftText || '').trim() !== (line.text || '').trim() ||
    (draftCharId || '') !== (line.character_id || '')
  const canSave = Boolean(
    onSave && campaignId && (draftText.trim().length > 0 || draftCharId) && dirty && !savingLine,
  )
  const canGenerate = Boolean(
    onGenerate &&
      campaignId &&
      (line.text || '').trim().length > 0 &&
      line.character_id &&
      !generating &&
      !dirty,
  )

  const handleSave = async () => {
    if (!canSave) return
    setError('')
    setSavingLine(true)
    try {
      await onSave(campaignId, line.id, {
        text: draftText.trim(),
        character_id: draftCharId || null,
      })
    } catch (e) {
      setError(`save: ${e?.message || e}`)
    } finally {
      setSavingLine(false)
    }
  }

  const handleGenerate = async () => {
    if (!canGenerate) return
    setError('')
    setGenerating(true)
    try {
      await onGenerate(campaignId, line.id)
    } catch (e) {
      setError(`generate: ${e?.message || e}`)
    } finally {
      setGenerating(false)
    }
  }

  const statusTone =
    line.status === 'ok'
      ? 'emerald'
      : line.status === 'failed'
      ? 'rose'
      : line.status === 'running' || line.status === 'pending'
      ? 'amber'
      : 'zinc'
  const statusClass = {
    emerald: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/40',
    rose: 'bg-rose-500/15 text-rose-200 ring-rose-400/40',
    amber: 'bg-amber-500/15 text-amber-200 ring-amber-400/40',
    zinc: 'bg-zinc-800 text-zinc-400 ring-zinc-700',
  }[statusTone]

  const beat = line.label || line.id || 'line'
  const charsLeft = 300 - draftText.length

  return (
    <li
      data-testid="dialogue-lane-line-row"
      data-line-id={line.id}
      data-line-status={line.status}
      className="rounded ring-1 ring-zinc-800 bg-zinc-950/60 px-2 py-1.5 space-y-1"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
          {beat}
        </span>
        <span
          className={`text-[9px] rounded-full px-2 py-0.5 font-mono ring-1 ${statusClass}`}
          title={`status: ${line.status}`}
        >
          {String(line.status).replace(/_/g, ' ')}
        </span>
      </div>
      <textarea
        value={draftText}
        onChange={(e) => setDraftText(e.target.value)}
        placeholder="Line of dialogue (≤300 chars, matches Runway avatar_videos cap)"
        rows={2}
        maxLength={300}
        disabled={savingLine || generating}
        data-testid="dialogue-lane-line-text"
        className="w-full rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] leading-snug font-mono focus:ring-pink-400 outline-none disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <select
          value={draftCharId}
          onChange={(e) => setDraftCharId(e.target.value)}
          disabled={savingLine || generating || readyChars.length === 0}
          data-testid="dialogue-lane-line-character"
          className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] focus:ring-pink-400 outline-none disabled:opacity-60 flex-1 min-w-0"
        >
          <option value="">— pick a speaker —</option>
          {readyChars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.runway_avatar_status})
            </option>
          ))}
        </select>
        <span className="text-[9px] text-zinc-600 font-mono shrink-0">
          {charsLeft}/300
        </span>
      </div>
      {readyChars.length === 0 && (
        <p className="text-[9px] text-amber-300/80 leading-snug">
          No spokespeople have a ready Runway avatar yet. Open a
          spokesperson and click Create Avatar to enable dialogue
          rendering.
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="dialogue-lane-line-save"
          className={
            'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
            (canSave
              ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100 ring-1 ring-zinc-600'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
          title={
            !onSave
              ? 'Wire onSaveDialogueLine before this can fire.'
              : !dirty
              ? 'No edits to save.'
              : !draftCharId
              ? 'Pick a speaker.'
              : savingLine
              ? 'Saving…'
              : 'POST /dialogue/line/{line_id} — no Runway credits.'
          }
        >
          {savingLine ? 'Saving…' : 'Save line'}
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          data-testid="dialogue-lane-line-generate"
          data-burns-credits="true"
          className={
            'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
            (canGenerate
              ? 'ring-1 ring-rose-400/50 bg-rose-500/30 hover:bg-rose-500/45 text-rose-100'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
          title={
            !onGenerate
              ? 'Wire onGenerateDialogueLine before this can fire.'
              : dirty
              ? 'Save edits before rendering.'
              : !line.character_id
              ? 'Pick + save a speaker first.'
              : !line.text
              ? 'Save a line of text first.'
              : generating
              ? 'Rendering…'
              : '⚠️ POST /dialogue/generate-line — burns one Runway credit (one avatar_videos task).'
          }
        >
          {generating
            ? 'Rendering…'
            : line.status === 'ok'
            ? 'Re-render Line'
            : 'Render Line'}
        </button>
        <span
          className="text-[9px] text-rose-300/70 font-mono shrink-0"
          title="One Runway avatar_videos task per click. ffmpeg stitch + captioned reel are free local ops."
        >
          ⚠ 1 credit
        </span>
        {line.video_url && line.status === 'ok' && (
          <a
            href={line.video_url}
            target="_blank"
            rel="noreferrer"
            download
            className="text-[10px] text-spark hover:underline font-mono ml-auto"
            data-testid="dialogue-lane-line-link"
          >
            preview ↗
          </a>
        )}
      </div>
      {error && (
        <p
          data-testid="dialogue-lane-line-error"
          className="text-[10px] text-rose-300 leading-snug"
          role="status"
          aria-live="polite"
        >
          {error}
        </p>
      )}
      {!error && line.error && line.status === 'failed' && (
        <p className="text-[10px] text-rose-300 leading-snug" title={line.error}>
          backend · {line.error}
        </p>
      )}
    </li>
  )
}
