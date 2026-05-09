import { useEffect, useState } from 'react'

/**
 * PR BQ — Reusable inline brief editor for v2 lane Step 1.
 *
 * Renders four editable fields — business / product / audience /
 * tone — that match the existing `Campaign` schema exactly. Save
 * commits via the parent's `onSave` callback, which is expected
 * to call `api.updateCampaignBrief(campaign.id, body)`. Cancel
 * resets the local form to whatever the campaign currently holds.
 *
 * Backend untouched at this layer; the parent owns the API call
 * + local campaigns slice update. Editor is purely presentation
 * + form-state.
 *
 * Used by SpokespersonLane / CinematicLane / DialogueLane
 * Step 1. When no focused campaign exists, the parent should
 * show its own empty-state copy instead of mounting this editor.
 */

const FIELDS = [
  {
    key: 'business',
    label: 'Business',
    placeholder: 'CEO Buzz, Local coffee shop, FocusNet…',
    rows: 1,
    required: true,
  },
  {
    key: 'product',
    label: 'Product',
    placeholder: 'Dumpster-to-CEO Energy Drink',
    rows: 2,
    required: false,
  },
  {
    key: 'audience',
    label: 'Audience',
    placeholder: 'Coders, founders, second-shift workers…',
    rows: 2,
    required: false,
  },
  {
    key: 'tone',
    label: 'Tone',
    placeholder: 'Wry, energetic, deadpan, etc.',
    rows: 1,
    required: false,
  },
]

export default function LaneBriefEditor({ campaign, onSave }) {
  const initial = {
    business: campaign?.business || '',
    product: campaign?.product || '',
    audience: campaign?.audience || '',
    tone: campaign?.tone || '',
  }
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // PR BQ — when the parent swaps to a different campaign (mode
  // change, focused-campaign rotation), reset the form so the
  // editor never carries stale field values across cards.
  useEffect(() => {
    setForm({
      business: campaign?.business || '',
      product: campaign?.product || '',
      audience: campaign?.audience || '',
      tone: campaign?.tone || '',
    })
    setError('')
    setStatusMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.id])

  // Auto-clear status banner so the editor doesn't carry a stale
  // "Saved" label across edits.
  useEffect(() => {
    if (!statusMsg) return undefined
    const t = setTimeout(() => setStatusMsg(''), 2_500)
    return () => clearTimeout(t)
  }, [statusMsg])

  if (!campaign) return null

  const dirty =
    form.business !== initial.business ||
    form.product !== initial.product ||
    form.audience !== initial.audience ||
    form.tone !== initial.tone
  const businessOk = form.business.trim().length > 0
  const canSave = dirty && businessOk && !busy && Boolean(onSave)

  const handleField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (error) setError('')
  }
  const handleCancel = () => {
    setForm({
      business: campaign.business || '',
      product: campaign.product || '',
      audience: campaign.audience || '',
      tone: campaign.tone || '',
    })
    setError('')
    setStatusMsg('')
  }
  const handleSave = async () => {
    if (!canSave) return
    setError('')
    setStatusMsg('')
    setBusy(true)
    try {
      await onSave(campaign.id, {
        business: form.business.trim(),
        product: form.product.trim(),
        audience: form.audience.trim(),
        tone: form.tone.trim(),
      })
      setStatusMsg('Brief saved.')
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="lane-brief-editor"
      data-campaign-id={campaign.id}
      data-dirty={dirty ? 'true' : 'false'}
      className="space-y-1.5"
    >
      {FIELDS.map((field) => (
        <label
          key={field.key}
          className="text-[10px] text-zinc-300 flex flex-col gap-0.5"
        >
          <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
            {field.label}
            {field.required && (
              <span className="text-rose-300"> *</span>
            )}
          </span>
          {field.rows > 1 ? (
            <textarea
              value={form[field.key]}
              onChange={(e) => handleField(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={field.rows}
              data-testid={`lane-brief-${field.key}`}
              disabled={busy}
              className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] leading-snug focus:ring-pink-400 outline-none disabled:opacity-60"
            />
          ) : (
            <input
              type="text"
              value={form[field.key]}
              onChange={(e) => handleField(field.key, e.target.value)}
              placeholder={field.placeholder}
              data-testid={`lane-brief-${field.key}`}
              disabled={busy}
              maxLength={200}
              className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] focus:ring-pink-400 outline-none disabled:opacity-60"
            />
          )}
        </label>
      ))}

      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="lane-brief-save"
          data-busy={busy ? 'true' : 'false'}
          title={
            canSave
              ? 'POST /api/campaigns/{id}/brief — patches business / product / audience / tone. No Runway calls.'
              : !businessOk
              ? 'Business is required.'
              : !dirty
              ? 'No changes to save.'
              : busy
              ? 'Saving…'
              : 'Wire onSave before this can fire.'
          }
          className={
            'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
            (canSave
              ? 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={!dirty || busy}
          data-testid="lane-brief-cancel"
          className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        {dirty && !busy && (
          <span className="text-[9px] text-amber-300 font-mono">
            unsaved changes
          </span>
        )}
      </div>

      {(busy || error || statusMsg) && (
        <p
          data-testid="lane-brief-status"
          className={
            'text-[10px] leading-snug ' +
            (error
              ? 'text-rose-300'
              : busy
              ? 'text-zinc-500'
              : 'text-emerald-300')
          }
          title={error || statusMsg || ''}
          role="status"
          aria-live="polite"
        >
          {error
            ? error
            : busy
            ? 'posting to /campaigns/{id}/brief…'
            : statusMsg}
        </p>
      )}
    </div>
  )
}
