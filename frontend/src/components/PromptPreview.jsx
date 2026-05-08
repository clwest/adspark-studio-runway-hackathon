export default function PromptPreview({ prompt, onChange, onGenerate, busy, disabled }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Runway video prompt</h3>
        <span className="text-xs text-zinc-500">edit before generating</span>
      </div>
      <textarea
        rows={4}
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-spark text-sm"
      />
      <button
        type="button"
        disabled={busy || disabled || !prompt.trim()}
        onClick={onGenerate}
        className="rounded-lg bg-spark text-ink font-semibold px-4 py-2 disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Generate Video'}
      </button>
    </div>
  )
}
