import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import AppShell from './components/AppShell.jsx'
import LegacyApp from './LegacyApp.jsx'
import Library from './Library.jsx'

/**
 * PR CA — App router root.
 *
 * The full v1 four-stage wizard + saved-campaign gallery
 * (PR A through PR AZ-era stack) used to live directly in
 * this file. As of PR CA, App.jsx is a thin router shell:
 *
 *   /            → <AppShell /> + <Library />
 *                  (Spokesperson Library — the new product
 *                   homepage; v2 surface, no flag required)
 *   /legacy      → <AppShell /> + <LegacyApp />
 *                  (verbatim v1 wizard + gallery, frozen)
 *   /legacy/*    → currently aliased to /legacy. The
 *                   `/legacy/gallery` deep-link is documented
 *                   for PR CB (will scroll to gallery anchor
 *                   inside LegacyApp). For PR CA, anything
 *                   under /legacy renders the full LegacyApp
 *                   so demo emergencies work.
 *   anything else → redirect to /
 *
 * AppShell owns the persistent TopBar (logo + health pill +
 * Legacy UI link) so route navigations don't unmount it.
 *
 * Do not put data fetching here. Each route page owns its
 * own list fetches; a shared store lands in PR CB+ if
 * needed.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Library />} />
          <Route path="legacy" element={<LegacyApp />} />
          <Route path="legacy/*" element={<LegacyApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
