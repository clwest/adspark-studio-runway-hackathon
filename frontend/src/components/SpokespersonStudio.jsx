import { useEffect, useState } from 'react'

import { api } from '../api'
import { friendlyError } from '../errors'
import SpokespersonCard from './SpokespersonCard.jsx'

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
}) {
  const [characters, setCharacters] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')
  const [busyByChar, setBusyByChar] = useState({})

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
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <h3
            className="font-semibold flex items-center gap-2"
            data-testid="spokesperson-studio-heading"
          >
            Spokesperson Studio
            <span
              className="text-[10px] rounded-full bg-pink-500/20 text-pink-300 px-2 py-0.5 font-mono"
              title="UX v2 preview — gated by ?ux=v2 / localStorage adspark.ux"
            >
              preview UX
            </span>
            <span
              className="text-[10px] rounded-full bg-zinc-800 text-zinc-300 px-2 py-0.5 font-mono"
              title="Reuses the existing /api/characters store; backend unchanged."
            >
              Runway-powered
            </span>
          </h3>
          <p className="text-xs text-zinc-400 max-w-prose leading-relaxed">
            Create persistent AI spokespeople that can star in ads,
            hold conversations, and live across campaigns. The
            preview UX surfaces them as durable identities first;
            campaigns get attached on top.
          </p>
        </div>
      </div>

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
              The classic Character Studio (toggle UX in the footer)
              still owns creation — picker + portrait + voice clone
              flows ship into the preview UX in subsequent slices.
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
              busyAction={busyByChar[c.id] || null}
              isActive={c.id === activeCharacterId}
              onSetActive={
                onSetActive
                  ? (next) => onSetActive(next ? c.id : null)
                  : undefined
              }
              onGeneratePortrait={handleGeneratePortrait}
              onCreateAvatar={handleCreateAvatar}
              onDelete={handleDelete}
              onCloneVoice={handleCloneVoice}
              onApplyVoiceToAvatar={handleApplyVoiceToAvatar}
              onRefreshAvatarVoice={handleRefreshAvatarVoice}
              onRefreshVoicePreview={handleRefreshVoicePreview}
              // PR BF — only the campaigns linked to this character
              // via character_id; empty array when nothing matches.
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
