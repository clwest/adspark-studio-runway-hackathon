import { useEffect, useState } from 'react'
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

function CampaignCard({ c, onUpdated, onDeleted }) {
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

  const [activeTab, setActiveTab] = useState('overview')
  const [busyFormat, setBusyFormat] = useState(null) // null | "landscape" | "reels" | "square"
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [hostBusy, setHostBusy] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [busyDubLang, setBusyDubLang] = useState(null)
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
  let nextActionLabel = null
  let nextActionTab = null
  if (!hasVideo) {
    nextActionLabel = 'Generate the visual ad first (Stage 2)'
  } else if (finishedCount < 3) {
    nextActionLabel = 'Build Campaign Pack →'
    nextActionTab = 'visuals'
  } else if (!avatarReady) {
    nextActionLabel = 'Pick or create a Brand Spokesperson →'
    nextActionTab = 'character'
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

  const overviewBody = (
    <div className="space-y-3">
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
    <li className="rounded-xl ring-1 ring-zinc-800 p-4 bg-studio-900/60 space-y-3 shadow-panel">
      {/* ---- Card header ------------------------------------------- */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-zinc-100 truncate">{c.business}</div>
          <div className="text-xs text-zinc-500">
            {new Date(c.created_at).toLocaleString()}
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

export default function CampaignGallery({ campaigns, onRefresh }) {
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
