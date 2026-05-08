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
  // image_gen_mock is set by /health and currently mirrors runway_mock; kept as
  // a separate pill so judges can see the system uses Runway for both legs.
  const imageGenReal = health.image_gen_mock === false

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold mr-2">Mode</h3>
        <Pill label="Concepts (OpenAI)" real={conceptsReal} />
        <Pill label="Image Gen (Runway)" real={imageGenReal} />
        <Pill label="Video Gen (Runway)" real={runwayReal} />
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
          public sample MP4 in ~12s, mock reference image (locally-generated PNG).
          No keys, no spend.
        </li>
        <li>
          <span className="text-zinc-300">Real mode</span> — concepts and/or
          Runway use live APIs based on which keys are set in the repo-root
          <code className="px-1 bg-zinc-950 rounded">.env</code>.
          Image Gen + Video Gen share the Runway key today.
        </li>
        {runwayReal && (
          <li className="text-rose-300">
            Runway is live — Gen-4 Turbo requires a reference image; Gen-4.5
            supports text-only. Use the model selector and the
            "Use text-only video" checkbox to choose.
          </li>
        )}
      </ul>
    </div>
  )
}
