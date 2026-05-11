// PR AL — Transcript export formatters.
//
// Pure functions so the unit shape is easy to reason about + the
// Realtime tab handler stays tiny. The frontend already has every
// turn in `campaign.realtime_transcript_turns`, so no backend round-
// trip is required for either export format.

const SPEAKER_DEFAULTS = {
  avatar: 'Avatar',
  user: 'Visitor',
  system: 'System',
}

function speakerLabel(turn) {
  const fromTurn = (turn && turn.speaker && String(turn.speaker).trim()) || ''
  if (fromTurn) return fromTurn
  return SPEAKER_DEFAULTS[turn?.role] || SPEAKER_DEFAULTS.system
}

function campaignTitle(campaign) {
  if (!campaign) return 'Character OS campaign'
  const business = (campaign.business || '').trim()
  const product = (campaign.product || '').trim()
  if (business && product) return `${business} · ${product}`
  if (business) return business
  if (product) return product
  return campaign.id || 'Character OS campaign'
}

export function buildTranscriptMarkdown(campaign, turns) {
  const safeTurns = Array.isArray(turns) ? turns : []
  const lines = []
  lines.push('# Conversation Transcript')
  lines.push('')
  lines.push(`Campaign: ${campaignTitle(campaign)}`)
  if (campaign?.runway_conversation_id) {
    lines.push(`Conversation ID: ${campaign.runway_conversation_id}`)
  }
  if (campaign?.realtime_transcript_fetched_at) {
    lines.push(`Fetched: ${campaign.realtime_transcript_fetched_at}`)
  }
  if (campaign?.realtime_transcript_mock_mode) {
    lines.push('Mock mode: yes')
  }
  lines.push('')
  lines.push('## Transcript')
  lines.push('')
  if (safeTurns.length === 0) {
    lines.push('_No turns recorded._')
  } else {
    for (const turn of safeTurns) {
      const speaker = speakerLabel(turn)
      const text = (turn?.text || '').trim()
      if (!text) continue
      lines.push(`**${speaker}:** ${text}`)
      lines.push('')
    }
  }
  return lines.join('\n').replace(/\n{3,}$/g, '\n\n').replace(/\s+$/g, '') + '\n'
}

export function buildTranscriptText(campaign, turns) {
  const safeTurns = Array.isArray(turns) ? turns : []
  const lines = []
  lines.push('Conversation Transcript')
  lines.push('=======================')
  lines.push(`Campaign: ${campaignTitle(campaign)}`)
  if (campaign?.runway_conversation_id) {
    lines.push(`Conversation ID: ${campaign.runway_conversation_id}`)
  }
  if (campaign?.realtime_transcript_fetched_at) {
    lines.push(`Fetched: ${campaign.realtime_transcript_fetched_at}`)
  }
  if (campaign?.realtime_transcript_mock_mode) {
    lines.push('Mock mode: yes')
  }
  lines.push('')
  if (safeTurns.length === 0) {
    lines.push('(no turns recorded)')
  } else {
    for (const turn of safeTurns) {
      const speaker = speakerLabel(turn)
      const text = (turn?.text || '').trim()
      if (!text) continue
      lines.push(`${speaker}: ${text}`)
    }
  }
  return lines.join('\n').replace(/\s+$/g, '') + '\n'
}

export function downloadTextFile(filename, content) {
  // Best-effort browser download. Returns true on success / false when
  // the host environment lacks the required APIs (caller surfaces a
  // friendly fallback). Always cleans up the object URL it creates.
  if (typeof window === 'undefined') return false
  const Blob_ = (typeof Blob !== 'undefined') ? Blob : window.Blob
  const URL_ = window.URL || window.webkitURL
  if (!Blob_ || !URL_ || !URL_.createObjectURL) return false
  let url
  try {
    const blob = new Blob_([content], { type: 'text/plain;charset=utf-8' })
    url = URL_.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  } catch (_err) {
    return false
  } finally {
    if (url && URL_.revokeObjectURL) {
      // Defer revocation a tick so the browser has a chance to start
      // the download before the URL is invalidated.
      setTimeout(() => URL_.revokeObjectURL(url), 1_000)
    }
  }
}

export async function copyToClipboard(text) {
  // Promise-style: resolves true on success, false when no clipboard
  // surface is available (HTTPS / older browsers). Caller decides how
  // to surface the failure.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_err) {
      // Some browsers throw on permissions issues; fall through to the
      // textarea fallback.
    }
  }
  if (typeof document === 'undefined') return false
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'absolute'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand && document.execCommand('copy')
    ta.remove()
    return Boolean(ok)
  } catch (_err) {
    return false
  }
}

export function transcriptFilename(campaign, ext = 'txt') {
  const base =
    (campaign?.business || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    || campaign?.id
    || 'campaign'
  const cid = campaign?.id ? `-${campaign.id.slice(0, 8)}` : ''
  return `adspark-transcript-${base}${cid}.${ext}`
}
