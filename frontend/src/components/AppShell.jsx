import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

import TopBar from './TopBar.jsx'

const UX_STORAGE_KEY = 'adspark.ux'

/**
 * PR CA — App shell with TopBar + routed outlet.
 *
 * One-shot localStorage migration: any user with
 * `localStorage.adspark.ux === "v1"` (set by the now-retired
 * footer toggle) gets navigated to /legacy once on first
 * mount, and the key is cleared so subsequent visits resolve
 * to `/` (the new Spokesperson Library default). Visitors
 * with no key, or with `"v2"`, land on whatever route they
 * requested.
 *
 * Equivalent ?ux=v1 query parameter is honoured the same way
 * (legacy demo links from before PR CA still work).
 *
 * No data fetching here — TopBar pulls /health independently;
 * each route page owns its own list fetches (Library reads
 * /api/characters + /api/campaigns; LegacyApp reads the same
 * pair from its existing useEffect). A single shared store
 * is the obvious next refactor (PR CB/CC) but staying with
 * the existing per-component fetch keeps PR CA's blast radius
 * tight.
 */
export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (location.pathname.startsWith('/legacy')) return
    let shouldRedirect = false
    try {
      const url = new URL(window.location.href)
      const queryUx = url.searchParams.get('ux')
      if (queryUx === 'v1') {
        shouldRedirect = true
        url.searchParams.delete('ux')
        window.history.replaceState({}, '', url.toString())
      } else if (queryUx === 'v2') {
        // PR CA — legacy `/?ux=v2` deep-links resolve to `/`.
        // Strip the param so refreshes don't re-trigger the
        // migration logic on every load.
        url.searchParams.delete('ux')
        window.history.replaceState({}, '', url.toString())
      }
      const stored = window.localStorage.getItem(UX_STORAGE_KEY)
      if (stored === 'v1') {
        shouldRedirect = true
      }
      if (stored) {
        // PR CA — clear once so the migration is single-shot.
        window.localStorage.removeItem(UX_STORAGE_KEY)
      }
    } catch {
      // localStorage / URL access can throw in private modes;
      // failing soft is the right default — visitor stays on /.
      return
    }
    if (shouldRedirect) {
      navigate('/legacy', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-studio-950 text-zinc-100">
      <TopBar />
      <Outlet />
    </div>
  )
}
