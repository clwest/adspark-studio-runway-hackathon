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
      <div className="space-y-1">
        <label className="text-sm text-zinc-300">Business / brand</label>
        <input
          required
          value={form.business}
          onChange={update('business')}
          placeholder="Donkey Betz Coffee"
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-zinc-300">Product / service</label>
        <input
          value={form.product}
          onChange={update('product')}
          placeholder="Cold-brew subscription"
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Tone</label>
          <input
            value={form.tone}
            onChange={update('tone')}
            placeholder="cinematic, gritty, playful…"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-zinc-300">Audience</label>
          <input
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
