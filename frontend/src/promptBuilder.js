/**
 * PR T — Structured Runway video prompt builder.
 *
 * Long cinematic "everything at once" prompts produce messy Runway
 * videos: the model tries to render multiple scenes in 5 seconds,
 * camera flips around, and the subject loses identity. The prompts
 * that consistently produce clean clips follow a tight structure:
 *
 *   - one character / subject
 *   - one environment / location
 *   - one action
 *   - one camera style
 *   - one emotional tone
 *   - clear visual constraints (lighting, style, format)
 *
 * Canonical successful example (raccoon coffee mascot):
 *
 *   "A realistic raccoon wearing a plaid robe and white t-shirt slowly
 *   walks into a small cozy kitchen early in the morning. The raccoon
 *   looks tired and half awake. Warm kitchen lighting. The raccoon
 *   presses the coffee machine button and watches coffee pour into a
 *   mug. Steam rises from the cup. The raccoon takes one sip and
 *   relaxes with a satisfied expression. Static camera shot, cinematic
 *   lighting, realistic fur, natural movement, cozy atmosphere, high
 *   detail, 16:9."
 *
 * See docs/research/RUNWAY_PROMPT_STRUCTURE.md for the rationale +
 * good/bad examples.
 */

const _join = (...parts) => parts.filter((p) => p && String(p).trim()).join(' ')
const _sentence = (s) => {
  const t = String(s || '').trim()
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/**
 * Compose a structured Runway video prompt from named fields.
 *
 *   buildRunwayVideoPrompt({
 *     subject:      'a friendly raccoon barista mascot',
 *     environment:  'a small cozy kitchen in the early morning',
 *     action:       'presses the coffee machine button and watches coffee pour into a mug',
 *     camera:       'static camera shot',
 *     lighting:     'warm kitchen lighting',
 *     style:        'cinematic',
 *     mood:         'cozy and satisfied',
 *     constraints:  'realistic fur, natural movement, high detail, 16:9',
 *   })
 *
 * Returns a single-paragraph prompt that opens with the subject +
 * action + environment, then layers mood, lighting, camera, style,
 * and constraints as separate beats. Empty fields are silently
 * dropped. Output is always punctuation-clean.
 */
export function buildRunwayVideoPrompt({
  subject = '',
  environment = '',
  action = '',
  camera = '',
  lighting = '',
  style = '',
  mood = '',
  constraints = '',
} = {}) {
  // Anchor sentence: "A realistic {subject} {action} in {environment}."
  // — when any of the three is missing, fall through to whatever's
  // present so the result still parses.
  const anchorParts = []
  if (subject) anchorParts.push(`A realistic ${subject.trim()}`)
  if (action) anchorParts.push(action.trim())
  if (environment) anchorParts.push(`in ${environment.trim()}`)
  const anchor = anchorParts.length ? _sentence(anchorParts.join(' ')) : ''

  const beats = [
    anchor,
    _sentence(mood),
    _sentence(lighting),
    _sentence(camera),
    _sentence(style),
    _sentence(constraints),
  ].filter(Boolean)

  return beats.join(' ').trim()
}

// ---- Concept → structured-prompt heuristic ------------------------

const _CONCEPT_PRESETS = {
  // Title prefix → preset shape. The mock concept_service uses these
  // exact prefixes; the OpenAI path produces variable titles so we
  // fall through to the daily-ritual default.
  'origin spark': {
    environment: 'a warm artisan workshop, soft sunlight through windows',
    actionTemplate: 'carefully prepares {subject} on a wooden surface',
    camera: 'static camera shot, slow push-in',
    lighting: 'warm tungsten light, golden highlights',
    mood: 'thoughtful, patient, made by hand',
  },
  'daily ritual': {
    environment: 'a small cozy kitchen in the early morning',
    actionTemplate: 'reaches for {subject} and uses it as part of a morning routine',
    camera: 'static camera shot',
    lighting: 'soft natural morning light',
    mood: 'calm, satisfied, unhurried',
  },
  frontier: {
    environment: 'a striking outdoor landscape at golden hour',
    actionTemplate: 'discovers {subject} and uses it for the first time',
    camera: 'static wide shot',
    lighting: 'golden hour light, soft rim',
    mood: 'curious, focused, energized',
  },
}

const _DEFAULT_PRESET = _CONCEPT_PRESETS['daily ritual']

const _matchPreset = (title) => {
  const t = String(title || '').toLowerCase()
  for (const key of Object.keys(_CONCEPT_PRESETS)) {
    if (t.includes(key)) return _CONCEPT_PRESETS[key]
  }
  return _DEFAULT_PRESET
}

/**
 * Convert a selected ad concept + campaign form into a structured
 * Runway video prompt. The dense ``visual`` prose from concept_service
 * gets discarded — the structured fields (subject, environment,
 * action…) are derived from the concept's title + the form's
 * product/business/tone/audience instead.
 *
 * Marketing copy (hook, caption, CTA) is intentionally NOT folded
 * into the video prompt — it lives on the campaign for the host
 * clip / overlay text. This matches the rule "do not dump full
 * marketing copy into the video prompt".
 *
 *   simplifyFromConcept({
 *     concept,            // AdConcept from /api/concepts
 *     form,               // { business, product, tone, audience }
 *     ratio = '1280:720', // optional — appended to constraints
 *   })  => string
 */
export function simplifyFromConcept({ concept, form, ratio = '1280:720' } = {}) {
  if (!concept || !form) return ''
  const product = (form.product || '').trim()
  const business = (form.business || '').trim()
  const tone = (form.tone || 'cinematic').trim()
  const audienceRaw = (form.audience || '').trim()
  // Take just the lead audience phrase ("urban creatives" out of
  // "urban creatives, 25-40") for cleaner subjects.
  const audience = audienceRaw.split(/[,;|·]/)[0].trim() || 'modern customers'

  const subjectThing = product || business || 'the product'
  const preset = _matchPreset(concept.title)

  // The subject is a person from the audience. Singular phrasing is
  // chosen carefully: "a busy morning commuter" rather than "busy
  // morning commuters" — Runway works better with one subject.
  const audienceSingular = audience
    .replace(/\b(\w+)s\b/g, '$1')      // crude depluralisation
    .replace(/\s+/g, ' ')
    .trim()
  const subject = `${audienceSingular || 'modern customer'}, face visible, expressive but natural`

  const action = preset.actionTemplate.replace(/\{subject\}/g, subjectThing)

  const ratioLabel =
    ratio === '720:1280' ? '9:16'
    : ratio === '960:960' ? '1:1'
    : '16:9'

  const constraints = `natural movement, high detail, ${ratioLabel}`

  return buildRunwayVideoPrompt({
    subject,
    environment: preset.environment,
    action,
    camera: preset.camera,
    lighting: preset.lighting,
    style: `${tone} cinematic style`,
    mood: preset.mood,
    constraints,
  })
}

// ---- Example presets / canonical successful prompts ---------------

/**
 * The two canonical examples kept in code so the docs page + a
 * future "use example" UI affordance can pull the same string. The
 * raccoon prompt is the exact text from the user's successful
 * Runway run; the EV prompt mirrors the structure for a different
 * domain.
 */
export const EXAMPLE_PROMPTS = {
  raccoon_coffee_mascot: buildRunwayVideoPrompt({
    subject: 'raccoon wearing a plaid robe and white t-shirt',
    environment: 'a small cozy kitchen early in the morning',
    action:
      'slowly walks into the kitchen, looks tired and half awake, ' +
      'presses the coffee machine button, and watches coffee pour into a mug; ' +
      'steam rises from the cup; the raccoon takes one sip and relaxes',
    camera: 'static camera shot',
    lighting: 'warm kitchen lighting',
    style: 'cinematic lighting',
    mood: 'cozy atmosphere, satisfied expression',
    constraints: 'realistic fur, natural movement, high detail, 16:9',
  }),
  luxury_ev_drive_at_dusk: buildRunwayVideoPrompt({
    subject: 'sleek matte-black luxury electric SUV',
    environment: 'a coastal highway at dusk, ocean visible to one side',
    action:
      'drives smoothly past the camera at moderate speed, headlights on, ' +
      'reflections sliding across the body',
    camera: 'static camera shot, low angle',
    lighting: 'cool blue dusk light with warm headlight glow',
    style: 'premium automotive cinematic style',
    mood: 'confident, quiet, expensive',
    constraints: 'natural movement, high detail, 16:9',
  }),
}

/**
 * Plain-English rules of thumb the UI can render as a hint chip.
 * Kept in code so the smoke can assert against the same text the
 * user sees, and so docs stay in sync with the implementation.
 */
export const PROMPT_QUALITY_RULES = [
  'one character',
  'one location',
  'one action',
  'one camera move',
]

export const PROMPT_QUALITY_HINT =
  `Best results: ${PROMPT_QUALITY_RULES.join(', ')}.`
