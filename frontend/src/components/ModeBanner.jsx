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

function readinessFor(health, providerStatus) {
  if (!health) return { label: 'starting', tone: 'zinc' }
  if (health.status !== 'ok') return { label: 'backend down', tone: 'rose' }
  if (!providerStatus) return { label: 'checking providers', tone: 'zinc' }
  const realRunway = providerStatus.has_runway_key === true
  const realConcepts = health.openai_mock === false
  if (realRunway && realConcepts) return { label: 'demo ready · all live', tone: 'emerald' }
  if (realRunway && !realConcepts) {
    return { label: 'demo ready · concepts mocked', tone: 'emerald' }
  }
  return { label: 'demo mode', tone: 'amber' }
}

const TONE_CLASSES = {
  zinc: 'bg-zinc-800 text-zinc-300',
  rose: 'bg-rose-500/20 text-rose-300',
  amber: 'bg-amber-500/20 text-amber-300',
  emerald: 'bg-emerald-500/20 text-emerald-300',
}

export default function ModeBanner({ health, providerStatus, organization }) {
  if (!health) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-500">
        Checking backend mode…
      </div>
    )
  }
  const conceptsReal = health.openai_mock === false
  const runwayReal = health.runway_mock === false
  const imageGenReal = health.image_gen_mock === false
  const readiness = readinessFor(health, providerStatus)
  // Show a credits chip only when runway is live AND we got a numeric value.
  // Failure / mock modes intentionally render no chip — non-blocking.
  const credits =
    runwayReal && organization && typeof organization.credits === 'number'
      ? organization.credits
      : null

  const supportTooltip = providerStatus
    ? `models: ${providerStatus.supported_models.join(', ')}\nratios: ${(providerStatus.supported_ratios_by_model?.[
        providerStatus.supported_models[0]
      ] || []).join(', ')}`
    : 'provider status unavailable'

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold mr-2">Mode</h3>
        <span
          className={`text-xs rounded-full px-2 py-0.5 font-mono ${TONE_CLASSES[readiness.tone]}`}
          title={supportTooltip}
          aria-label="readiness"
        >
          {readiness.label}
        </span>
        <Pill label="Concepts (OpenAI)" real={conceptsReal} />
        <Pill label="Image Gen (Runway)" real={imageGenReal} />
        <Pill label="Video Gen (Runway)" real={runwayReal} />
        {credits !== null && (
          <span
            className="text-xs rounded-full bg-spark/20 text-spark px-2 py-0.5 font-mono"
            title="Runway credits remaining (best-effort, refreshes on page load)"
          >
            credits: {credits}
          </span>
        )}
        {runwayReal && credits === null && typeof organization?.monthly_credit_cap === 'number' && (
          <span
            className="text-[10px] rounded-full bg-zinc-800 text-zinc-300 px-2 py-0.5 font-mono"
            title="Runway returns the monthly spend cap, not a per-account balance, on the org endpoint."
          >
            cap: {organization.monthly_credit_cap.toLocaleString()}
          </span>
        )}
        {runwayReal && credits === null && !organization?.monthly_credit_cap && organization?.error && (
          <span
            className="text-[10px] text-zinc-500"
            title={`organization endpoint: ${organization.error}`}
          >
            (credit balance unavailable)
          </span>
        )}
      </div>

      {/* PR Q (Phase 3) — collapsed by default. Pills above stay
          always visible (smoke depends on them); the explanatory copy
          here is reference material the user rarely re-reads. */}
      <details className="text-xs text-zinc-400 leading-relaxed group">
        <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300 list-none flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spark/40 rounded">
          <span className="inline-block transition-transform group-open:rotate-90 text-zinc-600">
            ▸
          </span>
          <span className="group-open:hidden">show details</span>
          <span className="hidden group-open:inline">hide details</span>
        </summary>
        <ul className="space-y-1 mt-2 pl-3">
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
      </details>
    </div>
  )
}
