import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api'
import { friendlyError } from '../errors'
import {
  CAMPAIGN_MODES,
  clearActiveMode,
  getActiveMode,
  setActiveMode,
} from '../uxFlag.js'
import CampaignModeModal from './CampaignModeModal.jsx'
import CreateSpokespersonFlow from './CreateSpokespersonFlow.jsx'
import SpokespersonCard from './SpokespersonCard.jsx'
import CinematicLane from './lanes/CinematicLane.jsx'
import DialogueLane from './lanes/DialogueLane.jsx'
import SpokespersonLane from './lanes/SpokespersonLane.jsx'

// PR BH — operator-friendly labels per campaign mode. Backend has
// no schema for these yet; selection lives in localStorage until
// PR BJ–BL ship the lane-specific builders.
const MODE_LABELS = {
  [CAMPAIGN_MODES.CINEMATIC]: 'Cinematic Ad',
  [CAMPAIGN_MODES.SPOKESPERSON]: 'Spokesperson Ad',
  [CAMPAIGN_MODES.DIALOGUE]: 'Dialogue Scene',
}

const MODE_PILL_CLASSES_V2 = {
  [CAMPAIGN_MODES.CINEMATIC]:
    'bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/40',
  [CAMPAIGN_MODES.SPOKESPERSON]:
    'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40',
  [CAMPAIGN_MODES.DIALOGUE]:
    'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40',
}

/**
 * PR BE — SpokespersonStudio (gated v2 surface).
 *
 * First spokesperson-first surface from the SESSION_035 plan. Reads
 * the same `GET /api/characters` data the legacy CharacterStudio
 * uses; renders each record as a `SpokespersonCard` (which embeds
 * the existing CharacterCard inside an Identity tab so v1 voice
 * affordances stay intact).
 *
 * Backend untouched. Mock-mode demos still work end-to-end. The
 * v1 CharacterStudio panel remains the default render path —
 * App.jsx swaps in this component only when `isUxV2()` is true.
 *
 * Future PRs (BF / BG) wire the Knowledge + Appearances tabs.
 * Future PRs (BH+) replace the Stage 1-4 brief flow with a
 * mode-first creation modal launched from this surface.
 */
export default function SpokespersonStudio({
  onCharactersChanged,
  // PR U — Spokesperson-first flow: parent owns the active-character
  // state. Tile gets an "active" pill + a "Use as Spokesperson" button.
  activeCharacterId = null,
  onSetActive,
  // PR BR — v2 Appearances click-through. Parent (App.jsx)
  // owns the openCampaignId target state; the studio fires this
  // callback with a campaign id when the operator clicks "Open
  // in gallery" on an Appearances row.
  onOpenCampaign,
  // PR CD — Home Library Only. Parent passes `true` to hide
  // the campaign-creation surfaces (the global "+ New
  // Campaign" button, the selected-mode pill, the lane mounts,
  // and the CampaignModeModal). The Library route on `/` uses
  // this so the homepage reads as "library only" — the
  // dedicated /spokespeople/:id workspace owns campaign
  // creation now. Defaults to `false` for backwards compat
  // (any other caller still gets PR BH/BI/BK/BL behaviour).
  hideCampaignControls = false,
}) {
  // PR CL — needed so the multi-step Create Spokesperson flow
  // can hand off to /spokespeople/{id} when the operator
  // checks "Start a campaign" on Step 4. The workspace's own
  // mount effect (PR CL too) reads `adspark.startCampaignHint`
  // and finishes the round-trip by opening the mode modal.
  const navigate = useNavigate()
  const [characters, setCharacters] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')
  const [busyByChar, setBusyByChar] = useState({})
  // PR BH — mode-first creation modal state. Modal opens on
  // "+ New Campaign" click; selecting a mode persists it via
  // setActiveMode (localStorage) and closes the modal. The
  // resulting selection drives a "Selected mode" pill + a
  // placeholder banner explaining lane components ship next.
  const [modeModalOpen, setModeModalOpen] = useState(false)
  const [activeMode, setActiveModeState] = useState(() => getActiveMode())

  // PR BR — Click-through status banner. Set when the operator
  // clicks an Appearances row's "Open in gallery →"; auto-clears
  // after 2.5 s so the banner never stays stale.
  const [openStatus, setOpenStatus] = useState({
    campaignId: null,
    label: '',
    mode: null,
  })
  useEffect(() => {
    if (!openStatus.campaignId) return undefined
    const t = setTimeout(
      () => setOpenStatus({ campaignId: null, label: '', mode: null }),
      2_500,
    )
    return () => clearTimeout(t)
  }, [openStatus.campaignId])
  const handleOpenCampaign = (campaignId, inferredMode = null) => {
    if (!campaignId) return
    // PR BS — bubble the inferred mode up so App.jsx can resolve
    // a target tab inside the saved CampaignCard (cinematic →
    // visuals, spokesperson → character, dialogue → dialogue,
    // realtime → realtime, mixed/draft → overview, storyboard →
    // visuals).
    onOpenCampaign?.(campaignId, inferredMode)
    const match = campaigns.find((x) => x.id === campaignId)
    const label = match?.business || `campaign ${String(campaignId).slice(0, 6)}`
    setOpenStatus({ campaignId, label, mode: inferredMode })
  }

  // PR BF — fetch campaigns alongside characters so the Knowledge
  // tab on each SpokespersonCard can render grounding + transcript
  // state for every campaign that links to that spokesperson via
  // ``character_id``. No new backend route — same `GET /api/campaigns`
  // the rest of the app already reads.
  const refresh = async () => {
    try {
      const [charsResp, campsResp] = await Promise.all([
        api.listCharacters(),
        api.listCampaigns(),
      ])
      setCharacters(charsResp.characters || [])
      setCampaigns(campsResp.campaigns || [])
      setErrMsg('')
    } catch (e) {
      setErrMsg(friendlyError(e, 'Couldn’t load spokespeople'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PR BF — index campaigns by character_id once per render so each
  // card receives only its own linked campaigns. Keeps the Knowledge
  // tab's filter logic out of the per-card render path.
  const campaignsByCharacter = (campaigns || []).reduce((acc, c) => {
    const key = c.character_id
    if (!key) return acc
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  const setBusy = (id, action) =>
    setBusyByChar((m) => ({ ...m, [id]: action }))
  const clearBusy = (id) =>
    setBusyByChar((m) => {
      const { [id]: _ignored, ...rest } = m
      return rest
    })

  // Handlers mirror the v1 CharacterStudio behaviour so every voice
  // affordance keeps working when the SpokespersonCard embeds the
  // legacy CharacterCard. Each handler updates the character in
  // place so the embedded card re-renders immediately.

  const handleGeneratePortrait = async (c) => {
    setBusy(c.id, 'portrait')
    try {
      const updated = await api.generateCharacterPortrait(c.id, {})
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Portrait failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  const handleCreateAvatar = async (c) => {
    setBusy(c.id, 'avatar')
    try {
      const updated = await api.createCharacterAvatar(c.id, {})
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Avatar create failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  const handleCloneVoice = async (c, file) => {
    setBusy(c.id, 'voice-clone')
    try {
      const updated = await api.cloneCharacterVoice(c.id, file)
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Voice clone failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  const handleApplyVoiceToAvatar = async (c, mode) => {
    setBusy(c.id, 'voice-apply')
    try {
      const updated = await api.applyCharacterVoiceToAvatar(c.id, mode)
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Voice apply failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  const handleRefreshAvatarVoice = async (c) => {
    setBusy(c.id, 'voice-refresh')
    try {
      const updated = await api.refreshCharacterAvatarVoice(c.id)
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Refresh avatar status failed for ${c.name}`))
      throw e
    } finally {
      clearBusy(c.id)
    }
  }

  const handleRefreshVoicePreview = async (c) => {
    setBusy(c.id, 'voice-preview-refresh')
    try {
      const updated = await api.refreshCharacterVoicePreview(c.id)
      setCharacters((cs) => cs.map((x) => (x.id === c.id ? updated : x)))
      onCharactersChanged?.()
      return updated
    } catch (e) {
      setErrMsg(friendlyError(e, `Refresh voice preview failed for ${c.name}`))
      throw e
    } finally {
      clearBusy(c.id)
    }
  }

  // PR BN — Spokesperson Reels submit handler. First v2 lane
  // action that fires real production behaviour (ffmpeg-only;
  // no Runway calls). Local campaigns slice is updated in place
  // so the lane re-renders with the freshly-cached
  // spokesperson_reels_url; parent's onCharactersChanged also
  // fires so the v1 gallery refreshes alongside if open.
  const handleBuildSpokespersonReels = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.buildSpokespersonReels(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BO — Voiced Cinematic submit handler. Mirrors the PR BN
  // shape: ffmpeg-only mux of the silent cinematic visual cut +
  // the avatar host clip's audio (PR S/X). Updates the campaigns
  // slice in place + bubbles onCharactersChanged. No Runway
  // calls.
  const handleBuildVoicedCinematic = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.buildCommercialWithVoice(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BP — Generate Real Spokesperson Ad. Burns Runway credits:
  // POST /spokesperson-ad → creates an avatar_videos task, polls
  // until READY (route is sync end-to-end; ~30-60 s). Updates
  // local campaigns slice on success.
  //
  // ⚠️ This is the only PR BP handler that actually fires real
  // Runway. The other four wires (storyboard stitch, dialogue
  // plan/stitch, dialogue reels) are ffmpeg-only or
  // template-driven planning with no upstream cost.
  const handleGenerateSpokespersonAd = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.generateSpokespersonAd(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BT — Generate Real Cinematic Video. Burns Runway credits:
  // POST /api/runway/generate fires `image_to_video` (or
  // `text_to_video` when no reference image), then we poll
  // /api/runway/task/{id} until SUCCEEDED / FAILED / CANCELED.
  // Uses the saved campaign's `runway_prompt` + optional
  // `reference_image_url` + `runway_model` so the lane re-renders
  // the same cinematic visual the operator set up at create time
  // — no inline prompt edit (today).
  //
  // Polling matches v1 App.handleGenerateVideo exactly:
  //   POLL_INTERVAL_MS = 5000  (+ jitter up to 800 ms)
  //   POLL_MAX_ATTEMPTS = 60   (≈ 5 min cap)
  //   terminal = SUCCEEDED | FAILED | CANCELED
  // No infinite loops; cap-on-attempts guarantees termination.
  //
  // PR BU — after polling resolves SUCCEEDED, the resulting
  // output[0] URL is persisted onto the campaign via the new
  // POST /api/campaigns/{id}/cinematic-video route. The backend
  // downloads it (VideoCache.fetch) + flips cached_video_url to
  // /api/campaigns/{id}/video so the v1 gallery's existing
  // player picks it up unchanged on reload. The local
  // `campaigns` slice is updated in place + onCharactersChanged
  // bubbles so the v1 gallery refreshes alongside if open.
  //
  // ⚠️ Real Runway credits per click (mock mode short-circuits
  // to a fast-resolving SUCCEEDED in the same shape; in mock
  // mode the persist call may 502 if the fake URL doesn't
  // resolve to a video — that's a status the lane surfaces
  // without losing the SUCCEEDED task).
  const handleGenerateCinematicVideo = async (campaignId, onProgress) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const camp = campaigns.find((x) => x.id === campaignId)
    if (!camp) {
      throw new Error('campaign not found in local slice')
    }
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
        if (attempts >= 60) {
          reject(new Error('polling timed out at the 5-min cap'))
          return
        }
        const jitter = Math.random() * 800
        setTimeout(tick, 5000 + jitter)
      }
      tick()
    })
    // PR BU — persist the SUCCEEDED output onto the campaign.
    // Source URL must be present + a string we can pass to the
    // backend's VideoCache.fetch.
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
        setCampaigns((cs) =>
          cs.map((x) => (x.id === campaignId ? updatedCampaign : x)),
        )
        onCharactersChanged?.()
        onProgress?.({
          phase: 'persisted',
          task: finalTask,
          campaign: updatedCampaign,
        })
        return { task: finalTask, campaign: updatedCampaign }
      } catch (persistErr) {
        // Persist failure does not invalidate the SUCCEEDED task
        // — surface it as a `persist-failed` phase so the lane can
        // still link the fresh URL while showing the warning.
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

  // PR BP — Stitch Storyboard Commercial. ffmpeg-only concat
  // over the existing per-shot MP4s. Backend route 409s if any
  // shot's status !== 'ok'.
  const handleStitchStoryboard = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.stitchStoryboard(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BP — Plan Dialogue Lines. No Runway credits — sets up the
  // 3-line Hook/Beat/Closer structure on the Campaign so the
  // operator can edit + render lines individually via the
  // classic UX Dialogue tab. No-op when lines already exist
  // (server returns the same plan).
  const handlePlanDialogue = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.planDialogue(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BP — Stitch Dialogue Scene. ffmpeg-only concat with audio
  // preserved. Backend route 409s if any line's status !== 'ok'.
  const handleStitchDialogue = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.stitchDialogue(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BP — Build Captioned Dialogue Reels. ffmpeg-only pad +
  // per-line drawtext over the stitched scene MP4. Backend route
  // 409s if dialogue_scene_video_url is unset.
  const handleBuildDialogueReels = async (campaignId) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.buildDialogueSceneReels(campaignId)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BQ — Inline brief save. Patches business / product /
  // audience / tone via the new /brief route; updates the local
  // campaigns slice + bubbles onCharactersChanged so the v1
  // gallery refreshes alongside if open. No Runway calls; pure
  // storage mutation.
  const handleUpdateBrief = async (campaignId, body) => {
    if (!campaignId) {
      throw new Error('campaign id required')
    }
    const updated = await api.updateCampaignBrief(campaignId, body)
    setCampaigns((cs) =>
      cs.map((x) => (x.id === campaignId ? updated : x)),
    )
    onCharactersChanged?.()
    return updated
  }

  // PR BH — mode-first creation handlers.
  const handleOpenCreateModal = () => {
    setModeModalOpen(true)
  }
  const handleCloseCreateModal = () => {
    setModeModalOpen(false)
  }
  const handleSelectMode = (mode) => {
    setActiveMode(mode)          // localStorage persistence
    setActiveModeState(mode)     // local re-render trigger
    setModeModalOpen(false)
  }
  const handleDismissActiveMode = () => {
    clearActiveMode()
    setActiveModeState(null)
  }

  // PR CB — Create Spokesperson modal state. Mirrors PR BH's
  // mode modal pattern: visible boolean + open/close handlers
  // + a success callback that swaps the new character into the
  // local slice + activates it so the next "+ New Campaign"
  // already targets them.
  const [createOpen, setCreateOpen] = useState(false)
  const handleOpenCreateSpokesperson = () => setCreateOpen(true)
  const handleCloseCreateSpokesperson = () => setCreateOpen(false)
  // PR CK — onCreated signature extended to
  //   onCreated(character, { startCampaign }) => void
  // so the multi-step flow can opt the operator into navigating
  // straight to the new spokesperson's workspace with the mode
  // modal pre-opened. The options arg is optional; PR CB-era
  // callers that pass just a character keep working.
  const handleSpokespersonCreated = (created, options = {}) => {
    if (!created) {
      setCreateOpen(false)
      return
    }
    setCharacters((cs) => {
      // Replace if already present (portrait re-fetch fired
      // and returned the same id), otherwise prepend so the
      // new tile is visible on first scroll.
      const existing = cs.findIndex((x) => x.id === created.id)
      if (existing >= 0) {
        const next = cs.slice()
        next[existing] = created
        return next
      }
      return [created, ...cs]
    })
    onSetActive?.(created.id)
    onCharactersChanged?.()
    setCreateOpen(false)
    if (options.startCampaign) {
      // PR CK — the flow's "Start a campaign" checkbox flag.
      // Persist a hint in localStorage; the workspace mount
      // effect (PR CL) reads it on /spokespeople/{id} and
      // opens the mode modal in-place.
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(
            'adspark.startCampaignHint',
            created.id,
          )
        }
      } catch {
        // localStorage can throw in private modes; safe to ignore.
      }
      // PR CL — auto-navigate to the new spokesperson's
      // workspace so the hint lands on a mounted instance.
      // Without this the operator stays on /, the localStorage
      // hint sits unread, and the "Start a campaign" checkbox
      // feels broken.
      navigate(`/spokespeople/${encodeURIComponent(created.id)}`)
    }
  }

  const handleDelete = async (c) => {
    if (
      !confirm(
        `Delete spokesperson "${c.name}"? This is local only — the Runway avatar is not removed.`,
      )
    )
      return
    setBusy(c.id, 'delete')
    try {
      await api.deleteCharacter(c.id)
      setCharacters((cs) => cs.filter((x) => x.id !== c.id))
      onCharactersChanged?.()
    } catch (e) {
      setErrMsg(friendlyError(e, `Delete failed for ${c.name}`))
    } finally {
      clearBusy(c.id)
    }
  }

  return (
    <section
      className="rounded-2xl ring-1 ring-pink-400/15 bg-studio-900/60 p-5 space-y-3 shadow-panel"
      data-testid="spokesperson-studio"
      data-ux-mode="v2"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1.5 min-w-0">
          <h1
            className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2"
            data-testid="spokesperson-studio-heading"
          >
            Spokesperson Library
            <span
              className="text-[10px] rounded-full bg-zinc-800 text-zinc-300 px-2 py-0.5 font-mono"
              title="Reuses the existing /api/characters store; backend unchanged."
            >
              Runway-powered
            </span>
          </h1>
          {/* PR CB — product sentence pinned per brief copy. */}
          <p
            data-testid="spokesperson-library-tagline"
            className="text-xs text-zinc-400 max-w-prose leading-relaxed"
          >
            Create persistent AI spokespeople that star in ads, hold
            conversations, and carry campaign memory.
          </p>
          {/* PR CB — Stats row. PR CO — counts now scope to
              **live-linked** campaigns only (campaigns whose
              `character_id` resolves to a record in the local
              characters slice). SESSION 070 manual QA caught
              the un-scoped variant claiming "6 linked
              campaigns / 46 cached outputs" while the
              workspace surfaced 0 — the orphans were inflating
              the library headline numbers. After PR CO the
              numbers reconcile with what an operator can
              actually click into. Each stat carries a stable
              testid + data-count attr the smoke can assert. */}
          {(() => {
            const liveCharacterIds = new Set(
              characters.map((c) => c.id),
            )
            const liveLinkedCampaigns = campaigns.filter(
              (c) =>
                Boolean(c.character_id) &&
                liveCharacterIds.has(c.character_id),
            )
            const totalSpokespeople = characters.length
            const totalLinkedCampaigns = liveLinkedCampaigns.length
            const totalOutputs = liveLinkedCampaigns.reduce((acc, c) => {
              let n = 0
              if (c.cached_video_url) n += 1
              if (c.host_video_url) n += 1
              if (c.voiced_commercial_url) n += 1
              if (c.storyboard_video_url) n += 1
              if (c.spokesperson_reels_url) n += 1
              if (c.dialogue_scene_video_url) n += 1
              if (c.dialogue_scene_reels_url) n += 1
              return acc + n
            }, 0)
            const totalTranscriptEntries = liveLinkedCampaigns.reduce(
              (acc, c) => {
                const list = Array.isArray(c.realtime_transcript_history)
                  ? c.realtime_transcript_history
                  : []
                return acc + list.length
              },
              0,
            )
            const stats = [
              {
                testid: 'library-stat-spokespeople',
                label: 'spokespeople',
                value: totalSpokespeople,
              },
              {
                testid: 'library-stat-linked-campaigns',
                label: 'linked campaigns',
                value: totalLinkedCampaigns,
              },
              {
                testid: 'library-stat-outputs',
                label: 'cached outputs',
                value: totalOutputs,
              },
              {
                testid: 'library-stat-transcripts',
                label: 'transcript entries',
                value: totalTranscriptEntries,
              },
            ]
            return (
              <div
                data-testid="library-stats-row"
                className="flex flex-wrap items-center gap-1.5 pt-1"
              >
                {stats.map((s) => (
                  <span
                    key={s.testid}
                    data-testid={s.testid}
                    data-count={s.value}
                    className="text-[10px] rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 text-zinc-300 px-2 py-0.5 font-mono"
                    title={`${s.value} ${s.label}`}
                  >
                    <span className="text-zinc-100 font-semibold">
                      {s.value}
                    </span>{' '}
                    <span className="text-zinc-500">{s.label}</span>
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
        {/* PR CB — primary CTAs row. "+ Create Spokesperson"
            (left, primary) opens the new CreateSpokespersonModal;
            "+ New Campaign" (right, secondary) keeps PR BH's
            mode-first creation flow. Both live on the homepage so
            the operator can branch into either creation path
            without scrolling into a tile. */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleOpenCreateSpokesperson}
            data-testid="library-create-spokesperson"
            className="rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-xs px-3 py-1.5 font-semibold transition-colors"
          >
            + Create Spokesperson
          </button>
          {/* PR CD — "+ New Campaign" only mounts when the
              parent allows campaign-creation surfaces. The
              Library route hides it (hideCampaignControls=true)
              so the homepage stays library-only; the
              SpokespersonWorkspace's own "+ New Campaign"
              button is the canonical entry point now. */}
          {!hideCampaignControls && (
            <button
              type="button"
              onClick={handleOpenCreateModal}
              data-testid="spokesperson-new-campaign"
              className="rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 ring-1 ring-zinc-700 text-xs px-3 py-1.5 transition-colors"
            >
              + New Campaign
            </button>
          )}
        </div>
      </div>

      {/* Selected mode pill + dismiss link. Renders only after the
          operator has chosen a mode in the modal. PR BI — when the
          mode is "spokesperson", the placeholder copy is replaced
          with a lane-open status string (the lane itself mounts
          below the pill). Other modes still show the original
          placeholder until their lanes ship in PR BJ–BK. */}
      {!hideCampaignControls && activeMode && (
        <div
          data-testid="spokesperson-active-mode"
          data-mode={activeMode}
          className="rounded-lg ring-1 ring-pink-400/30 bg-pink-500/5 p-2.5 flex items-center justify-between gap-2 flex-wrap"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[11px] rounded-full px-2 py-0.5 font-mono ${
                MODE_PILL_CLASSES_V2[activeMode] ||
                'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700'
              }`}
              title={`localStorage.adspark.activeMode = "${activeMode}"`}
            >
              {MODE_LABELS[activeMode] || activeMode}
            </span>
            <span className="text-[11px] text-zinc-300">
              {!hideCampaignControls && activeMode === CAMPAIGN_MODES.SPOKESPERSON && (
                <>
                  <span className="font-semibold">Spokesperson Ad lane open.</span>{' '}
                  Lip-synced talking-avatar render + reels export below.
                </>
              )}
              {!hideCampaignControls && activeMode === CAMPAIGN_MODES.CINEMATIC && (
                <>
                  <span className="font-semibold">Cinematic Ad lane open.</span>{' '}
                  Silent visual cut + voiced cinematic + storyboard targets below.
                </>
              )}
              {!hideCampaignControls && activeMode === CAMPAIGN_MODES.DIALOGUE && (
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
            data-testid="spokesperson-active-mode-dismiss"
            className="text-[10px] text-zinc-500 hover:text-pink-300 underline-offset-2 hover:underline"
            title="Clear the locally-stored campaign mode."
          >
            dismiss
          </button>
        </div>
      )}

      {/* PR BI — Spokesperson Ad lane scaffold. Mounts below the
          pill only when the operator has chosen the spokesperson
          mode. Receives the active spokesperson (set via PR U
          "Use as Spokesperson") + that spokesperson's linked
          campaigns indexed in this component. */}
      {!hideCampaignControls && activeMode === CAMPAIGN_MODES.SPOKESPERSON && (
        <SpokespersonLane
          activeSpokesperson={
            activeCharacterId
              ? characters.find((c) => c.id === activeCharacterId) || null
              : null
          }
          linkedCampaigns={
            activeCharacterId
              ? campaignsByCharacter[activeCharacterId] || []
              : []
          }
          // PR BN — wire the Captioned Reels button. Lane manages
          // its own busy / error state but bubbles the API call
          // up so the studio can keep the campaigns slice fresh.
          onBuildReels={handleBuildSpokespersonReels}
          // PR BP — wire the Horizontal button to the real
          // Runway avatar_videos route. Lane shows a credit-burn
          // warning + "Generate Real Spokesperson Ad" copy.
          onGenerateSpokesperson={handleGenerateSpokespersonAd}
          // PR BQ — wire Step 1 inline brief editor.
          onUpdateBrief={handleUpdateBrief}
        />
      )}
      {/* PR BK — Cinematic Ad lane scaffold. Same shape as the
          Spokesperson lane; mounts only when the operator has
          chosen the cinematic mode. */}
      {!hideCampaignControls && activeMode === CAMPAIGN_MODES.CINEMATIC && (
        <CinematicLane
          activeSpokesperson={
            activeCharacterId
              ? characters.find((c) => c.id === activeCharacterId) || null
              : null
          }
          linkedCampaigns={
            activeCharacterId
              ? campaignsByCharacter[activeCharacterId] || []
              : []
          }
          // PR BO — wire the Voiced Cinematic button. Same shape
          // as PR BN's onBuildReels; no Runway calls — ffmpeg
          // mux of cached visual + host clip audio.
          onBuildVoicedCinematic={handleBuildVoicedCinematic}
          // PR BP — wire the Storyboard Commercial button. ffmpeg
          // concat of cached per-shot MP4s; lane gates on every
          // shot status='ok'.
          onStitchStoryboard={handleStitchStoryboard}
          // PR BT — wire the Cinematic Video button to real
          // Runway image_to_video (start + poll). Burns credits.
          onGenerateCinematicVideo={handleGenerateCinematicVideo}
          // PR BQ — wire Step 1 inline brief editor.
          onUpdateBrief={handleUpdateBrief}
        />
      )}
      {/* PR BL — Dialogue Scene lane scaffold. Mirrors PR BI / PR BK
          shape; mounts only when the operator has chosen the
          dialogue mode. Cast list derives from
          `dialogue_lines[*]` on the focused campaign. */}
      {!hideCampaignControls && activeMode === CAMPAIGN_MODES.DIALOGUE && (
        <DialogueLane
          activeSpokesperson={
            activeCharacterId
              ? characters.find((c) => c.id === activeCharacterId) || null
              : null
          }
          linkedCampaigns={
            activeCharacterId
              ? campaignsByCharacter[activeCharacterId] || []
              : []
          }
          // PR BP — wire all three Dialogue lane buttons. Plan is
          // template-driven (no Runway credits); Stitch + Reels
          // are ffmpeg-only over existing per-line MP4s.
          onPlanDialogue={handlePlanDialogue}
          onStitchDialogue={handleStitchDialogue}
          onBuildDialogueReels={handleBuildDialogueReels}
          // PR BQ — wire Step 1 inline brief editor.
          onUpdateBrief={handleUpdateBrief}
        />
      )}

      {loading ? (
        <SpokespersonLibrarySkeleton />
      ) : characters.length === 0 ? (
        <div
          className="flex flex-col items-center text-center gap-3 py-8 px-4 rounded-xl ring-1 ring-pink-400/20 bg-pink-500/5"
          data-testid="spokesperson-empty-state"
        >
          <svg
            viewBox="0 0 64 64"
            aria-hidden="true"
            className="w-12 h-12 text-pink-300/70"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="32" cy="22" r="9" />
            <path d="M14 52c2-9 9-14 18-14s16 5 18 14" />
            <path d="M40 14l3-3M24 14l-3-3M32 11V7" />
          </svg>
          <div className="space-y-1">
            <div className="text-sm font-semibold text-zinc-200">
              No spokespeople yet
            </div>
            <p className="text-[11px] text-zinc-500 max-w-sm leading-relaxed">
              Click <span className="text-pink-300">+ Create
              Spokesperson</span> above to add the first one. Each
              spokesperson carries their own portrait, voice, and
              campaign history.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5"
          data-testid="spokesperson-library"
        >
          {characters.map((c) => (
            <SpokespersonCard
              key={c.id}
              character={c}
              isActive={c.id === activeCharacterId}
              // PR BF — only the campaigns linked to this character
              // via character_id; drives the campaign / output /
              // transcript count chips on the simplified PR CM tile.
              linkedCampaigns={campaignsByCharacter[c.id] || []}
            />
          ))}
        </div>
      )}

      {errMsg && (
        <p className="text-[10px] text-rose-300" title={errMsg}>
          {errMsg}
        </p>
      )}

      {/* PR BR — Click-through status banner. Renders only after
          the operator hits "Open in gallery →" on an Appearances
          row; auto-clears after 2.5 s. Confirms the jump landed
          on the right campaign. */}
      {openStatus.campaignId && (
        <p
          data-testid="spokesperson-open-status"
          data-campaign-id={openStatus.campaignId}
          data-mode={openStatus.mode || ''}
          className="text-[10px] text-emerald-300 font-mono leading-snug"
          role="status"
          aria-live="polite"
        >
          Opened campaign in gallery: {openStatus.label}
          {openStatus.mode ? ` · ${openStatus.mode} tab` : ''}.
        </p>
      )}

      {/* PR BH — mode-first creation modal. Mounted at the
          section level so backdrop clicks can dismiss without
          affecting the rest of the page; never renders when
          isOpen=false. PR CD — only mounts when campaign
          controls are allowed; the Library route hides this
          via `hideCampaignControls`. The
          `<SpokespersonWorkspace>` owns its own mode modal. */}
      {!hideCampaignControls && (
        <CampaignModeModal
          isOpen={modeModalOpen}
          onSelect={handleSelectMode}
          onClose={handleCloseCreateModal}
        />
      )}

      {/* PR CK — Multi-step Create Spokesperson flow. Replaces
          the PR CB lightweight modal with a 4-step stepper
          (Identity / Visual Direction / Voice / Generate) that
          captures the existing rich Character schema fields
          (personality, style, portrait_prompt, full 30 voice
          presets, metadata.audience_vibe). PR CJ portrait-failed
          retry/skip semantics preserved. Optional avatar bind +
          starter campaign hint via the extended onCreated
          signature. */}
      <CreateSpokespersonFlow
        isOpen={createOpen}
        onClose={handleCloseCreateSpokesperson}
        onCreated={handleSpokespersonCreated}
      />
    </section>
  )
}

/**
 * Pulsing tile placeholders rendered while the library loads.
 * Mirrors the v1 CharacterStudio loading skeleton so the v2 first
 * paint feels consistent.
 */
function SpokespersonLibrarySkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg p-2 space-y-1.5 ring-1 ring-zinc-800 bg-zinc-950/50"
          aria-hidden="true"
        >
          <div className="aspect-square w-full rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-2.5 w-3/4 rounded bg-zinc-800/60 animate-pulse" />
          <div className="h-2 w-1/2 rounded bg-zinc-800/40 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
