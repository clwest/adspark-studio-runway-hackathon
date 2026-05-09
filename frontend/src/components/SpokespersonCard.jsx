import { useState } from 'react'

import CharacterCard from './CharacterCard.jsx'

/**
 * PR BE — Spokesperson card (gated v2 surface).
 *
 * Wraps the existing PR K CharacterCard tile in a three-tab shell
 * (Identity / Knowledge / Appearances). For PR BE only the Identity
 * tab is wired — it embeds the full CharacterCard so the operator
 * gets parity with v1 (portrait, voice clone, recording, mic level
 * meter, recorded preview, cloned preview, avatar patch / verify /
 * drift / repair / refresh / freshness, voice history disclosure,
 * action row).
 *
 * Knowledge + Appearances render placeholder copy in this slice.
 * They land in PR BF / PR BG respectively.
 *
 * Backend untouched. Same `Character` data the v1 tile reads.
 */
const TABS = [
  { id: 'identity', label: 'Identity' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'appearances', label: 'Appearances' },
]

export default function SpokespersonCard({
  character,
  busyAction,
  // PR U — Spokesperson-first flow handlers, passed through to the
  // embedded CharacterCard so the v2 surface preserves every v1
  // affordance.
  isActive = false,
  onSetActive,
  onGeneratePortrait,
  onCreateAvatar,
  onDelete,
  onCloneVoice,
  onApplyVoiceToAvatar,
  onRefreshAvatarVoice,
  onRefreshVoicePreview,
}) {
  const [activeTab, setActiveTab] = useState('identity')
  const c = character

  return (
    <div
      className="rounded-lg ring-1 ring-pink-400/15 bg-zinc-950/40 p-1.5 space-y-1.5"
      data-testid="spokesperson-card"
      data-spokesperson-id={c.id}
    >
      {/* Tab strip — three lanes, Identity is selected by default. */}
      <div
        className="flex items-center gap-1 px-1 pt-0.5"
        role="tablist"
        aria-label={`Spokesperson ${c.name} sections`}
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
              data-testid={`spokesperson-tab-${t.id}`}
              data-active={selected ? 'true' : 'false'}
              className={
                'text-[10px] font-mono rounded-full px-2 py-0.5 transition-colors ' +
                (selected
                  ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                  : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Active tab content — Identity embeds the full CharacterCard
          so every v1 voice affordance keeps working under v2 without
          rewriting. PR BF / PR BG replace the placeholders with real
          Knowledge + Appearances content. */}
      {activeTab === 'identity' && (
        <div data-testid="spokesperson-identity-tab">
          <CharacterCard
            character={c}
            busyAction={busyAction}
            isActive={isActive}
            onSetActive={onSetActive}
            onGeneratePortrait={onGeneratePortrait}
            onCreateAvatar={onCreateAvatar}
            onDelete={onDelete}
            onCloneVoice={onCloneVoice}
            onApplyVoiceToAvatar={onApplyVoiceToAvatar}
            onRefreshAvatarVoice={onRefreshAvatarVoice}
            onRefreshVoicePreview={onRefreshVoicePreview}
          />
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div
          data-testid="spokesperson-knowledge-tab"
          className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400 min-h-[140px] flex flex-col items-center justify-center text-center gap-1"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Knowledge
          </span>
          <p className="leading-snug max-w-[24ch]">
            Knowledge wiring lands next.
          </p>
          <p className="text-[10px] text-zinc-600 max-w-[28ch] leading-snug">
            Will surface attached grounding documents + cross-campaign
            transcripts so this spokesperson's "what they know" is
            inspectable in one place.
          </p>
        </div>
      )}

      {activeTab === 'appearances' && (
        <div
          data-testid="spokesperson-appearances-tab"
          className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-400 min-h-[140px] flex flex-col items-center justify-center text-center gap-1"
        >
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
            Appearances
          </span>
          <p className="leading-snug max-w-[24ch]">
            Campaign appearances land next.
          </p>
          <p className="text-[10px] text-zinc-600 max-w-[28ch] leading-snug">
            Will list every campaign this spokesperson stars in with
            mode badge + last-touched timestamp + click-through to the
            saved card.
          </p>
        </div>
      )}
    </div>
  )
}
