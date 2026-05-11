import { useState } from 'react'

import {
  buildTranscriptMarkdown,
  buildTranscriptText,
  copyToClipboard,
  downloadTextFile,
  transcriptFilename,
} from '../transcriptExport.js'

/**
 * PR DK — Conversations sub-tab.
 *
 * Walks the active spokesperson's linked campaigns for persisted
 * realtime transcripts (PR AJ field set on the Campaign model:
 * `realtime_transcript_*` + `realtime_transcript_history`) and
 * renders one card per campaign that has a fetched transcript.
 *
 * This is a UI organization pass — no backend changes. Transcripts
 * are written by the existing
 * `POST /api/campaigns/{id}/realtime-transcript` route (PR AJ); this
 * component just surfaces them next to the Videos history so the
 * operator has one Media-Library-shaped tab for both generated
 * media and conversation history.
 *
 * Each card shows:
 *   - Campaign name + product preview
 *   - Spokesperson name (fixed — the active workspace character)
 *   - Fetched timestamp (relative)
 *   - Mock-mode badge when applicable
 *   - First few turns as an inline preview (avatar / user pairs)
 *   - Action row: Copy Markdown · Download TXT · `+N prior fetches`
 *     disclosure when the campaign has a richer
 *     `realtime_transcript_history`
 *
 * Empty state when no campaign has a fetched transcript yet —
 * points the operator at the Conversations tab where realtime
 * sessions are opened + transcripts are fetched on End.
 */

function formatRelTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const delta = (Date.now() - t) / 1000
  if (delta < 60) return 'just now'
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`
  return `${Math.floor(delta / 86_400)}d ago`
}

const ROLE_LABEL = {
  avatar: 'Avatar',
  user: 'Visitor',
  system: 'System',
}

function speakerLabel(turn) {
  const fromTurn = (turn && turn.speaker && String(turn.speaker).trim()) || ''
  if (fromTurn) return fromTurn
  return ROLE_LABEL[turn?.role] || ROLE_LABEL.system
}

function campaignsWithTranscripts(linkedCampaigns) {
  const list = Array.isArray(linkedCampaigns) ? linkedCampaigns : []
  return list
    .filter(
      (c) =>
        Array.isArray(c.realtime_transcript_turns) &&
        c.realtime_transcript_turns.length > 0 &&
        c.realtime_transcript_status !== 'no_session',
    )
    .sort((a, b) =>
      String(b.realtime_transcript_fetched_at || '').localeCompare(
        String(a.realtime_transcript_fetched_at || ''),
      ),
    )
}

export default function ConversationsHistory({
  linkedCampaigns = [],
  character = null,
}) {
  const cards = campaignsWithTranscripts(linkedCampaigns)
  const spokespersonName =
    (character?.name && String(character.name).trim()) || 'this spokesperson'

  if (cards.length === 0) {
    return (
      <section
        data-testid="conversations-history"
        data-conversation-count={0}
        className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-5 space-y-2 text-center"
      >
        <header className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-100">
            Conversations
          </h2>
          <p className="text-[11px] text-zinc-400 leading-relaxed max-w-prose mx-auto">
            Saved realtime conversations land here once you end a
            session and click <span className="font-mono">Fetch
            Transcript</span>. Each conversation is per-campaign and
            survives across reloads.
          </p>
        </header>
        <p
          data-testid="conversations-empty"
          className="text-[10px] rounded-full bg-pink-500/15 text-pink-200 ring-1 ring-pink-400/30 px-2 py-0.5 font-mono inline-block"
        >
          No conversations yet. Open the Conversations tab to talk to{' '}
          {spokespersonName}.
        </p>
      </section>
    )
  }

  return (
    <section
      data-testid="conversations-history"
      data-conversation-count={cards.length}
      className="space-y-3"
    >
      <header className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Conversations
        </h2>
        <p className="text-[11px] text-zinc-400 leading-snug">
          {cards.length} saved conversation{cards.length === 1 ? '' : 's'}{' '}
          with {spokespersonName} across{' '}
          {cards.length === 1 ? 'one campaign' : `${cards.length} campaigns`}.
          Newest first. Transcripts are fetched on demand from
          Runway after a session ends.
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-2.5">
        {cards.map((c) => (
          <ConversationCard
            key={`${c.id}:${c.realtime_transcript_fetched_at || 'now'}`}
            campaign={c}
            character={character}
          />
        ))}
      </ul>
    </section>
  )
}

function ConversationCard({ campaign, character }) {
  const turns = Array.isArray(campaign.realtime_transcript_turns)
    ? campaign.realtime_transcript_turns
    : []
  const visibleTurns = turns.slice(0, 4)
  const trailingCount = Math.max(0, turns.length - visibleTurns.length)
  const fetchedAt = campaign.realtime_transcript_fetched_at
  const isMock = Boolean(campaign.realtime_transcript_mock_mode)
  const priorFetches = Array.isArray(campaign.realtime_transcript_history)
    ? campaign.realtime_transcript_history.length
    : 0
  // history includes the current fetch as its newest entry, so
  // "prior fetches" means history beyond that one.
  const priorFetchesCount = Math.max(0, priorFetches - 1)

  const [copyStatus, setCopyStatus] = useState('')
  const [downloadStatus, setDownloadStatus] = useState('')

  const handleCopy = async () => {
    const md = buildTranscriptMarkdown(campaign, turns)
    const ok = await copyToClipboard(md)
    setCopyStatus(ok ? 'Copied Markdown ✓' : 'Copy unavailable')
    setTimeout(() => setCopyStatus(''), 2_000)
  }

  const handleDownload = () => {
    const txt = buildTranscriptText(campaign, turns)
    const ok = downloadTextFile(transcriptFilename(campaign, 'txt'), txt)
    setDownloadStatus(ok ? 'Downloaded TXT ✓' : 'Download unavailable')
    setTimeout(() => setDownloadStatus(''), 2_000)
  }

  const business = (campaign.business || '').trim() || 'Untitled campaign'
  const product = (campaign.product || '').trim()
  const speakerName =
    (character?.name && String(character.name).trim()) || 'Spokesperson'

  return (
    <li
      data-testid="conversation-card"
      data-campaign-id={campaign.id}
      data-mock-mode={isMock ? 'true' : 'false'}
      data-turn-count={turns.length}
      className="rounded-xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5 min-w-0 flex-1">
          <p
            className="text-xs font-semibold text-zinc-100 truncate"
            title={business + (product ? ` · ${product}` : '')}
          >
            {business}
            {product ? (
              <span className="text-zinc-500"> · {product}</span>
            ) : null}
          </p>
          <p className="text-[10px] text-zinc-400 font-mono leading-snug">
            <span className="text-pink-300">{speakerName}</span>
            {fetchedAt && (
              <>
                {' · '}
                <span title={fetchedAt}>{formatRelTime(fetchedAt)}</span>
              </>
            )}
            {' · '}
            {turns.length} turn{turns.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isMock && (
            <span
              className="text-[9px] rounded-full px-2 py-0.5 font-mono ring-1 bg-zinc-800 text-zinc-300 ring-zinc-700"
              title="Deterministic mock-mode transcript — no Runway round-trip"
            >
              mock
            </span>
          )}
          <span
            className="text-[9px] rounded-full px-2 py-0.5 font-mono ring-1 bg-emerald-500/15 text-emerald-200 ring-emerald-400/40"
            title={`status: ${campaign.realtime_transcript_status || 'ok'}`}
          >
            saved
          </span>
        </div>
      </div>

      <ol className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/60 p-2 space-y-1">
        {visibleTurns.length === 0 ? (
          <li className="text-[10px] text-zinc-500 italic">
            (no turn text recorded)
          </li>
        ) : (
          visibleTurns.map((turn, idx) => {
            const speaker = speakerLabel(turn)
            const isAvatar = turn?.role === 'avatar'
            const text = String(turn?.text || '').trim()
            return (
              <li
                key={idx}
                data-testid="conversation-turn-preview"
                className="text-[10px] leading-snug flex items-baseline gap-2"
              >
                <span
                  className={
                    'font-mono shrink-0 ' +
                    (isAvatar ? 'text-pink-300' : 'text-sky-300')
                  }
                  style={{ minWidth: '4.5rem' }}
                >
                  {speaker}
                </span>
                <span className="text-zinc-300 flex-1 line-clamp-2 italic">
                  {text ? `"${text}"` : '(empty)'}
                </span>
              </li>
            )
          })
        )}
        {trailingCount > 0 && (
          <li className="text-[9px] text-zinc-500 font-mono pt-0.5">
            +{trailingCount} more turn{trailingCount === 1 ? '' : 's'} —
            copy/download to see the full transcript
          </li>
        )}
      </ol>

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={handleCopy}
          data-testid="conversation-copy-markdown"
          title="Copy the full transcript as Markdown to the clipboard."
          className="text-[10px] rounded px-2 py-1 font-mono transition-colors ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/70 hover:ring-zinc-500 text-zinc-200"
        >
          Copy Markdown
        </button>
        <button
          type="button"
          onClick={handleDownload}
          data-testid="conversation-download-txt"
          title="Download the full transcript as a plain-text file."
          className="text-[10px] rounded px-2 py-1 font-mono transition-colors ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/70 hover:ring-zinc-500 text-zinc-200"
        >
          Download TXT
        </button>
        {priorFetchesCount > 0 && (
          <span
            className="text-[9px] text-zinc-500 font-mono"
            title="Earlier transcript fetches for the same campaign — capped at 20 by the store."
          >
            +{priorFetchesCount} prior fetch
            {priorFetchesCount === 1 ? '' : 'es'}
          </span>
        )}
        {(copyStatus || downloadStatus) && (
          <span className="text-[9px] text-emerald-300 font-mono">
            {copyStatus || downloadStatus}
          </span>
        )}
      </div>
    </li>
  )
}
