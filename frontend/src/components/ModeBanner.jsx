function Pill({ label, real }) {
  return (
    <span
      className={`text-xs rounded-full px-2 py-0.5 font-mono ${
        real
          ? 'bg-emerald-500/20 text-emerald-300'
          : 'bg-amber-500/20 text-amber-300'
      }`}
    >
      {label}: {real ? 'real' : 'mock'}
    </span>
  )
}

export default function ModeBanner({ health }) {
  if (!health) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
        Checking backend mode…
      </div>
    )
  }
  const conceptsReal = health.openai_mock === false
  const runwayReal = health.runway_mock === false

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold mr-2">Mode</h3>
        <Pill label="Concepts (OpenAI)" real={conceptsReal} />
        <Pill label="Runway video" real={runwayReal} />
        {runwayReal && (
          <span className="text-xs rounded-full bg-spark/20 text-spark px-2 py-0.5">
            real Runway verified
          </span>
        )}
      </div>

      <ul className="text-xs text-zinc-400 space-y-1 leading-relaxed">
        <li>
          <span className="text-zinc-300">Demo mode</span> — both providers
          mocked. Deterministic concepts, mock task that "succeeds" with a
          public sample MP4 in ~12s. No keys, no spend.
        </li>
        <li>
          <span className="text-zinc-300">Real mode</span> — concepts and/or
          Runway use live APIs based on which keys are set in the repo-root
          <code className="px-1 bg-zinc-950 rounded">.env</code>.
          Partial mock is fine (e.g. mock concepts + real Runway).
        </li>
        {runwayReal && (
          <li className="text-rose-300">
            Runway is in real <code className="px-1 bg-zinc-950 rounded">image_to_video</code>
            mode — a public reference image URL is <span className="font-semibold">required</span>
            on every Generate Video click. Backend will return a 400 if it's missing.
          </li>
        )}
      </ul>
    </div>
  )
}
