// Map raw thrown errors (from api.js's jsonFetch) into short, judge-friendly
// strings. jsonFetch throws Error("<status> <statusText>: <body>"); FastAPI
// 400/404/409/422/502 responses carry a JSON body with `detail`. We try to
// pull that out and otherwise fall back to a trimmed version of the message.

export function friendlyError(e, hint = '') {
  const raw = String(e?.message || e || 'unknown error').trim()
  const m = raw.match(/^(\d{3})\s+[^:]*:\s*(.+)$/s)
  let detail = ''
  if (m) {
    const body = m[2]
    try {
      const parsed = JSON.parse(body)
      if (Array.isArray(parsed?.detail)) {
        // FastAPI 422 validation errors come as an array of {loc, msg, ...}
        detail = parsed.detail
          .map((d) => d.msg || JSON.stringify(d))
          .join('; ')
      } else if (parsed?.detail) {
        detail = String(parsed.detail)
      } else {
        detail = body.slice(0, 200)
      }
    } catch {
      detail = body.slice(0, 200)
    }
  } else {
    detail = raw.replace(/^Error:\s*/, '')
  }
  detail = detail.trim() || 'Something went wrong'
  return hint ? `${hint} — ${detail}` : detail
}

// Per-call hints to give judges a clear "what to try next" line. Kept short
// and copy-edited for the demo; the technical detail still lands in detail.
export const ERROR_HINTS = {
  concepts: 'Couldn’t generate concepts',
  image: 'Reference image generation failed',
  video: 'Video generation failed',
  poll: 'Lost track of the Runway task',
  save: 'Couldn’t save the campaign',
  finish: 'Couldn’t build that pack format',
  realtime: 'Couldn’t start the realtime session',
}
