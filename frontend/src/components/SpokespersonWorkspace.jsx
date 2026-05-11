import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { friendlyError } from '../errors'
import {
  loadActiveSpokespersonId,
  saveActiveSpokespersonId,
} from '../settings'
import CampaignLanes from './CampaignLanes.jsx'
import CharacterCard from './CharacterCard.jsx'
import KnowledgePanel from './KnowledgePanel.jsx'
import VideosTab from './VideosTab.jsx'
import RealtimeSpokesperson from './RealtimeSpokesperson.jsx'
import { ToastProvider } from './Toast.jsx'

const TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'outputs', label: 'Videos' },
]

const TEMPLATE_LABELS = {
  mascot: 'Mascot · animal/brand',
  founder: 'Founder · indie spokesperson',
  coach: 'Coach · fitness / motivational',
  local_guide: 'Local Guide · small-business host',
}

/**
 * PR CC — Spokesperson Workspace.
 *
 * Dedicated `/spokespeople/:id` page for one spokesperson.
 * PR CB made the homepage feel like a product home; PR CC
 * lets you actually go inside one.
 *
 * For PR CC the **Identity tab is fully implemented** — it
 * embeds the existing `<CharacterCard>` with every handler
 * wired so the workspace is immediately useful for portrait /
 * avatar / voice work. The other four tabs render compact
 * "lands next" placeholders. PR CD splits the embedded
 * CharacterCard into a dedicated IdentityPanel + VoicePanel.
 *
 * `+ New Campaign` in the header opens the existing
 * `<CampaignModeModal>`. Selecting a mode persists the
 * spokesperson + mode in localStorage and navigates back to
 * `/`, where the Library's lane logic mounts the right
 * surface for the right spokesperson on first paint —
 * no cross-route plumbing required.
 *
 * Backend untouched. Reuses the same /api/characters +
 * /api/campaigns fetches the Library uses.
 */
export default function SpokespersonWorkspace() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [characters, setCharacters] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')
  const [activeTab, setActiveTab] = useState('identity')
  const [busyAction, setBusyAction] = useState(null)
  const [modeModalOpen, setModeModalOpen] = useState(false)
  // PR DA — campaign selection state. The lane edits whichever
  // campaign is *selected*, not "most recent" by default. When
  // `creatingNewCampaign` is true the lane mounts the empty
  // <LaneBriefCreator> regardless of which campaigns exist —
  // operator just clicked `+ New Campaign` and shouldn't see the
  // prior campaign's brief / script bleed through.
  const [selectedCampaignId, setSelectedCampaignId] = useState(null)
  const [creatingNewCampaign, setCreatingNewCampaign] = useState(false)

  // PR CC — pin the active spokesperson to the URL id on mount
  // so any subsequent navigation to / picks them up. Mirrors
  // `loadActiveSpokespersonId` so the Library lane defaults to
  // this person's linked campaigns.
  useEffect(() => {
    if (!id) return
    if (loadActiveSpokespersonId() !== id) {
      saveActiveSpokespersonId(id)
    }
  }, [id])

  // PR CL — consume the `adspark.startCampaignHint` set by the
  // CreateSpokespersonFlow Step 4 "Start a campaign" checkbox.
  // The flow + parent SpokespersonStudio writes the just-created
  // spokesperson's id into localStorage and navigates to
  // /spokespeople/{id}; on first mount we read the hint and, if
  // it matches our route id, switch to the Campaigns tab and
  // open the mode modal in-place so the operator can pick a
  // format without an extra click. Single-shot — we clear the
  // key after consuming so a refresh / re-mount doesn't re-open
  // the modal unexpectedly.
  useEffect(() => {
    if (!id) return
    if (typeof window === 'undefined') return
    let hint = null
    try {
      hint = window.localStorage.getItem('adspark.startCampaignHint')
    } catch {
      return
    }
    if (!hint || hint !== id) return
    try {
      window.localStorage.removeItem('adspark.startCampaignHint')
    } catch {
      // best-effort; even if we can't clear, the next mount
      // would still match + open — acceptable degraded state.
    }
    setActiveTab('campaigns')
    setModeModalOpen(true)
  }, [id])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const [charsResp, campsResp] = await Promise.all([
          api.listCharacters(),
          api.listCampaigns(),
        ])
        if (cancelled) return
        setCharacters(charsResp.characters || [])
        setCampaigns(campsResp.campaigns || [])
        setErrMsg('')
      } catch (e) {
        if (cancelled) return
        setErrMsg(friendlyError(e, 'Couldn’t load spokesperson'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [id])

  const character = characters.find((c) => c.id === id) || null
  const linkedCampaigns = (campaigns || []).filter(
    (c) => c.character_id === id,
  )

  // PR DA — when no campaign is selected and the operator hasn't
  // explicitly clicked "+ New Campaign", default to the newest
  // linked campaign so first-load shows something concrete. If
  // the previously-selected campaign was deleted (or detached),
  // auto-recover by re-selecting the newest.
  useEffect(() => {
    if (creatingNewCampaign) return
    const ids = linkedCampaigns.map((c) => c.id)
    if (ids.length === 0) {
      if (selectedCampaignId !== null) setSelectedCampaignId(null)
      return
    }
    if (!selectedCampaignId || !ids.includes(selectedCampaignId)) {
      const newest = [...linkedCampaigns].sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')),
      )[0]
      setSelectedCampaignId(newest?.id || null)
    }
  }, [creatingNewCampaign, linkedCampaigns, selectedCampaignId])

  // PR CC — Identity tab handlers. Mirror the SpokespersonStudio
  // shape exactly so /api/characters + voice clone + portrait +
  // avatar + drift refresh all behave identically across surfaces.
  const replaceCharacter = (next) => {
    if (!next) return
    setCharacters((cs) => cs.map((x) => (x.id === next.id ? next : x)))
  }
  const handleGeneratePortrait = async (c) => {
    setBusyAction('portrait')
    try {
      replaceCharacter(await api.generateCharacterPortrait(c.id, {}))
    } catch (e) {
      setErrMsg(friendlyError(e, `Portrait failed for ${c.name}`))
    } finally {
      setBusyAction(null)
    }
  }
  const handleCreateAvatar = async (c) => {
    setBusyAction('avatar')
    try {
      replaceCharacter(await api.createCharacterAvatar(c.id, {}))
    } catch (e) {
      setErrMsg(friendlyError(e, `Avatar create failed for ${c.name}`))
    } finally {
      setBusyAction(null)
    }
  }
  const handleCloneVoice = async (c, file) => {
    setBusyAction('voice-clone')
    try {
      replaceCharacter(await api.cloneCharacterVoice(c.id, file))
    } catch (e) {
      setErrMsg(friendlyError(e, `Voice clone failed for ${c.name}`))
    } finally {
      setBusyAction(null)
    }
  }
  const handleApplyVoiceToAvatar = async (c, mode) => {
    setBusyAction('voice-apply')
    try {
      replaceCharacter(await api.applyCharacterVoiceToAvatar(c.id, mode))
    } catch (e) {
      setErrMsg(friendlyError(e, `Voice apply failed for ${c.name}`))
    } finally {
      setBusyAction(null)
    }
  }
  const handleRefreshAvatarVoice = async (c) => {
    setBusyAction('voice-refresh')
    try {
      replaceCharacter(await api.refreshCharacterAvatarVoice(c.id))
    } catch (e) {
      setErrMsg(friendlyError(e, `Refresh avatar status failed for ${c.name}`))
      throw e
    } finally {
      setBusyAction(null)
    }
  }
  const handleRefreshVoicePreview = async (c) => {
    setBusyAction('voice-preview-refresh')
    try {
      const next = await api.refreshCharacterVoicePreview(c.id)
      replaceCharacter(next)
      return next
    } catch (e) {
      setErrMsg(friendlyError(e, `Refresh voice preview failed for ${c.name}`))
      throw e
    } finally {
      setBusyAction(null)
    }
  }
  const handleDelete = async (c) => {
    if (
      !confirm(
        `Delete spokesperson "${c.name}"? This is local only — the Runway avatar is not removed.`,
      )
    )
      return
    setBusyAction('delete')
    try {
      await api.deleteCharacter(c.id)
      navigate('/', { replace: true })
    } catch (e) {
      setErrMsg(friendlyError(e, `Delete failed for ${c.name}`))
    } finally {
      setBusyAction(null)
    }
  }

  // PR CE — + New Campaign flow stays inside the workspace.
  //
  // PR CC originally navigated to `/` after mode select; PR CD
  // routed it to `/legacy` instead. PR CE finally mounts the
  // lane components **inside** the workspace's Campaigns tab
  // via `<CampaignLanes>`, so a mode pick keeps the operator
  // on `/spokespeople/{id}`. Header `+ New Campaign` flips
  // the active tab to "campaigns" + opens the controlled
  // `<CampaignLanes>` modal; mode select inside CampaignLanes
  // dismisses the modal and mounts the matching lane.
  const handleOpenCreateCampaign = () => {
    setActiveTab('campaigns')
    // PR DA — entering creating-new mode clears the selection so
    // the lane mounts <LaneBriefCreator> with blank fields, not
    // <LaneBriefEditor> against the previously-selected campaign.
    setCreatingNewCampaign(true)
    setSelectedCampaignId(null)
    setModeModalOpen(true)
  }
  const handleCloseCreateCampaign = () => setModeModalOpen(false)
  // PR DA — campaign-row click. Switches the active campaign and
  // exits creating-new mode so the lane shows the picked record's
  // brief / script / outputs.
  const handleSelectCampaign = (campaignId) => {
    if (!campaignId) return
    setSelectedCampaignId(campaignId)
    setCreatingNewCampaign(false)
  }
  // PR DA — operator dismisses the "New campaign" empty form
  // without saving (e.g. clicked "+ New Campaign" by mistake).
  const handleCancelCreateCampaign = () => {
    setCreatingNewCampaign(false)
    // The auto-select-newest effect will pick a campaign next render.
  }

  // PR CE — propagate a single updated Campaign from
  // `<CampaignLanes>` handlers into our local slice so lanes
  // re-render with the freshest data without a list refetch.
  const handleCampaignsChanged = (updated) => {
    if (!updated) return
    setCampaigns((cs) => {
      const idx = cs.findIndex((c) => c.id === updated.id)
      if (idx >= 0) {
        const next = cs.slice()
        next[idx] = updated
        return next
      }
      return [updated, ...cs]
    })
  }

  if (loading) {
    return (
      <main
        data-testid="spokesperson-workspace-loading"
        className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-3"
      >
        <div className="h-6 w-1/3 rounded bg-zinc-800/60 animate-pulse" />
        <div className="h-32 rounded-xl ring-1 ring-zinc-800 bg-zinc-950/40 animate-pulse" />
      </main>
    )
  }

  if (!character) {
    return (
      <main
        data-testid="spokesperson-workspace-not-found"
        className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-3 text-center"
      >
        <h1 className="text-xl font-semibold text-zinc-100">
          Spokesperson not found
        </h1>
        <p className="text-xs text-zinc-400 leading-relaxed">
          We couldn’t find a spokesperson with id{' '}
          <code className="font-mono text-zinc-300">{id}</code>. They may
          have been deleted, or the link is stale.
        </p>
        {errMsg && (
          <p className="text-[10px] text-rose-300" title={errMsg}>
            {errMsg}
          </p>
        )}
        <Link
          to="/"
          data-testid="spokesperson-workspace-back-cta"
          className="inline-block text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors"
        >
          ← Back to Library
        </Link>
      </main>
    )
  }

  // ---- header pills -------------------------------------------------
  const personaLabel =
    TEMPLATE_LABELS[character.template] || character.template || 'Spokesperson'
  const avatarStatus = character.host_avatar_status || null
  const avatarPill = (() => {
    if (avatarStatus === 'ready') {
      return { tone: 'emerald', label: 'avatar · ready' }
    }
    if (avatarStatus === 'mock') {
      return { tone: 'zinc', label: 'avatar · mock' }
    }
    if (avatarStatus === 'failed') {
      return { tone: 'rose', label: 'avatar · failed' }
    }
    if (character.host_avatar_id) {
      return { tone: 'amber', label: 'avatar · pending' }
    }
    return { tone: 'zinc', label: 'avatar · not created' }
  })()
  const voicePill = (() => {
    if (character.custom_voice_status === 'ready') {
      const drift = character.avatar_voice_drift_status
      const patch = character.custom_voice_avatar_patch_status
      if (drift === 'match') {
        return { tone: 'emerald', label: 'voice · cloned · applied · match' }
      }
      if (drift === 'drift') {
        return { tone: 'rose', label: 'voice · cloned · applied · drift' }
      }
      if (patch === 'applied' || patch === 'mock_patched') {
        return { tone: 'emerald', label: 'voice · cloned · applied' }
      }
      return { tone: 'amber', label: 'voice · cloned · pending apply' }
    }
    if (character.custom_voice_status === 'mock') {
      return { tone: 'zinc', label: 'voice · cloned (mock)' }
    }
    if (character.custom_voice_status === 'failed') {
      return { tone: 'rose', label: 'voice · clone failed' }
    }
    return {
      tone: 'zinc',
      label: `voice · preset · ${character.voice_preset || 'vincent'}`,
    }
  })()
  const pillTone = (tone) => {
    return {
      emerald: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/40',
      rose: 'bg-rose-500/15 text-rose-200 ring-rose-400/40',
      amber: 'bg-amber-500/15 text-amber-200 ring-amber-400/40',
      zinc: 'bg-zinc-800 text-zinc-400 ring-zinc-700',
    }[tone] || 'bg-zinc-800 text-zinc-400 ring-zinc-700'
  }

  return (
    <ToastProvider>
    <main
      data-testid="spokesperson-workspace"
      data-spokesperson-id={character.id}
      data-active-tab={activeTab}
      className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-4"
    >
      <header
        data-testid="spokesperson-workspace-header"
        className="rounded-2xl ring-1 ring-pink-400/15 bg-studio-900/60 p-4 shadow-panel"
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <Link
              to="/"
              data-testid="spokesperson-workspace-back-link"
              title="Back to the Spokesperson Library."
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-200 text-sm transition-colors"
              aria-label="Back to library"
            >
              ←
            </Link>
            {character.portrait_url && (
              <img
                src={character.portrait_url}
                alt={`${character.name} portrait`}
                className="h-14 w-14 rounded-lg object-cover ring-1 ring-pink-400/30"
                data-testid="spokesperson-workspace-portrait"
              />
            )}
            <div className="space-y-1 min-w-0">
              <h1
                data-testid="spokesperson-workspace-name"
                className="text-xl font-semibold text-zinc-100 leading-tight truncate"
              >
                {character.name}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  data-testid="spokesperson-workspace-persona"
                  data-template={character.template || ''}
                  className="text-[10px] rounded-full bg-pink-500/20 text-pink-200 ring-1 ring-pink-400/40 px-2 py-0.5 font-mono"
                  title="template — drives the legacy portrait + avatar prompt scaffold"
                >
                  {personaLabel}
                </span>
                <span
                  data-testid="spokesperson-workspace-avatar-pill"
                  data-tone={avatarPill.tone}
                  className={`text-[10px] rounded-full px-2 py-0.5 font-mono ring-1 ${pillTone(avatarPill.tone)}`}
                  title={`host_avatar_status=${avatarStatus || 'none'} · host_avatar_id=${character.host_avatar_id || 'none'}`}
                >
                  {avatarPill.label}
                </span>
                <span
                  data-testid="spokesperson-workspace-voice-pill"
                  data-tone={voicePill.tone}
                  className={`text-[10px] rounded-full px-2 py-0.5 font-mono ring-1 ${pillTone(voicePill.tone)}`}
                  title={`voice_preset=${character.voice_preset || 'vincent'} · custom_voice_status=${character.custom_voice_status || 'none'} · drift=${character.avatar_voice_drift_status || 'unknown'}`}
                >
                  {voicePill.label}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                {linkedCampaigns.length} linked campaign
                {linkedCampaigns.length === 1 ? '' : 's'} ·{' '}
                {character.subject || 'no description'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenCreateCampaign}
            data-testid="spokesperson-workspace-new-campaign"
            className="rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-xs px-3 py-1.5 font-semibold transition-colors"
          >
            + New Campaign
          </button>
        </div>
      </header>

      <nav
        role="tablist"
        aria-label={`Spokesperson ${character.name} workspace tabs`}
        data-testid="spokesperson-workspace-tabs"
        className="flex flex-wrap items-center gap-1.5"
      >
        {TABS.map((t) => {
          const selected = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(t.id)}
              data-testid={`spokesperson-workspace-tab-${t.id}`}
              data-active={selected ? 'true' : 'false'}
              className={
                'text-xs font-mono rounded-full px-3 py-1 transition-colors ' +
                (selected
                  ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                  : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
              }
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      {/* PR DB — live demo readiness panel. Always visible above
          the tab content so the operator can glance at it while
          prepping the submission video. Auto-derives from the
          loaded character + linkedCampaigns slices. */}
      {character && (
        <DemoReadinessPanel
          character={character}
          linkedCampaigns={linkedCampaigns}
        />
      )}

      {activeTab === 'identity' && (
        <section
          data-testid="spokesperson-workspace-identity"
          className="space-y-3"
        >
          <div className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3">
            {/* PR CP — clarify the two distinct identity concepts so
                operators don't confuse "portrait" (still image,
                gen4_image_turbo, drives the tile face + the avatar's
                referenceImage) with "Runway avatar" (talking-head
                identity created via /v1/avatars, drives lip-sync ads
                + realtime conversations). */}
            <p className="text-[10px] text-zinc-500 leading-snug px-1 pb-2">
              <span className="text-zinc-300 font-semibold">Identity.</span>{' '}
              <span className="text-zinc-300 font-medium">Portrait image</span>{' '}
              = the still face used everywhere (tile + avatar reference).{' '}
              <span className="text-zinc-300 font-medium">Runway avatar</span>{' '}
              = the talking/lip-sync identity that drives Spokesperson Ads
              and realtime conversations.
            </p>
            {/* PR CQ — responsive 2-col grid so the embedded
                CharacterCard stops dominating the page. Left column
                caps at 320px on md+ (the card's previous full-width
                behaviour was rendering the aspect-square portrait at
                the full workspace width); right column hosts the
                prompt audit + future per-identity context. On mobile
                everything stacks via the implicit 1-col grid. */}
            <div
              data-testid="spokesperson-workspace-identity-grid"
              className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] items-start"
            >
              <div className="w-full max-w-[320px] mx-auto md:mx-0">
                <CharacterCard
                  character={character}
                  busyAction={busyAction}
                  isActive={true}
                  onSetActive={null}
                  onGeneratePortrait={handleGeneratePortrait}
                  onCreateAvatar={handleCreateAvatar}
                  onDelete={handleDelete}
                  onCloneVoice={handleCloneVoice}
                  onApplyVoiceToAvatar={handleApplyVoiceToAvatar}
                  onRefreshAvatarVoice={handleRefreshAvatarVoice}
                  onRefreshVoicePreview={handleRefreshVoicePreview}
                />
              </div>
              <div className="space-y-2 min-w-0">
                {/* PR CQ — last-used portrait prompt audit surface.
                    <details> disclosure shows the prompt that
                    gen4_image_turbo actually rendered
                    (Character.portrait_prompt — set on every
                    successful generate). When empty, renders a
                    subtle inline hint instead so the right column
                    doesn't read as broken pre-portrait. */}
                {character?.portrait_prompt ? (
                  <details
                    data-testid="spokesperson-workspace-portrait-prompt"
                    data-failed={
                      character.portrait_last_error ? 'true' : 'false'
                    }
                    className={
                      'rounded-lg px-3 py-1.5 ring-1 ' +
                      (character.portrait_last_error
                        ? 'ring-rose-500/40 bg-rose-950/20'
                        : 'ring-zinc-800 bg-zinc-950/60')
                    }
                  >
                    <summary
                      className={
                        'text-[10px] cursor-pointer select-none ' +
                        (character.portrait_last_error
                          ? 'text-rose-300 hover:text-rose-100'
                          : 'text-zinc-400 hover:text-zinc-200')
                      }
                    >
                      {character.portrait_last_error
                        ? 'Last portrait FAILED — prompt sent to '
                        : 'Last portrait prompt sent to '}
                      <span className="font-mono">gen4_image_turbo</span>{' '}
                      <span
                        className={
                          character.portrait_last_error
                            ? 'text-rose-400/70'
                            : 'text-zinc-600'
                        }
                      >
                        ({character.portrait_prompt.length} chars)
                      </span>
                    </summary>
                    <pre
                      data-testid="spokesperson-workspace-portrait-prompt-text"
                      className={
                        'text-[10px] font-mono whitespace-pre-wrap leading-snug pt-2 break-words ' +
                        (character.portrait_last_error
                          ? 'text-rose-100'
                          : 'text-zinc-300')
                      }
                    >
                      {character.portrait_prompt}
                    </pre>
                    {/* PR CS — failure-specific runway error caption.
                        Shows the [code=…] / task=… surface so the
                        operator has the diagnostic line right next
                        to the prompt that produced it. */}
                    {character.portrait_last_error && (
                      <p
                        data-testid="spokesperson-workspace-portrait-prompt-error"
                        className="text-[10px] text-rose-300/80 font-mono leading-snug pt-1.5 break-words"
                      >
                        runway · {character.portrait_last_error}
                      </p>
                    )}
                  </details>
                ) : (
                  <p
                    data-testid="spokesperson-workspace-portrait-prompt-empty"
                    className="rounded-lg ring-1 ring-zinc-800/60 bg-zinc-950/40 px-3 py-2 text-[10px] text-zinc-500 leading-snug"
                  >
                    No portrait yet. Click{' '}
                    <span className="text-zinc-300 font-medium">
                      Generate Portrait
                    </span>{' '}
                    to render this spokesperson — the resolved prompt
                    sent to{' '}
                    <span className="font-mono">gen4_image_turbo</span>{' '}
                    will appear here for audit.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* PR CP — Danger zone. Explicit visible delete affordance
              the workspace lacked before. The legacy CharacterCard
              footer still carries a tiny `delete` link for /legacy
              parity; this section is the discoverable v2 path. */}
          <DangerZone
            character={character}
            busy={busyAction === 'delete'}
            onDelete={handleDelete}
            linkedCampaignCount={linkedCampaigns.length}
          />
        </section>
      )}

      {activeTab === 'knowledge' && (
        // PR CX — real Knowledge tab. Operator pastes brand notes /
        // product details / FAQs etc.; campaign lane Step 2 surfaces
        // the saved sources next to the script editor for reference.
        <KnowledgePanel
          character={character}
          onCharacterChanged={(updated) => {
            // Merge the updated record into the local slice so the
            // tab + lane re-render against the new knowledge_sources
            // list without a full /api/characters re-fetch.
            setCharacters((prev) =>
              prev.map((c) => (c.id === updated.id ? updated : c)),
            )
          }}
        />
      )}

      {activeTab === 'campaigns' && (
        <section
          data-testid="spokesperson-workspace-campaigns"
          className="space-y-3"
        >
          <header className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-0.5 min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100">
                Campaigns
              </h2>
              <p className="text-[11px] text-zinc-400 leading-snug">
                {linkedCampaigns.length === 0
                  ? 'No campaigns linked yet — pick a mode to start one for this spokesperson.'
                  : `${linkedCampaigns.length} linked campaign${
                      linkedCampaigns.length === 1 ? '' : 's'
                    }. Pick a campaign below, or create a new one. The lane edits the selected campaign.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModeModalOpen(true)}
              data-testid="spokesperson-workspace-campaigns-new"
              className="rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 text-xs px-3 py-1.5 font-semibold transition-colors"
            >
              + New Campaign
            </button>
          </header>
          {linkedCampaigns.length > 0 && (
            <ul
              data-testid="spokesperson-workspace-campaigns-list"
              className="space-y-1 text-[11px] text-zinc-300"
            >
              {linkedCampaigns
                .slice()
                .sort((a, b) =>
                  String(b.created_at || '').localeCompare(
                    String(a.created_at || ''),
                  ),
                )
                .map((c) => {
                  // PR DA — click-to-select. The active row gets a
                  // pink ring so the operator always knows which
                  // campaign the lane below is editing.
                  const isActive =
                    !creatingNewCampaign && c.id === selectedCampaignId
                  // PR DJ — count every primary video render (not just
                  // spokesperson_ad). Reels are derived and excluded
                  // so the count reads as "billable renders" rather
                  // than "every file in the campaign".
                  const primaryOutputCount = Array.isArray(c.outputs)
                    ? c.outputs.filter((o) =>
                        ['spokesperson_ad', 'dialogue_scene', 'cinematic_video'].includes(
                          o.kind,
                        ),
                      ).length
                    : 0
                  const isRendered = Boolean(
                    c.host_video_url ||
                      c.cached_video_url ||
                      c.dialogue_scene_video_url ||
                      primaryOutputCount > 0,
                  )
                  return (
                    <li
                      key={c.id}
                      data-testid="spokesperson-workspace-campaigns-row"
                      data-campaign-id={c.id}
                      data-active={isActive ? 'true' : 'false'}
                      className={
                        'rounded-md px-2 py-1.5 flex items-center justify-between gap-2 transition-colors cursor-pointer ring-1 ' +
                        (isActive
                          ? 'ring-pink-400/50 bg-pink-500/10'
                          : 'ring-zinc-800 bg-zinc-950/50 hover:ring-pink-400/30 hover:bg-zinc-900/40')
                      }
                      onClick={() => handleSelectCampaign(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectCampaign(c.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isActive}
                    >
                      <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                        {String(c.id).slice(0, 8)}
                      </span>
                      <span className="truncate flex-1">
                        {c.business || 'untitled'}
                        {c.product ? (
                          <span className="text-zinc-500"> · {c.product}</span>
                        ) : null}
                      </span>
                      {primaryOutputCount > 0 && (
                        <span
                          className="font-mono text-[9px] text-emerald-300 shrink-0"
                          title={`${primaryOutputCount} saved video render${primaryOutputCount === 1 ? '' : 's'} (Spokesperson Ad / Dialogue Scene / Cinematic — reels not counted)`}
                        >
                          {primaryOutputCount}× saved
                        </span>
                      )}
                      <span
                        className={
                          'font-mono text-[9px] shrink-0 ' +
                          (isRendered ? 'text-emerald-300' : 'text-zinc-500')
                        }
                      >
                        {isRendered ? 'rendered' : 'draft'}
                      </span>
                      {isActive ? (
                        <span
                          className="text-[9px] rounded-full bg-pink-500/30 text-pink-100 px-2 py-0.5 font-mono shrink-0"
                          aria-label="active campaign"
                        >
                          active
                        </span>
                      ) : (
                        <span
                          className="text-[9px] text-pink-300/70 font-mono shrink-0"
                          aria-hidden="true"
                        >
                          edit →
                        </span>
                      )}
                    </li>
                  )
                })}
            </ul>
          )}
          <CampaignLanes
            activeSpokesperson={character}
            linkedCampaigns={linkedCampaigns}
            campaigns={campaigns}
            modalOpen={modeModalOpen}
            onModalClose={handleCloseCreateCampaign}
            onCampaignsChanged={handleCampaignsChanged}
            selectedCampaignId={selectedCampaignId}
            creatingNewCampaign={creatingNewCampaign}
            onSelectCampaign={handleSelectCampaign}
            onCancelCreateCampaign={handleCancelCreateCampaign}
            availableCharacters={characters}
          />
        </section>
      )}

      {activeTab === 'conversations' && (
        // PR DA (Demo Pillars) — mount the existing
        // <RealtimeSpokesperson> WebRTC component against the
        // selected campaign so operators can talk to the
        // brand-aware avatar from inside the v2 workspace
        // (was only reachable via /legacy CampaignGallery).
        // RealtimeSpokesperson handles its own gated / idle /
        // live / failed states and labels real vs mock clearly.
        <ConversationsTab
          activeSpokesperson={character}
          linkedCampaigns={linkedCampaigns}
          selectedCampaignId={selectedCampaignId}
          onSelectCampaignsTab={() => setActiveTab('campaigns')}
        />
      )}

      {activeTab === 'outputs' && (
        <section
          data-testid="spokesperson-workspace-outputs"
          className="space-y-3"
        >
          {/* PR DK — Videos tab gets sub-tabs: [Videos | Conversations] */}
          <VideosTab
            linkedCampaigns={linkedCampaigns}
            character={character}
          />
        </section>
      )}

      {errMsg && (
        <p
          data-testid="spokesperson-workspace-error"
          className="text-[10px] text-rose-300 leading-snug"
          title={errMsg}
        >
          {errMsg}
        </p>
      )}
    </main>
    </ToastProvider>
  )
}

/**
 * PR DA (Demo Pillars) — Conversations tab. Wraps the existing
 * `<RealtimeSpokesperson>` WebRTC component (was only mounted in
 * the legacy CampaignGallery) against the operator's currently-
 * selected campaign. Real WebRTC realtime when `RUNWAY_API_KEY`
 * is set; gated state with explanatory copy otherwise.
 *
 * Three render states:
 *   - **No avatar yet** → friendly empty state pointing the
 *     operator at the Identity tab to bind a Runway avatar.
 *   - **No campaign selected** → empty state pointing at the
 *     Campaigns tab to pick or create a campaign.
 *   - **Ready** → mounts <RealtimeSpokesperson> with the
 *     selected campaign as context. The component itself
 *     handles its own start/live/end/failed sub-states.
 */
function ConversationsTab({
  activeSpokesperson,
  linkedCampaigns,
  selectedCampaignId,
  onSelectCampaignsTab,
}) {
  const focused = selectedCampaignId
    ? linkedCampaigns.find((c) => c.id === selectedCampaignId) || null
    : null

  const avatarReady =
    activeSpokesperson?.runway_avatar_status === 'ready' ||
    activeSpokesperson?.runway_avatar_status === 'mock'
  const avatarStatus = activeSpokesperson?.runway_avatar_status || 'none'

  let gateReason = ''
  if (!activeSpokesperson?.runway_avatar_id) {
    gateReason =
      'No Runway avatar bound yet. Open the Identity tab and click Create Avatar first.'
  } else if (!avatarReady) {
    gateReason = `Runway avatar status is "${avatarStatus}" — wait until it's ready or rebind from Identity.`
  } else if (!focused) {
    gateReason =
      'No campaign selected. Pick or create one from the Campaigns tab so the avatar has brand context.'
  }

  return (
    <section
      data-testid="spokesperson-workspace-conversations"
      data-conversation-mode={focused ? 'live-ready' : 'gated'}
      className="space-y-3"
    >
      <header className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">Conversations</h2>
        <p className="text-[11px] text-zinc-400 leading-snug">
          Talk to {activeSpokesperson?.name || 'this spokesperson'} live
          via Runway's realtime avatar. The avatar is briefed on the
          selected campaign — ask it about the product, audience, or
          pitch and hear it respond in character.{' '}
          <span className="text-zinc-500">
            Real WebRTC when{' '}
            <span className="font-mono">RUNWAY_API_KEY</span> is set;
            mock-mode shows the gated state.
          </span>
        </p>
      </header>

      {!focused && !gateReason.startsWith('No Runway avatar') && !gateReason.startsWith('Runway avatar status') && (
        <div
          data-testid="spokesperson-workspace-conversations-empty"
          className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-4 text-center space-y-2"
        >
          <p className="text-[11px] text-zinc-400 leading-snug">
            No campaign selected. Pick a campaign so the avatar can
            reference its brief.
          </p>
          <button
            type="button"
            onClick={onSelectCampaignsTab}
            data-testid="spokesperson-workspace-conversations-go-campaigns"
            className="text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors"
          >
            Go to Campaigns →
          </button>
        </div>
      )}

      {focused && (
        <div
          data-testid="spokesperson-workspace-conversations-live"
          className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-2"
        >
          <p className="text-[10px] text-zinc-500 leading-snug">
            Active campaign:{' '}
            <span className="text-zinc-300 font-medium">
              {focused.business || 'untitled'}
            </span>
            {focused.product ? (
              <span className="text-zinc-400"> · {focused.product}</span>
            ) : null}
            <span className="font-mono text-zinc-600 ml-2">
              {String(focused.id).slice(0, 8)}
            </span>
          </p>
          {/* PR DB — pre-call checklist. Collapsible (default
              open the first time the operator lands on the tab,
              closed after they click Start). Mics in untreated
              rooms picked up enough background noise during
              demo testing that the avatar paused mid-reply;
              these tips cut that down to a manageable level. */}
          <ConversationPreCallChecklist />
          <RealtimeSpokesperson
            campaign={focused}
            gateReason={gateReason || null}
          />
        </div>
      )}

      {!focused && (gateReason.startsWith('No Runway avatar') || gateReason.startsWith('Runway avatar status')) && (
        <div
          data-testid="spokesperson-workspace-conversations-gated"
          className="rounded-2xl ring-1 ring-amber-500/30 bg-amber-500/[0.04] p-4 text-center space-y-2"
        >
          <p className="text-[11px] text-amber-200 leading-snug">{gateReason}</p>
        </div>
      )}
    </section>
  )
}


/**
 * PR DB — Live demo readiness panel. Auto-derives the
 * submission-day checklist from the loaded character +
 * linked-campaigns slice so the operator gets a live view of
 * "is this spokesperson ready for the demo". No backend
 * calls; reads state we already have.
 *
 * The full operator checklist lives in `docs/DEMO_CHECKLIST.md`;
 * this UI surface is the live version of the per-spokesperson
 * portion (items 1–4 of the checklist for this character).
 *
 * Collapsed by default — opens with one click. testids let the
 * smoke / manual QA confirm the right items light up.
 */
function DemoReadinessPanel({ character, linkedCampaigns }) {
  const hasPortrait = Boolean(character?.portrait_url)
  const avatarReady =
    Boolean(character?.runway_avatar_id) &&
    ['ready', 'mock'].includes(character?.runway_avatar_status || '')
  const hasKnowledge =
    Array.isArray(character?.knowledge_sources) &&
    character.knowledge_sources.length > 0
  const campaignsArr = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const hasCampaign = campaignsArr.length > 0
  const hasScript = campaignsArr.some(
    (c) => String(c?.commercial_script || '').trim().length > 0,
  )
  const adOutputCount = campaignsArr.reduce((acc, c) => {
    const outs = Array.isArray(c?.outputs) ? c.outputs : []
    return acc + outs.filter((o) => o.kind === 'spokesperson_ad').length
  }, 0)
  const hasRenderedAd =
    adOutputCount > 0 ||
    campaignsArr.some(
      (c) => c?.host_video_url && c?.host_status === 'ok',
    )

  const items = [
    { key: 'portrait', label: 'Portrait generated', ok: hasPortrait },
    { key: 'avatar', label: 'Runway avatar ready', ok: avatarReady },
    { key: 'knowledge', label: 'At least one knowledge source', ok: hasKnowledge },
    { key: 'campaign', label: 'At least one linked campaign', ok: hasCampaign },
    { key: 'script', label: 'A campaign has a saved script', ok: hasScript },
    { key: 'rendered-ad', label: 'At least one rendered Spokesperson Ad', ok: hasRenderedAd },
  ]
  const okCount = items.filter((i) => i.ok).length
  const total = items.length
  const allGreen = okCount === total

  return (
    <details
      data-testid="spokesperson-workspace-demo-readiness"
      data-ok-count={okCount}
      data-total={total}
      data-all-green={allGreen ? 'true' : 'false'}
      className={
        'rounded-2xl px-3 py-1.5 ring-1 ' +
        (allGreen
          ? 'ring-emerald-400/40 bg-emerald-500/[0.06]'
          : 'ring-amber-400/30 bg-amber-500/[0.04]')
      }
    >
      <summary
        className={
          'text-[11px] cursor-pointer select-none font-semibold leading-snug ' +
          (allGreen ? 'text-emerald-100' : 'text-amber-100')
        }
      >
        {allGreen ? '✅' : '🟡'} Demo readiness · {okCount}/{total} for{' '}
        {character?.name || 'this spokesperson'}
      </summary>
      <ul className="text-[10px] leading-snug pt-1.5 space-y-0.5">
        {items.map((item) => (
          <li
            key={item.key}
            data-testid="spokesperson-workspace-demo-readiness-item"
            data-key={item.key}
            data-ok={item.ok ? 'true' : 'false'}
            className={item.ok ? 'text-emerald-200' : 'text-zinc-400'}
          >
            <span className="font-mono">
              [{item.ok ? '✓' : ' '}]
            </span>{' '}
            {item.label}
          </li>
        ))}
      </ul>
      <p className="text-[9px] text-zinc-500 leading-snug pt-1.5">
        Full submission-day checklist lives in{' '}
        <span className="font-mono text-zinc-400">docs/DEMO_CHECKLIST.md</span>.
        This panel covers items 1–4 for this spokesperson.
      </p>
    </details>
  )
}


/**
 * PR DB — Pre-call checklist for the Conversations tab. Live
 * realtime sessions with the avatar pick up background noise
 * sensitively; the SDK doesn't expose a mute toggle, so the
 * cleanest demo-reliability lever is operator guidance up
 * front. Collapsible <details> so repeat sessions don't get
 * blocked by a wall of copy.
 */
function ConversationPreCallChecklist() {
  return (
    <details
      data-testid="spokesperson-workspace-conversations-precall"
      className="rounded-lg ring-1 ring-zinc-800 bg-zinc-950/60 px-3 py-1.5"
      open
    >
      <summary className="text-[11px] text-zinc-300 cursor-pointer select-none hover:text-zinc-100 font-semibold">
        Before you click Start Conversation
      </summary>
      <ul className="text-[11px] text-zinc-400 leading-snug pt-1.5 space-y-1 list-disc list-inside">
        <li>Use headphones if you can — open speakers let the avatar's voice loop into your mic.</li>
        <li>Reduce background noise (close noisy tabs, mute Slack, kill the fan).</li>
        <li>Click <span className="text-zinc-200 font-medium">Allow</span> when the browser asks for mic permission.</li>
        <li>Wait for the avatar to finish speaking before you reply — overlapping audio is what makes it pause.</li>
        <li>If the avatar stalls or repeats, click <span className="text-zinc-200 font-medium">End Conversation</span>, then <span className="text-zinc-200 font-medium">Retry Conversation</span>. The 5-minute Runway session restarts fresh.</li>
        <li>Sessions auto-end at the countdown timer (Runway's hard 5-min cap).</li>
      </ul>
      <p className="text-[10px] text-zinc-500 leading-snug pt-1.5">
        Webcam is off by default. The avatar reads your selected
        campaign's brief + saved script as context — pick a
        different campaign in the Campaigns tab to change the
        conversation focus.
      </p>
    </details>
  )
}


/**
 * PR CP — Danger zone. Explicit, discoverable delete affordance
 * the workspace lacked before (the legacy CharacterCard footer
 * carries a tiny 9px `delete` link that QA called out as
 * un-discoverable in SESSION 070).
 *
 * The two-step UX:
 *   - first click reveals the typed-name confirmation field +
 *     the destructive button
 *   - operator must type the spokesperson's name exactly, then
 *     press Delete — guards against accidental clicks
 *   - Cancel collapses the zone back
 *
 * Behaviour:
 *   - Delegates the actual API call to `onDelete(character)`
 *     (`SpokespersonWorkspace.handleDelete`) — same plumbing the
 *     legacy footer already uses, so the navigation + error
 *     surfaces stay identical.
 *   - The window.confirm() prompt inside `handleDelete` is kept
 *     as a final no-net safety check; this UI is the discoverable
 *     guard.
 */
function DangerZone({ character, busy, onDelete, linkedCampaignCount }) {
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')
  const expected = (character?.name || '').trim()
  const matchOk = typed.trim() === expected && expected.length > 0

  const handleArm = () => {
    setArmed(true)
    setTyped('')
  }

  const handleCancel = () => {
    setArmed(false)
    setTyped('')
  }

  const handleConfirm = () => {
    if (!matchOk || busy) return
    onDelete?.(character)
  }

  return (
    <section
      data-testid="spokesperson-workspace-danger-zone"
      className="rounded-2xl ring-1 ring-rose-900/60 bg-rose-950/20 p-3 space-y-2"
    >
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="text-xs font-semibold text-rose-200">
            Danger zone
          </h2>
          <p className="text-[10px] text-rose-300/70 leading-snug">
            Delete this spokesperson record. Linked campaigns
            stay in place but become unlinked (orphaned) — you
            can re-link them via a fresh spokesperson with the
            same name. Generated portraits / avatars / voice
            clones on Runway are{' '}
            <span className="font-semibold text-rose-200">not</span>{' '}
            removed by this action — clean those up via the
            Runway dashboard if needed.
          </p>
        </div>
        {!armed && (
          <button
            type="button"
            data-testid="spokesperson-workspace-delete"
            onClick={handleArm}
            disabled={busy}
            className="text-[11px] font-mono rounded-md ring-1 ring-rose-400/40 bg-rose-500/15 hover:bg-rose-500/30 text-rose-100 px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete this spokesperson"
          >
            Delete spokesperson
          </button>
        )}
      </header>
      {armed && (
        <div
          data-testid="spokesperson-workspace-delete-confirm"
          className="space-y-2 pt-1"
        >
          <p className="text-[10px] text-rose-200 leading-snug">
            Type{' '}
            <span className="font-mono font-semibold">{expected}</span>{' '}
            to confirm.{' '}
            {linkedCampaignCount > 0 && (
              <span className="text-rose-300">
                ({linkedCampaignCount} linked campaign
                {linkedCampaignCount === 1 ? '' : 's'} will be
                unlinked.)
              </span>
            )}
          </p>
          <input
            type="text"
            data-testid="spokesperson-workspace-delete-name-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            autoFocus
            disabled={busy}
            className="w-full rounded-md ring-1 ring-rose-700 bg-zinc-900 text-rose-100 text-xs px-2 py-1.5 font-mono placeholder:text-rose-300/40 focus:outline-none focus:ring-rose-400 disabled:opacity-60"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="spokesperson-workspace-delete-confirm-button"
              onClick={handleConfirm}
              disabled={!matchOk || busy}
              data-armed={matchOk ? 'true' : 'false'}
              className="text-[11px] font-mono rounded-md ring-1 ring-rose-400/60 bg-rose-500/30 hover:bg-rose-500/55 text-rose-50 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              data-testid="spokesperson-workspace-delete-cancel"
              onClick={handleCancel}
              disabled={busy}
              className="text-[11px] rounded-md ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function TabComingSoon({ testid, title, summary, tease }) {
  return (
    <section
      data-testid={testid}
      className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-5 space-y-2 text-center"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <p className="text-[11px] text-zinc-400 leading-relaxed max-w-prose mx-auto">
          {summary}
        </p>
      </div>
      <p className="text-[10px] rounded-full bg-pink-500/15 text-pink-200 ring-1 ring-pink-400/30 px-2 py-0.5 font-mono inline-block">
        {tease}
      </p>
    </section>
  )
}
