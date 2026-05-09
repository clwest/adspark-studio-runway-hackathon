import { useState } from 'react'

import CharacterCard from './CharacterCard.jsx'
import { formatHistoryTimestamp } from '../uiHelpers.js'

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

// PR BF — small local helpers for Knowledge tab rendering. Kept
// inline rather than promoted to uiHelpers.js because they read
// campaign shape directly; once Appearances ships in PR BG and
// reuses the same vocabulary they can graduate to a shared module.

/**
 * Compact relative-time formatter for Knowledge rows. Reuses the
 * shared bucket formatter from uiHelpers.js so the relative-time
 * vocabulary stays consistent with the voice history disclosure.
 * Returns "—" for missing / unparseable timestamps so the row
 * always has something to render.
 */
function formatKnowledgeTime(iso) {
  if (!iso) return '—'
  const formatted = formatHistoryTimestamp(iso)
  return formatted || '—'
}

/**
 * Map a campaign's grounding state to a label + Tailwind pill
 * class. Mirrors the vocabulary the Realtime grounding card uses
 * in CampaignGallery so v1 + v2 surfaces report the same status.
 */
function groundingLabel(campaign) {
  const status = campaign.runway_document_status
  const isGrounded = Boolean(campaign.runway_document_id)
  if (status === 'failed')
    return {
      label: 'Failed',
      className:
        'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40',
    }
  if (isGrounded && status === 'mock')
    return {
      label: 'Document-grounded · mock',
      className:
        'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40',
    }
  if (isGrounded && (status === 'ready' || campaign.runway_document_mock_mode === false))
    return {
      label: 'Document-grounded',
      className:
        'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40',
    }
  return {
    label: 'Prompt-grounded',
    className:
      'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700',
  }
}

/**
 * Friendly campaign label: prefer "Business · Product" when both
 * exist, otherwise fall back to whichever is set, otherwise the
 * campaign id. Truncates each side to ~28 chars so a wide product
 * doesn't blow the row layout.
 */
function campaignLabel(campaign) {
  const trim = (s) => {
    if (!s) return ''
    const t = String(s).trim()
    return t.length > 28 ? t.slice(0, 28) + '…' : t
  }
  const business = trim(campaign.business)
  const product = trim(campaign.product)
  if (business && product) return `${business} · ${product}`
  if (business) return business
  if (product) return product
  return `Untitled campaign · ${String(campaign.id || '').slice(0, 6)}`
}

/**
 * Aggregate the Knowledge summary stats from a list of campaigns.
 * Used by the per-spokesperson summary row at the top of the
 * Knowledge tab. ``lastFetchedAt`` is the maximum
 * ``realtime_transcript_fetched_at`` across all linked campaigns
 * (string compare is correct for ISO-8601).
 */
function summariseKnowledge(linkedCampaigns) {
  const campaigns = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  const groundedCount = campaigns.filter(
    (c) =>
      Boolean(c.runway_document_id) &&
      ['ready', 'mock'].includes(String(c.runway_document_status || '')),
  ).length
  const transcriptCount = campaigns.reduce(
    (sum, c) =>
      sum + (Array.isArray(c.realtime_transcript_history) ? c.realtime_transcript_history.length : 0),
    0,
  )
  const lastFetchedAt = campaigns.reduce((acc, c) => {
    const at = c.realtime_transcript_fetched_at
    if (!at) return acc
    return !acc || String(at) > String(acc) ? at : acc
  }, null)
  return {
    linkedCount: campaigns.length,
    groundedCount,
    transcriptCount,
    lastFetchedAt,
  }
}

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
  // PR BF — pre-filtered campaigns linked to this character via
  // ``character_id``. SpokespersonStudio indexes once per render
  // and forwards each card its own slice; empty array when no
  // campaigns currently use this spokesperson.
  linkedCampaigns = [],
}) {
  const [activeTab, setActiveTab] = useState('identity')
  const c = character
  const knowledge = summariseKnowledge(linkedCampaigns)

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
          className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-300 min-h-[140px] space-y-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Knowledge
            </span>
            <span className="text-[10px] text-zinc-600 font-mono">
              {linkedCampaigns.length > 0
                ? `${linkedCampaigns.length} linked`
                : 'unlinked'}
            </span>
          </div>

          {/* Summary row — always renders when at least one campaign
              links to this spokesperson; otherwise the empty state
              below replaces it. */}
          {linkedCampaigns.length > 0 ? (
            <p
              data-testid="spokesperson-knowledge-summary"
              className="text-[11px] text-zinc-300 leading-snug"
              title={
                knowledge.lastFetchedAt
                  ? `Most recent transcript fetch: ${knowledge.lastFetchedAt}`
                  : 'No transcripts fetched yet for any linked campaign.'
              }
            >
              <span className="font-mono">
                {knowledge.linkedCount}
              </span>{' '}
              {knowledge.linkedCount === 1 ? 'campaign' : 'campaigns'}
              {' · '}
              <span className="font-mono">
                {knowledge.groundedCount}
              </span>{' '}
              grounded
              {' · '}
              <span className="font-mono">
                {knowledge.transcriptCount}
              </span>{' '}
              transcripts
              {knowledge.lastFetchedAt && (
                <>
                  {' · last fetch '}
                  <span className="font-mono text-zinc-400">
                    {formatKnowledgeTime(knowledge.lastFetchedAt)}
                  </span>
                </>
              )}
            </p>
          ) : (
            <div
              data-testid="spokesperson-knowledge-empty"
              className="space-y-1"
            >
              <p className="text-[11px] text-zinc-400 leading-snug">
                No linked campaigns yet.
              </p>
              <p className="text-[10px] text-zinc-600 leading-snug">
                Attach this spokesperson to a campaign — grounding
                documents (PR AI) and transcript history (PR BC) will
                surface here automatically as the campaign runs.
              </p>
            </div>
          )}

          {/* Per-campaign rows — one line per linked campaign with
              business / product label, grounding pill, transcript
              count, and last-fetched time. */}
          {linkedCampaigns.length > 0 && (
            <ul className="space-y-0.5">
              {linkedCampaigns.map((cm) => {
                const grounding = groundingLabel(cm)
                const turns = Array.isArray(cm.realtime_transcript_history)
                  ? cm.realtime_transcript_history.length
                  : 0
                return (
                  <li
                    key={cm.id}
                    data-testid="spokesperson-knowledge-row"
                    data-campaign-id={cm.id}
                    className="flex items-center gap-1 text-[10px] leading-snug flex-wrap rounded bg-zinc-950/40 ring-1 ring-zinc-800 px-1.5 py-1"
                    title={`campaign ${cm.id}${
                      cm.realtime_transcript_fetched_at
                        ? ' · last fetch ' + cm.realtime_transcript_fetched_at
                        : ''
                    }`}
                  >
                    <span className="text-zinc-200 font-mono truncate max-w-[22ch]">
                      {campaignLabel(cm)}
                    </span>
                    <span
                      className={`rounded px-1 py-0.5 font-mono ${grounding.className}`}
                    >
                      {grounding.label}
                    </span>
                    <span className="text-zinc-500 font-mono">
                      {turns} {turns === 1 ? 'transcript' : 'transcripts'}
                    </span>
                    <span className="ml-auto text-zinc-600 font-mono">
                      {formatKnowledgeTime(cm.realtime_transcript_fetched_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
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
