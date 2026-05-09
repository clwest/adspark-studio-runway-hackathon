import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import AvatarPicker from './AvatarPicker.jsx'
import CharacterCard from './CharacterCard.jsx'
import RealtimeSpokesperson from './RealtimeSpokesperson.jsx'

const PACK_FORMATS = [
  { key: 'landscape', label: 'Landscape', dims: '1280×720', hint: 'YouTube / web' },
  { key: 'reels', label: 'Reels', dims: '720×1280', hint: 'TikTok / Reels / Shorts' },
  { key: 'square', label: 'Square', dims: '960×960', hint: 'Instagram feed' },
]

const DUB_LANGS = [
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Mandarin' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ko', label: 'Korean' },
  { code: 'it', label: 'Italian' },
]

// PR P — UI Phase 2 — six tabs per saved-campaign card. Default is
// Overview. Order is locked: each tab body is rendered only when the
// tab is active (lazy in the sense that tab content lives inside an
// `&&` gate; React still re-renders the whole card tree, just doesn't
// mount the inactive bodies).
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'visuals', label: 'Visuals' },
  { key: 'character', label: 'Character' },
  { key: 'voice', label: 'Voice' },
  { key: 'realtime', label: 'Realtime' },
  { key: 'exports', label: 'Exports' },
]

function finishedUrlFor(c, fmt) {
  // Prefer the per-format dict introduced in PR B; fall back to the legacy
  // single-URL field for landscape only so old saves still display correctly.
  const map = c.finished_videos || {}
  if (map[fmt]) return map[fmt]
  if (fmt === 'landscape' && c.finished_video_url) return c.finished_video_url
  return null
}

function PackEntry({ c, fmt, label, dims, hint, onClick, busyFormat }) {
  const url = finishedUrlFor(c, fmt)
  const ready = Boolean(url)
  const isBusy = busyFormat === fmt
  return (
    <div className="rounded-lg ring-1 ring-zinc-800/80 bg-zinc-950/50 p-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200">{label}</span>
        <span className="text-[10px] text-zinc-500 font-mono">{dims}</span>
      </div>
      <span className="text-[10px] text-zinc-500">{hint}</span>
      {ready ? (
        <div className="flex items-center justify-between gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-spark hover:underline"
          >
            view ↗
          </a>
          <span className="text-[10px] rounded-full bg-violet-500/20 text-violet-300 px-2 py-0.5">
            ready
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onClick(fmt)}
          disabled={isBusy || Boolean(busyFormat)}
          className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50"
          title={`Build ${label} (${dims}) via ffmpeg — local, no provider call`}
        >
          {isBusy ? `Building ${label}…` : `Build ${label}`}
        </button>
      )}
    </div>
  )
}

/**
 * Status chip used by the Overview dashboard. Green when ready, amber
 * for partial / mock, neutral for "not yet". Single line of metadata
 * underneath. Replaces the wall of inline pills the pre-Phase-2 card
 * showed in its body.
 */
function OverviewChip({ label, status, hint }) {
  const tone =
    status === 'ready'
      ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'
      : status === 'partial' || status === 'mock'
      ? 'bg-amber-500/15 text-amber-300 ring-amber-500/40'
      : 'bg-zinc-800 text-zinc-500 ring-zinc-700'
  return (
    <div
      className={`rounded-lg ring-1 px-2.5 py-1.5 text-[11px] flex flex-col gap-0.5 ${tone}`}
      title={hint || ''}
    >
      <span className="font-semibold">{label}</span>
      {hint && <span className="text-[10px] opacity-80 truncate">{hint}</span>}
    </div>
  )
}

function CampaignCard({ c, onUpdated, onDeleted, isNewestSaved, onClearNewest }) {
  const concept = c.selected_concept || {}
  // Preview preference: any finished format → cached → original presigned URL.
  const finishedAnyUrl =
    finishedUrlFor(c, 'landscape') ||
    finishedUrlFor(c, 'reels') ||
    finishedUrlFor(c, 'square')
  const isCached = Boolean(c.cached_video_url)
  const videoSrc = finishedAnyUrl || c.cached_video_url || c.video_url || null
  const hasVideo = Boolean(videoSrc)
  const cacheFailed = c.cache_status === 'failed'

  // PR Y — the just-saved card opens on Visuals so the user lands on
  // the cached video + Voiced Commercial CTAs, not the dashboard.
  const [activeTab, setActiveTab] = useState(() =>
    isNewestSaved ? 'visuals' : 'overview',
  )
  const cardRef = useRef(null)
  // PR Y — scroll the just-saved card into view + clear the newest
  // marker after one frame so a later refresh doesn't re-scroll.
  useEffect(() => {
    if (!isNewestSaved || !cardRef.current) return
    cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [busyFormat, setBusyFormat] = useState(null) // null | "landscape" | "reels" | "square"
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [hostBusy, setHostBusy] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [busyDubLang, setBusyDubLang] = useState(null)
  const [commercialBusy, setCommercialBusy] = useState(false)  // PR S
  // PR Z — Storyboard Commercial Builder. busy flags scoped per
  // operation so multiple shot generations don't collide and the
  // stitch / voiced-storyboard buttons stay independently togglable.
  const [storyboardPlanBusy, setStoryboardPlanBusy] = useState(false)
  const [storyboardShotBusy, setStoryboardShotBusy] = useState(null) // shot id or null
  const [storyboardStitchBusy, setStoryboardStitchBusy] = useState(false)
  const [storyboardVoicedBusy, setStoryboardVoicedBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  // PR K — Character attach picker. Lazy-loaded; only shown when the
  // user clicks "Attach Character".
  const [attachPickerOpen, setAttachPickerOpen] = useState(false)
  const [characterLibrary, setCharacterLibrary] = useState([])
  const [characterLibraryLoaded, setCharacterLibraryLoaded] = useState(false)
  const [attachBusyId, setAttachBusyId] = useState(null)

  const voiceReady = ['ready', 'mock'].includes(c.brand_voice_status || '')
  const voiceFailed = c.brand_voice_status === 'failed'
  const voiceMock = c.brand_voice_status === 'mock'

  // PR K — character attachment wins over picker selection.
  // PR I+ — picker selection unlocks downstream features the same way
  // a created custom avatar does. Falls back to host_avatar_id when
  // no selection is in play.
  const hasCharacter = Boolean(c.character_id)
  const hasSelection = Boolean(c.selected_avatar_id)
  const customReady = ['ready', 'mock'].includes(c.host_avatar_status || '') && Boolean(c.host_avatar_id)
  const [character, setCharacter] = useState(null)
  const characterAvatarReady = character && ['ready', 'mock'].includes(character.runway_avatar_status || '')
  const avatarReady = characterAvatarReady || hasSelection || customReady
  const avatarFailed = !characterAvatarReady && !hasSelection && c.host_avatar_status === 'failed'
  const avatarMock = (
    (characterAvatarReady && character.runway_avatar_status === 'mock') ||
    (!characterAvatarReady && hasSelection && String(c.selected_avatar_id || '').startsWith('mock-')) ||
    (!characterAvatarReady && !hasSelection && c.host_avatar_status === 'mock')
  )

  // Lazy-load the attached character record. We avoid pulling all
  // characters globally — each card fetches its own.
  useEffect(() => {
    let cancelled = false
    if (!c.character_id) {
      setCharacter(null)
      return undefined
    }
    api
      .listCharacters()
      .then((resp) => {
        if (cancelled) return
        const found = (resp.characters || []).find((x) => x.id === c.character_id) || null
        setCharacter(found)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [c.character_id])
  const hostReady = c.host_status === 'ok' && Boolean(c.host_video_url)
  const hostFailed = c.host_status === 'failed'
  const hostUnavailable = c.host_status === 'unavailable'

  const cacheStatusLabel = isCached
    ? 'cached locally'
    : cacheFailed
    ? 'cache failed'
    : c.video_url
    ? 'external URL may expire'
    : null

  const finishUnavailable = c.finish_status === 'unavailable'
  const finishedCount = PACK_FORMATS.filter((f) => Boolean(finishedUrlFor(c, f.key))).length

  // PR S + PR X — Voiced Commercial derivations. PR X auto-generates
  // the Avatar Host Clip when missing if a Brand Spokesperson Avatar
  // is ready, so the gating UX needs to know about avatar availability,
  // not just host-clip availability.
  const commercialReady = c.voiced_commercial_status === 'ok' && Boolean(c.voiced_commercial_url)
  const commercialStatus = c.voiced_commercial_status || null
  const hostReadyForCommercial = c.host_status === 'ok' && Boolean(c.host_video_url)

  // PR Z — Storyboard Commercial Builder derivations. Mirrors the
  // PR S/X derivation shape so the gating UX is consistent.
  const storyboardShots = Array.isArray(c.storyboard_shots) ? c.storyboard_shots : []
  const storyboardPlanned = storyboardShots.length > 0
  const storyboardAllShotsReady =
    storyboardPlanned && storyboardShots.every((s) => s.status === 'ok')
  const storyboardReady =
    c.storyboard_status === 'ok' && Boolean(c.storyboard_video_url)
  const storyboardVoicedReady =
    c.storyboard_voiced_status === 'ok' && Boolean(c.storyboard_voiced_url)
  // Avatar resolution chain: character > selected > host_avatar_id.
  // PR X uses this to decide whether the Build Voiced Commercial
  // button is enabled (true if EITHER a host clip exists OR an avatar
  // exists that we can use to auto-create one).
  const hasUsableAvatar = Boolean(
    c.character_id || c.selected_avatar_id ||
    (c.host_avatar_id && ['ready', 'mock'].includes(c.host_avatar_status || '')),
  )
  const commercialBuildable = isCached && (hostReadyForCommercial || hasUsableAvatar)

  const handleBuild = async (fmt) => {
    setLocalError('')
    setBusyFormat(fmt)
    try {
      const updated = await api.finishCampaign(c.id, fmt)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`${fmt}: ${e}`)
    } finally {
      setBusyFormat(null)
    }
  }

  const handleDetachCharacter = async () => {
    setLocalError('')
    try {
      const updated = await api.attachCharacter(c.id, null)
      onUpdated?.(updated)
      setCharacter(null)
    } catch (e) {
      setLocalError(`detach character: ${e}`)
    }
  }

  const openAttachPicker = async () => {
    setAttachPickerOpen(true)
    if (characterLibraryLoaded) return
    try {
      const resp = await api.listCharacters()
      setCharacterLibrary(resp.characters || [])
      setCharacterLibraryLoaded(true)
    } catch (e) {
      setLocalError(`load characters: ${e}`)
    }
  }

  const handleAttachCharacter = async (target) => {
    if (!target) return
    setLocalError('')
    setAttachBusyId(target.id)
    try {
      const updated = await api.attachCharacter(c.id, target.id)
      onUpdated?.(updated)
      setCharacter(target)
      setAttachPickerOpen(false)
    } catch (e) {
      setLocalError(`attach character: ${e}`)
    } finally {
      setAttachBusyId(null)
    }
  }

  const handleCreateSpokesperson = async (opts = {}) => {
    setLocalError('')
    setAvatarBusy(true)
    try {
      const updated = await api.createSpokesperson(c.id, opts)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`avatar: ${e}`)
    } finally {
      setAvatarBusy(false)
    }
  }

  const handlePresent = async () => {
    setLocalError('')
    setHostBusy(true)
    try {
      const updated = await api.presentCampaign(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`host: ${e}`)
    } finally {
      setHostBusy(false)
    }
  }

  const handleDesignVoice = async (opts = {}) => {
    setLocalError('')
    setVoiceBusy(true)
    try {
      const updated = await api.designBrandVoice(c.id, opts)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`voice: ${e}`)
    } finally {
      setVoiceBusy(false)
    }
  }

  const handleDub = async (lang) => {
    setLocalError('')
    setBusyDubLang(lang)
    try {
      const updated = await api.dubBrandVoice(c.id, lang)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`dub ${lang}: ${e}`)
    } finally {
      setBusyDubLang(null)
    }
  }

  // PR S — Commercial with Voice. Combines silent visual cut + Avatar
  // Host Clip audio. Backend returns 409 with friendly copy when the
  // preconditions aren't met; we surface that copy verbatim so the
  // user knows whether to save the campaign, generate a host clip, or
  // both.
  const handleBuildCommercial = async () => {
    setLocalError('')
    setCommercialBusy(true)
    try {
      const updated = await api.buildCommercialWithVoice(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`commercial: ${e}`)
    } finally {
      setCommercialBusy(false)
    }
  }

  // PR Z — Storyboard Commercial Builder handlers.
  const handlePlanStoryboard = async () => {
    setLocalError('')
    setStoryboardPlanBusy(true)
    try {
      const updated = await api.planStoryboard(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`storyboard plan: ${e}`)
    } finally {
      setStoryboardPlanBusy(false)
    }
  }

  const handleGenerateStoryboardShot = async (shotId) => {
    setLocalError('')
    setStoryboardShotBusy(shotId)
    try {
      const updated = await api.generateStoryboardShot(c.id, shotId)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`storyboard ${shotId}: ${e}`)
    } finally {
      setStoryboardShotBusy(null)
    }
  }

  const handleStitchStoryboard = async () => {
    setLocalError('')
    setStoryboardStitchBusy(true)
    try {
      const updated = await api.stitchStoryboard(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`storyboard stitch: ${e}`)
    } finally {
      setStoryboardStitchBusy(false)
    }
  }

  const handleBuildVoicedStoryboard = async () => {
    setLocalError('')
    setStoryboardVoicedBusy(true)
    try {
      const updated = await api.buildVoicedStoryboard(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`voiced storyboard: ${e}`)
    } finally {
      setStoryboardVoicedBusy(false)
    }
  }

  const [deleting, setDeleting] = useState(false)
  const handleDelete = async () => {
    if (deleting) return
    const label = (c.business || c.id).slice(0, 60)
    if (!confirm(
      `Delete campaign "${label}"?\n\n` +
      'This removes the local record + cached files (video, Pack ' +
      'outputs, host clip, voice preview, dubs).\n\n' +
      'Runway-side resources (avatar id, voice id) are NOT touched ' +
      '— they remain reusable from the Avatar Picker.'
    )) return
    setLocalError('')
    setDeleting(true)
    try {
      await api.deleteCampaign(c.id)
      onDeleted?.(c.id)
    } catch (e) {
      setLocalError(`delete: ${e}`)
      setDeleting(false)
    }
  }

  // ---- Overview dashboard helpers ----------------------------------

  const spokespersonHint = hasCharacter && character
    ? `${character.name} · ${character.template}`
    : hasSelection
    ? c.selected_avatar_name || 'Selected avatar'
    : customReady
    ? 'Custom Brand Spokesperson'
    : 'no spokesperson yet'
  const spokespersonStatus = avatarReady
    ? avatarMock
      ? 'mock'
      : 'ready'
    : 'idle'

  const packStatus =
    finishedCount === 0 ? 'idle' : finishedCount < 3 ? 'partial' : 'ready'
  const packHint =
    finishedCount === 0
      ? 'no formats built yet'
      : `${finishedCount}/3 formats ready`

  const voiceStatus = voiceReady ? (voiceMock ? 'mock' : 'ready') : voiceFailed ? 'idle' : 'idle'
  const voiceHint = voiceReady
    ? voiceMock
      ? 'mock voice sample'
      : 'voice identity ready'
    : 'no voice identity yet'

  const realtimeStatus =
    avatarReady && !avatarMock ? 'ready' : avatarReady && avatarMock ? 'mock' : 'idle'
  const realtimeHint =
    avatarReady && !avatarMock
      ? 'session available'
      : avatarReady
      ? 'mock — real key required'
      : 'spokesperson required'

  // Single suggested next-action — drives the user across stages.
  // PR X — voiced-commercial CTA promoted ahead of Pack + Brand Voice
  // since the voiced ad is now the headline final artefact and PR X's
  // auto-host means the user can build it without first manually
  // generating the host clip.
  let nextActionLabel = null
  let nextActionTab = null
  if (!hasVideo) {
    nextActionLabel = 'Generate the visual ad first (Stage 2)'
  } else if (!hasUsableAvatar) {
    nextActionLabel = 'Choose spokesperson →'
    nextActionTab = 'character'
  } else if (!commercialReady) {
    nextActionLabel = 'Build voiced commercial →'
    nextActionTab = 'visuals'
  } else if (finishedCount < 3) {
    nextActionLabel = 'Build Campaign Pack →'
    nextActionTab = 'visuals'
  } else if (!hostReady) {
    nextActionLabel = 'Record Avatar Host Clip →'
    nextActionTab = 'character'
  } else if (!voiceReady) {
    nextActionLabel = 'Design Brand Voice Identity →'
    nextActionTab = 'voice'
  } else {
    nextActionLabel = null // all primary deliverables ready
  }

  // ---- Tab body builders -------------------------------------------

  // PR Y — short prompt preview surfaces what the user actually
  // generated so cards with the same business name stay distinguishable.
  const promptPreview = (c.runway_prompt || '').trim()
  const promptShort = promptPreview.length > 80
    ? `${promptPreview.slice(0, 80).trimEnd()}…`
    : promptPreview
  const spokespersonName = (hasCharacter && character && character.name) ||
    c.selected_avatar_name ||
    null

  const overviewBody = (
    <div className="space-y-3">
      {(promptShort || spokespersonName) && (
        <div className="rounded-md ring-1 ring-zinc-800/60 bg-zinc-950/40 px-2.5 py-1.5 text-[11px] space-y-0.5">
          {spokespersonName && (
            <div className="text-zinc-300">
              <span className="text-zinc-500">spokesperson:</span>{' '}
              <span className="text-pink-300">{spokespersonName}</span>
            </div>
          )}
          {promptShort && (
            <div
              className="text-zinc-400 leading-snug"
              title={promptPreview}
            >
              <span className="text-zinc-500">prompt:</span> {promptShort}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <OverviewChip
          label="Visual"
          status={hasVideo ? 'ready' : 'idle'}
          hint={hasVideo ? 'silent · cached' : 'no video yet'}
        />
        <OverviewChip
          label="Pack"
          status={packStatus}
          hint={packHint}
        />
        <OverviewChip
          label="Spokesperson"
          status={spokespersonStatus}
          hint={spokespersonHint}
        />
        <OverviewChip
          label="Host clip"
          status={hostReady ? (c.host_mock_mode ? 'mock' : 'ready') : 'idle'}
          hint={hostReady ? (c.host_mock_mode ? 'mock placeholder' : 'recorded') : 'not recorded'}
        />
        <OverviewChip
          label="Voice"
          status={voiceStatus}
          hint={voiceHint}
        />
        <OverviewChip
          label="Realtime"
          status={realtimeStatus}
          hint={realtimeHint}
        />
      </div>

      {nextActionLabel && (
        <div className="rounded-lg ring-1 ring-spark/30 bg-spark/5 p-2 text-xs flex items-center justify-between gap-2">
          <span className="text-zinc-300">
            <span className="text-spark font-semibold">Next:</span>{' '}
            {nextActionLabel}
          </span>
          {nextActionTab && (
            <button
              type="button"
              onClick={() => setActiveTab(nextActionTab)}
              aria-label={`Open ${nextActionTab} tab`}
              className="rounded-md bg-spark/80 hover:bg-spark text-ink text-[11px] font-semibold px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
            >
              go
            </button>
          )}
        </div>
      )}

      {!nextActionLabel && (
        <p className="text-[11px] text-zinc-500 italic">
          All primary deliverables ready — Pack, Spokesperson, Host
          Clip, Voice. Realtime conversation available in real mode.
        </p>
      )}
    </div>
  )

  const visualsBody = (
    <div className="space-y-3">
      {hasVideo ? (
        <div className="space-y-2">
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            preload="metadata"
            className="w-full rounded-lg ring-1 ring-zinc-800"
          />
          <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
            <a
              href={videoSrc}
              target="_blank"
              rel="noreferrer"
              className="text-spark hover:underline"
            >
              open video ↗
            </a>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[10px] rounded-full bg-zinc-800 text-zinc-300 px-2 py-0.5 font-mono"
                title="Runway gen4_turbo / gen4.5 produce the visual cut only. Spoken assets live in the Character + Voice tabs."
              >
                visual-only · silent
              </span>
              {cacheStatusLabel && (
                <span
                  className={
                    isCached
                      ? 'text-emerald-300'
                      : cacheFailed
                      ? 'text-rose-300'
                      : 'text-zinc-500'
                  }
                  title={
                    isCached
                      ? 'Backend cached the video at backend/data/videos and serves it from /api/campaigns/{id}/video. Stable forever.'
                      : cacheFailed
                      ? `Caching failed: ${c.cache_error || 'unknown error'}. Falling back to the original Runway URL, which expires in ~days.`
                      : 'Runway artifact URLs are presigned and expire (~days). Cache skipped — fallback to the original URL.'
                  }
                >
                  {cacheStatusLabel}
                </span>
              )}
            </div>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Visual cut only — Runway gen4_turbo / gen4.5 output is silent.
            Spoken assets live in the <span className="text-zinc-300">Character</span>{' '}
            tab (host clip) and <span className="text-zinc-300">Voice</span> tab
            (samples).
          </p>
        </div>
      ) : (
        <p className="text-xs text-zinc-500 italic">
          No cached video yet. Save a campaign in Stage 2 first.
        </p>
      )}

      {/* Campaign Pack — only meaningful once we have a cached video. */}
      {isCached && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-300">Campaign Pack</span>
              <span className="text-[10px] text-zinc-500" title="Each format runs a local ffmpeg pass — no extra Runway calls.">
                {finishedCount}/3 formats ready
              </span>
            </div>
            {finishUnavailable && (
              <span className="text-[10px] text-amber-300">
                ffmpeg unavailable — install via `brew install ffmpeg`
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PACK_FORMATS.map((f) => (
              <PackEntry
                key={f.key}
                c={c}
                fmt={f.key}
                label={f.label}
                dims={f.dims}
                hint={f.hint}
                onClick={handleBuild}
                busyFormat={busyFormat}
              />
            ))}
          </div>
          {c.finish_status === 'failed' && c.finish_error && (
            <p className="text-[10px] text-rose-300" title={c.finish_error}>
              last finish attempt failed — see backend log
            </p>
          )}
        </div>
      )}

      {/* PR S + PR X — Voiced Commercial. Always rendered when the
          Visuals tab is open so the user understands the artefact
          exists; the body adapts based on which preconditions are met.
          PR X auto-creates the Avatar Host Clip when missing if a
          spokesperson is ready, so the gating UX needs only "no
          campaign saved" or "no spokesperson at all" 409s. */}
      <div className="space-y-2 rounded-lg ring-1 ring-spark/20 bg-spark/5 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">
              Voiced Commercial
            </span>
            <span
              className="text-[10px] text-zinc-500 font-mono"
              title="Loops the visual cut while the Avatar Host Clip audio plays. AdSpark auto-creates the host clip first when missing."
            >
              final ad MP4
            </span>
          </div>
          {commercialReady && (
            <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 font-mono">
              ready
            </span>
          )}
          {commercialStatus && commercialStatus !== 'ok' && !commercialBusy && (
            <span
              className="text-[10px] rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 font-mono"
              title={c.voiced_commercial_error || ''}
            >
              {commercialStatus}
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Uses the selected spokesperson's spoken host clip as the voice
          track. <span className="text-zinc-300">If the host clip is
          missing, AdSpark will create it first</span>, then loop the
          visual until the full pitch finishes — no early audio cutoff.
        </p>
        {commercialReady ? (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-emerald-300">
              Final voiced ad
            </div>
            <video
              key={c.voiced_commercial_url}
              src={c.voiced_commercial_url}
              controls
              preload="metadata"
              className="w-full max-w-md rounded-lg ring-1 ring-zinc-800"
            />
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <a
                href={c.voiced_commercial_url}
                target="_blank"
                rel="noreferrer"
                className="text-spark hover:underline"
                download
              >
                open voiced commercial ↗
              </a>
              <button
                type="button"
                onClick={handleBuildCommercial}
                disabled={commercialBusy}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                title="Re-build using the current visual + host clip"
              >
                {commercialBusy ? 'Building…' : 'rebuild'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {!isCached && (
              <p className="text-[10px] text-amber-300">
                Save the campaign first — the cached visual MP4 is the input.
              </p>
            )}
            {isCached && !hasUsableAvatar && (
              <p className="text-[10px] text-amber-300">
                Attach or create a spokesperson first (Character tab).
                The voiced commercial uses the spokesperson's host clip
                audio as its voice track.
              </p>
            )}
            {isCached && hasUsableAvatar && !hostReadyForCommercial && (
              <p className="text-[10px] text-zinc-500">
                AdSpark will auto-generate the Avatar Host Clip on the
                first build (~10 s in real mode).
              </p>
            )}
            <button
              type="button"
              onClick={handleBuildCommercial}
              disabled={commercialBusy || !commercialBuildable}
              className="rounded-md bg-spark/80 hover:bg-spark text-ink text-xs font-semibold px-3 py-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
            >
              {commercialBusy
                ? 'Building Voiced Commercial…'
                : commercialStatus && commercialStatus !== 'ok'
                ? 'Retry Voiced Commercial'
                : 'Build Voiced Commercial'}
            </button>
            {c.voiced_commercial_error && commercialStatus !== 'ok' && (
              <p className="text-[10px] text-rose-300" title={c.voiced_commercial_error}>
                {c.voiced_commercial_error}
              </p>
            )}
          </div>
        )}
      </div>

      {/* PR Z — Storyboard Commercial Builder. 3 shots × 5 s stitched
          into a longer commercial. Shots reuse the attached
          Character's portrait as prompt_image so the spokesperson
          stays consistent across the 15-second result. */}
      <div className="space-y-2 rounded-lg ring-1 ring-violet-400/30 bg-violet-500/5 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">
              Storyboard Commercial
            </span>
            <span
              className="text-[10px] text-zinc-500 font-mono"
              title="Three image-to-video shots stitched via local ffmpeg into a 15-second landscape MP4."
            >
              3 shots · ~15 s
            </span>
          </div>
          {storyboardReady && (
            <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 font-mono">
              stitched
            </span>
          )}
          {!storyboardReady && c.storyboard_status === 'failed' && (
            <span
              className="text-[10px] rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 font-mono"
              title={c.storyboard_error || ''}
            >
              failed
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Plans Hook → Action → Payoff prompts from the campaign + active
          character, then runs each shot through Runway image-to-video.
          Stitches all three with ffmpeg into a longer commercial.
        </p>

        {!storyboardPlanned && (
          <div className="space-y-1.5">
            {!isCached && !hasCharacter && (
              <p className="text-[10px] text-amber-300">
                Save the campaign with an attached character first — the
                storyboard pins the same portrait as prompt_image for every
                shot.
              </p>
            )}
            <button
              type="button"
              onClick={handlePlanStoryboard}
              disabled={storyboardPlanBusy}
              className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
            >
              {storyboardPlanBusy ? 'Planning…' : 'Plan Storyboard'}
            </button>
          </div>
        )}

        {storyboardPlanned && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] text-zinc-400 font-mono">
                {storyboardShots.filter((s) => s.status === 'ok').length}/{storyboardShots.length} shots ready
              </span>
              <button
                type="button"
                onClick={handlePlanStoryboard}
                disabled={storyboardPlanBusy}
                className="text-[10px] text-zinc-500 hover:text-violet-300 disabled:opacity-50"
                title="Re-plan resets all shot prompts but keeps cached MP4s"
              >
                {storyboardPlanBusy ? 'replanning…' : 're-plan'}
              </button>
            </div>
            <ul className="space-y-1.5">
              {storyboardShots.map((shot) => {
                const shotBusy = storyboardShotBusy === shot.id
                const ok = shot.status === 'ok'
                const failed = shot.status === 'failed'
                const running = shot.status === 'running'
                return (
                  <li
                    key={shot.id}
                    className="rounded-md ring-1 ring-zinc-800/80 bg-zinc-950/50 p-2 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-zinc-200">
                        Shot {shot.id.replace('shot-', '')} · {shot.label}
                      </span>
                      <span
                        className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                          ok
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : failed
                            ? 'bg-rose-500/20 text-rose-300'
                            : running || shotBusy
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                        title={shot.error || ''}
                      >
                        {ok ? 'ok' : failed ? 'failed' : running || shotBusy ? 'running' : 'idle'}
                      </span>
                    </div>
                    {shot.prompt && (
                      <p
                        className="text-[10px] text-zinc-400 leading-snug line-clamp-3"
                        title={shot.prompt}
                      >
                        {shot.prompt}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleGenerateStoryboardShot(shot.id)}
                        disabled={shotBusy || Boolean(storyboardShotBusy) || storyboardStitchBusy}
                        className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-[11px] font-semibold px-2.5 py-1 disabled:opacity-50"
                      >
                        {shotBusy
                          ? `Generating ${shot.label}…`
                          : ok
                          ? `Re-generate ${shot.label}`
                          : `Generate Shot ${shot.id.replace('shot-', '')}`}
                      </button>
                      {ok && shot.video_url && (
                        <a
                          href={shot.video_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-spark hover:underline"
                        >
                          preview ↗
                        </a>
                      )}
                    </div>
                    {failed && shot.error && (
                      <p className="text-[10px] text-rose-300" title={shot.error}>
                        {shot.error}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>

            <div className="space-y-1.5 pt-1">
              {storyboardReady ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-emerald-300">
                    Stitched storyboard
                  </div>
                  <video
                    key={c.storyboard_video_url}
                    src={c.storyboard_video_url}
                    controls
                    preload="metadata"
                    className="w-full max-w-md rounded-lg ring-1 ring-zinc-800"
                  />
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <a
                      href={c.storyboard_video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-spark hover:underline"
                      download
                    >
                      open storyboard ↗
                    </a>
                    <button
                      type="button"
                      onClick={handleStitchStoryboard}
                      disabled={storyboardStitchBusy}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                      title="Re-stitch the cached shots"
                    >
                      {storyboardStitchBusy ? 'Re-stitching…' : 'rebuild'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleStitchStoryboard}
                  disabled={
                    storyboardStitchBusy
                    || !storyboardAllShotsReady
                    || Boolean(storyboardShotBusy)
                  }
                  className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
                >
                  {storyboardStitchBusy
                    ? 'Stitching Storyboard…'
                    : 'Stitch Storyboard Commercial'}
                </button>
              )}
              {!storyboardAllShotsReady && !storyboardReady && (
                <p className="text-[10px] text-zinc-500">
                  Generate every shot before stitching.
                </p>
              )}
              {c.storyboard_error && c.storyboard_status === 'failed' && (
                <p className="text-[10px] text-rose-300" title={c.storyboard_error}>
                  {c.storyboard_error}
                </p>
              )}
            </div>

            {storyboardReady && (
              <div className="pt-2 border-t border-violet-500/20 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-zinc-200">
                    Voiced storyboard
                  </span>
                  {storyboardVoicedReady && (
                    <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 font-mono">
                      ready
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Loops the stitched visual under the Avatar Host Clip
                  audio. AdSpark auto-creates the host clip first when
                  missing.
                </p>
                {storyboardVoicedReady ? (
                  <div className="space-y-1.5">
                    <video
                      key={c.storyboard_voiced_url}
                      src={c.storyboard_voiced_url}
                      controls
                      preload="metadata"
                      className="w-full max-w-md rounded-lg ring-1 ring-zinc-800"
                    />
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <a
                        href={c.storyboard_voiced_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-spark hover:underline"
                        download
                      >
                        open voiced storyboard ↗
                      </a>
                      <button
                        type="button"
                        onClick={handleBuildVoicedStoryboard}
                        disabled={storyboardVoicedBusy}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                      >
                        {storyboardVoicedBusy ? 'Building…' : 'rebuild'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={handleBuildVoicedStoryboard}
                      disabled={storyboardVoicedBusy || !hasUsableAvatar}
                      className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
                    >
                      {storyboardVoicedBusy
                        ? 'Building Voiced Storyboard…'
                        : 'Build Voiced Storyboard'}
                    </button>
                    {!hasUsableAvatar && (
                      <p className="text-[10px] text-amber-300">
                        Attach or create a spokesperson first (Character tab).
                      </p>
                    )}
                    {c.storyboard_voiced_error && (
                      <p className="text-[10px] text-rose-300" title={c.storyboard_voiced_error}>
                        {c.storyboard_voiced_error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  const characterBody = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300">
            Brand Spokesperson
          </span>
          <span
            className="text-[10px] text-zinc-500 font-mono"
            title="Runway Avatar created from this campaign's reference image (or a stock portrait fallback)."
          >
            Runway Avatar
          </span>
        </div>
        {avatarReady && (
          <span
            className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
              avatarMock
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}
            title={avatarMock ? 'mock avatar (no real Runway call)' : 'Avatar processed and READY'}
          >
            {hasSelection ? (avatarMock ? 'selected · mock' : 'selected · ready') : (avatarMock ? 'mock ready' : 'ready')}
          </span>
        )}
        {avatarFailed && (
          <span className="text-[10px] rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 font-mono">
            failed
          </span>
        )}
      </div>

      {/* PR K — Character attachment. Wins over picker + custom. */}
      {hasCharacter && character && (
        <div className="rounded-md ring-1 ring-pink-400/40 bg-pink-500/5 p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-pink-300">
              Attached Character
            </span>
            <button
              type="button"
              onClick={handleDetachCharacter}
              className="text-[10px] text-zinc-500 hover:text-pink-300"
              title="Detach the character — falls back to selected avatar / custom Brand Spokesperson"
            >
              detach
            </button>
          </div>
          <div className="flex items-start gap-2">
            {character.portrait_url && (
              <img
                src={character.portrait_url}
                alt={character.name}
                className="w-12 h-12 rounded-md ring-1 ring-pink-400/40 object-cover bg-zinc-950"
              />
            )}
            <div className="text-[11px] text-zinc-300 min-w-0">
              <div className="font-medium truncate">{character.name}</div>
              <div className="text-zinc-500 font-mono text-[9px]">
                {character.template} · {character.voice_preset} ·
                avatar {character.runway_avatar_status || 'pending'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PR K — Attach-character affordance. Always available when
          no character is currently attached to this campaign. */}
      {!hasCharacter && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-400">
              <span className="text-pink-300">Attach Character</span>
              {' — '}reuse a Character Studio identity for Host Clip + Realtime
            </span>
            <button
              type="button"
              onClick={() => attachPickerOpen ? setAttachPickerOpen(false) : openAttachPicker()}
              className="text-[10px] text-zinc-500 hover:text-pink-300"
            >
              {attachPickerOpen ? 'cancel' : 'attach character'}
            </button>
          </div>
          {attachPickerOpen && (
            <div>
              {characterLibrary.length === 0 ? (
                <p className="text-[10px] text-zinc-500 italic py-2">
                  {characterLibraryLoaded
                    ? 'No characters yet. Use Character Studio above to create one.'
                    : 'Loading…'}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {characterLibrary.map((ch) => (
                    <CharacterCard
                      key={ch.id}
                      character={ch}
                      compact
                      onAttach={handleAttachCharacter}
                      busyAction={attachBusyId === ch.id ? 'attach' : null}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* PR I+ — Picker. If you select an existing avatar here, the
          "Create Custom Brand Spokesperson" flow below becomes
          optional — selected_avatar_id wins downstream.  Only
          show the picker when no character is attached (character
          is the higher-precedence pin). */}
      {!hasCharacter && <AvatarPicker campaign={c} onUpdated={onUpdated} />}

      {/* Phase 1 visual — current avatar identity (only shown when
          no Character is attached; the Character block above is the
          primary identity surface in that case) */}
      {!hasCharacter && avatarReady ? (
        <div className="flex items-start gap-3">
          {(hasSelection ? c.selected_avatar_thumbnail_url : c.host_avatar_image_url) && (
            <img
              src={hasSelection ? c.selected_avatar_thumbnail_url : c.host_avatar_image_url}
              alt={hasSelection ? c.selected_avatar_name || 'Selected Runway avatar' : 'Brand spokesperson avatar'}
              className="w-16 h-16 rounded-md ring-1 ring-zinc-800 object-cover bg-zinc-950"
            />
          )}
          <div className="text-[11px] text-zinc-400 space-y-0.5 min-w-0">
            {hasSelection ? (
              <>
                <div className="font-mono text-zinc-200 truncate" title={c.selected_avatar_id || ''}>
                  {c.selected_avatar_name || 'Selected Runway Avatar'}
                </div>
                <div>
                  source:{' '}
                  <span className="text-zinc-300">
                    {c.selected_avatar_source === 'preset'
                      ? 'Preset Character'
                      : c.selected_avatar_source === 'custom'
                      ? 'Custom Avatar'
                      : c.selected_avatar_source || 'unknown'}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="font-mono text-zinc-200 truncate" title={c.host_avatar_id || ''}>
                  avatar id: {String(c.host_avatar_id).slice(0, 12)}…
                </div>
                <div>
                  source:{' '}
                  <span className="text-zinc-300">
                    {c.host_avatar_image_source === 'campaign'
                      ? 'this campaign’s reference image'
                      : c.host_avatar_image_source === 'override'
                      ? 'user-provided image'
                      : 'stock portrait'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCreateSpokesperson({ force_recreate: true })}
                  disabled={avatarBusy}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                  title="Discard the cached avatar and create a fresh one"
                >
                  {avatarBusy ? 'Re-creating…' : 'Re-create spokesperson'}
                </button>
              </>
            )}
          </div>
        </div>
      ) : !hasCharacter ? (
        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Creates a reusable Runway Avatar from this campaign’s reference
            image (or a stock portrait fallback when the campaign image
            has no recognisable face).{' '}
            <span className="text-pink-300">
              Or attach a Character from Character Studio above.
            </span>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleCreateSpokesperson()}
              disabled={avatarBusy}
              className="rounded-md bg-sky-500/80 hover:bg-sky-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50"
            >
              {avatarBusy
                ? 'Creating Brand Spokesperson…'
                : avatarFailed
                ? 'Retry Create Brand Spokesperson'
                : 'Create Brand Spokesperson'}
            </button>
            {avatarFailed && (
              <button
                type="button"
                onClick={() =>
                  handleCreateSpokesperson({
                    force_recreate: true,
                    image_source: 'stock',
                  })
                }
                disabled={avatarBusy}
                className="rounded-md ring-1 ring-zinc-700 hover:ring-spark text-[10px] px-2 py-1 text-zinc-300 disabled:opacity-50"
                title="Try again using the configured stock portrait instead"
              >
                Retry with stock portrait
              </button>
            )}
          </div>
          {avatarFailed && c.host_avatar_error && (
            <p className="text-[10px] text-rose-300" title={c.host_avatar_error}>
              {c.host_avatar_error}
            </p>
          )}
        </div>
      ) : null}

      {/* Phase 2 — Avatar Host Clip — only available once Phase 1 is ready. */}
      {avatarReady && (
        <div className="border-t border-zinc-800/60 pt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300">
              Avatar Host Clip
            </span>
            {hostReady && (
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                  c.host_mock_mode
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-violet-500/20 text-violet-300'
                }`}
              >
                {c.host_mock_mode ? 'mock ready' : 'ready'}
              </span>
            )}
            {hostUnavailable && (
              <span className="text-[10px] text-amber-300">
                ffmpeg unavailable
              </span>
            )}
          </div>
          {hostReady ? (
            <div className="space-y-1.5">
              <video
                key={c.host_video_url}
                src={c.host_video_url}
                controls
                preload="metadata"
                className="w-full max-w-xs rounded-lg ring-1 ring-zinc-800"
              />
              <div className="flex items-center gap-3 text-xs">
                <a
                  href={c.host_video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-spark hover:underline"
                >
                  open host clip ↗
                </a>
                <button
                  type="button"
                  onClick={handlePresent}
                  disabled={hostBusy}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                  title="Generate a fresh clip with the same Brand Spokesperson"
                >
                  {hostBusy ? 'Recording…' : 'regenerate'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">
                Uses the Brand Spokesperson Avatar above to record a short
                campaign pitch.
              </p>
              <button
                type="button"
                onClick={handlePresent}
                disabled={hostBusy}
                className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50"
              >
                {hostBusy
                  ? 'Recording Host Clip…'
                  : hostFailed
                  ? 'Retry Present Campaign'
                  : 'Present Campaign'}
              </button>
              {hostFailed && c.host_error && (
                <p className="text-[10px] text-rose-300" title={c.host_error}>
                  {c.host_error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const voiceBody = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300">Audio Pack</span>
          <span
            className="text-[10px] text-zinc-500 font-mono"
            title="Brand Voice Identity (Runway /v1/voices) + multilingual voice samples (Runway voice_dubbing). These are voice samples, not full ad narration — commercial narration mixing is future work."
          >
            Brand Voice Identity
          </span>
        </div>
        {voiceReady && (
          <span
            className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
              voiceMock
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-teal-500/20 text-teal-300'
            }`}
          >
            {voiceMock ? 'mock voice' : 'voice ready'}
          </span>
        )}
        {voiceFailed && (
          <span className="text-[10px] rounded-full bg-rose-500/20 text-rose-300 px-2 py-0.5 font-mono">
            voice failed
          </span>
        )}
      </div>

      <p className="text-[10px] text-zinc-500 leading-relaxed">
        Voice samples, not full ad narration.{' '}
        <span className="text-zinc-300">
          The spoken pitch lives in the Avatar Host Clip (Character tab)
        </span>{' '}
        — that's the avatar speaking the campaign hook + caption + CTA.
        Commercial narration / mixing into the visual cut is future work.
      </p>

      {/* Phase 1 — Brand Voice Identity */}
      {voiceReady ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-zinc-300">
            Voice Sample
          </div>
          <div className="flex items-start gap-3">
            <audio
              key={c.brand_voice_preview_url}
              src={c.brand_voice_preview_url}
              controls
              preload="metadata"
              className="w-full max-w-xs"
            />
            <div className="text-[11px] text-zinc-400 space-y-0.5 min-w-0">
              <div className="font-mono text-zinc-200 truncate" title={c.brand_voice_id || ''}>
                voice id: {String(c.brand_voice_id).slice(0, 12)}…
              </div>
              <button
                type="button"
                onClick={() => handleDesignVoice({ force_recreate: true })}
                disabled={voiceBusy}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                title="Discard the cached voice identity and design a fresh one"
              >
                {voiceBusy ? 'Re-designing…' : 'Re-design voice identity'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Designs a reusable Runway voice that matches this campaign's
            tone + audience. The cached preview is Runway's generic voice
            sample — not the ad copy — and seeds the multilingual samples
            below.
          </p>
          {voiceBusy && (
            // PR Q (Phase 3) — skeleton audio bar while Runway designs
            // the voice. Brand-voice design takes ~10s; the spinner
            // gives the user something to look at instead of a stalled
            // button.
            <div
              className="rounded-md ring-1 ring-teal-500/30 bg-teal-500/5 px-2 py-2 flex items-center gap-2"
              aria-busy="true"
              aria-live="polite"
            >
              <div className="w-3 h-3 rounded-full ring-2 ring-teal-400/40 border-t-2 border-t-teal-300 animate-spin shrink-0" />
              <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full w-1/3 bg-teal-400/60 animate-pulse" />
              </div>
              <span className="text-[9px] text-teal-300/80 font-mono">
                designing voice…
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => handleDesignVoice()}
            disabled={voiceBusy}
            className="rounded-md bg-teal-500/80 hover:bg-teal-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            {voiceBusy
              ? 'Designing Brand Voice…'
              : voiceFailed
              ? 'Retry Design Brand Voice'
              : 'Design Brand Voice'}
          </button>
          {voiceFailed && c.brand_voice_error && (
            <p className="text-[10px] text-rose-300" title={c.brand_voice_error}>
              {c.brand_voice_error}
            </p>
          )}
        </div>
      )}

      {/* Phase 2 — Multilingual Voice Samples — only meaningful with a ready voice */}
      {voiceReady && (
        <div className="border-t border-zinc-800/60 pt-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300">
              Voice Samples — Multilingual
            </span>
            <span
              className="text-[10px] text-zinc-500"
              title="Runway voice_dubbing dubs the Brand Voice sample above into the chosen language. The output is a voice sample in that language — not the campaign ad in that language."
            >
              Runway voice_dubbing
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Each language re-voices the Voice Sample above —{' '}
            <span className="text-zinc-300">not the ad itself</span>. Tap to
            hear how the brand voice sounds in that language.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {DUB_LANGS.map((d) => {
              const url = (c.dubbed_audio_urls || {})[d.code]
              const status = (c.dub_statuses || {})[d.code]
              const error = (c.dub_errors || {})[d.code]
              const ready = status === 'ok' && Boolean(url)
              const isBusy = busyDubLang === d.code
              const failed = status === 'failed'
              return (
                <div
                  key={d.code}
                  className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-1.5 text-[11px] flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-200">{d.label}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{d.code}</span>
                  </div>
                  {ready ? (
                    <audio src={url} controls preload="none" className="w-full" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleDub(d.code)}
                      disabled={isBusy || Boolean(busyDubLang)}
                      className="rounded bg-teal-500/70 hover:bg-teal-500 text-zinc-100 text-[10px] px-1.5 py-0.5 disabled:opacity-50"
                      title={`Generate a ${d.label} voice sample from the Brand Voice above`}
                    >
                      {isBusy ? 'Sampling…' : failed ? `Retry ${d.label}` : `Sample ${d.label}`}
                    </button>
                  )}
                  {failed && error && (
                    <span
                      className="text-[10px] text-rose-300 truncate"
                      title={error}
                    >
                      {error}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  const realtimeBody = (
    <div className="space-y-2">
      {avatarReady ? (
        <RealtimeSpokesperson
          campaign={c}
          gateReason={
            avatarMock
              ? 'Realtime requires a real Runway key — running in mock mode.'
              : null
          }
        />
      ) : (
        <div className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-1.5">
          <div className="text-xs font-semibold text-zinc-300">
            Brand Spokesperson required
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Realtime conversations need a ready Runway Avatar. Pick or
            attach one in the <span className="text-zinc-300">Character</span>{' '}
            tab first, then come back here.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('character')}
            className="rounded-md bg-fuchsia-500/30 hover:bg-fuchsia-500/50 text-zinc-100 text-xs px-2 py-1"
          >
            Open Character tab →
          </button>
        </div>
      )}
    </div>
  )

  // Exports — flat list of every cached/derived artefact with a
  // download link or a "not generated yet" placeholder. Saved as a
  // ledger view rather than a player so users can hand off URLs.
  const exportRows = [
    {
      label: 'Visual ad (silent cut)',
      url: c.cached_video_url || c.video_url,
      meta: isCached ? 'cached locally' : 'external Runway URL',
    },
    ...PACK_FORMATS.map((f) => ({
      label: `Campaign Pack — ${f.label} (${f.dims})`,
      url: finishedUrlFor(c, f.key),
      meta: 'local ffmpeg output',
    })),
    // PR S + PR X — voiced final ad. Sits between the Pack outputs
    // and the host clip in the ledger so it reads as the main "final"
    // artefact.
    {
      label: 'Voiced Commercial',
      url: commercialReady ? c.voiced_commercial_url : null,
      meta: 'looped visual + host clip audio (ffmpeg)',
    },
    // PR Z — Storyboard outputs.
    {
      label: 'Storyboard Commercial',
      url: storyboardReady ? c.storyboard_video_url : null,
      meta: '3 shots stitched via ffmpeg (~15 s)',
    },
    {
      label: 'Voiced Storyboard',
      url: storyboardVoicedReady ? c.storyboard_voiced_url : null,
      meta: 'storyboard visual + host clip audio (ffmpeg)',
    },
    {
      label: 'Avatar Host Clip',
      url: hostReady ? c.host_video_url : null,
      meta: c.host_mock_mode ? 'ffmpeg mock placeholder' : 'Runway avatar_videos',
    },
    {
      label: 'Brand Voice Sample',
      url: voiceReady ? c.brand_voice_preview_url : null,
      meta: voiceMock ? 'ffmpeg lavfi placeholder' : 'Runway voices preview',
    },
    ...DUB_LANGS.filter((d) => (c.dubbed_audio_urls || {})[d.code]).map((d) => ({
      label: `Voice Sample — ${d.label} (${d.code})`,
      url: (c.dubbed_audio_urls || {})[d.code],
      meta: 'Runway voice_dubbing',
    })),
  ]

  const exportsBody = (
    <div className="space-y-1.5">
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        Every cached artefact for this campaign. Files served by the
        FastAPI backend stay reachable as long as the campaign exists.
        Use <span className="text-rose-300">delete</span> in the card
        header to clean everything up.
      </p>
      <ul className="divide-y divide-zinc-800/60 ring-1 ring-zinc-800/60 rounded-md">
        {exportRows.map((row, i) => (
          <li
            key={`${row.label}-${i}`}
            className="px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="text-zinc-200 truncate">{row.label}</div>
              <div className="text-[10px] text-zinc-500">{row.meta}</div>
            </div>
            {row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="text-spark hover:underline shrink-0"
                download
              >
                download ↓
              </a>
            ) : (
              <span className="text-[10px] text-zinc-600 italic shrink-0">
                not generated yet
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <li
      ref={cardRef}
      className={`rounded-xl ring-1 p-4 bg-studio-900/60 space-y-3 shadow-panel transition-shadow ${
        isNewestSaved
          ? 'ring-spark/60 shadow-[0_0_0_2px_rgba(56,189,248,0.15),0_0_24px_rgba(56,189,248,0.18)]'
          : 'ring-zinc-800'
      }`}
      aria-current={isNewestSaved ? 'true' : undefined}
    >
      {/* ---- Card header ------------------------------------------- */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-zinc-100 truncate">{c.business}</div>
          <div className="text-xs text-zinc-500">
            {new Date(c.created_at).toLocaleString()}
            {' · '}
            <span className="font-mono" title="Campaign id">
              id {String(c.id).slice(0, 8)}
            </span>
            {c.runway_task_id && (
              <>
                {' · '}
                <span className="font-mono" title="Runway task id">
                  {String(c.runway_task_id).slice(0, 12)}…
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isNewestSaved && (
            <span
              className="text-xs rounded-full px-2 py-0.5 bg-spark/25 text-spark ring-1 ring-spark/40 font-semibold"
              title="Newest saved this session"
              aria-label="just saved"
            >
              just saved
            </span>
          )}
          {finishedCount > 0 && (
            <span
              className="text-xs rounded-full px-2 py-0.5 bg-violet-500/20 text-violet-300"
              title="Finished formats in the Campaign Pack"
            >
              pack {finishedCount}/3
            </span>
          )}
          <span
            className={`text-xs rounded-full px-2 py-0.5 ${
              hasVideo
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-zinc-700/40 text-zinc-300'
            }`}
          >
            {hasVideo ? 'video ready' : 'no video'}
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-[10px] text-zinc-500 hover:text-rose-300 px-1.5 py-0.5 disabled:opacity-50"
            title="Local delete only — removes the campaign record + cached files. Runway-side avatars / voices are NOT touched."
            aria-label={`delete campaign ${c.business || c.id}`}
          >
            {deleting ? 'deleting…' : 'delete'}
          </button>
        </div>
      </div>

      {/* ---- Concept summary --------------------------------------- */}
      <div>
        <div className="text-sm text-zinc-200 font-medium">
          {concept.title || 'Untitled concept'}
        </div>
        {concept.caption && (
          <div className="text-xs text-zinc-400 mt-0.5">{concept.caption}</div>
        )}
        {c.runway_prompt && (
          <details className="text-xs text-zinc-500 mt-1">
            <summary className="cursor-pointer hover:text-zinc-300">
              prompt
            </summary>
            <p className="mt-1 text-zinc-400 whitespace-pre-wrap leading-relaxed">
              {c.runway_prompt}
            </p>
          </details>
        )}
      </div>

      {/* ---- Tab row ----------------------------------------------- */}
      {/* PR Q (Phase 3) — arrow-key navigation between tabs.
          Inactive tabs are tabIndex=-1; only the active tab is in the
          tab order. Left/Right cycles, Home/End jumps to ends. */}
      <div
        role="tablist"
        aria-label={`campaign ${c.business || c.id} tabs`}
        className="flex flex-wrap gap-1 border-b border-zinc-800/60 pb-1"
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
          e.preventDefault()
          const idx = TABS.findIndex((t) => t.key === activeTab)
          let nextIdx = idx
          if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + TABS.length) % TABS.length
          else if (e.key === 'ArrowRight') nextIdx = (idx + 1) % TABS.length
          else if (e.key === 'Home') nextIdx = 0
          else if (e.key === 'End') nextIdx = TABS.length - 1
          const nextKey = TABS[nextIdx].key
          setActiveTab(nextKey)
          // Move DOM focus to the new tab so keyboard nav stays sticky.
          // Defer to next tick — React needs to re-render with the new
          // active tab + new tabIndex before we can focus it.
          setTimeout(() => {
            const el = document.getElementById(`tab-${c.id}-${nextKey}`)
            el?.focus()
          }, 0)
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`tabpanel-${c.id}-${t.key}`}
              id={`tab-${c.id}-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(t.key)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark/60 ${
                active
                  ? 'bg-spark/20 text-spark ring-1 ring-spark/40 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ---- Active tab body --------------------------------------- */}
      <div
        role="tabpanel"
        id={`tabpanel-${c.id}-${activeTab}`}
        aria-labelledby={`tab-${c.id}-${activeTab}`}
      >
        {activeTab === 'overview' && overviewBody}
        {activeTab === 'visuals' && visualsBody}
        {activeTab === 'character' && characterBody}
        {activeTab === 'voice' && voiceBody}
        {activeTab === 'realtime' && realtimeBody}
        {activeTab === 'exports' && exportsBody}
      </div>

      {localError && (
        <p className="text-[10px] text-rose-300">{localError}</p>
      )}
    </li>
  )
}

export default function CampaignGallery({ campaigns, onRefresh, newestSavedId, onClearNewest }) {
  const [overrides, setOverrides] = useState({})
  const [deletedIds, setDeletedIds] = useState(new Set())
  const handleUpdated = (updated) => {
    if (!updated?.id) return
    setOverrides((m) => ({ ...m, [updated.id]: updated }))
  }
  const handleDeleted = (id) => {
    if (!id) return
    setDeletedIds((s) => {
      const next = new Set(s)
      next.add(id)
      return next
    })
    onRefresh?.()
  }
  const merged = (campaigns || [])
    .filter((c) => !deletedIds.has(c.id))
    .map((c) => overrides[c.id] || c)

  return (
    // PR Q (Phase 3) — added role="region" + aria-labelledby so the
    // Playwright smoke can target the gallery via getByRole('region')
    // instead of the brittle div.rounded-2xl selector that used to
    // lock layout changes behind workaround classes. studio-panel
    // applies rounded-2xl via @apply.
    <section
      role="region"
      aria-labelledby="saved-campaigns-heading"
      className="studio-panel p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 id="saved-campaigns-heading" className="font-semibold">
          Saved campaigns
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-zinc-400 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark/40 rounded px-1"
        >
          refresh
        </button>
      </div>
      {!merged.length ? <GalleryEmptyState /> : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {merged.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
              isNewestSaved={c.id === newestSavedId}
              onClearNewest={onClearNewest}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * PR Q — Phase 3 empty state for the saved-campaigns gallery. Renders
 * a centered SVG sketch + headline + subtext + CTA pointing the user
 * back to Stage 1. Pure presentation; no behaviour. The CTA is a
 * scroll-link rather than a navigation since stages are anchors on
 * the same page.
 */
function GalleryEmptyState() {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-8 px-4 rounded-xl ring-1 ring-zinc-800/60 bg-studio-950/40">
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="w-12 h-12 text-zinc-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="8" y="14" width="48" height="36" rx="4" />
        <path d="M8 22h48" />
        <circle cx="14" cy="18" r="1.2" fill="currentColor" />
        <circle cx="18" cy="18" r="1.2" fill="currentColor" />
        <path d="M28 36l8-4-8-4z" fill="currentColor" stroke="none" />
      </svg>
      <div className="space-y-1">
        <div className="text-sm font-semibold text-zinc-200">
          No saved campaigns yet
        </div>
        <p className="text-xs text-zinc-500 max-w-sm leading-relaxed">
          Generate a visual ad in Stage 2, save it, then build your
          Campaign Pack, Spokesperson, Voice Identity, and Realtime
          deliverables — all attached to the same campaign card.
        </p>
      </div>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault()
          // Stage 1 is the first <section> on the page; scroll to top
          // so the brief form is visible.
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        className="text-[11px] rounded-md bg-spark/15 hover:bg-spark/25 text-spark px-3 py-1.5 ring-1 ring-spark/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
      >
        Start a campaign brief →
      </a>
    </div>
  )
}
