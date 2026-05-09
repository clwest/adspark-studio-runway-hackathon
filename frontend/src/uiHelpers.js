// PR BD — Shared UI helpers extracted from CharacterCard.jsx.
//
// These were originally introduced in PR BB (voice repair audit
// trail). PR BD lifts them to a shared module so future
// spokesperson-first surfaces (PR BE+) can render the same
// audit-row affordances without re-defining the swatches /
// timestamp formatter / status & drift class maps.
//
// Behaviour is identical to the original CharacterCard.jsx
// definitions; this is a pure relocation slice.

/**
 * Compact relative-time formatter for audit-trail / history rows.
 * Same bucket structure as `formatVerifyFreshness` from PR AW
 * minus the `"Last checked "` prefix so the string fits at the
 * right end of a single-line list row.
 *
 *   < 45 s   → "just now"
 *   < 60 m   → "Nm ago"
 *   < 24 h   → "Nh ago"
 *   else     → "Nd ago"
 *
 * Future timestamps (clock skew on a stale tab) clamp to "just
 * now" so the label never reads negative time. Empty / unparseable
 * inputs return `""` so the consumer can skip rendering.
 *
 * @param {string | null | undefined} isoString
 * @param {number} [nowMs]
 * @returns {string}
 */
export function formatHistoryTimestamp(isoString, nowMs = Date.now()) {
  if (!isoString) return ''
  const ts = Date.parse(isoString)
  if (!Number.isFinite(ts)) return ''
  const deltaMs = nowMs - ts
  if (deltaMs < 45_000) return 'just now'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Colour swatches per voice-repair audit-trail action (PR BB).
 * Operator scans the action column at a glance without reading
 * every label: clone is the create event (emerald), apply is the
 * routine retry (indigo), repair is the drift correction (amber),
 * refresh + verify are read-only diagnostics (zinc).
 */
export const HISTORY_ACTION_PILLS = Object.freeze({
  clone:
    'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40',
  apply:
    'bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40',
  repair:
    'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40',
  refresh:
    'bg-zinc-700 text-zinc-200 ring-1 ring-zinc-500',
  verify:
    'bg-zinc-700 text-zinc-200 ring-1 ring-zinc-500',
})

/**
 * Map an audit-row's primary status string to a Tailwind pill
 * class. Mirrors the colour vocabulary used elsewhere in the
 * voice section (emerald = success, soft-emerald = mock, rose =
 * failure / unverified, zinc = unknown / neutral).
 */
export function historyStatusClass(status) {
  if (!status) return 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700'
  const s = String(status).toLowerCase()
  if (
    s === 'ready' ||
    s === 'applied' ||
    s === 'verified'
  )
    return 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
  if (s === 'mock' || s === 'mock_patched' || s === 'mock_verified')
    return 'bg-emerald-500/15 text-emerald-200/90 ring-1 ring-emerald-400/30'
  if (s === 'failed' || s === 'unverified' || s === 'pending_avatar')
    return 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40'
  return 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700'
}

/**
 * Map an audit-row's drift_status to a Tailwind pill class. Match
 * is emerald (cloned voice resolves on the avatar), drift is rose
 * (mismatch needs repair), unknown is zinc (verify hasn't run).
 */
export function historyDriftClass(drift) {
  if (drift === 'match')
    return 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
  if (drift === 'drift')
    return 'bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40'
  return 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700'
}
