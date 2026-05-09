// PR BD — UX v2 feature flag.
//
// Foundation slice for the spokesperson-first redesign (see
// docs/handoffs/SESSION_035_UX_V2_FLAG.md). The whole redesign
// (PR BE through PR BO) ships behind this flag so the v13
// hackathon-submission demo stays intact at every commit. This
// module is the single source of truth for flag state.
//
// Read order (highest precedence first):
//   1. ?ux=v2 / ?ux=v1 URL search param (also persists to localStorage)
//   2. localStorage.adspark.ux === "v2"
//   3. default → "v1" (current legacy UX)
//
// All helpers are no-ops on the server (they guard against the
// `window` / `localStorage` surfaces being absent so the module
// is import-safe in test runners that mock them).

const STORAGE_KEY = 'adspark.ux'

const VALID_MODES = new Set(['v1', 'v2'])

function safeWindow() {
  if (typeof window === 'undefined') return null
  return window
}

function safeLocalStorage() {
  const w = safeWindow()
  if (!w) return null
  try {
    return w.localStorage
  } catch {
    return null
  }
}

function readUrlMode() {
  const w = safeWindow()
  if (!w || !w.location || !w.location.search) return null
  let params
  try {
    params = new URLSearchParams(w.location.search)
  } catch {
    return null
  }
  const raw = (params.get('ux') || '').toLowerCase().trim()
  return VALID_MODES.has(raw) ? raw : null
}

function readStorageMode() {
  const ls = safeLocalStorage()
  if (!ls) return null
  let raw
  try {
    raw = ls.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  const trimmed = String(raw).toLowerCase().trim()
  return VALID_MODES.has(trimmed) ? trimmed : null
}

function writeStorageMode(mode) {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.setItem(STORAGE_KEY, mode)
  } catch {
    // Quota / private-mode failures shouldn't break the app.
  }
}

/**
 * Resolve the active UX mode. URL param wins; otherwise persisted
 * localStorage value; otherwise legacy v1. URL mode is also
 * persisted on read so a `?ux=v2` deep-link sticks across reloads
 * after the first visit.
 *
 * @returns {"v1" | "v2"}
 */
export function getUxMode() {
  const fromUrl = readUrlMode()
  if (fromUrl) {
    writeStorageMode(fromUrl)
    return fromUrl
  }
  const fromStorage = readStorageMode()
  if (fromStorage) return fromStorage
  return 'v1'
}

/**
 * Convenience: true when the resolved mode is v2.
 */
export function isUxV2() {
  return getUxMode() === 'v2'
}

/**
 * Persist a new UX mode to localStorage. Caller is responsible
 * for triggering a re-render (or full reload) so the rest of the
 * app picks up the change. Invalid inputs are ignored so the
 * legacy mode stays the safe baseline.
 *
 * @param {"v1" | "v2"} mode
 */
export function setUxMode(mode) {
  const normalised = String(mode || '').toLowerCase().trim()
  if (!VALID_MODES.has(normalised)) return
  writeStorageMode(normalised)
}

// Exported for tests + future surfaces that want to react to the
// flag without redefining the constant.
export const UX_MODES = Object.freeze({ V1: 'v1', V2: 'v2' })
export const UX_STORAGE_KEY = STORAGE_KEY


// ---- PR BH — campaign-mode persistence ---------------------------
//
// The v2 SpokespersonStudio's "+ New Campaign" affordance opens a
// mode-first modal (Cinematic / Spokesperson / Dialogue). Selecting
// a mode persists it here so the upcoming lane components (PR BJ–BL)
// can route on it. Backend is untouched in PR BH — when those lane
// components ship they'll either thread the mode into the existing
// `POST /api/campaigns` payload or graduate this to a real schema
// field. Until then we keep it client-side and surface a pill so
// the operator's choice isn't invisible.

const ACTIVE_MODE_STORAGE_KEY = 'adspark.activeMode'

const VALID_CAMPAIGN_MODES = new Set(['cinematic', 'spokesperson', 'dialogue'])

/**
 * Resolve the currently selected campaign mode (v2 only). Returns
 * one of `"cinematic" | "spokesperson" | "dialogue"` or `null` when
 * nothing has been chosen yet. Invalid persisted values are ignored.
 */
export function getActiveMode() {
  const ls = safeLocalStorage()
  if (!ls) return null
  let raw
  try {
    raw = ls.getItem(ACTIVE_MODE_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  const trimmed = String(raw).toLowerCase().trim()
  return VALID_CAMPAIGN_MODES.has(trimmed) ? trimmed : null
}

/**
 * Persist the active campaign mode to localStorage. Caller is
 * responsible for triggering a re-render. Invalid inputs are ignored
 * so a stray call can never poison the store.
 */
export function setActiveMode(mode) {
  const ls = safeLocalStorage()
  if (!ls) return
  const normalised = String(mode || '').toLowerCase().trim()
  if (!VALID_CAMPAIGN_MODES.has(normalised)) return
  try {
    ls.setItem(ACTIVE_MODE_STORAGE_KEY, normalised)
  } catch {
    // Quota / private mode — fail silently like the rest of this module.
  }
}

/**
 * Clear the active campaign mode. Used when the operator dismisses
 * the placeholder banner or when a future lane component finishes
 * routing the choice.
 */
export function clearActiveMode() {
  const ls = safeLocalStorage()
  if (!ls) return
  try {
    ls.removeItem(ACTIVE_MODE_STORAGE_KEY)
  } catch {
    // see above
  }
}

export const CAMPAIGN_MODES = Object.freeze({
  CINEMATIC: 'cinematic',
  SPOKESPERSON: 'spokesperson',
  DIALOGUE: 'dialogue',
})
export const ACTIVE_MODE_KEY = ACTIVE_MODE_STORAGE_KEY
