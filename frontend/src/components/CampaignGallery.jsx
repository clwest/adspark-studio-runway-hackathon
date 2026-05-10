import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { buildCommercialScript, COMMERCIAL_SCRIPT_MAX } from '../scriptBuilder'
import { describeVoicePreset } from '../voicePresets'
import AvatarPicker from './AvatarPicker.jsx'
import CharacterCard from './CharacterCard.jsx'
import RealtimeSpokesperson from './RealtimeSpokesperson.jsx'
import {
  buildTranscriptMarkdown,
  buildTranscriptText,
  copyToClipboard,
  downloadTextFile,
  transcriptFilename,
} from '../transcriptExport.js'

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
  // PR AF — Dialogue Scene Builder. Sits between Voice and Realtime
  // because it's an asynchronous render path (more like Voice) and
  // benefits from being adjacent to where the script lives.
  { key: 'dialogue', label: 'Dialogue' },
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

function CampaignCard({
  c,
  onUpdated,
  onDeleted,
  isNewestSaved,
  onClearNewest,
  // PR BR — v2 Appearances click-through target. When the parent
  // sets openCampaignId === c.id, the card scrolls into view +
  // flashes a highlight ring for ~2 s; onClearOpen fires when the
  // animation lands so a future click can re-fire cleanly.
  isOpenedFromV2 = false,
  onClearOpen,
}) {
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
  // PR AF — when the Dialogue tab opens, lazy-load the ready-character
  // library so the speaker dropdowns have options. Idempotent.
  useEffect(() => {
    if (activeTab !== 'dialogue') return
    if (characterLibraryLoadedForDialogue) return
    ensureDialogueCharacterLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])
  const cardRef = useRef(null)
  // PR Z2 — make the silent-vs-voiced distinction unmistakable. The
  // voiced section gets a ref so the silent player's CTA can scroll
  // there + the post-build success path can pulse a brief highlight.
  const voicedSectionRef = useRef(null)
  const [voicedHighlight, setVoicedHighlight] = useState(false)
  const scrollToVoiced = () => {
    const node = voicedSectionRef.current
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setVoicedHighlight(true)
    window.setTimeout(() => setVoicedHighlight(false), 2200)
  }
  // PR Y — scroll the just-saved card into view + clear the newest
  // marker after one frame so a later refresh doesn't re-scroll.
  useEffect(() => {
    if (!isNewestSaved || !cardRef.current) return
    cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PR BR — v2 Appearances click-through. When the parent flips
  // `isOpenedFromV2` true (because openCampaignId matches this
  // card's id), scroll into view + flash a pink highlight ring
  // for ~2 s, then call onClearOpen so subsequent re-clicks can
  // re-fire the animation. Independent from voicedHighlight /
  // newestSaved scroll paths so the v2 jump never confuses
  // those flows.
  const [openHighlight, setOpenHighlight] = useState(false)
  useEffect(() => {
    if (!isOpenedFromV2) return undefined
    if (cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    setOpenHighlight(true)
    const t = window.setTimeout(() => {
      setOpenHighlight(false)
      onClearOpen?.()
    }, 2200)
    return () => window.clearTimeout(t)
  }, [isOpenedFromV2, onClearOpen])
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
  // PR AC — per-shot prompt drafts keyed by shot id. Drafts are
  // initialised + re-synced from the server-side prompt when the
  // campaign record changes; user edits diverge until Save / Generate.
  const [shotPromptDrafts, setShotPromptDrafts] = useState(() => {
    const out = {}
    for (const s of c.storyboard_shots || []) {
      if (s && s.id) out[s.id] = s.prompt || ''
    }
    return out
  })
  const [shotPromptSavingId, setShotPromptSavingId] = useState(null)
  // PR AF — Dialogue Scene Builder state. Per-line drafts keyed by
  // line id; busy flags scoped per operation so the user can plan,
  // edit, generate, and stitch without races.
  const [dialoguePlanBusy, setDialoguePlanBusy] = useState(false)
  const [dialogueLineSavingId, setDialogueLineSavingId] = useState(null)
  const [dialogueLineGenId, setDialogueLineGenId] = useState(null)
  const [dialogueStitchBusy, setDialogueStitchBusy] = useState(false)
  // PR AG — Vertical / Reels export busy flags. One per output kind.
  const [spokespersonReelsBusy, setSpokespersonReelsBusy] = useState(false)
  const [dialogueReelsBusy, setDialogueReelsBusy] = useState(false)
  // PR AI — Realtime document attach busy flag.
  const [realtimeDocBusy, setRealtimeDocBusy] = useState(false)
  // PR AJ — Transcript fetch busy flag.
  const [transcriptBusy, setTranscriptBusy] = useState(false)
  // PR AL — Transcript export status. ``kind`` distinguishes copy vs
  // download so the same banner can render context-specific copy
  // (e.g. "Copied" vs "Download ready"). Auto-clears after 2.5 s so
  // the card doesn't carry a stale banner forever.
  const [transcriptExport, setTranscriptExport] = useState({
    kind: null,    // 'copy' | 'download' | null
    status: null,  // 'ok' | 'failed' | null
    message: '',
  })
  // PR BC — Transcript history disclosure expand/collapse. Defaults
  // to 5 visible; clicking the toggle reveals up to the full 20-entry
  // store cap. Local-only — never re-shown across mounts.
  const [transcriptHistoryExpanded, setTranscriptHistoryExpanded] =
    useState(false)
  // PR AK — Brand colour control. Local draft mirrors the saved
  // value so a quick swatch swap doesn't fire an API call until the
  // user finishes choosing (commit-on-blur / change).
  const DEFAULT_BRAND_COLOR_DISPLAY = '#0b1220'
  const [brandColorBusy, setBrandColorBusy] = useState(false)
  const [brandColorDraft, setBrandColorDraft] = useState(
    c.brand_color || DEFAULT_BRAND_COLOR_DISPLAY,
  )
  const [dialogueDrafts, setDialogueDrafts] = useState(() => {
    const out = {}
    for (const l of c.dialogue_lines || []) {
      if (l && l.id) out[l.id] = { text: l.text || '', character_id: l.character_id || '' }
    }
    return out
  })
  const [characterLibraryForDialogue, setCharacterLibraryForDialogue] = useState([])
  const [characterLibraryLoadedForDialogue, setCharacterLibraryLoadedForDialogue] = useState(false)
  // PR AA — Commercial Script editor state. Local draft tracks
  // unsaved edits; scriptSaved pulses a 1.5 s "saved" indicator after
  // a successful save.
  const [scriptDraft, setScriptDraft] = useState(c.commercial_script || '')
  const [scriptDraftSeed, setScriptDraftSeed] = useState(c.commercial_script || '')
  const [scriptBusy, setScriptBusy] = useState(false)
  const [scriptSavedFlash, setScriptSavedFlash] = useState(false)
  // When the upstream campaign record changes (e.g. a save updates
  // the persisted script), reset the local draft so we don't show a
  // stale value.
  useEffect(() => {
    const next = c.commercial_script || ''
    if (next !== scriptDraftSeed) {
      setScriptDraft(next)
      setScriptDraftSeed(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.commercial_script])
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
  // PR AF — Dialogue Scene derivations.
  const dialogueLines = Array.isArray(c.dialogue_lines) ? c.dialogue_lines : []
  const dialoguePlanned = dialogueLines.length > 0
  const dialogueAllLinesReady =
    dialoguePlanned && dialogueLines.every((l) => l.status === 'ok')
  const dialogueSceneReady =
    c.dialogue_scene_status === 'ok' && Boolean(c.dialogue_scene_video_url)
  const dialogueSomeMock =
    dialoguePlanned && dialogueLines.some((l) => l.mock_mode === true)
  // PR AG — Vertical / Reels export readiness. Each kind is "ready"
  // when status is ok and the URL persisted on the campaign record.
  const spokespersonReelsReady =
    c.spokesperson_reels_status === 'ok' && Boolean(c.spokesperson_reels_url)
  const dialogueSceneReelsReady =
    c.dialogue_scene_reels_status === 'ok' && Boolean(c.dialogue_scene_reels_url)
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
      // PR AB — call the Spokesperson Ad alias. Same artefact and
      // persisted fields as presentCampaign; the new endpoint exists
      // so the API vocabulary matches the UI.
      const updated = await api.generateSpokespersonAd(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`spokesperson ad: ${e}`)
    } finally {
      setHostBusy(false)
    }
  }

  // PR AG — Reels export handlers. Reuse existing rendered MP4s as
  // input to a local ffmpeg pad pass; surface failures via the same
  // localError banner pattern used by every other handler in this card.
  const handleSpokespersonReels = async () => {
    setLocalError('')
    setSpokespersonReelsBusy(true)
    try {
      const updated = await api.buildSpokespersonReels(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`spokesperson reels: ${e}`)
    } finally {
      setSpokespersonReelsBusy(false)
    }
  }

  const handleDialogueSceneReels = async () => {
    setLocalError('')
    setDialogueReelsBusy(true)
    try {
      const updated = await api.buildDialogueSceneReels(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`dialogue reels: ${e}`)
    } finally {
      setDialogueReelsBusy(false)
    }
  }

  // PR AI — attach (or refresh) the Realtime grounding document. Same
  // setLocalError + onUpdated pattern as every other handler in this
  // card. Mock mode succeeds with a deterministic id; real mode does
  // POST /v1/documents + best-effort PATCH /v1/avatars/{id}.
  const handleAttachRealtimeDocument = async () => {
    setLocalError('')
    setRealtimeDocBusy(true)
    try {
      const updated = await api.attachRealtimeDocument(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`realtime grounding: ${e}`)
    } finally {
      setRealtimeDocBusy(false)
    }
  }

  // PR AJ — fetch the realtime conversation transcript. Mock mode
  // synthesises a deterministic 3-turn replay from the campaign
  // brief; real mode hits Runway's GET /v1/avatar_conversations/{id}
  // using the session id captured when the broker last ran.
  const handleFetchTranscript = async () => {
    setLocalError('')
    setTranscriptBusy(true)
    try {
      const updated = await api.fetchRealtimeTranscript(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`transcript: ${e}`)
    } finally {
      setTranscriptBusy(false)
    }
  }

  // PR AL — auto-clear the transcript export banner after a beat so
  // the card never carries a stale "Copied" indicator.
  useEffect(() => {
    if (!transcriptExport.kind) return undefined
    const t = setTimeout(
      () => setTranscriptExport({ kind: null, status: null, message: '' }),
      2_500,
    )
    return () => clearTimeout(t)
  }, [transcriptExport.kind, transcriptExport.status, transcriptExport.message])

  // PR AL — Copy Markdown to clipboard. Falls back to a textarea
  // selection trick when navigator.clipboard isn't available; surfaces
  // a friendly failure when even that fallback errors.
  const handleCopyTranscriptMarkdown = async () => {
    const md = buildTranscriptMarkdown(c, transcriptTurns)
    const ok = await copyToClipboard(md)
    setTranscriptExport({
      kind: 'copy',
      status: ok ? 'ok' : 'failed',
      message: ok
        ? 'Copied as Markdown'
        : 'Clipboard unavailable — try Download TXT',
    })
  }

  // PR AL — Download the transcript as a .txt file via Blob + object
  // URL. ``downloadTextFile`` cleans up the URL automatically.
  const handleDownloadTranscriptText = () => {
    const txt = buildTranscriptText(c, transcriptTurns)
    const ok = downloadTextFile(transcriptFilename(c, 'txt'), txt)
    setTranscriptExport({
      kind: 'download',
      status: ok ? 'ok' : 'failed',
      message: ok ? 'Download ready' : 'Browser blocked the download',
    })
  }

  // PR AK — Brand colour. Persists immediately on commit (change /
  // blur) so the next reels build picks it up. Empty / default value
  // clears the stored colour and reverts to the default backdrop.
  const handleCommitBrandColor = async (raw) => {
    const cleaned = (raw || '').trim()
    // Treat the visual default as "unset" so the operator can revert
    // to the default backdrop just by leaving the swatch alone.
    const persistAs =
      !cleaned || cleaned.toLowerCase() === DEFAULT_BRAND_COLOR_DISPLAY
        ? ''
        : cleaned
    if ((c.brand_color || '') === persistAs) return
    setLocalError('')
    setBrandColorBusy(true)
    try {
      const updated = await api.setBrandColor(c.id, persistAs || null)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`brand color: ${e}`)
      // Revert local draft on failure so the swatch matches state.
      setBrandColorDraft(c.brand_color || DEFAULT_BRAND_COLOR_DISPLAY)
    } finally {
      setBrandColorBusy(false)
    }
  }

  const handleResetBrandColor = () => {
    setBrandColorDraft(DEFAULT_BRAND_COLOR_DISPLAY)
    handleCommitBrandColor('')
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
      // PR Z2 — when the build succeeds, pull focus to the voiced
      // player so the user immediately sees + plays the audio version
      // instead of the silent source above it.
      if (updated && updated.voiced_commercial_status === 'ok') {
        // setTimeout because onUpdated triggers a re-render and the
        // ref node only exists in the next paint.
        window.setTimeout(scrollToVoiced, 60)
      }
    } catch (e) {
      setLocalError(`commercial: ${e}`)
    } finally {
      setCommercialBusy(false)
    }
  }

  // PR AC — when the persisted shot list changes (plan / re-plan /
  // server-side prompt update), reset any drafts whose seed shifted
  // so the textarea reflects the new persisted text. We deliberately
  // do NOT clobber drafts whose seed is unchanged — that would erase
  // the user's in-progress edit on every poll/refresh.
  useEffect(() => {
    setShotPromptDrafts((prev) => {
      const next = { ...prev }
      let changed = false
      for (const s of c.storyboard_shots || []) {
        if (!s || !s.id) continue
        const persisted = s.prompt || ''
        if (next[s.id] === undefined) {
          next[s.id] = persisted
          changed = true
          continue
        }
        // If the persisted prompt changed AND the draft equals the
        // previous persisted value (i.e. user hadn't edited it), pull
        // the new persisted prompt through. If the draft diverges
        // (unsaved edit) leave it alone.
        const prevSeed = prev.__seeds__?.[s.id] ?? next[s.id]
        if (persisted !== prevSeed && next[s.id] === prevSeed) {
          next[s.id] = persisted
          changed = true
        }
      }
      // Stash the latest seeds so the next render can detect drift.
      next.__seeds__ = Object.fromEntries(
        (c.storyboard_shots || []).map((s) => [s.id, s.prompt || '']),
      )
      return changed || !prev.__seeds__ ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.storyboard_shots])

  const handleShotPromptDraftChange = (shotId, value) => {
    setShotPromptDrafts((prev) => ({ ...prev, [shotId]: value }))
  }

  const handleResetShotPrompt = (shotId) => {
    const persisted = (c.storyboard_shots || []).find((s) => s.id === shotId)
    if (!persisted) return
    setShotPromptDrafts((prev) => ({
      ...prev,
      [shotId]: persisted.prompt || '',
    }))
  }

  const handleSaveShotPrompt = async (shotId) => {
    const draft = (shotPromptDrafts[shotId] || '').trim()
    if (!draft) return
    setLocalError('')
    setShotPromptSavingId(shotId)
    try {
      const updated = await api.saveStoryboardShotPrompt(c.id, shotId, draft)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`shot ${shotId} save: ${e}`)
    } finally {
      setShotPromptSavingId(null)
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
      // PR AC — flush any unsaved prompt edits before firing the
      // generate call so Runway sees the user-edited text. The save
      // route resets the shot's status to idle, which the generate
      // route immediately overwrites with running.
      const persisted =
        (c.storyboard_shots || []).find((s) => s.id === shotId)?.prompt || ''
      const draft = (shotPromptDrafts[shotId] || '').trim()
      if (draft && draft !== persisted) {
        const saved = await api.saveStoryboardShotPrompt(c.id, shotId, draft)
        onUpdated?.(saved)
      }
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

  // PR AA — Commercial Script handlers.
  const handleGenerateScript = () => {
    const generated = buildCommercialScript({ campaign: c, character })
    if (generated) setScriptDraft(generated)
  }

  const handleSaveScript = async () => {
    setLocalError('')
    setScriptBusy(true)
    try {
      const updated = await api.saveCommercialScript(c.id, scriptDraft || null)
      onUpdated?.(updated)
      setScriptDraftSeed(updated.commercial_script || '')
      setScriptSavedFlash(true)
      window.setTimeout(() => setScriptSavedFlash(false), 1500)
    } catch (e) {
      setLocalError(`script save: ${e}`)
    } finally {
      setScriptBusy(false)
    }
  }

  const handleRecordHostFromScript = async () => {
    if (scriptDraft && scriptDraft !== scriptDraftSeed) {
      // Save the latest draft first so the host clip uses the visible
      // text, not a stale persisted version.
      try {
        const saved = await api.saveCommercialScript(c.id, scriptDraft || null)
        onUpdated?.(saved)
        setScriptDraftSeed(saved.commercial_script || '')
      } catch (e) {
        setLocalError(`script save: ${e}`)
        return
      }
    }
    await handlePresent()
  }

  // PR AF — keep dialogue drafts in sync with persisted lines. Same
  // draft-vs-seed pattern used for storyboard shot prompts.
  useEffect(() => {
    setDialogueDrafts((prev) => {
      const next = { ...prev }
      let changed = false
      const seeds = prev.__seeds__ || {}
      const newSeeds = {}
      for (const l of c.dialogue_lines || []) {
        if (!l || !l.id) continue
        const persistedText = l.text || ''
        const persistedChar = l.character_id || ''
        newSeeds[l.id] = { text: persistedText, character_id: persistedChar }
        if (next[l.id] === undefined) {
          next[l.id] = { text: persistedText, character_id: persistedChar }
          changed = true
          continue
        }
        const seed = seeds[l.id] || { text: '', character_id: '' }
        // Only auto-pull through when the user hasn't edited locally.
        if (
          persistedText !== seed.text
          && next[l.id].text === seed.text
        ) {
          next[l.id] = { ...next[l.id], text: persistedText }
          changed = true
        }
        if (
          persistedChar !== seed.character_id
          && next[l.id].character_id === seed.character_id
        ) {
          next[l.id] = { ...next[l.id], character_id: persistedChar }
          changed = true
        }
      }
      next.__seeds__ = newSeeds
      return changed || !prev.__seeds__ ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.dialogue_lines])

  const ensureDialogueCharacterLibrary = async () => {
    if (characterLibraryLoadedForDialogue) return characterLibraryForDialogue
    try {
      const resp = await api.listCharacters()
      const all = resp.characters || []
      // Only show characters with a usable Runway avatar.
      const ready = all.filter(
        (ch) => ch.runway_avatar_id && ['ready', 'mock'].includes(ch.runway_avatar_status || ''),
      )
      setCharacterLibraryForDialogue(ready)
      setCharacterLibraryLoadedForDialogue(true)
      return ready
    } catch (e) {
      setLocalError(`load characters: ${e}`)
      return []
    }
  }

  const handlePlanDialogue = async () => {
    setLocalError('')
    setDialoguePlanBusy(true)
    try {
      await ensureDialogueCharacterLibrary()
      const updated = await api.planDialogue(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`dialogue plan: ${e}`)
    } finally {
      setDialoguePlanBusy(false)
    }
  }

  const handleDialogueLineDraftChange = (lineId, key, value) => {
    setDialogueDrafts((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] || { text: '', character_id: '' }), [key]: value },
    }))
  }

  const handleSaveDialogueLine = async (lineId) => {
    const draft = dialogueDrafts[lineId] || { text: '', character_id: '' }
    setLocalError('')
    setDialogueLineSavingId(lineId)
    try {
      const updated = await api.saveDialogueLine(c.id, lineId, {
        text: draft.text || '',
        character_id: draft.character_id || null,
      })
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`dialogue ${lineId} save: ${e}`)
    } finally {
      setDialogueLineSavingId(null)
    }
  }

  const handleGenerateDialogueLine = async (lineId) => {
    setLocalError('')
    setDialogueLineGenId(lineId)
    try {
      // Save dirty drafts first so generation uses the on-screen text.
      const draft = dialogueDrafts[lineId] || { text: '', character_id: '' }
      const persisted = (c.dialogue_lines || []).find((l) => l.id === lineId) || {}
      const dirty =
        draft.text !== (persisted.text || '')
        || draft.character_id !== (persisted.character_id || '')
      if (dirty) {
        const saved = await api.saveDialogueLine(c.id, lineId, {
          text: draft.text || '',
          character_id: draft.character_id || null,
        })
        onUpdated?.(saved)
      }
      const updated = await api.generateDialogueLine(c.id, lineId)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`dialogue ${lineId} gen: ${e}`)
    } finally {
      setDialogueLineGenId(null)
    }
  }

  const handleStitchDialogue = async () => {
    setLocalError('')
    setDialogueStitchBusy(true)
    try {
      const updated = await api.stitchDialogue(c.id)
      onUpdated?.(updated)
    } catch (e) {
      setLocalError(`dialogue stitch: ${e}`)
    } finally {
      setDialogueStitchBusy(false)
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
  // PR AA — script-first ordering. Once a visual + spokesperson exist,
  // nudge the user to write the Commercial Script before recording the
  // host clip (previously the host clip silently used a deterministic
  // template, leading to a generic-sounding voiced ad).
  let nextActionLabel = null
  let nextActionTab = null
  const hasScript = Boolean((c.commercial_script || '').trim())
  if (!hasVideo) {
    nextActionLabel = 'Generate the visual ad first (Stage 2)'
  } else if (!hasUsableAvatar) {
    nextActionLabel = 'Choose spokesperson →'
    nextActionTab = 'character'
  } else if (!hasScript) {
    nextActionLabel = 'Write commercial script →'
    nextActionTab = 'voice'
  } else if (!hostReady) {
    // PR AB — surface the Spokesperson Ad as the next-step deliverable.
    // The host clip already IS the talking-to-camera ad; we just use
    // the new label so users find it without scrolling Voice tab tools.
    nextActionLabel = 'Generate spokesperson ad →'
    nextActionTab = 'character'
  } else if (!commercialReady) {
    nextActionLabel = 'Build cinematic voiced ad →'
    nextActionTab = 'visuals'
  } else if (finishedCount < 3) {
    nextActionLabel = 'Build Campaign Pack →'
    nextActionTab = 'visuals'
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
      {/* PR AD — Two-mode Ad picker. Cinematic Commercial vs
          Spokesperson Ad live as sibling final outputs. The picker
          lives at the top of the Overview tab so users immediately
          see they can pick the path that fits the campaign instead
          of scrolling Visuals/Character looking for "the right one". */}
      <section
        aria-label="Ad mode picker"
        className="rounded-xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-2"
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-zinc-100">
            Pick your ad mode
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            two final outputs · same campaign brief
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Cinematic Commercial */}
          <div className="rounded-lg ring-1 ring-spark/30 bg-spark/5 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-spark">
                Cinematic Commercial
              </span>
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                  commercialReady
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-500'
                }`}
                title={commercialReady ? 'final voiced cinematic ad ready' : 'not built'}
              >
                {commercialReady ? 'ready' : 'idle'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Beautiful visual scene/storyboard with{' '}
              <span className="text-zinc-300">voiceover</span>. Best for
              product b-roll, atmosphere, and brand visuals.
            </p>
            <p className="text-[10px] text-amber-300/80 italic">
              Visual is not lip-synced.
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('visuals')}
              className="rounded-md bg-spark/80 hover:bg-spark text-ink text-[11px] font-semibold px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark"
              title="Open the Visuals tab — visual cut, storyboard, Final Voiced Ad"
            >
              {commercialReady ? 'Open Cinematic Ad ↗' : 'Build Cinematic Ad ↗'}
            </button>
          </div>

          {/* Spokesperson Ad */}
          <div className="rounded-lg ring-1 ring-violet-400/40 bg-violet-500/5 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-violet-200">
                Spokesperson Ad
              </span>
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                  hostReady
                    ? c.host_mock_mode
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/40'
                    : 'bg-zinc-800 text-zinc-500'
                }`}
                title={
                  hostReady
                    ? c.host_mock_mode
                      ? 'mock placeholder'
                      : 'lip synced + audio'
                    : 'not recorded'
                }
              >
                {hostReady
                  ? c.host_mock_mode
                    ? 'mock · lip sync'
                    : 'lip synced'
                  : 'idle'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Lip-synced talking ad — your selected character speaks
              the saved script directly to camera. Best for{' '}
              <span className="text-zinc-300">TikTok, Reels, UGC, mascots</span>,
              and founder-style explainers.
            </p>
            <p className="text-[10px] text-zinc-500 italic">
              Powered by Runway avatar_videos. Vertical export polish is a future pass.
            </p>
            {hostReady ? (
              <div className="space-y-1">
                <video
                  key={c.host_video_url}
                  src={c.host_video_url}
                  controls
                  preload="metadata"
                  className="w-full rounded-md ring-1 ring-violet-400/40"
                />
                <div className="flex items-center gap-2 flex-wrap text-[10px]">
                  <a
                    href={c.host_video_url}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="text-spark hover:underline font-semibold"
                  >
                    download Spokesperson Ad ↗
                  </a>
                  <button
                    type="button"
                    onClick={handlePresent}
                    disabled={hostBusy}
                    className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                    title="Re-render the talking ad with the latest spokesperson + script"
                  >
                    {hostBusy ? 'Re-generating…' : 're-generate'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {!avatarReady && (
                  <p className="text-[10px] text-amber-300">
                    Choose or create a spokesperson first.
                  </p>
                )}
                {avatarReady && !hasScript && (
                  <p className="text-[10px] text-amber-300">
                    Write the commercial script first (Voice tab → Commercial Script).
                  </p>
                )}
                <button
                  type="button"
                  onClick={handlePresent}
                  disabled={hostBusy || !avatarReady}
                  className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-[11px] font-semibold px-2 py-1 disabled:opacity-50"
                  title={
                    avatarReady
                      ? 'Render the lip-synced talking ad with the saved script'
                      : 'Attach or create a spokesperson first'
                  }
                >
                  {hostBusy
                    ? 'Generating Spokesperson Ad…'
                    : hostFailed
                    ? 'Retry Spokesperson Ad'
                    : 'Generate Spokesperson Ad'}
                </button>
              </div>
            )}
          </div>

          {/* PR AF — Dialogue Scene Ad. Multi-character branded skit
              built from sequential talking-avatar lines. */}
          <div className="rounded-lg ring-1 ring-fuchsia-400/40 bg-fuchsia-500/5 p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-fuchsia-200">
                Dialogue Scene
              </span>
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                  dialogueSceneReady
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : dialoguePlanned
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-zinc-800 text-zinc-500'
                }`}
                title={
                  dialogueSceneReady
                    ? 'stitched dialogue scene ready'
                    : dialoguePlanned
                    ? 'planned · generate + stitch lines next'
                    : 'not planned'
                }
              >
                {dialogueSceneReady ? 'ready' : dialoguePlanned ? 'planned' : 'idle'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Multi-character skit assembled from talking avatar clips.
              Best for{' '}
              <span className="text-zinc-300">Office-style cold opens</span>,
              founder vs. mascot reactions, fake podcasts, and recurring
              social bits.
            </p>
            {dialogueSceneReady ? (
              <video
                key={c.dialogue_scene_video_url}
                src={c.dialogue_scene_video_url}
                controls
                preload="metadata"
                className="w-full rounded-md ring-1 ring-fuchsia-400/40"
              />
            ) : (
              <p className="text-[10px] text-zinc-500 italic">
                Plan + render lines in the Dialogue tab.
              </p>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('dialogue')}
              className="rounded-md bg-fuchsia-500/80 hover:bg-fuchsia-500 text-zinc-100 text-[11px] font-semibold px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
              title="Open the Dialogue tab — plan, edit, generate, and stitch lines"
            >
              {dialogueSceneReady ? 'Open Dialogue Scene ↗' : 'Build Dialogue Scene ↗'}
            </button>
          </div>
        </div>
      </section>

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
          label="Spokesperson Ad"
          status={hostReady ? (c.host_mock_mode ? 'mock' : 'ready') : 'idle'}
          hint={
            hostReady
              ? c.host_mock_mode
                ? 'mock placeholder'
                : 'lip synced + audio'
              : 'not recorded'
          }
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
        <div
          className={
            commercialReady
              ? 'space-y-2 opacity-80'
              : 'space-y-2'
          }
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-zinc-400">
              {commercialReady ? 'Source visual (silent)' : 'Source visual'}
            </span>
            {commercialReady && (
              <span
                className="text-[10px] text-zinc-500"
                title="Voiced final ad rendered below. The silent source remains here for download / inspection."
              >
                final ad with sound is below ↓
              </span>
            )}
          </div>
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            preload="metadata"
            className={
              commercialReady
                ? 'w-full max-w-md rounded-lg ring-1 ring-zinc-800'
                : 'w-full rounded-lg ring-1 ring-zinc-800'
            }
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
                title="Runway gen4_turbo / gen4.5 produce the visual cut only. The Voiced Commercial below mixes in the spokesperson audio."
              >
                source visual · silent
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
            This is the raw Runway visual cut and{' '}
            <span className="text-amber-300 font-semibold">has no audio</span>.
            Build the <span className="text-zinc-300">Voiced Commercial</span>{' '}
            below for the version with{' '}
            {spokespersonName ? `${spokespersonName}'s` : "the spokesperson's"}{' '}
            spoken pitch.
          </p>
          <button
            type="button"
            onClick={scrollToVoiced}
            className="text-[11px] text-spark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark rounded"
            title="Jump to the Voiced Commercial section"
          >
            Go to Voiced Commercial ↓
          </button>
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
      <div
        ref={voicedSectionRef}
        className={
          commercialReady
            ? `space-y-2 rounded-lg ring-2 bg-spark/10 p-4 transition-shadow ${
                voicedHighlight
                  ? 'ring-spark shadow-[0_0_22px_rgba(255,139,61,0.45)]'
                  : 'ring-spark/60'
              }`
            : `space-y-2 rounded-lg ring-1 ring-spark/20 bg-spark/5 p-3 transition-shadow ${
                voicedHighlight ? 'ring-spark shadow-[0_0_18px_rgba(255,139,61,0.35)]' : ''
              }`
        }
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={
                commercialReady
                  ? 'text-sm font-semibold text-zinc-100'
                  : 'text-xs font-semibold text-zinc-200'
              }
            >
              Final Voiced Cinematic Ad
            </span>
            <span
              className="text-[10px] text-zinc-500 font-mono"
              title="Loops the visual cut while the Avatar Host Clip audio plays. AdSpark auto-creates the host clip first when missing."
            >
              cinematic visual + voiceover · not lip synced
            </span>
          </div>
          {commercialReady && (
            <span
              className="text-[10px] rounded-full bg-emerald-500/25 text-emerald-200 px-2 py-0.5 font-mono ring-1 ring-emerald-400/40"
              title="MP4 export with sound"
            >
              with sound
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
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          This is the <span className="text-zinc-300">Cinematic Ad</span>:
          looped Runway visual cut + spokesperson voiceover.{' '}
          {c.commercial_script ? (
            <span className="text-zinc-300">
              Uses the saved Commercial Script
            </span>
          ) : (
            <span className="text-zinc-300">
              Falls back to a templated pitch when no Commercial Script
              is saved
            </span>
          )}{' '}
          spoken by the selected spokesperson. The voiced visual is
          <span className="text-zinc-500"> not lip-synced</span>{' '}
          — for a talking-to-camera ad, use{' '}
          <button
            type="button"
            onClick={() => setActiveTab('character')}
            className="text-violet-300 hover:underline"
            title="Open the Character tab to render the lip-synced Spokesperson Ad"
          >
            Spokesperson Ad ↗
          </button>{' '}
          in the Character tab.
        </p>
        {commercialReady ? (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
              <span aria-hidden>▶</span> Final voiced ad — playable with sound
            </div>
            <video
              key={c.voiced_commercial_url}
              src={c.voiced_commercial_url}
              controls
              preload="metadata"
              autoPlay={voicedHighlight}
              className="w-full rounded-lg ring-2 ring-spark/50 shadow-lg"
            />
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <a
                href={c.voiced_commercial_url}
                target="_blank"
                rel="noreferrer"
                className="text-spark hover:underline font-semibold"
                download
              >
                download Final Voiced Ad ↗
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
          Stitches all three with ffmpeg into a longer{' '}
          <span className="text-zinc-300">cinematic</span> commercial —{' '}
          <span className="text-amber-300/80">not lip-synced</span>.
          For talking-to-camera, use Spokesperson Ad in the Overview tab.
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
                title="Re-plan regenerates AI suggestions for all shots from the current script"
              >
                {storyboardPlanBusy ? 'replanning…' : 're-plan from script'}
              </button>
            </div>
            {/* PR AC — directing tip. Reinforces the structured-prompt
                rule of thumb the editable textareas now expose. */}
            <p className="text-[10px] text-zinc-500 italic">
              Tip: keep each shot focused on one action, one location,
              and one camera movement. Edit a shot below, then Save
              Prompt + Generate Shot.
            </p>
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
                    {/* PR AC — editable shot prompt. The textarea is
                        the load-bearing input; Generate Shot saves
                        before firing if the draft has diverged. */}
                    {(() => {
                      const draft = shotPromptDrafts[shot.id] ?? shot.prompt ?? ''
                      const persisted = shot.prompt || ''
                      const dirty = draft !== persisted
                      const saving = shotPromptSavingId === shot.id
                      return (
                        <div className="space-y-1">
                          <textarea
                            aria-label={`Storyboard ${shot.id} prompt`}
                            value={draft}
                            onChange={(e) =>
                              handleShotPromptDraftChange(shot.id, e.target.value)
                            }
                            rows={3}
                            placeholder="Describe one character, one location, one action, one camera move…"
                            className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-[11px] text-zinc-100 focus:border-violet-400 outline-none font-mono leading-snug"
                          />
                          <div className="flex items-center justify-between gap-2 flex-wrap text-[10px]">
                            <span className="text-zinc-500 font-mono">
                              {draft.length} chars
                              {dirty && (
                                <span className="text-amber-300"> · unsaved</span>
                              )}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {dirty && (
                                <button
                                  type="button"
                                  onClick={() => handleResetShotPrompt(shot.id)}
                                  className="text-zinc-500 hover:text-violet-300"
                                  title="Discard the unsaved edit + restore the saved prompt"
                                >
                                  reset to AI suggestion
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleSaveShotPrompt(shot.id)}
                                disabled={!dirty || saving || !draft.trim()}
                                className="rounded-md bg-violet-500/70 hover:bg-violet-500 text-zinc-100 px-2 py-0.5 disabled:opacity-50"
                                title="Persist the edited prompt — invalidates any stitched output"
                              >
                                {saving ? 'Saving…' : 'Save Prompt'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
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

      {/* PR AB — Spokesperson Ad (formerly "Avatar Host Clip"). Same
          Runway avatar_videos artefact, surfaced as a first-class
          talking-to-camera commercial instead of just an audio source.
          The technical "Avatar Host Clip" wording sticks around as a
          small footnote so people who knew the old surface can still
          orient themselves. */}
      {avatarReady && (
        <div className="border-t border-zinc-800/60 pt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-100">
                Spokesperson Ad
              </span>
              <span
                className="text-[10px] text-zinc-500 font-mono"
                title="Powered by Runway avatar_videos. The selected avatar speaks the saved Commercial Script with synced mouth movement."
              >
                talking-to-camera · lip synced
              </span>
            </div>
            {hostReady && (
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                  c.host_mock_mode
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-400/40'
                }`}
                title={c.host_mock_mode ? 'mock placeholder MP4' : 'lip synced + audio'}
              >
                {c.host_mock_mode ? 'mock · lip sync' : 'lip synced + audio'}
              </span>
            )}
            {hostUnavailable && (
              <span className="text-[10px] text-amber-300">
                ffmpeg unavailable
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Your selected character speaks the saved commercial script
            directly to camera with synced mouth movement.{' '}
            <span className="text-zinc-400">Powered by Runway avatar_videos.</span>
          </p>
          {hostReady ? (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-violet-200 flex items-center gap-1.5">
                <span aria-hidden>▶</span> Talking ad ready — playable with audio
              </div>
              <video
                key={c.host_video_url}
                src={c.host_video_url}
                controls
                preload="metadata"
                className="w-full rounded-lg ring-2 ring-violet-400/40 shadow"
              />
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <a
                  href={c.host_video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-spark hover:underline font-semibold"
                  download
                >
                  download Spokesperson Ad ↗
                </a>
                {/* PR AG — Vertical / Reels export. Pads/letterboxes
                    the existing 1088×704 talking-head MP4 into a
                    720×1280 vertical clip via local ffmpeg. PR AH —
                    captions burned in by default from the saved
                    Commercial Script. No new Runway calls. */}
                <button
                  type="button"
                  onClick={handleSpokespersonReels}
                  disabled={spokespersonReelsBusy}
                  data-testid="reels-spokesperson"
                  className="text-[10px] rounded-md bg-violet-500/30 hover:bg-violet-500/45 text-violet-100 ring-1 ring-violet-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
                  title="Letterbox to 720×1280 with burned-in captions for TikTok / Reels / Shorts"
                >
                  {spokespersonReelsBusy
                    ? 'Building Reels…'
                    : spokespersonReelsReady
                    ? 'Rebuild Captioned Reels'
                    : 'Captioned Reels (720×1280)'}
                </button>
                {spokespersonReelsReady && (
                  <a
                    href={c.spokesperson_reels_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-spark hover:underline"
                    download
                  >
                    download reels ↗
                  </a>
                )}
                <button
                  type="button"
                  onClick={handlePresent}
                  disabled={hostBusy}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                  title="Generate a fresh clip with the same Brand Spokesperson"
                >
                  {hostBusy ? 'Recording…' : 'regenerate'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('voice')}
                  className="text-[10px] text-zinc-500 hover:text-pink-300"
                  title="Open the Voice tab to edit the Commercial Script"
                >
                  edit script ↗
                </button>
              </div>
              {c.spokesperson_reels_status === 'failed' &&
                c.spokesperson_reels_error && (
                  <p
                    className="text-[10px] text-rose-300"
                    title={c.spokesperson_reels_error}
                  >
                    Reels export failed: {c.spokesperson_reels_error}
                  </p>
                )}
              {/* PR AA — script provenance. Surfaces which script was
                  used so the user knows whether the audio reflects
                  the saved Commercial Script or the fallback template. */}
              <p className="text-[10px] text-zinc-500">
                Script:{' '}
                <span className="text-zinc-300">
                  {c.commercial_script
                    ? 'saved Commercial Script'
                    : 'templated build_script fallback'}
                </span>
                {c.commercial_script && (
                  <span className="text-zinc-500" title={c.commercial_script}>
                    {' — '}{(c.commercial_script || '').slice(0, 60).trim()}
                    {c.commercial_script.length > 60 ? '…' : ''}
                  </span>
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">
                Renders your selected character speaking the{' '}
                {c.commercial_script ? (
                  <span className="text-zinc-300">saved Commercial Script</span>
                ) : (
                  <span className="text-zinc-300">templated campaign pitch</span>
                )}{' '}
                directly to camera.{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('voice')}
                  className="text-pink-300 hover:underline"
                  title="Open the Voice tab to edit the Commercial Script"
                >
                  Edit script in Voice tab ↗
                </button>
              </p>
              <button
                type="button"
                onClick={handlePresent}
                disabled={hostBusy}
                className="rounded-md bg-violet-500/80 hover:bg-violet-500 text-zinc-100 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
              >
                {hostBusy
                  ? 'Generating Spokesperson Ad…'
                  : hostFailed
                  ? 'Retry Spokesperson Ad'
                  : 'Generate Spokesperson Ad'}
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
    <div className="space-y-4">
      {/* PR AB — Ad Mode primer. Two distinct final commercials live
          on a saved campaign; this card teaches the difference so the
          user lands on the right tab for the right output. */}
      <div className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/70 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-100">Ad Mode</span>
          <span className="text-[10px] text-zinc-500 font-mono">
            two final outputs · pick by use case
          </span>
        </div>
        <ul className="space-y-1.5 text-[11px] leading-relaxed">
          <li>
            <span className="text-spark font-semibold">Cinematic Ad</span>{' '}
            <span className="text-zinc-500">— Visuals tab.</span>{' '}
            <span className="text-zinc-300">
              Silent Runway visual cut + spokesperson voiceover.
            </span>{' '}
            <span className="text-zinc-500">
              Best for B-roll / cinematic / product-only shots. Output:
              "Final Voiced Cinematic Ad".
            </span>
          </li>
          <li>
            <span className="text-violet-300 font-semibold">Spokesperson Ad</span>{' '}
            <span className="text-zinc-500">— Character tab.</span>{' '}
            <span className="text-zinc-300">
              Selected character speaks the saved script directly to
              camera, lip-synced.
            </span>{' '}
            <span className="text-zinc-500">
              Best for mascot / personality-driven ads (e.g. Brewster).
              Output: "Spokesperson Ad" (Runway avatar_videos).
            </span>
          </li>
        </ul>
        <p className="text-[10px] text-zinc-500 italic">
          The Commercial Script below feeds both — Spokesperson Ad
          speaks it lip-synced; Cinematic Ad mixes it as voiceover.
        </p>
      </div>

      {/* PR AA — Commercial Script. Authored before the Avatar Host
          Clip is generated; downstream host-video + commercial-with-
          voice paths speak this verbatim when present. */}
      <div className="space-y-2 rounded-lg ring-1 ring-pink-400/30 bg-pink-500/5 p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">
              Commercial Script
            </span>
            <span
              className="text-[10px] text-zinc-500 font-mono"
              title="Spoken pitch the spokesperson reads in the Avatar Host Clip. Saved on the campaign so re-builds replay the same script."
            >
              spoken pitch · ≤ {COMMERCIAL_SCRIPT_MAX} chars
            </span>
          </div>
          {c.commercial_script && (
            <span className="text-[10px] rounded-full bg-pink-500/20 text-pink-200 px-2 py-0.5 font-mono">
              saved
            </span>
          )}
          {scriptSavedFlash && (
            <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 font-mono">
              ✓ saved
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Write the spoken pitch first, then record the Avatar Host
          Clip with that script.{' '}
          <span className="text-zinc-300">Build Voiced Commercial</span>{' '}
          mixes the host-clip audio over the visual cut.
        </p>
        <textarea
          aria-label="Commercial Script"
          value={scriptDraft}
          onChange={(e) =>
            setScriptDraft(e.target.value.slice(0, COMMERCIAL_SCRIPT_MAX))
          }
          rows={3}
          placeholder={`Meet ${c.business || 'your brand'}. ${
            (c.selected_concept && c.selected_concept.hook) || 'Hook line.'
          } ${(c.selected_concept && c.selected_concept.cta) || 'Call to action.'}`}
          className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-100 focus:border-pink-400 outline-none font-mono leading-relaxed"
        />
        <div className="flex items-center justify-between gap-2 flex-wrap text-[10px]">
          <span className="text-zinc-500 font-mono">
            {scriptDraft.length}/{COMMERCIAL_SCRIPT_MAX}
            {scriptDraft && scriptDraft !== scriptDraftSeed && (
              <span className="text-amber-300"> · unsaved</span>
            )}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleGenerateScript}
              className="rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] px-2 py-1"
              title="Regenerate from business + concept + character"
            >
              Generate Script
            </button>
            <button
              type="button"
              onClick={handleSaveScript}
              disabled={
                scriptBusy
                || (scriptDraft || '') === (scriptDraftSeed || '')
              }
              className="rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-[11px] font-semibold px-2 py-1 disabled:opacity-50"
            >
              {scriptBusy ? 'Saving…' : 'Save Script'}
            </button>
            <button
              type="button"
              onClick={handleRecordHostFromScript}
              disabled={hostBusy || !avatarReady || !scriptDraft.trim()}
              className="rounded-md bg-spark/80 hover:bg-spark text-ink text-[11px] font-semibold px-2 py-1 disabled:opacity-50"
              title={
                avatarReady
                  ? 'Saves the script then renders the talking-to-camera Spokesperson Ad'
                  : 'Attach or create a spokesperson first'
              }
            >
              {hostBusy ? 'Generating…' : 'Generate Spokesperson Ad'}
            </button>
          </div>
        </div>
        {!avatarReady && (
          <p className="text-[10px] text-amber-300">
            Attach or create a spokesperson first (Character tab) so the
            host clip can speak this script.
          </p>
        )}
        {(() => {
          const charDesc = character && describeVoicePreset(character.voice_preset)
          if (!character || !charDesc) return null
          return (
            <p className="text-[10px] text-zinc-500">
              Voiced by{' '}
              <span className="text-pink-300">{character.name}</span>
              {' · '}
              <span className="text-zinc-300">
                {charDesc.label} — {charDesc.summary}
              </span>
            </p>
          )
        })()}
      </div>

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

  // PR AF — Dialogue Scene Builder body. Sequential talking-avatar
  // lines stitched into one MP4 — like an Office-style branded skit.
  const dialogueBody = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-100">
            Dialogue Scene Builder
          </span>
          <span
            className="text-[10px] text-zinc-500 font-mono"
            title="Sequential talking-avatar clips stitched into one MP4. Each line targets a specific character's Runway avatar."
          >
            multi-character skit · ≤ 300 chars/line
          </span>
        </div>
        {dialogueSceneReady && (
          <span className="text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 px-2 py-0.5 font-mono">
            ready
          </span>
        )}
        {dialogueSomeMock && !dialogueSceneReady && (
          <span className="text-[10px] rounded-full bg-amber-500/20 text-amber-300 px-2 py-0.5 font-mono">
            mock placeholders
          </span>
        )}
      </div>
      <p className="text-[10px] text-zinc-500 leading-relaxed">
        Create Office-style branded skits from multiple AI characters.
        Each line uses one character's lip-synced avatar; ffmpeg stitches
        the lines into a single dialogue scene.
      </p>

      {!dialoguePlanned && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-amber-300">
            {hasUsableAvatar
              ? 'Plan a 3-line scene from the saved campaign + your ready characters.'
              : 'Create at least one Character with a ready Runway Avatar (Stage 1) before planning a scene.'}
          </p>
          <button
            type="button"
            onClick={handlePlanDialogue}
            disabled={dialoguePlanBusy}
            className="rounded-md bg-fuchsia-500/80 hover:bg-fuchsia-500 text-zinc-100 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
          >
            {dialoguePlanBusy ? 'Planning…' : 'Plan Dialogue Scene'}
          </button>
        </div>
      )}

      {dialoguePlanned && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-400 font-mono">
              {dialogueLines.filter((l) => l.status === 'ok').length}/{dialogueLines.length} lines ready
            </span>
            <button
              type="button"
              onClick={handlePlanDialogue}
              disabled={dialoguePlanBusy}
              className="text-[10px] text-zinc-500 hover:text-fuchsia-300 disabled:opacity-50"
              title="Regenerate the default 3-line scene from the saved campaign + script. Resets local edits."
            >
              {dialoguePlanBusy ? 'replanning…' : 're-plan from script'}
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 italic">
            Tip: keep each line tight, in voice, and under ~280 characters.
            Pick a different character for the middle beat for a real
            back-and-forth.
          </p>

          <ul className="space-y-1.5">
            {dialogueLines.map((line, idx) => {
              const draft = dialogueDrafts[line.id] || {
                text: line.text || '',
                character_id: line.character_id || '',
              }
              const persistedText = line.text || ''
              const persistedChar = line.character_id || ''
              const dirty =
                draft.text !== persistedText
                || draft.character_id !== persistedChar
              const saving = dialogueLineSavingId === line.id
              const generating = dialogueLineGenId === line.id
              const ok = line.status === 'ok'
              const failed = line.status === 'failed'
              const running = line.status === 'running'
              return (
                <li
                  key={line.id}
                  className="rounded-md ring-1 ring-zinc-800/80 bg-zinc-950/50 p-2 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-zinc-100">
                      Line {idx + 1}
                    </span>
                    <span
                      className={`text-[10px] rounded-full px-2 py-0.5 font-mono ${
                        ok
                          ? line.mock_mode
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                          : failed
                          ? 'bg-rose-500/20 text-rose-300'
                          : running || generating
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                      title={line.error || ''}
                    >
                      {ok ? (line.mock_mode ? 'mock ok' : 'ok')
                        : failed ? 'failed'
                        : running || generating ? 'running'
                        : 'idle'}
                    </span>
                  </div>

                  <label className="text-[10px] text-zinc-500 flex items-center gap-1 font-mono">
                    speaker
                    <select
                      aria-label={`dialogue ${line.id} character`}
                      value={draft.character_id || ''}
                      onChange={(e) =>
                        handleDialogueLineDraftChange(line.id, 'character_id', e.target.value)
                      }
                      className="rounded-md bg-zinc-950 border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-200 focus:border-fuchsia-400 outline-none"
                    >
                      {characterLibraryForDialogue.length === 0 && line.character_id && (
                        <option value={line.character_id}>
                          {line.character_name || line.character_id.slice(0, 8)}
                        </option>
                      )}
                      {characterLibraryForDialogue.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.name}
                          {ch.runway_avatar_status === 'mock' ? ' (mock)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <textarea
                    aria-label={`dialogue ${line.id} text`}
                    value={draft.text}
                    onChange={(e) =>
                      handleDialogueLineDraftChange(
                        line.id, 'text', e.target.value.slice(0, 300),
                      )
                    }
                    rows={2}
                    placeholder="What does this character say?"
                    className="w-full rounded-md bg-zinc-950 border border-zinc-800 px-2 py-1 text-[11px] text-zinc-100 focus:border-fuchsia-400 outline-none font-mono leading-snug"
                  />

                  <div className="flex items-center justify-between gap-2 flex-wrap text-[10px]">
                    <span className="text-zinc-500 font-mono">
                      {draft.text.length}/300
                      {dirty && <span className="text-amber-300"> · unsaved</span>}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {ok && line.video_url && (
                        <a
                          href={line.video_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-spark hover:underline"
                        >
                          preview ↗
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleSaveDialogueLine(line.id)}
                        disabled={!dirty || saving || !draft.text.trim()}
                        className="rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-2 py-0.5 disabled:opacity-50"
                        title="Persist text + speaker. Resets the line's render state to idle."
                      >
                        {saving ? 'Saving…' : 'Save Line'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGenerateDialogueLine(line.id)}
                        disabled={
                          generating
                          || Boolean(dialogueLineGenId)
                          || dialogueStitchBusy
                          || !draft.text.trim()
                          || !draft.character_id
                        }
                        className="rounded-md bg-fuchsia-500/80 hover:bg-fuchsia-500 text-zinc-100 px-2 py-0.5 font-semibold disabled:opacity-50"
                      >
                        {generating
                          ? 'Generating…'
                          : ok ? 'Re-generate' : 'Generate Line Clip'}
                      </button>
                    </div>
                  </div>
                  {failed && line.error && (
                    <p className="text-[10px] text-rose-300" title={line.error}>
                      {line.error}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="space-y-1.5 pt-1">
            {dialogueSceneReady ? (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-emerald-300">
                  Dialogue Scene Ad — playable with audio
                </div>
                <video
                  key={c.dialogue_scene_video_url}
                  src={c.dialogue_scene_video_url}
                  controls
                  preload="metadata"
                  className="w-full max-w-md rounded-lg ring-2 ring-fuchsia-400/40 shadow"
                />
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <a
                    href={c.dialogue_scene_video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-spark hover:underline font-semibold"
                    download
                  >
                    download Dialogue Scene Ad ↗
                  </a>
                  {/* PR AG — Vertical / Reels export. Pads the
                      stitched 1088×704 dialogue scene into 720×1280
                      via local ffmpeg. PR AH — burns each saved line's
                      text in as a per-segment caption overlay. */}
                  <button
                    type="button"
                    onClick={handleDialogueSceneReels}
                    disabled={dialogueReelsBusy}
                    data-testid="reels-dialogue"
                    className="text-[10px] rounded-md bg-fuchsia-500/30 hover:bg-fuchsia-500/45 text-fuchsia-100 ring-1 ring-fuchsia-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
                    title="Letterbox to 720×1280 with per-line captions for TikTok / Reels / Shorts"
                  >
                    {dialogueReelsBusy
                      ? 'Building Reels…'
                      : dialogueSceneReelsReady
                      ? 'Rebuild Captioned Reels'
                      : 'Captioned Reels (720×1280)'}
                  </button>
                  {dialogueSceneReelsReady && (
                    <a
                      href={c.dialogue_scene_reels_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-spark hover:underline"
                      download
                    >
                      download reels ↗
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleStitchDialogue}
                    disabled={dialogueStitchBusy}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                    title="Re-stitch the cached line clips"
                  >
                    {dialogueStitchBusy ? 'Re-stitching…' : 'rebuild'}
                  </button>
                </div>
                {c.dialogue_scene_reels_status === 'failed' &&
                  c.dialogue_scene_reels_error && (
                    <p
                      className="text-[10px] text-rose-300"
                      title={c.dialogue_scene_reels_error}
                    >
                      Reels export failed: {c.dialogue_scene_reels_error}
                    </p>
                  )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStitchDialogue}
                disabled={
                  dialogueStitchBusy
                  || !dialogueAllLinesReady
                  || Boolean(dialogueLineGenId)
                }
                className="rounded-md bg-fuchsia-500/80 hover:bg-fuchsia-500 text-zinc-100 text-xs font-semibold px-3 py-1.5 disabled:opacity-50"
              >
                {dialogueStitchBusy
                  ? 'Stitching Dialogue Scene…'
                  : 'Stitch Dialogue Scene'}
              </button>
            )}
            {!dialogueAllLinesReady && !dialogueSceneReady && (
              <p className="text-[10px] text-zinc-500">
                Generate every line before stitching.
              </p>
            )}
            {c.dialogue_scene_error && c.dialogue_scene_status === 'failed' && (
              <p className="text-[10px] text-rose-300" title={c.dialogue_scene_error}>
                {c.dialogue_scene_error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // PR AI — grounding state derivations. The badge surfaces whether
  // the realtime broker will pass documentIds (Document-grounded) or
  // fall back to the inlined personality/startScript only
  // (Prompt-grounded). The badge + attach control is intentionally
  // small — no new pages, no new tabs.
  const grounded =
    Boolean(c.runway_document_id) &&
    (c.runway_document_status === 'ready' || c.runway_document_status === 'mock')
  const groundedMock = grounded && c.runway_document_status === 'mock'
  const groundingFailed = c.runway_document_status === 'failed'
  // PR AJ — transcript replay state. ``transcriptTurns`` is the
  // structured per-speaker history persisted on the campaign;
  // ``transcriptStatus`` drives the UI state machine.
  const transcriptStatus = c.realtime_transcript_status || null
  const transcriptTurns = Array.isArray(c.realtime_transcript_turns)
    ? c.realtime_transcript_turns
    : []
  const transcriptHasTurns = transcriptTurns.length > 0
  const transcriptIsMock = c.realtime_transcript_mock_mode === true
  const transcriptFailed = transcriptStatus === 'failed'
  const transcriptEmpty = transcriptStatus === 'empty'
  const transcriptNoSession = transcriptStatus === 'no_session'
  // PR BC — per-campaign transcript audit trail. Newest first;
  // capped at 20 by the backend store. Default 5 visible with a
  // small "Show all (N)" toggle to expand. List-only by design —
  // the latest fetched transcript stays in the card preview above
  // and continues to drive the Copy Markdown / Download TXT
  // exports.
  const transcriptHistory = Array.isArray(c.realtime_transcript_history)
    ? c.realtime_transcript_history
    : []

  const realtimeBody = (
    <div className="space-y-2">
      <div className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-2.5 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-200">
            Realtime grounding
          </span>
          <span
            className={
              grounded
                ? `text-[10px] rounded-full px-2 py-0.5 font-mono ${
                    groundedMock
                      ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
                      : 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40'
                  }`
                : 'text-[10px] rounded-full px-2 py-0.5 font-mono bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700'
            }
            title={
              grounded
                ? `documentIds=[${c.runway_document_id}] passed on session create`
                : 'No attached document — broker uses personality + startScript only'
            }
            data-testid="realtime-grounding"
          >
            {grounded
              ? groundedMock
                ? 'Document-grounded · mock'
                : 'Document-grounded'
              : 'Prompt-grounded'}
          </span>
          <button
            type="button"
            onClick={handleAttachRealtimeDocument}
            disabled={realtimeDocBusy}
            data-testid="attach-realtime-doc"
            className="text-[10px] rounded-md bg-emerald-500/30 hover:bg-emerald-500/45 text-emerald-100 ring-1 ring-emerald-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
            title="Generate a Markdown campaign brief, POST it to /v1/documents, and bind it to the realtime session"
          >
            {realtimeDocBusy
              ? 'Attaching…'
              : grounded
              ? 'Refresh grounding doc'
              : 'Attach grounding doc'}
          </button>
        </div>
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          {grounded ? (
            <>
              The avatar grounds answers in the saved campaign brief
              document; the inline personality stays lean.
            </>
          ) : (
            <>
              Without a document the broker still injects business +
              product + audience + script as personality (PR AE).
              Attach a doc to lighten that prompt and ground answers
              in the brief instead.
            </>
          )}
        </p>
        {groundingFailed && c.runway_document_error && (
          <p
            className="text-[10px] text-rose-300"
            title={c.runway_document_error}
          >
            grounding failed: {c.runway_document_error}
          </p>
        )}
      </div>

      {/* PR AJ — Conversation transcript / replay. Sits below the
          grounding card so the operator reads the realtime story top
          to bottom: who's grounding it, then what was said. Compact:
          one fetch button, one turn-list, gracefully renders empty /
          no-session / failed states without redesigning anything. */}
      <div
        className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-2.5 space-y-1.5"
        data-testid="transcript-card"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-zinc-200">
            Conversation transcript
          </span>
          {transcriptHasTurns && (
            <span
              className={
                transcriptIsMock
                  ? 'text-[10px] rounded-full px-2 py-0.5 font-mono bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
                  : 'text-[10px] rounded-full px-2 py-0.5 font-mono bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40'
              }
              data-testid="transcript-state"
              title={
                c.runway_conversation_id
                  ? `conversationId=${c.runway_conversation_id}`
                  : 'transcript on file'
              }
            >
              {transcriptIsMock
                ? `Replay ready · mock · ${transcriptTurns.length} turns`
                : `Replay ready · ${transcriptTurns.length} turns`}
            </span>
          )}
          {!transcriptHasTurns && transcriptNoSession && (
            <span
              className="text-[10px] rounded-full px-2 py-0.5 font-mono bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700"
              data-testid="transcript-state"
            >
              No session yet
            </span>
          )}
          {!transcriptHasTurns && !transcriptNoSession && (
            <span
              className="text-[10px] rounded-full px-2 py-0.5 font-mono bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700"
              data-testid="transcript-state"
            >
              No transcript yet
            </span>
          )}
          <button
            type="button"
            onClick={handleFetchTranscript}
            disabled={transcriptBusy}
            data-testid="fetch-transcript"
            className="text-[10px] rounded-md bg-sky-500/30 hover:bg-sky-500/45 text-sky-100 ring-1 ring-sky-400/40 px-2 py-0.5 font-semibold disabled:opacity-50"
            title="GET /v1/avatar_conversations/{conversationId} — replay the spokesperson session"
          >
            {transcriptBusy
              ? 'Fetching…'
              : transcriptHasTurns
              ? 'Refresh transcript'
              : 'Fetch transcript'}
          </button>
          {/* PR AL — Export / share affordances. Buttons are visible
              but disabled until turns exist so the operator can see
              the surface up front; clicking either one writes a tiny
              status banner that auto-clears after 2.5 s. */}
          <button
            type="button"
            onClick={handleCopyTranscriptMarkdown}
            disabled={!transcriptHasTurns}
            data-testid="transcript-copy-markdown"
            className="text-[10px] rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 ring-1 ring-zinc-700 px-2 py-0.5 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copy a readable Markdown version of the transcript"
          >
            Copy Markdown
          </button>
          <button
            type="button"
            onClick={handleDownloadTranscriptText}
            disabled={!transcriptHasTurns}
            data-testid="transcript-download-txt"
            className="text-[10px] rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 ring-1 ring-zinc-700 px-2 py-0.5 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download the transcript as a plain .txt file"
          >
            Download TXT
          </button>
        </div>
        {transcriptExport.kind && transcriptExport.message && (
          <p
            data-testid="transcript-export-status"
            className={
              transcriptExport.status === 'ok'
                ? 'text-[10px] text-emerald-300'
                : 'text-[10px] text-rose-300'
            }
            role="status"
            aria-live="polite"
          >
            {transcriptExport.message}
          </p>
        )}
        {transcriptHasTurns ? (
          <ol
            className="space-y-1 max-h-44 overflow-y-auto pr-1"
            data-testid="transcript-turns"
          >
            {transcriptTurns.map((turn, idx) => {
              const isAvatar = turn.role === 'avatar'
              const isUser = turn.role === 'user'
              const speaker =
                turn.speaker ||
                (isAvatar ? 'Avatar' : isUser ? 'Visitor' : 'System')
              return (
                <li
                  key={idx}
                  className={
                    'text-[11px] leading-snug rounded-md px-2 py-1 ring-1 ' +
                    (isAvatar
                      ? 'bg-violet-500/10 ring-violet-500/30 text-violet-100'
                      : isUser
                      ? 'bg-sky-500/10 ring-sky-500/30 text-sky-100'
                      : 'bg-zinc-800/40 ring-zinc-700 text-zinc-300')
                  }
                >
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
                    {speaker}
                  </div>
                  <div>{turn.text}</div>
                </li>
              )
            })}
          </ol>
        ) : transcriptNoSession ? (
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            No realtime session has been recorded for this campaign yet.
            Start a conversation below; AdSpark captures the session id
            so this card can fetch the transcript afterwards.
          </p>
        ) : transcriptEmpty ? (
          <p className="text-[10px] text-amber-300 leading-relaxed">
            Runway has no recorded turns for this conversation yet
            (it may still be processing). Try refresh in a few seconds.
          </p>
        ) : transcriptFailed && c.realtime_transcript_error ? (
          <p
            className="text-[10px] text-rose-300"
            title={c.realtime_transcript_error}
          >
            transcript fetch failed: {c.realtime_transcript_error}
          </p>
        ) : (
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Click <span className="text-zinc-300">Fetch transcript</span>{' '}
            to pull the recorded session for replay. In mock mode AdSpark
            renders a deterministic 3-turn preview drawn from the saved
            campaign brief so the UX is demoable without a Runway key.
          </p>
        )}
        {c.realtime_transcript_fetched_at && transcriptHasTurns && (
          <p className="text-[10px] text-zinc-600 font-mono">
            fetched {String(c.realtime_transcript_fetched_at).slice(0, 19)}Z
          </p>
        )}
        {/* PR BC — Per-campaign transcript audit trail. Renders only
            when at least one history entry exists. Default 5 visible
            with a "Show all (N)" toggle expanding up to the 20-entry
            cap. List-only by design: the latest fetched transcript
            stays in the preview block above and continues driving
            the Copy Markdown / Download TXT buttons. */}
        {transcriptHistory.length > 0 && (
          <div
            data-testid="transcript-history"
            className="space-y-0.5 pt-1 border-t border-zinc-800/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
                Transcript history
              </span>
              {transcriptHistory.length > 5 && (
                <button
                  type="button"
                  onClick={() =>
                    setTranscriptHistoryExpanded((v) => !v)
                  }
                  className="text-[10px] text-zinc-500 hover:text-sky-300"
                  title={
                    transcriptHistoryExpanded
                      ? 'Collapse to the 5 most recent fetches.'
                      : `Show all ${transcriptHistory.length} entries (capped at 20).`
                  }
                >
                  {transcriptHistoryExpanded
                    ? 'Show 5 newest'
                    : `Show all (${transcriptHistory.length})`}
                </button>
              )}
            </div>
            <ul className="space-y-0.5">
              {(transcriptHistoryExpanded
                ? transcriptHistory
                : transcriptHistory.slice(0, 5)
              ).map((entry, idx) => {
                const status = String(entry.status || '').toLowerCase()
                const statusClass =
                  status === 'ok'
                    ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                    : status === 'mock'
                    ? 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40'
                    : status === 'empty'
                    ? 'bg-zinc-700 text-zinc-200 ring-1 ring-zinc-500'
                    : status === 'no_session'
                    ? 'bg-zinc-700 text-zinc-300 ring-1 ring-zinc-600'
                    : status === 'failed'
                    ? 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40'
                    : 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700'
                const convoShort = entry.conversation_id
                  ? `${String(entry.conversation_id).slice(0, 12)}…`
                  : '—'
                const fetchedShort = entry.fetched_at
                  ? String(entry.fetched_at).slice(0, 16).replace('T', ' ')
                  : '—'
                return (
                  <li
                    key={`${entry.fetched_at || ''}-${idx}`}
                    data-testid="transcript-history-entry"
                    className="flex items-center gap-1 text-[10px] leading-snug flex-wrap"
                    title={
                      entry.error
                        ? `${entry.fetched_at || ''} — ${entry.error}`
                        : `${entry.fetched_at || ''}${
                            entry.conversation_id
                              ? ' · ' + entry.conversation_id
                              : ''
                          }`
                    }
                  >
                    <span
                      className={`rounded px-1 py-0.5 font-mono ${statusClass}`}
                    >
                      {status || 'unknown'}
                    </span>
                    <span className="text-zinc-400 font-mono">
                      {entry.turn_count ?? 0} turns
                    </span>
                    <span className="text-zinc-500 font-mono truncate max-w-[12ch]">
                      {convoShort}
                    </span>
                    <span className="ml-auto text-zinc-500 font-mono">
                      {fetchedShort}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

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
    // PR AF — Dialogue Scene final output.
    {
      label: 'Dialogue Scene Ad',
      url: dialogueSceneReady ? c.dialogue_scene_video_url : null,
      meta: 'multi-character talking skit · sequential avatar_videos stitch (ffmpeg)',
    },
    {
      // PR AB — same artefact, user-facing rename. Meta still reports
      // the underlying Runway primitive so file vocabulary is honest.
      label: 'Spokesperson Ad',
      url: hostReady ? c.host_video_url : null,
      meta: c.host_mock_mode
        ? 'ffmpeg mock placeholder'
        : 'talking avatar video with synced voice (Runway avatar_videos)',
    },
    // PR AG — Vertical / Reels exports. Letterbox of the existing
    // 1088×704 talking-head + dialogue-scene MP4s. PR AH — burned-in
    // captions by default; label calls that out so judges + operators
    // know what they're getting without playing the file. No new
    // Runway calls.
    {
      label: 'Spokesperson Reels · 720×1280 · Captioned',
      url: spokespersonReelsReady ? c.spokesperson_reels_url : null,
      meta: 'ffmpeg pad/letterbox + drawtext from the saved Commercial Script',
    },
    {
      label: 'Dialogue Scene Reels · 720×1280 · Captioned',
      url: dialogueSceneReelsReady ? c.dialogue_scene_reels_url : null,
      meta: 'ffmpeg pad/letterbox + per-line drawtext segments',
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
      data-testid="campaign-card"
      data-campaign-id={c.id}
      data-opened-from-v2={openHighlight ? 'true' : 'false'}
      className={`rounded-xl ring-1 p-4 bg-studio-900/60 space-y-3 shadow-panel transition-shadow ${
        openHighlight
          ? 'ring-pink-400/70 shadow-[0_0_0_2px_rgba(244,114,182,0.25),0_0_28px_rgba(244,114,182,0.25)]'
          : isNewestSaved
          ? 'ring-spark/60 shadow-[0_0_0_2px_rgba(56,189,248,0.15),0_0_24px_rgba(56,189,248,0.18)]'
          : 'ring-zinc-800'
      }`}
      aria-current={isNewestSaved || openHighlight ? 'true' : undefined}
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

      {/* PR AC — Creative-Director breadcrumb. Surfaces the
          script-first ordering ("Script -> Storyboard -> Video ->
          Final Ad") right above the tab row so the user always knows
          where they are in the directing flow. Each step lights up
          when its underlying state is ready. */}
      <nav
        aria-label="campaign creative director flow"
        className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono flex-wrap pt-0.5"
      >
        {(() => {
          const steps = [
            { key: 'script',     label: 'Script',     done: hasScript },
            { key: 'storyboard', label: 'Storyboard', done: storyboardPlanned },
            { key: 'video',      label: 'Video',      done: hasVideo },
            { key: 'final',      label: 'Final Ad',   done: commercialReady || hostReady },
          ]
          return steps.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1">
              <span
                className={
                  s.done
                    ? 'text-spark'
                    : 'text-zinc-500'
                }
              >
                {s.done ? '✓ ' : '· '}{s.label}
              </span>
              {i < steps.length - 1 && (
                <span className="text-zinc-700">→</span>
              )}
            </span>
          ))
        })()}
      </nav>

      {/* PR AK — Brand colour control. Compact: native colour input +
          live hex display + reset link. Persisted via the small
          dedicated POST /brand-color route on commit (no save button).
          Affects the Reels backdrop on the next build for both kinds
          (Spokesperson + Dialogue Scene). */}
      <div
        className="flex items-center gap-2 text-[10px] text-zinc-400 flex-wrap pt-0.5"
        data-testid="brand-color-control"
      >
        <span className="font-mono uppercase tracking-wide text-zinc-500">
          Brand colour
        </span>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="color"
            aria-label="brand colour"
            value={brandColorDraft || DEFAULT_BRAND_COLOR_DISPLAY}
            onChange={(e) => setBrandColorDraft(e.target.value)}
            onBlur={(e) => handleCommitBrandColor(e.target.value)}
            disabled={brandColorBusy}
            data-testid="brand-color-input"
            className="h-5 w-7 rounded ring-1 ring-zinc-700 bg-transparent cursor-pointer disabled:opacity-50"
          />
          <span
            className="font-mono text-zinc-300 text-[10px]"
            data-testid="brand-color-value"
          >
            {(c.brand_color || '').toLowerCase() ||
              `${DEFAULT_BRAND_COLOR_DISPLAY} (default)`}
          </span>
        </label>
        {c.brand_color && (
          <button
            type="button"
            onClick={handleResetBrandColor}
            disabled={brandColorBusy}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            title="Revert to the default dark slate backdrop"
          >
            reset
          </button>
        )}
        <span className="text-[10px] text-zinc-600">
          backdrop for Reels exports (720×1280)
        </span>
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
        {activeTab === 'dialogue' && dialogueBody}
        {activeTab === 'realtime' && realtimeBody}
        {activeTab === 'exports' && exportsBody}
      </div>

      {localError && (
        <p className="text-[10px] text-rose-300">{localError}</p>
      )}
    </li>
  )
}

export default function CampaignGallery({
  campaigns,
  onRefresh,
  newestSavedId,
  onClearNewest,
  // PR BR — v2 Appearances click-through targets.
  openCampaignId = null,
  onClearOpen,
}) {
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
              isOpenedFromV2={Boolean(openCampaignId) && c.id === openCampaignId}
              onClearOpen={onClearOpen}
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
