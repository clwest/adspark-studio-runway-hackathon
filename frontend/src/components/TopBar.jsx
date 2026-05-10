import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { api } from '../api'

/**
 * PR CA — Top bar for the new app shell. Three jobs:
 *
 *   1. Brand: AdSpark Studio logo + tagline.
 *   2. Health pill that summarises whether real Runway / image
 *      providers are wired (the v1 ModeBanner used to surface
 *      this; we lift a smaller version into the persistent
 *      top bar so every route sees it).
 *   3. Top-right "Legacy UI ↗" link to /legacy. Replaces the
 *      v1 footer "Try preview UX / Use classic UX" toggle —
 *      now that `/` is the spokesperson library, the only
 *      reason to visit /legacy is the wizard / classic gallery
 *      (PR BR/BS click-through, demo emergencies).
 *
 * Backend untouched. Health is a single GET /health on mount;
 * no polling. The pill's data-mock attribute is consumed by
 * the smoke spec.
 */
export default function TopBar() {
  const [health, setHealth] = useState(null)
  const location = useLocation()
  const onLegacy = location.pathname.startsWith('/legacy')

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth({ status: 'down' }))
  }, [])

  const anyMock = health?.any_mock === true
  const runwayMock = health?.runway_mock === true
  const pillLabel = !health
    ? 'health…'
    : health.status === 'down'
    ? 'backend down'
    : runwayMock
    ? 'mock Runway'
    : anyMock
    ? 'partial mock'
    : 'live API'
  const pillClass = !health
    ? 'bg-zinc-800 text-zinc-400 ring-zinc-700'
    : health.status === 'down'
    ? 'bg-rose-500/15 text-rose-300 ring-rose-500/40'
    : runwayMock
    ? 'bg-amber-500/15 text-amber-300 ring-amber-500/40'
    : anyMock
    ? 'bg-amber-500/10 text-amber-200/80 ring-amber-500/30'
    : 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40'

  return (
    <header
      data-testid="app-shell-topbar"
      className="sticky top-0 z-30 backdrop-blur bg-studio-950/80 border-b border-zinc-900/70"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <Link
          to="/"
          data-testid="app-shell-home-link"
          className="flex items-center gap-2 group"
        >
          <span aria-hidden="true" className="text-lg">
            ✨
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-zinc-100 group-hover:text-spark transition-colors">
              AdSpark Studio
            </div>
            <div className="text-[10px] text-zinc-500 font-mono">
              persistent AI spokesperson infrastructure
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <span
            data-testid="app-shell-health-pill"
            data-mock={anyMock ? 'true' : 'false'}
            data-runway-mock={runwayMock ? 'true' : 'false'}
            data-status={health?.status || 'pending'}
            className={`text-[10px] rounded-full px-2 py-0.5 font-mono ring-1 ${pillClass}`}
            title={
              health
                ? `runway_mock=${health.runway_mock} · image_gen_mock=${health.image_gen_mock} · openai_mock=${health.openai_mock}`
                : 'fetching /health…'
            }
          >
            {pillLabel}
          </span>
          {onLegacy ? (
            <Link
              to="/"
              data-testid="app-shell-home-cta"
              className="text-[11px] rounded-md bg-pink-500/20 hover:bg-pink-500/35 text-pink-200 ring-1 ring-pink-400/40 px-2 py-1 font-mono transition-colors"
              title="Back to the Spokesperson Library."
            >
              ← Library
            </Link>
          ) : (
            <Link
              to="/legacy"
              data-testid="app-shell-legacy-link"
              className="text-[11px] rounded-md bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-300 ring-1 ring-zinc-700 px-2 py-1 font-mono transition-colors"
              title="Open the classic 4-stage wizard + saved-campaign gallery (PR A through PR AZ-era surface)."
            >
              Legacy UI ↗
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
