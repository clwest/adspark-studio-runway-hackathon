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
  // PR CB — count cached outputs across all linked campaigns
  // for the tile-level summary chip. Mirrors the Library
  // stats-row math so per-spokesperson + library-wide totals
  // stay consistent.
  const outputCount = campaigns.reduce((sum, c) => {
    let n = 0
    if (c.cached_video_url) n += 1
    if (c.host_video_url) n += 1
    if (c.voiced_commercial_url) n += 1
    if (c.storyboard_video_url) n += 1
    if (c.spokesperson_reels_url) n += 1
    if (c.dialogue_scene_video_url) n += 1
    if (c.dialogue_scene_reels_url) n += 1
    return sum + n
  }, 0)
  return {
    linkedCount: campaigns.length,
    groundedCount,
    transcriptCount,
    lastFetchedAt,
    outputCount,
  }
}

// PR BG — Appearances tab helpers ----------------------------------

/**
 * Colour vocabulary for the inferred-mode badge on each appearance
 * row. Mirrors the ad-mode picker palette where it overlaps so v1
 * + v2 surfaces feel consistent.
 */
const MODE_PILL_CLASSES = Object.freeze({
  Cinematic:
    'bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-400/40',
  'Spokesperson Ad':
    'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40',
  'Dialogue Scene':
    'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40',
  Storyboard:
    'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40',
  Realtime:
    'bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/40',
  Mixed:
    'bg-pink-500/20 text-pink-200 ring-1 ring-pink-400/40',
  Draft:
    'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700',
})

/**
 * Deterministic mode inference — derive the campaign's primary
 * "lane" from which output URLs / lists are populated. Order of
 * precedence locks the brief: dialogue → spokesperson →
 * storyboard → cinematic → realtime → draft. Two or more *strong*
 * outputs (anything except realtime/draft) collapse to "Mixed".
 */
function inferCampaignMode(campaign) {
  if (!campaign || typeof campaign !== 'object') return 'Draft'
  const flags = {
    dialogue:
      Boolean(campaign.dialogue_scene_video_url) ||
      Boolean(campaign.dialogue_scene_reels_url) ||
      (Array.isArray(campaign.dialogue_lines) &&
        campaign.dialogue_lines.length > 0),
    spokesperson:
      Boolean(campaign.host_video_url) ||
      Boolean(campaign.spokesperson_reels_url),
    storyboard:
      Boolean(campaign.storyboard_video_url) ||
      Boolean(campaign.storyboard_voiced_url) ||
      (Array.isArray(campaign.storyboard_shots) &&
        campaign.storyboard_shots.length > 0),
    cinematic:
      Boolean(campaign.cached_video_url) ||
      Boolean(campaign.voiced_commercial_url),
    realtime:
      Boolean(campaign.runway_conversation_id) ||
      (Array.isArray(campaign.realtime_transcript_history) &&
        campaign.realtime_transcript_history.length > 0),
  }
  const strong = ['dialogue', 'spokesperson', 'storyboard', 'cinematic']
  const strongHits = strong.filter((k) => flags[k])
  if (strongHits.length >= 2) return 'Mixed'
  if (flags.dialogue) return 'Dialogue Scene'
  if (flags.spokesperson) return 'Spokesperson Ad'
  if (flags.storyboard) return 'Storyboard'
  if (flags.cinematic) return 'Cinematic'
  if (flags.realtime) return 'Realtime'
  return 'Draft'
}

/**
 * Pick the most recent meaningful timestamp on a campaign so the
 * appearance row can render "last touched 5m ago" without
 * surfacing only the static created_at. Considers (in order):
 *   - max(realtime_transcript_history[*].fetched_at)
 *   - realtime_transcript_fetched_at
 *   - commercial_script_updated_at
 *   - created_at
 *
 * Returns the latest ISO string or `null` when nothing is set.
 * String compare is correct for ISO-8601.
 */
function campaignLastTouched(campaign) {
  if (!campaign) return null
  const candidates = []
  if (Array.isArray(campaign.realtime_transcript_history)) {
    for (const e of campaign.realtime_transcript_history) {
      if (e && e.fetched_at) candidates.push(e.fetched_at)
    }
  }
  if (campaign.realtime_transcript_fetched_at)
    candidates.push(campaign.realtime_transcript_fetched_at)
  if (campaign.commercial_script_updated_at)
    candidates.push(campaign.commercial_script_updated_at)
  if (campaign.created_at) candidates.push(campaign.created_at)
  if (candidates.length === 0) return null
  return candidates.reduce((acc, v) =>
    !acc || String(v) > String(acc) ? v : acc,
  )
}

/**
 * One-line list of available outputs / states for the appearance
 * row. Short labels so several can fit before the row wraps; the
 * caller can slice() to keep the display compact.
 */
function campaignOutputSummary(campaign) {
  if (!campaign) return []
  const labels = []
  if (campaign.spokesperson_reels_url) labels.push('Reels')
  if (campaign.dialogue_scene_video_url) labels.push('Dialogue stitched')
  if (campaign.dialogue_scene_reels_url) labels.push('Dialogue Reels')
  if (campaign.voiced_commercial_url) labels.push('Voiced')
  if (campaign.storyboard_video_url) labels.push('Storyboard')
  if (campaign.storyboard_voiced_url) labels.push('Voiced Storyboard')
  if (campaign.host_video_url && !campaign.spokesperson_reels_url)
    labels.push('Spokesperson cut')
  if (
    campaign.runway_document_id &&
    ['ready', 'mock'].includes(String(campaign.runway_document_status || ''))
  )
    labels.push('Grounded')
  const transcripts = Array.isArray(campaign.realtime_transcript_history)
    ? campaign.realtime_transcript_history.length
    : 0
  if (transcripts > 0)
    labels.push(`${transcripts} ${transcripts === 1 ? 'transcript' : 'transcripts'}`)
  return labels
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
  // PR BR — Appearances click-through. SpokespersonStudio
  // (parent) bubbles the call up to App.jsx which sets
  // openCampaignId on the v1 CampaignGallery to scroll +
  // highlight the matching saved card.
  onOpenCampaign = null,
}) {
  const [activeTab, setActiveTab] = useState('identity')
  const c = character
  const knowledge = summariseKnowledge(linkedCampaigns)

  // PR CB — tile-level summary chips. Surfaces the at-a-glance
  // info the brief calls out: voice state, linked campaigns
  // count, outputs count. The chips are read-only telemetry —
  // every actionable affordance lives in the Identity tab below
  // (which embeds the full CharacterCard). The summariseKnowledge
  // helper already returns linked-campaign + output counts.
  const voiceState = (() => {
    if (c.custom_voice_status === 'ready') {
      const drift = c.avatar_voice_drift_status
      const patch = c.custom_voice_avatar_patch_status
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
    if (c.custom_voice_status === 'mock') {
      return { tone: 'zinc', label: 'voice · cloned (mock)' }
    }
    if (c.custom_voice_status === 'failed') {
      return { tone: 'rose', label: 'voice · clone failed' }
    }
    return { tone: 'zinc', label: `voice · preset · ${c.voice_preset || 'vincent'}` }
  })()
  const voiceToneClass = {
    emerald: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/40',
    rose: 'bg-rose-500/15 text-rose-200 ring-rose-400/40',
    amber: 'bg-amber-500/15 text-amber-200 ring-amber-400/40',
    zinc: 'bg-zinc-800 text-zinc-400 ring-zinc-700',
  }[voiceState.tone]

  return (
    <div
      className="rounded-lg ring-1 ring-pink-400/15 bg-zinc-950/40 p-1.5 space-y-1.5"
      data-testid="spokesperson-card"
      data-spokesperson-id={c.id}
    >
      {/* PR CB — at-a-glance summary chips. Read-only; the real
          voice / portrait / avatar affordances live inside the
          Identity tab's CharacterCard below. Each chip carries a
          stable testid + data attr so the smoke can assert
          structure without coupling to copy. */}
      <div
        data-testid="spokesperson-card-summary"
        data-linked-count={linkedCampaigns.length}
        data-output-count={knowledge.outputCount || 0}
        data-voice-tone={voiceState.tone}
        className="flex flex-wrap items-center gap-1 px-1 pt-0.5"
      >
        <span
          data-testid="spokesperson-summary-voice"
          title={`voice_preset=${c.voice_preset || 'vincent'} · custom_voice_status=${c.custom_voice_status || 'none'} · drift=${c.avatar_voice_drift_status || 'unknown'}`}
          className={`text-[9px] rounded-full px-2 py-0.5 font-mono ring-1 ${voiceToneClass}`}
        >
          {voiceState.label}
        </span>
        <span
          data-testid="spokesperson-summary-linked"
          title={`${linkedCampaigns.length} campaigns linked via character_id`}
          className="text-[9px] rounded-full bg-zinc-800/70 text-zinc-300 ring-1 ring-zinc-700 px-2 py-0.5 font-mono"
        >
          {linkedCampaigns.length} campaigns
        </span>
        {knowledge.outputCount > 0 && (
          <span
            data-testid="spokesperson-summary-outputs"
            title="Cached MP4 / MP3 outputs across all linked campaigns."
            className="text-[9px] rounded-full bg-zinc-800/70 text-zinc-300 ring-1 ring-zinc-700 px-2 py-0.5 font-mono"
          >
            {knowledge.outputCount} outputs
          </span>
        )}
      </div>

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
          className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/60 p-3 text-[11px] text-zinc-300 min-h-[140px] space-y-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Appearances
            </span>
            <span className="text-[10px] text-zinc-600 font-mono">
              {linkedCampaigns.length > 0
                ? `${linkedCampaigns.length} ${
                    linkedCampaigns.length === 1 ? 'campaign' : 'campaigns'
                  }`
                : 'none yet'}
            </span>
          </div>

          {linkedCampaigns.length > 0 ? (
            <ul className="space-y-1">
              {linkedCampaigns.map((cm) => {
                const mode = inferCampaignMode(cm)
                const modeClass =
                  MODE_PILL_CLASSES[mode] || MODE_PILL_CLASSES.Draft
                const touchedIso = campaignLastTouched(cm)
                const outputs = campaignOutputSummary(cm)
                const visibleOutputs = outputs.slice(0, 5)
                const overflow = outputs.length - visibleOutputs.length
                return (
                  <li
                    key={cm.id}
                    data-testid="spokesperson-appearance-row"
                    data-campaign-id={cm.id}
                    data-mode={mode}
                    className="space-y-0.5 rounded bg-zinc-950/40 ring-1 ring-zinc-800 px-1.5 py-1"
                    title={`campaign ${cm.id}${
                      touchedIso ? ' · last touched ' + touchedIso : ''
                    }`}
                  >
                    <div className="flex items-center gap-1 flex-wrap text-[10px]">
                      <span className="text-zinc-200 font-mono truncate max-w-[22ch]">
                        {campaignLabel(cm)}
                      </span>
                      <span
                        data-testid="spokesperson-appearance-mode"
                        className={`rounded px-1 py-0.5 font-mono ${modeClass}`}
                      >
                        {mode}
                      </span>
                      <span className="ml-auto text-zinc-600 font-mono">
                        {formatKnowledgeTime(touchedIso)}
                      </span>
                    </div>
                    {visibleOutputs.length > 0 ? (
                      <div className="flex items-center gap-1 flex-wrap text-[9px] text-zinc-500">
                        {visibleOutputs.map((label, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-zinc-800/70 ring-1 ring-zinc-700 px-1 py-0.5 font-mono"
                          >
                            {label}
                          </span>
                        ))}
                        {overflow > 0 && (
                          <span className="text-zinc-600 font-mono">
                            +{overflow}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[9px] text-zinc-600 italic">
                        No outputs generated yet — campaign brief saved.
                      </p>
                    )}
                    <div className="flex items-center justify-end pt-0.5">
                      {/* PR BR — Click-through wired. Calls the
                          parent's onOpenCampaign(cm.id) which
                          flows up to App.jsx → CampaignGallery
                          where the matching CampaignCard scrolls
                          into view + flashes a pink highlight
                          ring for ~2 s. Stays disabled (zinc) when
                          no handler is wired. */}
                      <button
                        type="button"
                        // PR BS — pass the inferred mode so App.jsx
                        // can resolve the most relevant
                        // CampaignCard tab to open (cinematic →
                        // visuals, spokesperson → character,
                        // dialogue → dialogue, realtime → realtime,
                        // mixed/draft → overview).
                        onClick={() => onOpenCampaign?.(cm.id, mode)}
                        disabled={!onOpenCampaign}
                        data-testid="spokesperson-appearance-open"
                        title={
                          onOpenCampaign
                            ? `Scroll to + highlight this campaign in the saved gallery below; opens the ${mode} tab.`
                            : 'Click-through handler not wired.'
                        }
                        className={
                          'text-[9px] rounded px-1.5 py-0.5 font-mono transition-colors ' +
                          (onOpenCampaign
                            ? 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40'
                            : 'bg-zinc-800/40 text-zinc-500 ring-1 ring-zinc-700 cursor-not-allowed')
                        }
                      >
                        Open in gallery →
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div
              data-testid="spokesperson-appearance-empty"
              className="space-y-1"
            >
              <p className="text-[11px] text-zinc-400 leading-snug">
                No appearances yet.
              </p>
              <p className="text-[10px] text-zinc-600 leading-snug">
                Create a campaign with this spokesperson to populate
                appearances. Inferred mode + last-touched + available
                outputs will surface here automatically.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
