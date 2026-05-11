import { useEffect, useState } from 'react'

import { formatHistoryTimestamp } from '../../uiHelpers.js'
import Step1CampaignPanel from './Step1CampaignPanel.jsx'

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
  onGenerateLongSpokesperson = null,
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
  // PR DC — Ad Variant upsert. Lifts the script editor out of the
  // mutable campaign field into per-variant rows so multiple
  // takes can coexist under one stable campaign brief.
  onUpsertAdVariant = null,
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

  // PR DC — selected Ad Variant state. Scoped to the lane (not the
  // workspace) because it resets when the operator switches
  // campaigns. Render handler in Step 3 reads this so the
  // OutputRecord captures variant_id + variant_title.
  const variants = Array.isArray(focused?.ad_variants) ? focused.ad_variants : []
  const [selectedVariantId, setSelectedVariantId] = useState(null)
  useEffect(() => {
    if (!focused?.id) {
      setSelectedVariantId(null)
      return
    }
    if (variants.length === 0) {
      setSelectedVariantId(null)
      return
    }
    // Default to newest variant; preserve a still-existing prior
    // selection across re-renders of the same campaign.
    setSelectedVariantId((prev) => {
      if (prev && variants.some((v) => v.id === prev)) return prev
      return variants[0].id
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id, variants.length])
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
      // PR DC — pass selected variant_id so the appended
      // OutputRecord captures the variant linkage. Backend uses
      // the variant's script as the spoken text when set.
      await onGenerateSpokesperson(focused.id, {
        variantId: selectedVariantId || undefined,
      })
    } catch (e) {
      setHorizontalError(`${e?.message || e}`)
    } finally {
      setHorizontalBusy(false)
    }
  }

  // PR DO — Long Spokesperson Ad state + handlers. Multi-chunk
  // render pipeline; backend chunks the script + fires one
  // avatar_videos per chunk + ffmpeg-concats into one MP4 in the
  // Videos tab.
  const LONG_SCRIPT_MAX = 1500
  const LONG_CHUNK_TARGET = 280
  const CHARS_PER_SECOND = 15
  const selectedVariant = (focused?.ad_variants || []).find(
    (v) => v.id === selectedVariantId,
  )
  const [longAdExpanded, setLongAdExpanded] = useState(false)
  const [longAdScript, setLongAdScript] = useState(
    selectedVariant?.long_script || '',
  )
  const [longAdBusy, setLongAdBusy] = useState(false)
  const [longAdError, setLongAdError] = useState('')
  useEffect(() => {
    // When the operator switches variants, swap the textarea
    // content to the new variant's long_script. Existing edits in
    // the textarea are discarded so the UI never carries stale
    // text across variants.
    setLongAdScript(selectedVariant?.long_script || '')
    setLongAdError('')
  }, [selectedVariantId, selectedVariant?.long_script])
  const longCharCount = longAdScript.length
  const longChunkEstimate = longAdScript
    ? Math.max(1, Math.ceil(longCharCount / LONG_CHUNK_TARGET))
    : 0
  const longDurationEstimate = longAdScript
    ? Math.max(1, Math.round(longCharCount / CHARS_PER_SECOND))
    : 0
  const longAdCanFire = Boolean(
    onGenerateLongSpokesperson &&
      hasCampaign &&
      horizontalHasUsableAvatar &&
      longAdScript.trim().length > 0 &&
      longCharCount <= LONG_SCRIPT_MAX &&
      !longAdBusy,
  )
  const longAdLabel = longAdBusy
    ? `Rendering long ad (~${longChunkEstimate} chunks)…`
    : 'Render Long Ad'
  const longAdDisabledReason = !hasCampaign
    ? 'Requires campaign brief — save the brief in Step 1 first.'
    : !horizontalHasUsableAvatar
    ? 'Requires avatar — generate or attach a Runway avatar to the campaign first.'
    : !longAdScript.trim()
    ? 'Type a long-form script in the textarea below first.'
    : longCharCount > LONG_SCRIPT_MAX
    ? `Script is ${longCharCount}/${LONG_SCRIPT_MAX} chars — trim before rendering.`
    : !onGenerateLongSpokesperson
    ? 'Wire onGenerateLongSpokesperson before this can fire.'
    : ''
  const handleGenerateLongAd = async () => {
    if (!longAdCanFire) return
    setLongAdError('')
    setLongAdBusy(true)
    try {
      await onGenerateLongSpokesperson(focused.id, {
        script: longAdScript.trim(),
        variantId: selectedVariantId || undefined,
      })
      // PR DQ — collapse the textarea panel on success so the
      // "next action" surface (Reels button, Videos tab) is
      // unobscured. The script stays persisted on
      // variant.long_script via backend write-through, so the
      // textarea pre-populates on the next expand.
      setLongAdExpanded(false)
    } catch (e) {
      setLongAdError(`${e?.message || e}`)
    } finally {
      setLongAdBusy(false)
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
        {/* Step 1 — Campaign Setup / Summary (PR DI) */}
        <Step1CampaignPanel
          focused={focused}
          hasSpokesperson={hasSpokesperson}
          onCreate={onCreateCampaign}
          onSave={onUpdateBrief}
          modeLabel="spokesperson ad"
          testidPrefix="spokesperson"
          counts={
            focused
              ? {
                  adVariants: Array.isArray(focused.ad_variants)
                    ? focused.ad_variants.length
                    : 0,
                  outputs: Array.isArray(focused.outputs)
                    ? focused.outputs.filter(
                        (o) => o?.kind === 'spokesperson_ad',
                      ).length
                    : 0,
                }
              : null
          }
        />

        {/* Step 2 — Ad Variants (PR DC) */}
        <Step2AdVariants
          focusedCampaign={focused}
          focusedScript={focusedScript}
          scriptPreview={scriptPreview}
          hasCampaign={hasCampaign}
          onSaveScript={onSaveScript}
          onUpsertAdVariant={onUpsertAdVariant}
          selectedVariantId={selectedVariantId}
          onSelectVariant={setSelectedVariantId}
          knowledgeSources={
            Array.isArray(activeSpokesperson?.knowledge_sources)
              ? activeSpokesperson.knowledge_sources
              : []
          }
        />
        {/* — original block preserved as Step2Script (PR CU/CX); PR DC
            wraps it inside Step2AdVariants for the new variant flow — */}

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
                renders are preserved in the Videos tab.
              </p>
            )}
            {/* PR DO + PR DR — Long Spokesperson Ad. Outer button
                is pure toggle (expand/collapse the textarea). The
                expanded form below has its own explicit Render +
                Clear buttons so a failed/interrupted render leaves
                a clear retry path. Backend chunks the script at
                sentence boundaries, fires one avatar_videos per
                chunk, and ffmpeg-concats into one Videos card. */}
            <button
              type="button"
              onClick={() => setLongAdExpanded((v) => !v)}
              disabled={longAdBusy}
              data-testid="spokesperson-lane-long-ad"
              data-render-target="long-ad"
              data-expanded={longAdExpanded ? 'true' : 'false'}
              data-busy={longAdBusy ? 'true' : 'false'}
              title="Toggle the long-form script editor. Render fires from inside the form."
              className={
                'w-full flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 font-mono transition-colors ' +
                (longAdBusy
                  ? 'ring-1 ring-rose-400/30 bg-rose-500/20 text-rose-200 cursor-wait'
                  : longAdExpanded
                  ? 'ring-1 ring-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
                  : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-300 cursor-pointer hover:ring-rose-400/30')
              }
            >
              <span className="truncate">
                {longAdBusy ? longAdLabel : longAdExpanded ? 'Hide Long Ad editor' : 'Render Long Ad'}
              </span>
              <span className="text-[9px] text-zinc-200/70">
                {longAdBusy
                  ? `rendering ${longChunkEstimate} chunks…`
                  : longChunkEstimate > 0
                  ? `${longChunkEstimate} clips · ~${longDurationEstimate}s`
                  : longAdExpanded
                  ? 'type below ↓'
                  : 'click to expand'}
              </span>
            </button>
            {longAdExpanded && (
              <div
                data-testid="spokesperson-lane-long-ad-editor"
                className="rounded ring-1 ring-zinc-800 bg-zinc-950/60 p-2 space-y-1.5"
              >
                <p className="text-[10px] text-zinc-400 leading-snug">
                  Long-form script (≤{LONG_SCRIPT_MAX} chars). Backend
                  splits at sentence boundaries into ~{LONG_CHUNK_TARGET}-char
                  chunks, renders each via avatar_videos, then
                  stitches into one MP4. One Runway credit per chunk.
                </p>
                <textarea
                  value={longAdScript}
                  onChange={(e) => setLongAdScript(e.target.value)}
                  placeholder={
                    "Hi, I'm Donny. Most AI ads feel like one-off " +
                    "experiments. Character OS gives your brand " +
                    "persistent spokespeople, reusable campaigns, saved " +
                    "videos, and ad variants you can keep building on…"
                  }
                  rows={6}
                  maxLength={LONG_SCRIPT_MAX}
                  disabled={longAdBusy}
                  data-testid="spokesperson-lane-long-ad-textarea"
                  className="w-full rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] leading-snug font-mono focus:ring-rose-400 outline-none disabled:opacity-60"
                />
                <div className="flex items-center justify-between gap-2 flex-wrap text-[9px] text-zinc-500 font-mono">
                  <span>
                    {longCharCount}/{LONG_SCRIPT_MAX} chars
                  </span>
                  <span data-testid="spokesperson-lane-long-ad-estimate">
                    {longChunkEstimate > 0
                      ? `${longChunkEstimate} clip${longChunkEstimate === 1 ? '' : 's'} · estimated ${longDurationEstimate}s runtime`
                      : 'type a script to see the chunk + runtime estimate'}
                  </span>
                </div>
                {/* PR DR — explicit Render + Clear buttons inside
                    the form. Outer toggle button never auto-fires
                    a render, so this is the only way to start
                    rendering. After a failed/interrupted render
                    the form stays open + the operator can Clear
                    and retype or just hit Render again. */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <button
                    type="button"
                    onClick={handleGenerateLongAd}
                    disabled={!longAdCanFire}
                    data-testid="spokesperson-lane-long-ad-render"
                    data-burns-credits="true"
                    title={
                      longAdCanFire
                        ? `⚠️ POST /v1/avatar_videos × ${longChunkEstimate} — burns ${longChunkEstimate} credits.`
                        : longAdDisabledReason || 'Type a script first.'
                    }
                    className={
                      'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
                      (longAdCanFire
                        ? 'ring-1 ring-rose-400/50 bg-rose-500/30 hover:bg-rose-500/45 text-rose-100'
                        : 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-400 cursor-not-allowed disabled:opacity-80')
                    }
                  >
                    {longAdBusy
                      ? `Rendering (${longChunkEstimate} chunks)…`
                      : longChunkEstimate > 0
                      ? `Render Long Ad · ${longChunkEstimate} clips`
                      : 'Render Long Ad'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLongAdScript('')
                      setLongAdError('')
                    }}
                    disabled={longAdBusy || longCharCount === 0}
                    data-testid="spokesperson-lane-long-ad-clear"
                    title="Wipe the textarea so you can type a fresh script."
                    className={
                      'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
                      (longAdBusy || longCharCount === 0
                        ? 'ring-1 ring-zinc-700 bg-zinc-800/40 text-zinc-500 cursor-not-allowed disabled:opacity-60'
                        : 'ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/70 hover:ring-zinc-500 text-zinc-200')
                    }
                  >
                    Clear
                  </button>
                  {selectedVariant?.long_script
                    && longAdScript !== selectedVariant.long_script
                    && !longAdBusy
                    && (
                      <button
                        type="button"
                        onClick={() => {
                          setLongAdScript(selectedVariant.long_script || '')
                          setLongAdError('')
                        }}
                        data-testid="spokesperson-lane-long-ad-restore"
                        title="Reset the textarea to the saved long_script on this variant."
                        className="text-[10px] text-zinc-500 hover:text-zinc-200 font-mono"
                      >
                        ↺ restore saved
                      </button>
                    )
                  }
                </div>
                {longAdError && (
                  <p
                    data-testid="spokesperson-lane-long-ad-error"
                    className="text-[10px] text-rose-300 leading-snug"
                    title={longAdError}
                  >
                    ⚠ {longAdError}
                  </p>
                )}
                {selectedVariant && (
                  <p className="text-[9px] text-zinc-500 leading-snug">
                    Linked to variant{' '}
                    <span className="text-pink-300 font-mono">
                      {selectedVariant.title}
                    </span>{' '}
                    — on successful render the script is saved as
                    the variant's long_script so re-rendering
                    pre-populates here.
                  </p>
                )}
              </div>
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
              PR DC — when a variant is selected, scope the list
              to renders whose `variant_id` matches; otherwise show
              all the campaign's spokesperson_ad outputs. Each row
              shows the variant title when captured. */}
          {hasCampaign && (() => {
            const allAdOutputs = Array.isArray(focused.outputs)
              ? focused.outputs.filter((o) => o.kind === 'spokesperson_ad')
              : []
            const adOutputs = selectedVariantId
              ? allAdOutputs.filter((o) => o.variant_id === selectedVariantId)
              : allAdOutputs
            if (allAdOutputs.length === 0) return null
            const scopeLabel = selectedVariantId
              ? `${adOutputs.length} saved render${adOutputs.length === 1 ? '' : 's'} for this variant`
              : `${adOutputs.length} saved render${adOutputs.length === 1 ? '' : 's'} for this campaign`
            return (
              <details
                data-testid="spokesperson-lane-saved-renders"
                data-output-count={adOutputs.length}
                data-scope={selectedVariantId ? 'variant' : 'campaign'}
                className="rounded ring-1 ring-emerald-400/30 bg-emerald-500/[0.04] px-2 py-1 mt-1"
              >
                <summary className="text-[10px] text-emerald-200 cursor-pointer select-none hover:text-emerald-100">
                  {scopeLabel}
                </summary>
                <ul className="space-y-1 pt-1.5">
                  {adOutputs.slice(0, 5).map((o) => (
                    <li
                      key={o.id}
                      data-testid="spokesperson-lane-saved-render-row"
                      data-output-id={o.id}
                      data-variant-id={o.variant_id || ''}
                      className="flex items-center justify-between gap-2 rounded bg-black/20 ring-1 ring-emerald-400/20 px-2 py-1"
                    >
                      <div className="min-w-0 flex-1">
                        {o.variant_title && (
                          <span className="text-[9px] text-pink-300 font-mono">
                            {o.variant_title}
                            <span className="text-zinc-500"> · </span>
                          </span>
                        )}
                        <span className="text-[10px] text-emerald-100">
                          {o.script
                            ? (o.script.length > 60
                                ? o.script.slice(0, 60) + '…'
                                : o.script)
                            : <span className="text-zinc-400 italic">no script captured</span>}
                        </span>
                      </div>
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
                      + {adOutputs.length - 5} more — see Videos tab for the full history
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

/**
 * PR DC — Step 2 wrapper for Ad Variants. Lets the operator stack
 * multiple variants (title + script) under one stable Campaign
 * brief. The Step 3 render button uses the selected variant's id
 * + script via the variant_id passthrough on the host-video route.
 *
 * Three states:
 *   - no campaign       → points operator back to Step 1
 *   - campaign + no variants → "+ New Ad" CTA (also surfaces the
 *                          legacy commercial_script if one is set
 *                          so it doesn't disappear visually)
 *   - campaign + variants    → variant chip-row + per-variant
 *                          script editor + new-variant + delete
 *
 * Backward compat: when a campaign has `commercial_script` set but
 * no variants, we render a "Convert legacy script to Ad 1" CTA
 * that materializes the saved script into a real variant.
 */
function Step2AdVariants({
  focusedCampaign,
  focusedScript,
  scriptPreview,
  hasCampaign,
  onSaveScript,
  onUpsertAdVariant,
  selectedVariantId,
  onSelectVariant,
  knowledgeSources = [],
}) {
  const variants = Array.isArray(focusedCampaign?.ad_variants)
    ? focusedCampaign.ad_variants
    : []
  const knowledgeCount = knowledgeSources.length
  const selectedVariant =
    variants.find((v) => v.id === selectedVariantId) || null

  const hasLegacyScript = Boolean(focusedScript) && variants.length === 0

  // The classic Step 2 inline editor moves inside this wrapper.
  // When a variant is selected it edits the variant's script; when
  // no variants exist it falls back to the campaign-level script
  // editor (legacy path).
  return (
    <div
      data-testid="spokesperson-lane-step-script"
      data-variant-id={selectedVariantId || ''}
      className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
          Step 2 · Ad Variants
        </span>
        {variants.length > 0 && (
          <span
            className="text-[9px] text-zinc-600 font-mono"
            data-testid="spokesperson-lane-variant-count"
          >
            {variants.length}{' '}
            {variants.length === 1 ? 'variant' : 'variants'}
          </span>
        )}
      </div>

      {/* Knowledge reference disclosure (PR CX) — unchanged. */}
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
          </div>
        </details>
      )}

      {!hasCampaign && (
        <p className="text-[11px] text-zinc-400 leading-snug">
          Save a campaign brief in Step 1 to start adding ad variants.
        </p>
      )}

      {/* PR DC — variant chip row. Click to select; new-variant
          button at the end. Replaces the legacy "one script per
          campaign" mental model with "many scripts (variants)
          under one campaign". */}
      {hasCampaign && variants.length > 0 && (
        <VariantChipRow
          variants={variants}
          selectedVariantId={selectedVariantId}
          onSelectVariant={onSelectVariant}
          onUpsertAdVariant={onUpsertAdVariant}
          campaignId={focusedCampaign?.id}
        />
      )}

      {/* Selected-variant inline script editor. Uses the same
          UX shape as the PR CU/CX Step2Script — preview, edit,
          save — but the save target is the variant, not the
          campaign's commercial_script. */}
      {hasCampaign && selectedVariant && (
        <VariantScriptEditor
          campaignId={focusedCampaign?.id}
          variant={selectedVariant}
          onUpsertAdVariant={onUpsertAdVariant}
        />
      )}

      {/* No-variants empty state */}
      {hasCampaign && variants.length === 0 && (
        <NoVariantsState
          campaignId={focusedCampaign?.id}
          legacyScript={hasLegacyScript ? focusedScript : ''}
          scriptPreview={scriptPreview}
          onUpsertAdVariant={onUpsertAdVariant}
          onSelectVariant={onSelectVariant}
        />
      )}
    </div>
  )
}

function VariantChipRow({
  variants,
  selectedVariantId,
  onSelectVariant,
  onUpsertAdVariant,
  campaignId,
}) {
  const [creating, setCreating] = useState(false)
  const handleNew = async () => {
    if (!onUpsertAdVariant || !campaignId || creating) return
    setCreating(true)
    try {
      const title = `Ad ${variants.length + 1}`
      const updated = await onUpsertAdVariant(campaignId, { title, script: '' })
      const newest = Array.isArray(updated?.ad_variants)
        ? updated.ad_variants[0]
        : null
      if (newest?.id) onSelectVariant?.(newest.id)
    } catch (e) {
      // surfaced via the workspace's error banner if needed; the
      // chip row itself stays simple
    } finally {
      setCreating(false)
    }
  }
  return (
    <div
      data-testid="spokesperson-lane-variant-chips"
      className="flex flex-wrap items-center gap-1"
    >
      {variants.map((v) => {
        const isActive = v.id === selectedVariantId
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelectVariant?.(v.id)}
            data-testid="spokesperson-lane-variant-chip"
            data-variant-id={v.id}
            data-active={isActive ? 'true' : 'false'}
            title={v.title}
            className={
              'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ' +
              (isActive
                ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
            }
          >
            {v.title}
          </button>
        )
      })}
      <button
        type="button"
        onClick={handleNew}
        disabled={!onUpsertAdVariant || creating}
        data-testid="spokesperson-lane-variant-new"
        className={
          'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ring-1 ' +
          (creating
            ? 'bg-zinc-800/40 text-zinc-500 ring-zinc-700 cursor-wait'
            : 'bg-zinc-900/60 text-zinc-300 ring-zinc-700 hover:ring-pink-400/40 hover:text-pink-200')
        }
        title="Add a new Ad Variant to this campaign — campaign brief stays the same."
      >
        {creating ? 'creating…' : '+ New Ad'}
      </button>
    </div>
  )
}

function VariantScriptEditor({ campaignId, variant, onUpsertAdVariant }) {
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(variant.title)
  const [draftScript, setDraftScript] = useState(variant.script || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Re-sync on variant switch.
  useEffect(() => {
    setDraftTitle(variant.title)
    setDraftScript(variant.script || '')
    setEditing(false)
    setError('')
  }, [variant.id])

  const canSave = !busy && draftTitle.trim().length > 0
  const handleSave = async () => {
    if (!canSave) return
    setError('')
    setBusy(true)
    try {
      await onUpsertAdVariant?.(campaignId, {
        id: variant.id,
        title: draftTitle.trim(),
        script: draftScript.trim(),
      })
      setEditing(false)
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }
  const handleCancel = () => {
    setDraftTitle(variant.title)
    setDraftScript(variant.script || '')
    setEditing(false)
    setError('')
  }

  if (!editing) {
    return (
      <div
        data-testid="spokesperson-lane-variant-script"
        data-variant-id={variant.id}
        className="space-y-1"
      >
        <p className="text-[10px] text-zinc-500 leading-snug">
          <span className="text-zinc-300 font-medium">
            {variant.title}
          </span>{' '}
          · {variant.script ? `${variant.script.length} chars` : 'no script yet'}
        </p>
        {variant.script ? (
          <pre
            data-testid="spokesperson-lane-variant-script-preview"
            className="whitespace-pre-wrap break-words text-[10px] text-zinc-300 font-mono leading-snug max-h-[6rem] overflow-y-auto rounded bg-black/30 ring-1 ring-zinc-800 p-1.5"
          >
            {variant.script}
          </pre>
        ) : (
          <p className="text-[11px] text-zinc-400 leading-snug">
            No script yet for this variant.
          </p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={!onUpsertAdVariant}
          data-testid="spokesperson-lane-variant-edit"
          className="text-[10px] rounded px-2 py-1 font-mono bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40 transition-colors disabled:opacity-60"
        >
          {variant.script ? 'Edit ad' : '+ Add script'}
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="spokesperson-lane-variant-editor"
      data-variant-id={variant.id}
      className="space-y-1"
    >
      <label className="text-[10px] text-zinc-300 flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
          Variant title
        </span>
        <input
          type="text"
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          maxLength={80}
          disabled={busy}
          data-testid="spokesperson-lane-variant-title-input"
          className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] focus:ring-pink-400 outline-none disabled:opacity-60"
        />
      </label>
      <label className="text-[10px] text-zinc-300 flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
          Script · {draftScript.length}/300
        </span>
        <textarea
          value={draftScript}
          onChange={(e) => setDraftScript(e.target.value)}
          placeholder="A short, direct line your spokesperson will speak verbatim. ≤300 chars."
          rows={4}
          maxLength={300}
          disabled={busy}
          data-testid="spokesperson-lane-variant-script-input"
          className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] leading-snug font-mono focus:ring-pink-400 outline-none disabled:opacity-60"
        />
      </label>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="spokesperson-lane-variant-save"
          className={
            'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
            (canSave
              ? 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
        >
          {busy ? 'Saving…' : 'Save variant'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          data-testid="spokesperson-lane-variant-cancel"
          className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1 py-1 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p
          data-testid="spokesperson-lane-variant-error"
          className="text-[10px] text-rose-300 leading-snug"
          role="status"
          aria-live="polite"
        >
          {error}
        </p>
      )}
    </div>
  )
}

function NoVariantsState({
  campaignId,
  legacyScript,
  scriptPreview,
  onUpsertAdVariant,
  onSelectVariant,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleCreateBlank = async () => {
    if (!onUpsertAdVariant || !campaignId || busy) return
    setError('')
    setBusy(true)
    try {
      const updated = await onUpsertAdVariant(campaignId, {
        title: 'Ad 1',
        script: '',
      })
      const created = Array.isArray(updated?.ad_variants)
        ? updated.ad_variants[0]
        : null
      if (created?.id) onSelectVariant?.(created.id)
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const handleConvertLegacy = async () => {
    if (!onUpsertAdVariant || !campaignId || busy || !legacyScript) return
    setError('')
    setBusy(true)
    try {
      const updated = await onUpsertAdVariant(campaignId, {
        title: 'Ad 1',
        script: legacyScript,
      })
      const created = Array.isArray(updated?.ad_variants)
        ? updated.ad_variants[0]
        : null
      if (created?.id) onSelectVariant?.(created.id)
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="spokesperson-lane-variants-empty"
      className="space-y-1.5"
    >
      <p className="text-[11px] text-zinc-400 leading-snug">
        No ad variants yet for this campaign. Each variant carries its
        own title + script; campaign brief stays stable across them.
      </p>
      {legacyScript ? (
        <>
          <p className="text-[10px] text-amber-200 leading-snug">
            This campaign has a legacy saved script:
          </p>
          <pre className="whitespace-pre-wrap break-words text-[10px] text-zinc-300 font-mono leading-snug max-h-[5rem] overflow-y-auto rounded bg-black/30 ring-1 ring-zinc-800 p-1.5">
            {scriptPreview}
          </pre>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleConvertLegacy}
              disabled={busy}
              data-testid="spokesperson-lane-variants-convert-legacy"
              className="text-[10px] rounded px-2 py-1 font-mono bg-amber-500/30 hover:bg-amber-500/45 text-amber-100 ring-1 ring-amber-400/40 transition-colors disabled:opacity-60"
            >
              {busy ? 'Converting…' : 'Convert to Ad 1 variant'}
            </button>
            <button
              type="button"
              onClick={handleCreateBlank}
              disabled={busy}
              data-testid="spokesperson-lane-variants-new"
              className="text-[10px] rounded px-2 py-1 font-mono bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40 transition-colors disabled:opacity-60"
            >
              + New Ad (blank)
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={handleCreateBlank}
          disabled={busy}
          data-testid="spokesperson-lane-variants-new"
          className="text-[10px] rounded px-2 py-1 font-mono bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40 transition-colors disabled:opacity-60"
        >
          {busy ? 'Creating…' : '+ New Ad'}
        </button>
      )}
      {error && (
        <p
          data-testid="spokesperson-lane-variants-error"
          className="text-[10px] text-rose-300 leading-snug"
          role="status"
          aria-live="polite"
        >
          {error}
        </p>
      )}
    </div>
  )
}
