import { useState } from 'react'

/**
 * PR CU — Lane brief creator.
 *
 * Closes the v2 lane dead-end: when a spokesperson has no linked
 * campaign, every lane (Spokesperson / Cinematic / Dialogue) used
 * to render dead copy ("Create or select a campaign to edit the
 * brief.") with no actionable surface. Operators had to flip back
 * to /legacy to author a brief.
 *
 * This component is the inline empty-state CTA for Step 1.
 *
 * Two states:
 *
 *   1. Collapsed — single primary button (`+ Create campaign brief`).
 *   2. Expanded — Business / Product / Audience / Tone form +
 *      Save / Cancel.
 *
 * Field shape mirrors `LaneBriefEditor` (PR BQ) verbatim so the
 * operator transitions seamlessly from "create" to "edit" the
 * moment the campaign exists.
 *
 * Props:
 *   onCreate(brief) -> Promise<Campaign>
 *     Required. Parent wires this to `CampaignLanes.handleCreateCampaign`
 *     which POSTs the minimal valid CampaignCreate + attaches the
 *     active spokesperson. Brief is `{ business, product, audience, tone }`.
 *   modeLabel  string  e.g. "spokesperson ad" — surfaces in copy so
 *     the empty state names which lane is opening.
 *   testidPrefix  string  e.g. "spokesperson" — keeps testids
 *     unique across the three lanes.
 *
 * Backend untouched at this layer.
 */
export default function LaneBriefCreator({
  onCreate,
  modeLabel = 'campaign',
  testidPrefix = 'lane',
  hasSpokesperson = true,
}) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState({
    business: '',
    product: '',
    audience: '',
    tone: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const businessOk = form.business.trim().length > 0
  const canSave = businessOk && !busy && Boolean(onCreate) && hasSpokesperson

  const handleField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (error) setError('')
  }

  const handleCancel = () => {
    setExpanded(false)
    setForm({ business: '', product: '', audience: '', tone: '' })
    setError('')
  }

  const handleSave = async () => {
    if (!canSave) return
    setError('')
    setBusy(true)
    try {
      await onCreate({
        business: form.business.trim(),
        product: form.product.trim(),
        audience: form.audience.trim(),
        tone: form.tone.trim(),
      })
      // On success, parent's onCampaignsChanged + linkedCampaigns
      // refresh causes the lane to re-render with the focused
      // campaign in Step 1 — this component unmounts.
    } catch (e) {
      setError(`${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  if (!expanded) {
    return (
      <div
        data-testid={`${testidPrefix}-brief-creator-empty`}
        className="space-y-1.5"
      >
        <p className="text-[11px] text-zinc-400 leading-snug">
          No campaign yet. Start a {modeLabel} brief — the rest of
          the lane unlocks once it's saved.
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={!hasSpokesperson || !onCreate}
          data-testid={`${testidPrefix}-brief-creator-cta`}
          className={
            'w-full text-[11px] rounded px-2 py-1.5 font-mono transition-colors ' +
            (hasSpokesperson && onCreate
              ? 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
          title={
            !hasSpokesperson
              ? 'Active spokesperson required.'
              : !onCreate
              ? 'Create handler not wired.'
              : `Create a campaign brief for this ${modeLabel}.`
          }
        >
          + Create campaign brief
        </button>
        {!hasSpokesperson && (
          <p className="text-[10px] text-zinc-500 leading-snug">
            Pick an active spokesperson first — the new campaign
            attaches to them.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid={`${testidPrefix}-brief-creator`}
      data-expanded="true"
      className="space-y-1.5"
    >
      <p className="text-[10px] text-zinc-400 leading-snug">
        Minimal brief — Business is required. Refine the rest from
        the lane after save.
      </p>
      {[
        {
          key: 'business',
          label: 'Business / campaign name',
          placeholder: 'CEO Buzz, FocusNet, Local coffee shop…',
          rows: 1,
          required: true,
        },
        {
          key: 'product',
          label: 'Product / offer / message',
          placeholder: 'Dumpster-to-CEO Energy Drink',
          rows: 2,
        },
        {
          key: 'audience',
          label: 'Audience / hook',
          placeholder: 'Coders, founders, second-shift workers…',
          rows: 2,
        },
        {
          key: 'tone',
          label: 'Tone',
          placeholder: 'Wry, energetic, deadpan…',
          rows: 1,
        },
      ].map((field) => (
        <label
          key={field.key}
          className="text-[10px] text-zinc-300 flex flex-col gap-0.5"
        >
          <span className="text-[9px] uppercase tracking-wide text-zinc-500 font-mono">
            {field.label}
            {field.required && <span className="text-rose-300"> *</span>}
          </span>
          {field.rows > 1 ? (
            <textarea
              value={form[field.key]}
              onChange={(e) => handleField(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={field.rows}
              data-testid={`${testidPrefix}-brief-creator-${field.key}`}
              disabled={busy}
              className="rounded bg-zinc-950 ring-1 ring-zinc-800 px-1.5 py-1 text-[10px] leading-snug focus:ring-pink-400 outline-none disabled:opacity-60"
            />
          ) : (
            <input
              type="text"
              value={form[field.key]}
              onChange={(e) => handleField(field.key, e.target.value)}
              placeholder={field.placeholder}
              data-testid={`${testidPrefix}-brief-creator-${field.key}`}
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
          data-testid={`${testidPrefix}-brief-creator-save`}
          data-busy={busy ? 'true' : 'false'}
          className={
            'text-[10px] rounded px-2 py-1 font-mono transition-colors ' +
            (canSave
              ? 'bg-pink-500/30 hover:bg-pink-500/45 text-pink-100 ring-1 ring-pink-400/40'
              : 'bg-zinc-800/40 text-zinc-400 ring-1 ring-zinc-700 cursor-not-allowed disabled:opacity-80')
          }
          title={
            !businessOk
              ? 'Business / campaign name is required.'
              : busy
              ? 'Saving…'
              : 'POST /api/campaigns + /attach-character — no Runway calls.'
          }
        >
          {busy ? 'Saving…' : 'Save brief'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          data-testid={`${testidPrefix}-brief-creator-cancel`}
          className="text-[10px] text-zinc-500 hover:text-zinc-200 px-1 py-1 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {(busy || error) && (
        <p
          data-testid={`${testidPrefix}-brief-creator-status`}
          className={
            'text-[10px] leading-snug ' +
            (error ? 'text-rose-300' : 'text-zinc-500')
          }
          role="status"
          aria-live="polite"
        >
          {error || 'creating campaign…'}
        </p>
      )}
    </div>
  )
}
