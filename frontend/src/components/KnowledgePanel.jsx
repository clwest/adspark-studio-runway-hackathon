import { useState } from 'react'

import { api } from '../api'
import { friendlyError } from '../errors'

/**
 * PR CX — Knowledge tab panel.
 *
 * Mounted by `<SpokespersonWorkspace>` when the Knowledge tab is
 * active. Replaces the long-running `<TabComingSoon>` placeholder
 * ("Knowledge sources will appear here.") with a real, demo-ready
 * surface:
 *
 *   1. `+ Add Knowledge Source` CTA on the empty state.
 *   2. Inline form (title + source-type select + content textarea).
 *   3. Saved-source list with delete + short preview.
 *
 * Manual paste only — no embeddings, no RAG. The lane Step 2 hosts
 * a separate "Knowledge for reference" disclosure so the operator
 * can read while authoring scripts.
 *
 * Props:
 *   character           Character (must include `id` + `name`).
 *   onCharacterChanged  (Character) => void — fires after a
 *     successful add or delete so the parent can merge the
 *     updated record into its local slice without re-fetching.
 */

const SOURCE_TYPES = [
  { value: 'brand_note', label: 'Brand note' },
  { value: 'product', label: 'Product' },
  { value: 'audience', label: 'Audience' },
  { value: 'offer', label: 'Offer' },
  { value: 'campaign_fact', label: 'Campaign fact' },
  { value: 'other', label: 'Other' },
]

const TYPE_LABEL = Object.fromEntries(
  SOURCE_TYPES.map((t) => [t.value, t.label]),
)

const PLACEHOLDER_CONTENT =
  'Paste a product description, brand voice notes, pricing, FAQs, ' +
  'service details, or campaign facts this spokesperson should know.'

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

export default function KnowledgePanel({ character, onCharacterChanged }) {
  const sources = Array.isArray(character?.knowledge_sources)
    ? character.knowledge_sources
    : []
  const hasSources = sources.length > 0

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    title: '',
    source_type: 'brand_note',
    content: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  const handleField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (error) setError('')
  }

  const handleStartAdd = () => {
    setAdding(true)
    setForm({ title: '', source_type: 'brand_note', content: '' })
    setError('')
  }

  const handleCancel = () => {
    setAdding(false)
    setForm({ title: '', source_type: 'brand_note', content: '' })
    setError('')
  }

  const canSave =
    !busy &&
    form.title.trim().length > 0 &&
    form.content.trim().length > 0 &&
    Boolean(character?.id)

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.addCharacterKnowledge(character.id, {
        title: form.title.trim(),
        source_type: form.source_type,
        content: form.content.trim(),
      })
      onCharacterChanged?.(updated)
      setAdding(false)
      setForm({ title: '', source_type: 'brand_note', content: '' })
    } catch (e) {
      setError(friendlyError(e, 'Failed to save knowledge source.'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (sourceId) => {
    if (!character?.id || deletingId) return
    if (!window.confirm('Remove this knowledge source?')) return
    setDeletingId(sourceId)
    setError('')
    try {
      const updated = await api.deleteCharacterKnowledge(character.id, sourceId)
      onCharacterChanged?.(updated)
    } catch (e) {
      setError(friendlyError(e, 'Failed to delete knowledge source.'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section
      data-testid="spokesperson-workspace-knowledge"
      data-source-count={sources.length}
      className="space-y-3"
    >
      <header className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Knowledge</h2>
          {!adding && (
            <button
              type="button"
              onClick={handleStartAdd}
              disabled={!character?.id}
              data-testid="spokesperson-workspace-knowledge-add"
              className="text-xs rounded-md bg-pink-500/80 hover:bg-pink-500 text-zinc-100 px-3 py-1.5 font-semibold transition-colors disabled:opacity-60"
            >
              + Add Knowledge Source
            </button>
          )}
        </div>
        <p className="text-[11px] text-zinc-400 leading-snug">
          {hasSources
            ? `${sources.length} saved source${sources.length === 1 ? '' : 's'} available to campaigns. The lane shows them next to the script editor for reference.`
            : `Teach ${character?.name || 'this spokesperson'} about a product, business, offer, or brand voice. Campaign scripts can use this context later.`}
        </p>
      </header>

      {adding && (
        <div
          data-testid="spokesperson-workspace-knowledge-form"
          className="rounded-2xl ring-1 ring-pink-400/30 bg-zinc-950/40 p-3 space-y-2"
        >
          <label className="text-[11px] text-zinc-300 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Source title <span className="text-rose-300">*</span>
            </span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => handleField('title', e.target.value)}
              placeholder="CEO Buzz brand voice notes, F-150 spec sheet, …"
              maxLength={120}
              disabled={busy}
              data-testid="spokesperson-workspace-knowledge-title"
              className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-2 py-1.5 text-xs focus:ring-pink-400 outline-none disabled:opacity-60"
            />
          </label>

          <label className="text-[11px] text-zinc-300 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Source type
            </span>
            <select
              value={form.source_type}
              onChange={(e) => handleField('source_type', e.target.value)}
              disabled={busy}
              data-testid="spokesperson-workspace-knowledge-type"
              className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-2 py-1.5 text-xs focus:ring-pink-400 outline-none disabled:opacity-60"
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px] text-zinc-300 flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">
              Content <span className="text-rose-300">*</span>
              <span className="text-zinc-600"> · {form.content.length}/8000</span>
            </span>
            <textarea
              value={form.content}
              onChange={(e) => handleField('content', e.target.value)}
              placeholder={PLACEHOLDER_CONTENT}
              rows={6}
              maxLength={8000}
              disabled={busy}
              data-testid="spokesperson-workspace-knowledge-content"
              className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-2 py-1.5 text-xs leading-snug focus:ring-pink-400 outline-none disabled:opacity-60"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              data-testid="spokesperson-workspace-knowledge-save"
              className={
                'text-xs rounded-md px-3 py-1.5 font-semibold transition-colors ' +
                (canSave
                  ? 'bg-pink-500/80 hover:bg-pink-500 text-zinc-100'
                  : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
              }
            >
              {busy ? 'Saving…' : 'Save source'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={busy}
              data-testid="spokesperson-workspace-knowledge-cancel"
              className="text-xs rounded-md ring-1 ring-zinc-700 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          </div>

          {error && (
            <p
              data-testid="spokesperson-workspace-knowledge-error"
              className="text-[10px] text-rose-300 leading-snug"
              role="status"
              aria-live="polite"
            >
              {error}
            </p>
          )}
        </div>
      )}

      {hasSources && (
        <ul
          data-testid="spokesperson-workspace-knowledge-list"
          className="space-y-2"
        >
          {sources.map((src) => {
            const preview =
              src.content.length > 280
                ? src.content.slice(0, 280) + '…'
                : src.content
            return (
              <li
                key={src.id}
                data-testid="spokesperson-workspace-knowledge-row"
                data-source-id={src.id}
                data-source-type={src.source_type}
                className="rounded-2xl ring-1 ring-zinc-800 bg-zinc-950/40 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-zinc-100 truncate">
                      {src.title}
                    </span>
                    <span className="text-[10px] rounded-full px-2 py-0.5 font-mono bg-pink-500/15 text-pink-200 ring-1 ring-pink-400/30">
                      {TYPE_LABEL[src.source_type] || src.source_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      data-testid="spokesperson-workspace-knowledge-status"
                      className="text-[10px] text-emerald-300 font-mono"
                    >
                      saved · available to campaigns
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(src.id)}
                      disabled={deletingId === src.id}
                      data-testid="spokesperson-workspace-knowledge-delete"
                      data-source-id={src.id}
                      className="text-[10px] text-zinc-500 hover:text-rose-300 px-1 disabled:opacity-50"
                      title="Remove this knowledge source."
                    >
                      {deletingId === src.id ? 'Deleting…' : 'delete'}
                    </button>
                  </div>
                </div>
                <pre
                  data-testid="spokesperson-workspace-knowledge-content-preview"
                  className="whitespace-pre-wrap break-words text-[11px] text-zinc-300 leading-snug font-sans"
                >
                  {preview}
                </pre>
                {src.created_at && (
                  <p className="text-[9px] text-zinc-600 font-mono">
                    {src.content.length} chars · added {formatRelTime(src.created_at)}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!adding && !hasSources && (
        <p
          data-testid="spokesperson-workspace-knowledge-empty"
          className="text-[11px] text-zinc-500 leading-snug px-1"
        >
          No sources yet. Click <span className="text-zinc-300 font-medium">+ Add Knowledge Source</span>{' '}
          above to give {character?.name || 'this spokesperson'} something to reference.
        </p>
      )}
    </section>
  )
}
