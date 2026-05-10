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

const TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'outputs', label: 'Outputs' },
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
    setModeModalOpen(true)
  }
  const handleCloseCreateCampaign = () => setModeModalOpen(false)

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

      {activeTab === 'identity' && (
        <section
          data-testid="spokesperson-workspace-identity"
          className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3"
        >
          <p className="text-[10px] text-zinc-500 leading-snug px-1 pb-2">
            Identity — portrait + voice clone + Runway avatar binding.
            PR CC embeds the existing card-level affordances; PR CD
            splits this into a dedicated IdentityPanel + VoicePanel.
          </p>
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
        </section>
      )}

      {activeTab === 'knowledge' && (
        <TabComingSoon
          testid="spokesperson-workspace-knowledge"
          title="Knowledge"
          summary={`This spokesperson has ${linkedCampaigns.length} linked campaign${
            linkedCampaigns.length === 1 ? '' : 's'
          }. The Knowledge panel surfaces grounding documents + transcript history; the wiring lands in PR CD.`}
          tease="Knowledge panel lands next."
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
                    }. Each lane below targets the most-recent campaign.`}
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
                .map((c) => (
                  <li
                    key={c.id}
                    data-testid="spokesperson-workspace-campaigns-row"
                    data-campaign-id={c.id}
                    className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/50 px-2 py-1.5 flex items-center justify-between gap-2"
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
                    <span className="font-mono text-[9px] text-zinc-500 shrink-0">
                      {c.cached_video_url ||
                      c.host_video_url ||
                      c.dialogue_scene_video_url
                        ? 'rendered'
                        : 'draft'}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <CampaignLanes
            activeSpokesperson={character}
            linkedCampaigns={linkedCampaigns}
            campaigns={campaigns}
            modalOpen={modeModalOpen}
            onModalClose={handleCloseCreateCampaign}
            onCampaignsChanged={handleCampaignsChanged}
          />
        </section>
      )}

      {activeTab === 'conversations' && (
        <TabComingSoon
          testid="spokesperson-workspace-conversations"
          title="Conversations"
          summary="Realtime sessions and transcript replays for this spokesperson."
          tease="Realtime conversations land next."
        />
      )}

      {activeTab === 'outputs' && (
        <TabComingSoon
          testid="spokesperson-workspace-outputs"
          title="Outputs"
          summary="Unified gallery of cinematic, spokesperson ad, dialogue, reels, and voice outputs across every linked campaign."
          tease="Output gallery lands next."
        />
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
