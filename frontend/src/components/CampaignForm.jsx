import { useState } from 'react'

export default function CampaignForm({ onSubmit, busy }) {
  const [form, setForm] = useState({
    business: '',
    product: '',
    tone: 'cinematic',
    audience: '',
  })

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    if (!form.business.trim()) return
    onSubmit(form)
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4"
    >
      {/* PR AC follow-up — maxLength caps mirror the backend
          ConceptRequest validation so the user can't accidentally
          type past the limit and receive a silent 422. */}
      <div className="space-y-1">
        <label className="text-sm text-zinc-300">
          Business / brand
          <span className="text-[10px] text-zinc-500 font-mono ml-2">
            {form.business.length}/200
          </span>
        </label>
        <input
          required
          minLength={2}
          maxLength={200}
          value={form.business}
          onChange={update('business')}
          placeholder="Donkey Betz Coffee"
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-zinc-300">
          Product / service
          <span className="text-[10px] text-zinc-500 font-mono ml-2">
            {form.product.length}/200
          </span>
        </label>
        <input
          maxLength={200}
          value={form.product}
          onChange={update('product')}
          placeholder="Cold-brew subscription"
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm text-zinc-300">
            Tone
            <span className="text-[10px] text-zinc-500 font-mono ml-2">
              {form.tone.length}/80
            </span>
          </label>
          <input
            maxLength={80}
            value={form.tone}
            onChange={update('tone')}
            placeholder="cinematic, gritty, playful…"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-zinc-300">
            Audience
            <span className="text-[10px] text-zinc-500 font-mono ml-2">
              {form.audience.length}/200
            </span>
          </label>
          <input
            maxLength={200}
            value={form.audience}
            onChange={update('audience')}
            placeholder="urban creatives, 25–40"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-spark text-ink font-semibold py-2 disabled:opacity-50"
      >
        {busy ? 'Generating concepts…' : 'Generate Ad Concepts'}
      </button>
    </form>
  )
}
