import { useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'
import LaneBriefCreator from './LaneBriefCreator.jsx'
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
  // PR CU — Create campaign from inline brief form. Closes the
  // empty-state dead-end. POSTs /api/campaigns + /attach-character.
  onCreateCampaign = null,
  // PR CU — Save the commercial script inline so Step 2 has a real
  // CTA instead of a "go to legacy" instruction. POSTs /script.
  onSaveScript = null,
  // PR DA — focused campaign + creating-new mode are now driven
  // by the workspace's selection state (lifted state). Lane no
  // longer derives "most recent" itself.
  focusedCampaign = null,
  creatingNew = false,
  onCancelCreate = null,
}) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  // PR DA — `focused` is now the operator-selected campaign passed
  // in from the workspace. When the operator is creating a brand
  // new campaign (`creatingNew=true`), focused is null on purpose
  // so the lane mounts <LaneBriefCreator> with blank fields and
  // doesn't bleed the previous campaign's brief / script through.
  const focused = focusedCampaign
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
    ? 'Rebuild captions from saved video'
    : 'Build Captioned Reels'
  const reelsCanFire = Boolean(
    onBuildReels && hasCampaign && reelsSourceReady && !reelsBusy,
  )
  const reelsDisabledReason = !hasCampaign
    ? 'Requires campaign brief — save the brief in Step 1 first.'
    : !reelsSourceReady
    ? 'Requires saved video — generate the Spokesperson Ad in Step 3 first.'
    : !onBuildReels
    ? 'Wire the v2 onBuildReels handler before this button can fire.'
    : ''
  // PR CU — operator-readable chip for the Reels button.
  const reelsChip = reelsBusy
    ? 'building…'
    : reelsCached
    ? 'cached'
    : reelsSourceReady
    ? 'ready'
    : !hasCampaign
    ? 'requires brief'
    : 'requires video'
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
  // PR CY — re-render is now append-not-overwrite (Outputs gallery
  // shows every prior render). Updated label so operators understand
  // they're spending fresh credits, not "regenerating" an existing
  // file in place.
  const horizontalLabel = horizontalBusy
    ? 'Generating Real Spokesperson Ad…'
    : horizontalCached
    ? 'Render new Spokesperson Ad'
    : 'Generate Real Spokesperson Ad'
  const horizontalDisabledReason = !hasCampaign
    ? 'Requires campaign brief — save the brief in Step 1 first.'
    : !horizontalHasUsableAvatar
    ? 'Requires avatar — generate or attach a Runway avatar to the campaign first.'
    : !onGenerateSpokesperson
    ? 'Wire the v2 onGenerateSpokesperson handler before this button can fire.'
    : ''
  // PR CU — short chip text shown adjacent to the button label.
  // PR CY — clearer copy: "previous render saved" instead of
  // "cached · burns credits" so operators understand re-renders are
  // billed and don't overwrite the prior take.
  const horizontalChip = horizontalBusy
    ? 'generating…'
    : horizontalCached
    ? 'previous render saved'
    : horizontalCanFire
    ? 'burns credits'
    : !hasCampaign
    ? 'requires brief'
    : !horizontalHasUsableAvatar
    ? 'requires avatar'
    : 'unavailable'
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
            Build a spokesperson ad
          </h4>
          <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
            Render this spokesperson speaking your script directly to
            camera, then export a captioned vertical reel. Real Runway
            credits when you click Generate.
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

      {/* PR DA — active-state banner. Surfaces which campaign the
          lane is editing (or "New campaign" creating-new mode) so
          the operator never confuses the form with a stale record. */}
      <div
        data-testid="spokesperson-lane-active-state"
        data-mode={creatingNew ? 'new' : focused ? 'editing' : 'idle'}
        className={
          'rounded-lg px-2.5 py-1.5 ring-1 flex items-center justify-between gap-2 flex-wrap ' +
          (creatingNew
            ? 'ring-pink-400/40 bg-pink-500/10'
            : focused
            ? 'ring-emerald-400/30 bg-emerald-500/[0.06]'
            : 'ring-zinc-800 bg-zinc-950/40')
        }
      >
        <div className="text-[11px] leading-snug min-w-0">
          {creatingNew ? (
            <>
              <span className="text-pink-100 font-semibold">
                ✏️ New campaign
              </span>{' '}
              <span className="text-pink-200/80">
                — fill the brief below to start. Previous campaigns
                stay in the list above.
              </span>
            </>
          ) : focused ? (
            <>
              <span className="text-emerald-100 font-semibold">
                Editing: {focused.business || 'untitled'}
              </span>
              {focused.product && (
                <span className="text-emerald-200/80">
                  {' '}· {focused.product}
                </span>
              )}
              <span className="text-zinc-500 font-mono ml-2">
                {String(focused.id).slice(0, 8)}
              </span>
            </>
          ) : (
            <span className="text-zinc-400">
              No campaign selected. Pick one from the list above or
              click <span className="text-zinc-200 font-medium">+ New Campaign</span>.
            </span>
          )}
        </div>
        {creatingNew && onCancelCreate && (
          <button
            type="button"
            onClick={onCancelCreate}
            data-testid="spokesperson-lane-cancel-create"
            className="text-[10px] text-zinc-500 hover:text-zinc-200 underline-offset-2 hover:underline"
          >
            cancel new campaign
          </button>
        )}
      </div>

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
            // PR CU — replace the dead-end copy with an actionable
            // empty-state CTA + inline create form.
            <LaneBriefCreator
              onCreate={onCreateCampaign}
              modeLabel="spokesperson ad"
              testidPrefix="spokesperson"
              hasSpokesperson={hasSpokesperson}
            />
          )}
        </div>

        {/* Step 2 — Script */}
        <Step2Script
          focusedCampaign={focused}
          focusedScript={focusedScript}
          scriptPreview={scriptPreview}
          hasCampaign={hasCampaign}
          onSaveScript={onSaveScript}
          knowledgeSources={
            Array.isArray(activeSpokesperson?.knowledge_sources)
              ? activeSpokesperson.knowledge_sources
              : []
          }
        />
        {/* — original block preserved as Step2Script (PR CU/CX) — */}

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
                {horizontalChip}
              </span>
            </button>
            {horizontalCanFire && (
              <p
                data-testid="spokesperson-lane-horizontal-warning"
                className="text-[9px] text-rose-300 leading-snug"
              >
                ⚠️ Re-rendering creates a new billable video. Prior
                renders are preserved in the Outputs tab.
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
                {reelsChip}
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
          {/* PR DA — saved-renders disclosure for THIS campaign.
              Distinct from the workspace Outputs tab gallery (which
              shows every campaign's renders); this is scoped to
              the active campaign so the operator can confirm prior
              takes still exist after a new render. */}
          {hasCampaign && (() => {
            const adOutputs = Array.isArray(focused.outputs)
              ? focused.outputs.filter((o) => o.kind === 'spokesperson_ad')
              : []
            if (adOutputs.length === 0) return null
            return (
              <details
                data-testid="spokesperson-lane-saved-renders"
                data-output-count={adOutputs.length}
                className="rounded ring-1 ring-emerald-400/30 bg-emerald-500/[0.04] px-2 py-1 mt-1"
              >
                <summary className="text-[10px] text-emerald-200 cursor-pointer select-none hover:text-emerald-100">
                  {adOutputs.length} saved render{adOutputs.length === 1 ? '' : 's'} for this campaign
                </summary>
                <ul className="space-y-1 pt-1.5">
                  {adOutputs.slice(0, 5).map((o) => (
                    <li
                      key={o.id}
                      data-testid="spokesperson-lane-saved-render-row"
                      data-output-id={o.id}
                      className="flex items-center justify-between gap-2 rounded bg-black/20 ring-1 ring-emerald-400/20 px-2 py-1"
                    >
                      <span className="text-[10px] text-emerald-100 truncate">
                        {o.script
                          ? (o.script.length > 60
                              ? o.script.slice(0, 60) + '…'
                              : o.script)
                          : <span className="text-zinc-400 italic">no script captured</span>}
                      </span>
                      <a
                        href={o.video_url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="text-[10px] text-spark hover:underline font-mono shrink-0"
                      >
                        open ↗
                      </a>
                    </li>
                  ))}
                  {adOutputs.length > 5 && (
                    <li className="text-[9px] text-zinc-500 font-mono px-2">
                      + {adOutputs.length - 5} more — see Outputs tab for the full history
                    </li>
                  )}
                </ul>
              </details>
            )
          })()}
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
 * PR CU — Step 2 Script.
 *
 * Three states, each with a clear next action:
 *
 *   - no campaign       — disabled CTA pointing back to Step 1
 *   - campaign + script — preview + "Edit script" reveals textarea
 *   - campaign no script — primary CTA "+ Save script" reveals textarea
 *
 * No legacy-wizard round-trip. Plain textarea, ≤300 chars (matches
 * Runway's `avatar_videos` speech cap). Save POSTs to the existing
 * `/script` route via `onSaveScript`.
 */
function Step2Script({
  focusedCampaign,
  focusedScript,
  scriptPreview,
  hasCampaign,
  onSaveScript,
  knowledgeSources = [],
}) {
  const knowledgeCount = knowledgeSources.length
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const startEditing = () => {
    setDraft(focusedScript || '')
    setEditing(true)
    setError('')
  }
  const cancelEditing = () => {
    setEditing(false)
    setDraft('')
    setError('')
  }
  const handleSave = async () => {
    if (!hasCampaign || !onSaveScript || busy) return
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Script cannot be empty.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await onSaveScript(focusedCampaign.id, trimmed)
      setEditing(false)
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="spokesperson-lane-step-script"
      className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1"
    >
      <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
        Step 2 · Script
      </span>

      {/* PR CX — knowledge reference disclosure. Surfaces when the
          spokesperson has at least one saved knowledge source so the
          operator can read product / brand notes while authoring
          the script. Manual paste only — no auto-injection. */}
      {knowledgeCount > 0 && (
        <details
          data-testid="spokesperson-lane-knowledge-reference"
          data-source-count={knowledgeCount}
          className="rounded ring-1 ring-emerald-400/30 bg-emerald-500/[0.04] px-2 py-1"
        >
          <summary className="text-[10px] text-emerald-200 cursor-pointer select-none hover:text-emerald-100">
            {knowledgeCount} knowledge source{knowledgeCount === 1 ? '' : 's'} available — open for reference
          </summary>
          <div className="space-y-1.5 pt-1.5">
            {knowledgeSources.slice(0, 5).map((src) => {
              const preview =
                src.content.length > 200
                  ? src.content.slice(0, 200) + '…'
                  : src.content
              return (
                <div
                  key={src.id}
                  data-testid="spokesperson-lane-knowledge-row"
                  data-source-id={src.id}
                  className="rounded bg-black/20 ring-1 ring-emerald-400/20 px-2 py-1"
                >
                  <p className="text-[10px] text-emerald-100 font-semibold">
                    {src.title}
                  </p>
                  <p className="text-[10px] text-zinc-300 leading-snug whitespace-pre-wrap break-words">
                    {preview}
                  </p>
                </div>
              )
            })}
            {knowledgeCount > 5 && (
              <p className="text-[9px] text-zinc-500 font-mono">
                + {knowledgeCount - 5} more in Knowledge tab
              </p>
            )}
          </div>
        </details>
      )}

      {!hasCampaign && (
        <p className="text-[11px] text-zinc-400 leading-snug">
          Save a campaign brief in Step 1 to author a script.
        </p>
      )}

      {hasCampaign && !editing && focusedScript && (
        <>
          <pre
            data-testid="spokesperson-lane-script-preview"
            className="whitespace-pre-wrap break-words text-[10px] text-zinc-300 font-mono leading-snug max-h-[6rem] overflow-y-auto rounded bg-black/30 ring-1 ring-zinc-800 p-1.5"
          >
            {scriptPreview}
          </pre>
          <button
            type="button"
            onClick={startEditing}
            disabled={!onSaveScript}
            data-testid="spokesperson-lane-script-edit"
            className="text-[10px] rounded px-2 py-1 font-mono bg-zinc-800/40 hover:bg-zinc-700/60 text-zinc-200 ring-1 ring-zinc-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            title={
              onSaveScript
                ? 'Edit the saved script in place.'
                : 'Wire onSaveScript to enable editing.'
            }
          >
            Edit script
          </button>
        </>
      )}

      {hasCampaign && !editing && !focusedScript && (
        <>
          <p className="text-[11px] text-zinc-400 leading-snug">
            No script yet. The spokesperson will speak the saved
            script verbatim during render.
          </p>
          <button
            type="button"
            onClick={startEditing}
            disabled={!onSaveScript}
            data-testid="spokesperson-lane-script-cta"
            className={
              'w-full text-[11px] rounded px-2 py-1.5 font-mono transition-colors ' +
              (onSaveScript
                ? 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40'
                : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
            }
            title={
              onSaveScript
                ? 'Author a short script (≤300 chars) — saved on the campaign.'
                : 'Wire onSaveScript to enable.'
            }
          >
            + Save script
          </button>
        </>
      )}

      {hasCampaign && editing && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A short, direct line your spokesperson will speak verbatim. ≤300 chars."
            rows={4}
            maxLength={300}
            disabled={busy}
            data-testid="spokesperson-lane-script-textarea"
            className="w-full rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] leading-snug font-mono focus:ring-pink-400 outline-none disabled:opacity-60"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !draft.trim()}
              data-testid="spokesperson-lane-script-save"
              className={
                'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
                (busy || !draft.trim()
                  ? 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80'
                  : 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40')
              }
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={busy}
              data-testid="spokesperson-lane-script-cancel"
              className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <span className="text-[9px] text-zinc-600 font-mono ml-auto">
              {draft.length}/300
            </span>
          </div>
          {error && (
            <p
              data-testid="spokesperson-lane-script-status"
              className="text-[10px] text-rose-300 leading-snug"
              role="status"
              aria-live="polite"
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
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
