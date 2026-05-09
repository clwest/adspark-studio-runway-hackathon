/**
 * PR AA — Deterministic Commercial Script builder.
 *
 * Generates an editable spoken-pitch script from the campaign's
 * concept fields + the active spokesperson character. The output is
 * the audio script the Avatar Host Clip will speak; downstream
 * `commercial-with-voice` and `storyboard/voiced` mux this script's
 * spoken audio over the visual cut.
 *
 * Mirrors the backend's `character_host_client.build_script` shape
 * but adds the spokesperson personality + a stronger brand-voice
 * cadence so the script reads less like template glue.
 *
 *   buildCommercialScript({ campaign, character }) => string
 *
 * Marketing copy lives in `selected_concept.{hook,caption,cta}` —
 * those are the load-bearing inputs. Falls back gracefully when any
 * field is empty.
 */
const _MAX_SCRIPT_CHARS = 300
const _trim = (s) => String(s || '').trim()
const _sentence = (s) => {
  const t = _trim(s)
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

export function buildCommercialScript({ campaign, character } = {}) {
  if (!campaign) return ''
  const concept = campaign.selected_concept || {}
  const business = _trim(campaign.business)
  const product = _trim(campaign.product)
  const audience = _trim(campaign.audience).split(/[,;]/)[0].trim()
  const hook = _trim(concept.hook)
  const caption = _trim(concept.caption)
  const cta = _trim(concept.cta).replace(/[→\->]+\s*$/, '').trim()
  const personality = character ? _trim(character.personality) : ''

  const lead = business ? `Meet ${business}.` : ''
  const positioning = audience
    ? `Built for ${audience}.`
    : ''
  const beats = [
    lead,
    _sentence(hook),
    positioning,
    _sentence(caption),
    _sentence(cta),
  ]
  // Personality nudges the cadence when present — a single descriptor
  // sentence between the hook and caption, not the whole brief.
  if (personality) {
    const trimmed = personality.split(/[.!?]/)[0].trim()
    if (trimmed && trimmed.length < 80) {
      beats.splice(2, 0, _sentence(trimmed))
    }
  }
  const script = beats.filter(Boolean).join(' ').trim()
  if (script.length <= _MAX_SCRIPT_CHARS) return script
  // Avatar speech endpoint caps at 300 chars. Trim cleanly on a sentence.
  const truncated = script.slice(0, _MAX_SCRIPT_CHARS)
  const lastStop = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?'),
  )
  return lastStop > 80 ? truncated.slice(0, lastStop + 1).trim() : truncated.trim()
}

export const COMMERCIAL_SCRIPT_MAX = _MAX_SCRIPT_CHARS
