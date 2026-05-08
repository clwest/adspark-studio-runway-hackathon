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
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 flex flex-col gap-1.5">
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

function CampaignCard({ c, onUpdated }) {
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

  const finishedCount = PACK_FORMATS.filter((f) => Boolean(finishedUrlFor(c, f.key))).length

  return (
    <li className="rounded-xl border border-zinc-800 p-4 bg-zinc-950/40 space-y-3">
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
        </div>
      </div>

      <div>
        <div className="text-sm text-zinc-200 font-medium">
          {concept.title || 'Untitled concept'}
        </div>
        {concept.caption && (
          <div className="text-xs text-zinc-400 mt-0.5">{concept.caption}</div>
        )}
      </div>

      {c.runway_prompt && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">prompt</summary>
          <p className="mt-1 text-zinc-400 whitespace-pre-wrap leading-relaxed">
            {c.runway_prompt}
          </p>
        </details>
      )}

      {hasVideo && (
        <div className="space-y-2">
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            preload="metadata"
            className="w-full rounded-lg border border-zinc-800"
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
      )}

      {/* Campaign Pack — only meaningful once we have a cached video. */}
      {isCached && (
        <div className="border-t border-zinc-800 pt-3 space-y-2">
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
            <p
              className="text-[10px] text-rose-300"
              title={c.finish_error}
            >
              last finish attempt failed — see backend log
            </p>
          )}
        </div>
      )}

      {/* PR F — Brand Spokesperson Avatar (Phase 1) + Avatar Host Clip (Phase 2). */}
      <div className="border-t border-zinc-800 pt-3 space-y-3">
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
          <div className="rounded-md border border-pink-400/40 bg-pink-500/5 p-2 space-y-1.5">
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
                  className="w-12 h-12 rounded-md border border-pink-400/40 object-cover bg-zinc-950"
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
                className="w-16 h-16 rounded-md border border-zinc-800 object-cover bg-zinc-950"
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
                  className="rounded-md border border-zinc-700 hover:border-spark text-[10px] px-2 py-1 text-zinc-300 disabled:opacity-50"
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
                  className="w-full max-w-xs rounded-lg border border-zinc-800"
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

        {/* PR I — Talk to Brand Spokesperson (realtime).  Strictly
            additive layer, gated to real-mode ready avatars only.  In
            mock mode we render the section disabled with a clear
            reason so the demo story stays honest. */}
        {avatarReady && (
          <RealtimeSpokesperson
            campaign={c}
            gateReason={
              avatarMock
                ? 'Realtime requires a real Runway key — running in mock mode.'
                : null
            }
          />
        )}
      </div>

      {/* PR H — Audio Pack: Brand Voice (Phase 1) + Multilingual Dub (Phase 2) */}
      <div className="border-t border-zinc-800 pt-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-300">Audio Pack</span>
            <span
              className="text-[10px] text-zinc-500 font-mono"
              title="Runway brand voice + multilingual dubbing"
            >
              Runway Voices
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

        {/* Phase 1 — Brand Voice */}
        {voiceReady ? (
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
                title="Discard the cached voice and design a fresh one"
              >
                {voiceBusy ? 'Re-designing…' : 'Re-design voice'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Designs a custom Runway voice from this campaign’s tone +
              audience. The preview MP3 caches locally and seeds the
              multilingual dubs below.
            </p>
            <button
              type="button"
              onClick={() => handleDesignVoice()}
              disabled={voiceBusy}
              className="rounded-md bg-teal-500/80 hover:bg-teal-500 text-zinc-100 text-xs px-2 py-1 disabled:opacity-50"
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

        {/* Phase 2 — Multilingual Dub Pack — only meaningful with a ready voice */}
        {voiceReady && (
          <div className="border-t border-zinc-800/60 pt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-300">Multilingual Dubs</span>
              <span className="text-[10px] text-zinc-500" title="Runway voice_dubbing on the cached Brand Voice preview">
                Runway voice_dubbing
              </span>
            </div>
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
                    className="rounded-md border border-zinc-800 bg-zinc-950/40 p-1.5 text-[11px] flex flex-col gap-1"
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
                        title={`Dub the Brand Voice into ${d.label}`}
                      >
                        {isBusy ? 'Dubbing…' : failed ? `Retry ${d.label}` : `Dub ${d.label}`}
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

      {localError && (
        <p className="text-[10px] text-rose-300">{localError}</p>
      )}
    </li>
  )
}

export default function CampaignGallery({ campaigns, onRefresh }) {
  const [overrides, setOverrides] = useState({})
  const handleUpdated = (updated) => {
    if (!updated?.id) return
    setOverrides((m) => ({ ...m, [updated.id]: updated }))
  }
  const merged = (campaigns || []).map((c) => overrides[c.id] || c)

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Saved campaigns</h3>
        <button
          type="button"
          onClick={onRefresh}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          refresh
        </button>
      </div>
      {!merged.length ? (
        <p className="text-sm text-zinc-500">No campaigns saved yet.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {merged.map((c) => (
            <CampaignCard key={c.id} c={c} onUpdated={handleUpdated} />
          ))}
        </ul>
      )}
    </div>
  )
}
