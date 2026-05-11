/**
 * PR CW — Clean portrait prompt composer (frontend).
 *
 * Mirrors `backend/app/services/character_studio_client.py`'s
 * `_compose_clean_prompt` byte-for-byte so the v1 CharacterStudio
 * textarea + the v2 CreateSpokespersonFlow textarea + the backend
 * default path all produce the same string for the same inputs.
 *
 * Output shape:
 *   "Polished {anchor} portrait of {subject}[ wearing {wardrobe}]. "
 *   "{expression cue}. "
 *   "[{aesthetic sentence}.] "
 *   "Head-and-shoulders composition on a clean neutral background. "
 *   "Professional advertising character design. "
 *   "[Soft studio lighting.]"
 *
 * Operator-typed text in the textarea still gets POSTed verbatim as
 * `prompt_override` and the backend `build_prompt` short-circuits
 * to it before the composer runs — so manual edits are preserved.
 */

const _trim = (s) => String(s || '').trim()

const _DEFAULT_SUBJECT = {
  mascot: 'a friendly brand mascot',
  founder: 'a polished founder spokesperson, mid-30s',
  coach: 'an energetic coach spokesperson, mid-30s',
  local_guide: 'a welcoming local-business spokesperson',
}

// Per-template expression cue. Drives the second sentence of the
// composed prompt.
const _EXPRESSION_CUE = {
  mascot: 'Calm confident expression',
  founder: 'Direct trustworthy gaze with a soft natural smile',
  coach: 'Confident bright expression',
  local_guide: 'Welcoming friendly expression',
}

// Style chip mapping — each chip lands in one of three categories
// (design / color / light). The composer picks one phrase per
// category and folds them into a single readable sentence.
const _STYLE_CHIPS = {
  // design
  stylized: ['design', 'stylized commercial brand-character design'],
  editorial: ['design', 'editorial advertising aesthetic'],
  'plush mascot': ['design', 'plush mascot character design'],
  // colors
  'muted palette': ['color', 'muted colors'],
  'bright palette': ['color', 'bright friendly colors'],
  'vibrant palette': ['color', 'vibrant colors'],
  // lighting
  'studio light': ['light', 'soft studio lighting'],
  'natural light': ['light', 'natural soft lighting'],
  cinematic: ['light', 'cinematic lighting'],
}

// Anchor word for "Polished {anchor} portrait of …" — first chip
// in this priority list that appears in the operator's chips wins.
// Falls back to "commercial" when no priority chip is present.
const _ANCHOR_PRIORITY = ['editorial', 'cinematic', 'stylized']
const _DEFAULT_ANCHOR = 'commercial'

const _PROMPT_HARD_CAP = 700

function _ensureArticle(text) {
  const t = _trim(text)
  if (!t) return ''
  const lower = t.toLowerCase()
  for (const prefix of ['a ', 'an ', 'the ', 'his ', 'her ', 'their ']) {
    if (lower.startsWith(prefix)) return t
  }
  const article = 'aeiou'.includes(t[0].toLowerCase()) ? 'an ' : 'a '
  return article + t
}

function _formatWardrobe(text) {
  const items = String(text || '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
  if (items.length === 0) return ''
  const head = _ensureArticle(items[0])
  if (items.length === 1) return head
  return [head, ...items.slice(1)].join(' and ')
}

function _parseStyle(style) {
  if (!style) return { chips: [], wardrobe: '' }
  const s = _trim(style)
  let chipsPart = s
  let wardrobe = ''
  const sep = s.indexOf(';')
  if (sep >= 0) {
    chipsPart = s.slice(0, sep)
    wardrobe = s.slice(sep + 1)
  }
  const chips = chipsPart
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  return { chips, wardrobe: _trim(wardrobe) }
}

function _composeAesthetic(chips, usedAnchor) {
  const byCat = { design: null, color: null, light: null }
  for (const chip of chips) {
    if (chip === usedAnchor) continue
    const mapped = _STYLE_CHIPS[chip]
    if (!mapped) continue
    const [cat, phrase] = mapped
    if (byCat[cat] === null) byCat[cat] = phrase
  }
  if (!byCat.design && !byCat.color && !byCat.light) return ''
  const subjectPhrase = byCat.design || 'Polished commercial illustration'
  const modifiers = [byCat.color, byCat.light].filter(Boolean)
  if (modifiers.length === 0) return subjectPhrase
  return `${subjectPhrase} with ${modifiers.join(' and ')}`
}

function _capitalizeFirst(text) {
  if (!text) return text
  return text.slice(0, 1).toUpperCase() + text.slice(1)
}

/**
 * Build the auto-derived portrait prompt. Pure / deterministic.
 *
 * @param  {object} args
 * @param  {string} [args.template='mascot']
 * @param  {string} [args.subject='']
 * @param  {string} [args.style='']  - "chip1, chip2; wardrobe text"
 * @returns {string}
 */
export function buildCharacterPortraitPrompt({
  template = 'mascot',
  subject = '',
  style = '',
} = {}) {
  const tmpl = _EXPRESSION_CUE[template] ? template : 'mascot'
  const defaults = _DEFAULT_SUBJECT[tmpl] || _DEFAULT_SUBJECT.mascot
  const { chips, wardrobe } = _parseStyle(style)

  const subjectText = _ensureArticle(_trim(subject) || defaults)
  const anchor =
    _ANCHOR_PRIORITY.find((c) => chips.includes(c)) || _DEFAULT_ANCHOR
  const usedAnchor = chips.includes(anchor) ? anchor : null

  const wardrobePhrase = _formatWardrobe(wardrobe)
  const wardrobeClause = wardrobePhrase ? ` wearing ${wardrobePhrase}` : ''
  const expressionCue = _EXPRESSION_CUE[tmpl]
  const aesthetic = _composeAesthetic(chips, usedAnchor)

  const lines = [
    `Polished ${anchor} portrait of ${subjectText}${wardrobeClause}.`,
    // PR DT — singular framing. Mirrors the backend composer; keeps
    // the textarea preview in sync with what gen4_image actually
    // receives. Drives gen4_image away from duplicate-subject
    // hallucinations (Riggs regenerate returning two raccoons).
    'Single solitary figure, one character only, centered solo subject.',
    `${expressionCue}.`,
  ]
  if (aesthetic) lines.push(`${_capitalizeFirst(aesthetic)}.`)
  lines.push('Head-and-shoulders composition on a clean neutral background.')
  lines.push('Professional advertising character design.')
  const lightAlreadyUsed = chips.some(
    (c) =>
      c !== usedAnchor &&
      _STYLE_CHIPS[c] &&
      _STYLE_CHIPS[c][0] === 'light',
  )
  if (!lightAlreadyUsed) lines.push('Soft studio lighting.')

  return lines.join(' ').slice(0, _PROMPT_HARD_CAP)
}

/**
 * Helper-text shown above the portrait textarea. Reflects the new
 * composer's positive-only direction.
 */
export const PORTRAIT_PROMPT_HELPER =
  'Best avatar results: centered head-and-shoulders portrait, face ' +
  'visible, eyes visible, mouth visible, clean background, ' +
  'unobstructed view of the face.'
