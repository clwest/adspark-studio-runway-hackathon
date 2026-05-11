import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import {
  CAMPAIGN_MODES,
  clearActiveMode,
  getActiveMode,
  setActiveMode as persistActiveMode,
} from '../uxFlag.js'
import CampaignModeModal from './CampaignModeModal.jsx'
import { useToast } from './Toast.jsx'
import CinematicLane from './lanes/CinematicLane.jsx'
import DialogueLane from './lanes/DialogueLane.jsx'
import SpokespersonLane from './lanes/SpokespersonLane.jsx'

const MODE_LABELS = {
  [CAMPAIGN_MODES.CINEMATIC]: 'Cinematic Ad',
  [CAMPAIGN_MODES.SPOKESPERSON]: 'Spokesperson Ad',
  [CAMPAIGN_MODES.DIALOGUE]: 'Dialogue Scene',
}

const MODE_PILL_CLASSES = {
  [CAMPAIGN_MODES.CINEMATIC]:
    'bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/40',
  [CAMPAIGN_MODES.SPOKESPERSON]:
    'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40',
  [CAMPAIGN_MODES.DIALOGUE]:
    'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40',
}

const POLL_INTERVAL_MS = 5000
const POLL_MAX_ATTEMPTS = 60

/**
 * PR CE — CampaignLanes.
 *
 * Self-contained "campaign creation surface" extracted from
 * `<SpokespersonStudio>`. Owns:
 *
 *   - active-mode state (read at mount via getActiveMode(),
 *     persisted via setActiveMode())
 *   - the selected-mode pill banner + dismiss link
 *   - the three lane components (Spokesperson / Cinematic /
 *     Dialogue) with all the handlers wired through (PR BN /
 *     PR BO / PR BP / PR BQ / PR BT / PR BU)
 *   - the `<CampaignModeModal>` mount (controlled via the
 *     `modalOpen` prop so callers can flip it from any
 *     surface — header buttons, tile shortcuts, etc.)
 *
 * Designed to be re-mounted inside any per-spokesperson
 * surface. The `<SpokespersonWorkspace>` Campaigns tab is the
 * primary caller (PR CE); a future caller could surface it
 * elsewhere without re-implementing the modal + handlers.
 *
 * Backend untouched. Every handler reuses the long-standing
 * `/api/campaigns/*` routes. The polling helper for
 * `image_to_video` mirrors v1 `App.handleGenerateVideo`
 * exactly (5 s ± 800 ms jitter, 60-attempt 5-min cap, terminal
 * SUCCEEDED / FAILED / CANCELED handling, no infinite loops).
 *
 * Props:
 *   activeSpokesperson  Character | null  required for lane
 *                        gating; null surfaces an empty-state
 *                        hint.
 *   linkedCampaigns     Array<Campaign>   campaigns linked to
 *                        this spokesperson via character_id.
 *                        Lanes pick the most-recent one for
 *                        their per-mode build targets.
 *   campaigns           Array<Campaign>   full campaigns list,
 *                        needed by handleGenerateCinematicVideo
 *                        to read runway_prompt /
 *                        reference_image_url / runway_model.
 *                        Defaults to linkedCampaigns when not
 *                        provided.
 *   modalOpen           bool              controlled modal
 *                        visibility. Caller flips this true
 *                        when launching the mode picker.
 *   onModalClose        () => void        called when the
 *                        modal dismisses (mode select, ESC,
 *                        backdrop click).
 *   onCampaignsChanged  (Campaign) =>     called after every
 *                        successful lane handler with the
 *                        updated campaign so the parent can
 *                        merge it into its local slice.
 */
export default function CampaignLanes({
  activeSpokesperson = null,
  linkedCampaigns = [],
  campaigns = null,
  modalOpen = false,
  onModalClose,
  onCampaignsChanged,
  // PR DA — campaign-selection state lifted to the workspace.
  selectedCampaignId = null,
  creatingNewCampaign = false,
  onSelectCampaign = null,
  onCancelCreateCampaign = null,
  // PR DA (Demo Pillars) — characters slice for the Dialogue
  // Scene speaker dropdowns. Workspace already loads this for
  // its own header / library use; we just pass it through.
  availableCharacters = [],
}) {
  const [activeMode, setActiveModeState] = useState(() => getActiveMode())

  const handleSelectMode = (mode) => {
    persistActiveMode(mode)
    setActiveModeState(mode)
    onModalClose?.()
  }
  const handleDismissActiveMode = () => {
    clearActiveMode()
    setActiveModeState(null)
  }

  // PR EG-3 — Reset active mode when the operator switches to a
  // different campaign. Without this the active mode was sticky
  // across campaign switches, so clicking from a Dialogue Scene
  // campaign to a Spokesperson Ad campaign left the Dialogue lane
  // mounted on a campaign that had no dialogue lines. Operator
  // expectation (verified by Chris's bug report): each campaign
  // click should land on the mode picker so the operator picks
  // what to do with this campaign.
  //
  // Guarded so the initial mount transition (null → first selected
  // campaign via auto-select-newest) doesn't clear a mode the
  // operator just freshly picked. Only fires when BOTH the previous
  // and current ids are non-null and different.
  const prevSelectedRef = useRef(selectedCampaignId)
  useEffect(() => {
    const prev = prevSelectedRef.current
    if (prev && selectedCampaignId && prev !== selectedCampaignId) {
      clearActiveMode()
      setActiveModeState(null)
    }
    prevSelectedRef.current = selectedCampaignId
  }, [selectedCampaignId])

  // PR CE — every successful handler hands the updated
  // Campaign to the parent so the workspace's local slice stays
  // in sync without re-fetching. Failures bubble up to the
  // lane component which renders them inline.
  const propagate = (updated) => {
    if (updated) onCampaignsChanged?.(updated)
    return updated
  }

  // PR DQ — toast surface for render-completion feedback. Each
  // handler that completes a long-running operation (any render
  // or stitch) pushes a positive toast so the operator sees the
  // result land even when their eyes are on another tab.
  // PR DR — error toasts on the rejection path so an interrupted
  // / failed render flashes red top-right too (was only inline-
  // erroring inside the lane, easy to miss).
  const { push: pushToast } = useToast()
  const announce = (message, kind = 'success') => {
    try {
      pushToast(message, { kind })
    } catch {
      // ToastProvider should always be mounted by the workspace,
      // but if a future caller drops the provider we don't want a
      // toast push to break the actual handler. Silent fallback.
    }
  }
  // PR DR — small helper that runs the handler, fires the success
  // toast on resolve, fires an error toast + re-throws on reject
  // (so the lane's inline error UI still shows + the operator
  // gets a second signal). Keeps the per-handler bodies tidy.
  const withRenderToast = async (
    successMessage, errorPrefix, work,
  ) => {
    try {
      const updated = await work()
      const msg = typeof successMessage === 'function'
        ? successMessage(updated)
        : successMessage
      announce(msg, 'success')
      return updated
    } catch (e) {
      const detail = e?.message ? String(e.message) : 'unknown error'
      announce(`${errorPrefix} ${detail}`, 'error')
      throw e
    }
  }

  const handleBuildSpokespersonReels = async (campaignId) => {
    if (!campaignId) throw new Error('campaign id required')
    return withRenderToast(
      'Captioned Reel exported — see Videos tab.',
      'Reel export failed:',
      async () => propagate(await api.buildSpokespersonReels(campaignId)),
    )
  }
  const handleBuildVoicedCinematic = async (campaignId) => {
    if (!campaignId) throw new Error('campaign id required')
    return withRenderToast(
      'Voiced Cinematic Ad built — see Videos tab.',
      'Voiced cinematic failed:',
      async () => propagate(await api.buildCommercialWithVoice(campaignId)),
    )
  }
  const handleGenerateSpokespersonAd = async (campaignId, options = {}) => {
    if (!campaignId) throw new Error('campaign id required')
    // PR DC — operator-selected variant_id flows through to the
    // backend so the appended OutputRecord captures variant_id +
    // variant_title. Backend honours `body.variant_id` even if
    // `script_override` is also passed.
    const body = {}
    if (options.variantId) body.variant_id = options.variantId
    return withRenderToast(
      'Spokesperson Ad rendered — see Videos tab.',
      'Spokesperson Ad render failed:',
      async () => propagate(await api.generateSpokespersonAd(campaignId, body)),
    )
  }
  // PR EF — DaVinci Resolve polish. Routes the campaign's existing
  // Spokesperson Ad MP4 through the operator's hand-built Resolve
  // template (color grade + transitions + Fusion titles + music
  // bed). Local-only — 503 surfaces as an "is Resolve running?"
  // error in the toast. Render time is bounded by Resolve's render
  // queue speed (~30-90s for a short ad on a modern Mac).
  const handleRenderViaResolve = async (campaignId) => {
    if (!campaignId) throw new Error('campaign id required')
    return withRenderToast(
      '🎬 Resolve polish rendered — see Videos tab.',
      'Resolve render failed:',
      async () => propagate(await api.renderViaResolve(campaignId)),
    )
  }
  // PR DO — Long Spokesperson Ad. Backend chunks the script,
  // renders each chunk via avatar_videos, and stitches into one
  // MP4. One OutputRecord (kind=long_spokesperson_ad) appended.
  const handleGenerateLongSpokespersonAd = async (
    campaignId, { script, variantId } = {},
  ) => {
    if (!campaignId) throw new Error('campaign id required')
    if (!script || !String(script).trim()) {
      throw new Error('long ad script is required')
    }
    const body = { script: String(script).trim() }
    if (variantId) body.variant_id = variantId
    return withRenderToast(
      (updated) => {
        // Pull chunk_count + duration_estimate off the freshly
        // appended OutputRecord so the toast announces real
        // numbers instead of a generic "rendered" message.
        const newest = Array.isArray(updated?.outputs)
          ? updated.outputs.find((o) => o.kind === 'long_spokesperson_ad')
          : null
        const chunks = newest?.chunk_count
        const seconds = newest?.duration_estimate
        const detail = (chunks && seconds)
          ? ` (${chunks} clips · ~${seconds}s)`
          : ''
        return `Long Spokesperson Ad rendered${detail} — see Videos tab.`
      },
      'Long Ad render failed:',
      async () => propagate(
        await api.generateLongSpokespersonAd(campaignId, body),
      ),
    )
  }
  const handleUpsertAdVariant = async (campaignId, payload) => {
    if (!campaignId) throw new Error('campaign id required')
    return propagate(await api.upsertAdVariant(campaignId, payload))
  }
  const handleStitchStoryboard = async (campaignId) => {
    if (!campaignId) throw new Error('campaign id required')
    return withRenderToast(
      'Storyboard stitched — see Videos tab.',
      'Storyboard stitch failed:',
      async () => propagate(await api.stitchStoryboard(campaignId)),
    )
  }
  const handlePlanDialogue = async (campaignId, mode = 'reset') => {
    if (!campaignId) throw new Error('campaign id required')
    return propagate(await api.planDialogue(campaignId, mode))
  }
  const handleStitchDialogue = async (campaignId) => {
    if (!campaignId) throw new Error('campaign id required')
    return withRenderToast(
      'Final Scene stitched — see Videos tab.',
      'Stitch failed:',
      async () => propagate(await api.stitchDialogue(campaignId)),
    )
  }
  const handleBuildDialogueReels = async (campaignId) => {
    if (!campaignId) throw new Error('campaign id required')
    return withRenderToast(
      'Captioned Reel exported — see Videos tab.',
      'Reel export failed:',
      async () => propagate(await api.buildDialogueSceneReels(campaignId)),
    )
  }
  // PR DA (Demo Pillars) — per-line save + generate. Backend
  // routes already exist (POST /dialogue/line/{line_id} +
  // /dialogue/generate-line/{line_id}); these wrappers propagate
  // the updated Campaign to the workspace's local slice so the
  // lane's line list re-renders against fresh status pills.
  const handleSaveDialogueLine = async (campaignId, lineId, body) => {
    if (!campaignId || !lineId) throw new Error('campaign + line id required')
    return propagate(await api.saveDialogueLine(campaignId, lineId, body))
  }
  const handleGenerateDialogueLine = async (campaignId, lineId) => {
    if (!campaignId || !lineId) throw new Error('campaign + line id required')
    const lineNum = String(lineId).replace(/^line-/, '')
    return withRenderToast(
      `Line ${lineNum} rendered — see Videos tab.`,
      `Line ${lineNum} render failed:`,
      async () => propagate(await api.generateDialogueLine(campaignId, lineId)),
    )
  }
  const handleUpdateBrief = async (campaignId, body) => {
    if (!campaignId) throw new Error('campaign id required')
    return propagate(await api.updateCampaignBrief(campaignId, body))
  }

  // PR CU — close the v2 lane dead-end. Build a minimal valid
  // CampaignCreate payload from the empty-state brief form, POST
  // it, then attach to the active spokesperson so the lane's
  // `linkedCampaigns` filter picks it up immediately. The
  // selected_concept / runway_prompt / social_post defaults are
  // *placeholders* — the legacy wizard refines them. The brief
  // editor surfaces the four fields the operator just typed for
  // continued editing.
  // PR DA — focused-campaign derivation lives here so the lane
  // (and the Cinematic / Dialogue siblings) all see the same
  // selected record. When `creatingNewCampaign` is true we
  // deliberately pass null so the lane mounts <LaneBriefCreator>
  // with blank fields.
  const focusedCampaign =
    !creatingNewCampaign && selectedCampaignId
      ? linkedCampaigns.find((c) => c.id === selectedCampaignId) || null
      : null

  const handleCreateCampaign = async ({ business, product = '', audience = '', tone = '' } = {}) => {
    if (!activeSpokesperson?.id) {
      throw new Error('active spokesperson required to attach the new campaign')
    }
    const trimmedBusiness = String(business || '').trim()
    if (!trimmedBusiness) {
      throw new Error('business / campaign name is required')
    }
    const trimmedProduct = String(product || '').trim()
    const trimmedAudience = String(audience || '').trim()
    const trimmedTone = String(tone || '').trim()
    const payload = {
      business: trimmedBusiness,
      product: trimmedProduct,
      audience: trimmedAudience,
      tone: trimmedTone,
      selected_concept: {
        title: trimmedBusiness,
        hook: trimmedAudience || `Meet ${trimmedBusiness}.`,
        visual: trimmedProduct || trimmedBusiness,
        caption: trimmedProduct || trimmedBusiness,
        cta: 'Learn more',
      },
      runway_prompt: `A polished commercial visual for ${trimmedBusiness}${trimmedProduct ? ` featuring ${trimmedProduct}` : ''}.`,
      social_post: {
        caption: trimmedProduct || trimmedBusiness,
        cta: 'Learn more',
        hashtags: [],
      },
    }
    const created = await api.saveCampaign(payload)
    let final = created
    try {
      final = await api.attachCharacter(created.id, activeSpokesperson.id)
    } catch (e) {
      // Attach failure is recoverable — campaign exists, lane just
      // won't see it via the character_id filter. Surface the error
      // so the operator can retry.
      throw new Error(`Campaign ${created.id} saved but attach failed: ${e?.message || e}`)
    }
    propagate(final)
    // PR DA — newly-created campaign becomes the selected one so
    // the lane immediately re-mounts in editor mode against the
    // record the operator just wrote.
    if (final?.id) onSelectCampaign?.(final.id)
    return final
  }

  // PR CU — Save commercial script inline so Step 2 has a real
  // CTA. Backend route already exists (PR AA — `/script`); this
  // just wires it into the lane.
  const handleSaveScript = async (campaignId, script) => {
    if (!campaignId) throw new Error('campaign id required')
    return propagate(await api.saveCommercialScript(campaignId, script))
  }

  // PR BT + PR BU — start + poll + persist for the cinematic
  // video. Polling matches v1 `App.handleGenerateVideo` exactly.
  const handleGenerateCinematicVideo = async (campaignId, onProgress) => {
    if (!campaignId) throw new Error('campaign id required')
    const haystack = Array.isArray(campaigns) && campaigns.length > 0
      ? campaigns
      : linkedCampaigns
    const camp = haystack.find((x) => x.id === campaignId)
    if (!camp) throw new Error('campaign not found in local slice')
    const promptText = (camp.runway_prompt || '').trim()
    if (!promptText) {
      throw new Error('This campaign has no saved prompt — re-save it in the legacy wizard before regenerating.')
    }
    const referenceImage = (camp.reference_image_url || '').trim() || null
    const start = await api.startRunway({
      prompt_text: promptText,
      prompt_image: referenceImage,
      duration: 5,
      ratio: '1280:720',
      model: camp.runway_model || 'gen4_turbo',
    })
    onProgress?.({ phase: 'started', task: start })
    const finalTask = await new Promise((resolve, reject) => {
      let attempts = 0
      const tick = async () => {
        attempts += 1
        let t
        try {
          t = await api.pollRunway(start.task_id)
        } catch (e) {
          reject(e)
          return
        }
        onProgress?.({ phase: 'polling', task: t, attempts })
        const terminal = ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(t.status)
        if (terminal) {
          if (t.status === 'SUCCEEDED') {
            resolve(t)
          } else {
            reject(new Error(t.failure_reason || t.status))
          }
          return
        }
        if (attempts >= POLL_MAX_ATTEMPTS) {
          reject(new Error('polling timed out at the 5-min cap'))
          return
        }
        const jitter = Math.random() * 800
        setTimeout(tick, POLL_INTERVAL_MS + jitter)
      }
      tick()
    })
    const outputUrl =
      Array.isArray(finalTask?.output) && finalTask.output.length > 0
        ? String(finalTask.output[0] || '').trim()
        : ''
    if (outputUrl) {
      onProgress?.({ phase: 'persisting', task: finalTask })
      try {
        const updatedCampaign = await api.persistCinematicVideo(
          campaignId,
          outputUrl,
        )
        propagate(updatedCampaign)
        onProgress?.({
          phase: 'persisted',
          task: finalTask,
          campaign: updatedCampaign,
        })
        return { task: finalTask, campaign: updatedCampaign }
      } catch (persistErr) {
        onProgress?.({
          phase: 'persist-failed',
          task: finalTask,
          error: persistErr,
        })
        return { task: finalTask, campaign: null, persistError: persistErr }
      }
    }
    return { task: finalTask, campaign: null }
  }

  return (
    <section
      data-testid="campaign-lanes"
      data-active-mode={activeMode || ''}
      className="space-y-3"
    >
      {/* Selected-mode pill + dismiss link. Mirrors PR BH /
          PR BI shape; only renders after the operator has
          chosen a mode. */}
      {activeMode && (
        <div
          data-testid="campaign-lanes-active-mode"
          data-mode={activeMode}
          className="rounded-lg ring-1 ring-pink-400/30 bg-pink-500/5 p-2.5 flex items-center justify-between gap-2 flex-wrap"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[11px] rounded-full px-2 py-0.5 font-mono ${
                MODE_PILL_CLASSES[activeMode] ||
                'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700'
              }`}
              title={`localStorage.adspark.activeMode = "${activeMode}"`}
            >
              {MODE_LABELS[activeMode] || activeMode}
            </span>
            <span className="text-[11px] text-zinc-300">
              {activeMode === CAMPAIGN_MODES.SPOKESPERSON && (
                <>
                  <span className="font-semibold">Spokesperson Ad lane open.</span>{' '}
                  Lip-synced talking-avatar render + reels export below.
                </>
              )}
              {activeMode === CAMPAIGN_MODES.CINEMATIC && (
                <>
                  <span className="font-semibold">Cinematic Ad lane open.</span>{' '}
                  Silent visual cut + voiced cinematic + storyboard targets below.
                </>
              )}
              {activeMode === CAMPAIGN_MODES.DIALOGUE && (
                <>
                  <span className="font-semibold">Dialogue Scene lane open.</span>{' '}
                  Multi-character stitched skit + reels targets below.
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDismissActiveMode}
            data-testid="campaign-lanes-active-mode-dismiss"
            className="text-[10px] text-zinc-500 hover:text-pink-300 underline-offset-2 hover:underline"
            title="Clear the locally-stored campaign mode."
          >
            dismiss
          </button>
        </div>
      )}

      {activeMode === CAMPAIGN_MODES.SPOKESPERSON && (
        <SpokespersonLane
          activeSpokesperson={activeSpokesperson}
          linkedCampaigns={linkedCampaigns}
          onBuildReels={handleBuildSpokespersonReels}
          onGenerateSpokesperson={handleGenerateSpokespersonAd}
          onGenerateLongSpokesperson={handleGenerateLongSpokespersonAd}
          onRenderViaResolve={handleRenderViaResolve}
          onUpdateBrief={handleUpdateBrief}
          onCreateCampaign={handleCreateCampaign}
          onSaveScript={handleSaveScript}
          onUpsertAdVariant={handleUpsertAdVariant}
          focusedCampaign={focusedCampaign}
          creatingNew={creatingNewCampaign}
          onCancelCreate={onCancelCreateCampaign}
        />
      )}
      {activeMode === CAMPAIGN_MODES.CINEMATIC && (
        <CinematicLane
          activeSpokesperson={activeSpokesperson}
          linkedCampaigns={linkedCampaigns}
          onBuildVoicedCinematic={handleBuildVoicedCinematic}
          onStitchStoryboard={handleStitchStoryboard}
          onGenerateCinematicVideo={handleGenerateCinematicVideo}
          onUpdateBrief={handleUpdateBrief}
          onCreateCampaign={handleCreateCampaign}
          focusedCampaign={focusedCampaign}
        />
      )}
      {activeMode === CAMPAIGN_MODES.DIALOGUE && (
        <DialogueLane
          activeSpokesperson={activeSpokesperson}
          linkedCampaigns={linkedCampaigns}
          onPlanDialogue={handlePlanDialogue}
          onStitchDialogue={handleStitchDialogue}
          onBuildDialogueReels={handleBuildDialogueReels}
          onUpdateBrief={handleUpdateBrief}
          onCreateCampaign={handleCreateCampaign}
          onSaveDialogueLine={handleSaveDialogueLine}
          onGenerateDialogueLine={handleGenerateDialogueLine}
          availableCharacters={availableCharacters}
          focusedCampaign={focusedCampaign}
        />
      )}

      <CampaignModeModal
        isOpen={modalOpen}
        onSelect={handleSelectMode}
        onClose={onModalClose}
      />
    </section>
  )
}
