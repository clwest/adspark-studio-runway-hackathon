// Persisted user-facing settings for the prompt panel. Stored in
// localStorage under a single versioned key so we can re-shape later
// without colliding with stale values.
//
// Never persist secrets, generated media bytes, or anything Runway returned
// directly. Reference image URLs are kept ONLY when they look safe (local
// /api/runway/image/<id> or http(s) — never data: URIs which can be
// arbitrarily large).

export const STORAGE_KEY = 'adspark.settings.v1'

export const ALLOWED_MODELS = ['gen4_turbo', 'gen4.5']
export const ALLOWED_RATIOS = ['1280:720', '720:1280', '960:960']
export const ALLOWED_DURATIONS = {
  gen4_turbo: [5],
  'gen4.5': [5, 8, 10],
}

export const DEFAULT_SETTINGS = Object.freeze({
  model: 'gen4_turbo',
  ratio: '1280:720',
  duration: 5,
  textOnly: false,
  imageUrl: '',
})

function isSafeImageUrl(s) {
  if (typeof s !== 'string' || !s) return false
  if (s.startsWith('/api/runway/image/')) return true
  if (/^https?:\/\//i.test(s)) return true
  // Reject data: blob: file: javascript: etc.
  return false
}

export function clampSettings(input) {
  const s = { ...DEFAULT_SETTINGS, ...(input || {}) }
  if (!ALLOWED_MODELS.includes(s.model)) s.model = DEFAULT_SETTINGS.model
  if (!ALLOWED_RATIOS.includes(s.ratio)) s.ratio = DEFAULT_SETTINGS.ratio
  const allowedD = ALLOWED_DURATIONS[s.model] || [DEFAULT_SETTINGS.duration]
  if (!allowedD.includes(s.duration)) s.duration = allowedD[0]
  if (s.model !== 'gen4.5') s.textOnly = false
  s.textOnly = Boolean(s.textOnly)
  s.imageUrl = isSafeImageUrl(s.imageUrl) ? s.imageUrl : ''
  return s
}

export function loadSettings() {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return clampSettings(parsed)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s) {
  try {
    if (typeof localStorage === 'undefined') return
    const safe = clampSettings(s)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
  } catch {
    // localStorage may be disabled (private mode, quota); persistence is
    // best-effort and never blocks the UI.
  }
}

// ---- PR U follow-up: persist activeCharacterId across reloads ----
// Lives under a separate key so the spokesperson choice survives a
// browser refresh or accidental tab close during demo recording.
// Cleared automatically when the character no longer exists in the
// library (the App.jsx reconciler handles that gracefully).

export const SPOKESPERSON_STORAGE_KEY = 'adspark.spokesperson.v1'

function isSafeCharacterId(id) {
  // Match the backend's character-id shape (12-char hex from
  // CharacterStore._slugify) plus the broader uuid hex shape just in
  // case. Refuse anything path-like.
  return (
    typeof id === 'string' &&
    /^[a-z0-9_-]{4,64}$/i.test(id)
  )
}

export function loadActiveSpokespersonId() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(SPOKESPERSON_STORAGE_KEY)
    if (!raw) return null
    return isSafeCharacterId(raw) ? raw : null
  } catch {
    return null
  }
}

export function saveActiveSpokespersonId(id) {
  try {
    if (typeof localStorage === 'undefined') return
    if (id === null || id === undefined || id === '') {
      localStorage.removeItem(SPOKESPERSON_STORAGE_KEY)
      return
    }
    if (!isSafeCharacterId(id)) return
    localStorage.setItem(SPOKESPERSON_STORAGE_KEY, id)
  } catch {
    // Best-effort.
  }
}
