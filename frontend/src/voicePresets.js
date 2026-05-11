/**
 * PR AA — Curated descriptions for the focused subset of Runway
 * `runway-live-preset` voice ids that Character OS surfaces in the
 * Character Studio voice picker.
 *
 * Why descriptions instead of audio previews:
 *
 * Runway documents a `POST /v1/voices/preview` endpoint for sample
 * audio of *designed* voices, but no documented path returns a
 * standalone preview MP3 for a `runway-live-preset` (e.g. `drew`,
 * `vincent`) without first creating an avatar with that voice. We
 * deliberately don't fire avatar creates just to play a preset —
 * that costs Runway credits + leaves stale avatars behind.
 *
 * The descriptions below were authored by hand to reflect the
 * commonly-observed timbre + delivery of each preset. They're a
 * heuristic, not a guarantee — the user should still listen to the
 * Avatar Host Clip itself to confirm the voice matches their brand.
 *
 * Once a per-campaign Brand Voice exists (`/v1/voices` text-design),
 * its `previewUrl` is a real playable MP3 — that flow already lives
 * in the Voice tab and is unchanged by this PR.
 *
 * The full 30-preset list lives in
 * `backend/app/services/character_host_client.SUPPORTED_VOICE_PRESETS`
 * and any of those values are valid Runway preset ids; descriptions
 * below are a curated subset highlighted in the picker. Presets not
 * in the map fall back to a generic "Runway voice preset" string.
 */
export const VOICE_PRESET_DESCRIPTIONS = {
  drew: {
    label: 'Drew',
    summary: 'warm, grounded, friendly',
    detail: 'Conversational midrange — feels like a friend recommending the product.',
  },
  ruby: {
    label: 'Ruby',
    summary: 'bright, energetic, playful',
    detail: 'Upbeat delivery — pairs well with feel-good and lifestyle pitches.',
  },
  max: {
    label: 'Max',
    summary: 'confident, bold, commercial',
    detail: 'Big presence — built for headline reads, hook-heavy ad copy.',
  },
  victoria: {
    label: 'Victoria',
    summary: 'polished, professional, premium',
    detail: 'Smooth corporate cadence — strong fit for B2B and luxury brands.',
  },
  vincent: {
    label: 'Vincent',
    summary: 'smooth, classic spokesperson',
    detail: 'Reliable narrator timbre — broadly compatible default.',
  },
  clara: {
    label: 'Clara',
    summary: 'clear, articulate, trustworthy',
    detail: 'Steady mid-tone — works for explainer-style commercials.',
  },
  skye: {
    label: 'Skye',
    summary: 'soft, calm, reassuring',
    detail: 'Gentle delivery — wellness, mindfulness, family-friendly ads.',
  },
  morgan: {
    label: 'Morgan',
    summary: 'neutral, modern, balanced',
    detail: 'Versatile midrange — safe choice when tone is mixed.',
  },
  aurora: {
    label: 'Aurora',
    summary: 'rich, expressive, cinematic',
    detail: 'Story-leaning timbre — premium brand storytelling.',
  },
  felix: {
    label: 'Felix',
    summary: 'crisp, witty, tech-forward',
    detail: 'Bright cadence — startup, SaaS, dev-tooling vibes.',
  },
  marcus: {
    label: 'Marcus',
    summary: 'deep, authoritative, classic',
    detail: 'Low-end gravitas — automotive, finance, legacy brands.',
  },
  emma: {
    label: 'Emma',
    summary: 'engaging, sincere, modern',
    detail: 'Warm contemporary — DTC and lifestyle storytelling.',
  },
}

/**
 * Look up a description for a preset id (case-insensitive). Returns a
 * generic fallback when the preset isn't in the curated map so the
 * picker still renders something honest for the long tail of the
 * 30-preset roster.
 */
export function describeVoicePreset(presetId) {
  if (!presetId) return null
  const key = String(presetId).toLowerCase()
  if (VOICE_PRESET_DESCRIPTIONS[key]) return VOICE_PRESET_DESCRIPTIONS[key]
  return {
    label: key.charAt(0).toUpperCase() + key.slice(1),
    summary: 'Runway voice preset',
    detail: 'Curated description not available — listen to a host clip to confirm the timbre.',
  }
}

/**
 * Subset surfaced by the Character Studio voice picker. Returning
 * the curated keys (in display order) lets us show short cards
 * with descriptions instead of a bare 30-item dropdown.
 */
export const FEATURED_VOICE_PRESETS = [
  'drew',
  'ruby',
  'max',
  'victoria',
  'vincent',
  'clara',
  'skye',
  'morgan',
  'aurora',
  'felix',
  'marcus',
  'emma',
]
