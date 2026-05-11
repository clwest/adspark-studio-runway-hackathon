import { useEffect, useState } from 'react'

import { api } from '../api'

/**
 * PR EM-b — Memory tab for a Character.
 *
 * Surfaces the cross-session memory layer (PR EM-a foundation):
 *   - lists current entries (filterable by source type)
 *   - lets the operator manually fire ingest from every registered
 *     source (operator knowledge notes + past realtime transcript
 *     summaries; future external feeds when registered)
 *   - previews the Markdown body the RecencyWeightedComposer
 *     produces (no Runway upload), so the operator can see exactly
 *     what the realtime session will attach as RAG
 *   - "Publish to Runway document" — uploads the composed body via
 *     POST /v1/documents, returns the new document id
 *   - per-entry delete for operator cleanup
 *
 * Budget bar at the top shows total_chars against the composer's
 * 40K-char target (well under Runway's 50K-token doc cap, leaves
 * margin for personality + startScript).
 *
 * Phase 3 will add: query box (semantic search against the
 * embeddings), per-entry inline edit, source-type filter chips,
 * and an auto-ingest toggle that fires after every realtime session.
 */

const SOURCE_LABELS = {
  operator_note: '📝 Operator notes',
  transcript: '🎙️ Past conversations',
  external_feed: '🛰️ External feeds',
  auto_extracted: '🤖 Auto-extracted',
  seed: '🌱 Seed',
}

const COMPOSER_BUDGET = 40_000

export default function MemoryPanel({ character }) {
  const [entries, setEntries] = useState([])
  const [totalChars, setTotalChars] = useState(0)
  const [filterSource, setFilterSource] = useState('')
  const [loading, setLoading] = useState(true)
  const [errMsg, setErrMsg] = useState('')

  const [ingestBusy, setIngestBusy] = useState(false)
  const [lastIngest, setLastIngest] = useState(null)

  const [composeBusy, setComposeBusy] = useState(false)
  const [composedBody, setComposedBody] = useState(null)
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishResult, setPublishResult] = useState(null)

  const characterId = character?.id

  const refresh = async () => {
    if (!characterId) return
    setLoading(true)
    setErrMsg('')
    try {
      const resp = await api.listCharacterMemory(characterId, {
        sourceType: filterSource || undefined,
      })
      setEntries(resp.entries || [])
      setTotalChars(resp.total_chars || 0)
    } catch (e) {
      setErrMsg(`Failed to load memory: ${e?.message || e}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, filterSource])

  const handleIngest = async () => {
    if (!characterId || ingestBusy) return
    setIngestBusy(true)
    setErrMsg('')
    try {
      const result = await api.ingestCharacterMemory(characterId, {})
      setLastIngest(result)
      await refresh()
    } catch (e) {
      setErrMsg(`Ingest failed: ${e?.message || e}`)
    } finally {
      setIngestBusy(false)
    }
  }

  const handleDelete = async (entryId) => {
    const ok = window.confirm(
      'Delete this memory entry?\n\n' +
        'Operator notes can be re-ingested by re-running ingest. ' +
        'Transcript summaries can be re-derived from the campaign\u2019s ' +
        'realtime_transcript_history.',
    )
    if (!ok) return
    try {
      await api.deleteCharacterMemoryEntry(characterId, entryId)
      setEntries((prev) => prev.filter((e) => e.id !== entryId))
    } catch (e) {
      setErrMsg(`Delete failed: ${e?.message || e}`)
    }
  }

  const handleCompose = async () => {
    if (!characterId || composeBusy) return
    setComposeBusy(true)
    setErrMsg('')
    setPublishResult(null)
    try {
      const result = await api.composeCharacterMemory(characterId, {
        publish: false,
      })
      setComposedBody(result)
    } catch (e) {
      setErrMsg(`Compose failed: ${e?.message || e}`)
    } finally {
      setComposeBusy(false)
    }
  }

  const handlePublish = async () => {
    if (!characterId || publishBusy) return
    const ok = window.confirm(
      'Publish this composed memory to Runway as a new document?\n\n' +
        'The new document_id will be returned. You can then attach it ' +
        'to a campaign\u2019s runway_document_id so the next realtime ' +
        'session uses it as RAG.\n\n' +
        '(In mock mode this is a no-op that returns a deterministic ' +
        'mock document id.)',
    )
    if (!ok) return
    setPublishBusy(true)
    setErrMsg('')
    try {
      const result = await api.composeCharacterMemory(characterId, {
        publish: true,
      })
      setPublishResult(result)
    } catch (e) {
      setErrMsg(`Publish failed: ${e?.message || e}`)
    } finally {
      setPublishBusy(false)
    }
  }

  const budgetPct = Math.min(100, Math.round((totalChars / COMPOSER_BUDGET) * 100))

  if (!character) {
    return (
      <section className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-[12px] text-zinc-400">Load a spokesperson first.</p>
      </section>
    )
  }

  return (
    <section
      data-testid="spokesperson-workspace-memory"
      className="space-y-3"
    >
      {/* Header + budget bar */}
      <header className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-zinc-100">
              Memory · {character.name}
            </h2>
            <p className="text-[11px] text-zinc-400 leading-snug max-w-prose">
              Persisted memory entries across every registered source.
              Ingest pulls fresh data; compose assembles a Markdown
              body the realtime session can attach as RAG; publish
              uploads to Runway as a document.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleIngest}
              disabled={ingestBusy}
              data-testid="memory-ingest"
              className="text-[11px] rounded-md px-2.5 py-1 font-mono bg-violet-500/30 hover:bg-violet-500/45 text-violet-100 ring-1 ring-violet-400/40 disabled:opacity-60"
              title="POST /memory/ingest — fire every registered source"
            >
              {ingestBusy ? 'Ingesting…' : '↻ Ingest now'}
            </button>
            <button
              type="button"
              onClick={handleCompose}
              disabled={composeBusy || entries.length === 0}
              data-testid="memory-compose"
              className="text-[11px] rounded-md px-2.5 py-1 font-mono bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40 disabled:opacity-60"
              title="POST /memory/compose — preview the composed body"
            >
              {composeBusy ? 'Composing…' : '📄 Preview compose'}
            </button>
          </div>
        </div>

        {/* Budget bar */}
        <div className="space-y-0.5" title="Memory budget against the composer's 40K-char target">
          <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
            <span>{totalChars.toLocaleString()} chars / {COMPOSER_BUDGET.toLocaleString()} budget</span>
            <span>{budgetPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-900 ring-1 ring-zinc-800 overflow-hidden">
            <div
              className={
                'h-full transition-all ' +
                (budgetPct < 70
                  ? 'bg-emerald-500/60'
                  : budgetPct < 90
                  ? 'bg-amber-500/60'
                  : 'bg-rose-500/60')
              }
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>

        {/* Last-ingest summary */}
        {lastIngest && (
          <p
            data-testid="memory-last-ingest"
            className="text-[10px] text-emerald-300/80 font-mono leading-snug"
          >
            ✓ Last ingest: {lastIngest.added} entries added across{' '}
            {Object.keys(lastIngest.per_source || {}).length} sources
            {lastIngest.errors?.length > 0 && (
              <span className="text-rose-300">
                {' '}· {lastIngest.errors.length} source error(s)
              </span>
            )}
          </p>
        )}
      </header>

      {/* Filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[10px] text-zinc-500 font-mono">filter:</span>
        <button
          type="button"
          onClick={() => setFilterSource('')}
          data-testid="memory-filter-all"
          className={
            'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ' +
            (filterSource === ''
              ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
              : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
          }
        >
          all ({entries.length || 0})
        </button>
        {Object.entries(SOURCE_LABELS).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilterSource(id)}
            data-testid={`memory-filter-${id}`}
            className={
              'text-[10px] rounded-full px-2 py-0.5 font-mono transition-colors ' +
              (filterSource === id
                ? 'bg-pink-500/30 text-pink-100 ring-1 ring-pink-400/50'
                : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700 hover:text-zinc-200')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Compose preview surface */}
      {composedBody && (
        <div
          data-testid="memory-compose-preview"
          className="rounded-xl ring-1 ring-pink-400/30 bg-pink-500/[0.05] p-3 space-y-1.5"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[11px] text-zinc-100 font-semibold">
              Composed memory document — preview only
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-zinc-400 font-mono">
                {composedBody.included_count} entries · {composedBody.body_chars.toLocaleString()} chars
              </span>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishBusy}
                data-testid="memory-publish"
                className="text-[10px] rounded-md px-2 py-1 font-mono bg-violet-500/40 hover:bg-violet-500/60 text-violet-100 ring-1 ring-violet-400/50 disabled:opacity-60"
                title="POST /memory/compose with publish=true"
              >
                {publishBusy ? 'Publishing…' : '🚀 Publish to Runway'}
              </button>
            </div>
          </div>
          <pre className="text-[10px] text-zinc-200 font-mono leading-snug max-h-[18rem] overflow-y-auto whitespace-pre-wrap break-words rounded bg-black/40 ring-1 ring-zinc-900 p-2">
            {composedBody.body}
          </pre>
          {publishResult && (
            <p
              data-testid="memory-publish-result"
              className="text-[10px] text-emerald-300 font-mono leading-snug"
            >
              {publishResult.published
                ? `✓ Published — document_id: ${publishResult.document_id}`
                : `⚠️ Publish issue: ${publishResult.error || 'unknown'}`}
            </p>
          )}
        </div>
      )}

      {/* Error banner */}
      {errMsg && (
        <p
          data-testid="memory-error"
          className="text-[11px] text-rose-300 leading-snug rounded-md ring-1 ring-rose-400/40 bg-rose-500/[0.06] p-2"
        >
          {errMsg}
        </p>
      )}

      {/* Entry list */}
      {loading && (
        <p className="text-[11px] text-zinc-500 italic">Loading memory…</p>
      )}
      {!loading && entries.length === 0 && (
        <p
          data-testid="memory-empty"
          className="text-[11px] text-zinc-400 italic rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-3"
        >
          No memory entries yet. Click <b className="text-zinc-200">Ingest now</b> to pull from every registered source (operator knowledge sources + past realtime transcript summaries).
        </p>
      )}
      {!loading && entries.length > 0 && (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              data-testid="memory-entry"
              data-source-type={e.source_type}
              className="rounded-md ring-1 ring-zinc-800 bg-zinc-950/40 p-2.5 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[11px] text-zinc-100 font-medium truncate" title={e.title}>
                    {e.title}
                  </p>
                  <p className="text-[9px] text-zinc-500 font-mono leading-snug">
                    {SOURCE_LABELS[e.source_type] || e.source_type}
                    {' · '}{e.content.length} chars
                    {e.campaign_id && (
                      <span title="campaign-scoped entry — only surfaces when this campaign is active">
                        {' · 📌 campaign-scoped'}
                      </span>
                    )}
                    {e.tags?.length > 0 && (
                      <span>{' · '}{e.tags.join(' · ')}</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  title="Delete this memory entry"
                  className="text-[10px] text-zinc-500 hover:text-rose-300 px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
              <p className="text-[10px] text-zinc-300 leading-snug whitespace-pre-wrap break-words">
                {e.content.length > 280
                  ? e.content.slice(0, 280) + '…'
                  : e.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
