/**
 * PR V — Character portrait prompt builder.
 *
 * Mirrors the backend's PORTRAIT_TEMPLATES (services/character_studio_client.py)
 * but produces a richer, avatar-ready string the user can edit before
 * the request fires. The backend's text already auto-builds something
 * sensible from {template, subject, style}; PR V exposes that string
 * as an editable textarea + folds in the optional `name` and
 * `personality` fields the backend ignored at portrait time.
 *
 * The output prompt is what the frontend POSTs to
 * /api/characters/{id}/generate-portrait as `prompt_override`. The
 * backend's `build_prompt` short-circuits to the override when it's
 * present, so this string ends up being the exact text passed to
 * Runway's gen4_image_turbo.
 *
 * Best-practice prompt rules (matched to the canonical raccoon prompt
 * the user provided):
 *   - centered head-and-shoulders portrait
 *   - face / eyes / mouth visible
 *   - clean background, no sunglasses, no props blocking the face
 *   - single subject, single environment hint
 *   - avatar-ready
 */

const _trim = (s) => String(s || '').trim()
const _terminate = (s) => {
  const t = _trim(s)
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

// Default subject + style fallbacks matching the backend's
// TEMPLATE_DEFAULTS so the auto-builder produces parsable text even
// when the user hasn't filled out subject / style yet.
const _DEFAULTS = {
  mascot: {
    subject: 'a friendly raccoon barista mascot',
    style: 'photorealistic stylised plush texture',
  },
  founder: {
    subject: 'an indie brand founder, mid-30s',
    style: 'polished modern editorial style',
  },
  coach: {
    subject: 'a fitness coach, mid-30s',
    style: 'bright high-energy editorial style',
  },
  local_guide: {
    subject: 'a friendly local-business shopkeeper',
    style: 'warm documentary editorial style',
  },
}

// Per-template scene anchors used in the auto-built prompt. The
// constraints + finishers are shared across templates to enforce the
// avatar-ready shape the smoke + the user's canonical prompt both
// hint at.
const _TEMPLATES = {
  mascot: {
    background: 'Clean warm studio background',
    light: 'soft three-point studio lighting',
    expression: 'expressive eyes, soft warm smile',
  },
  founder: {
    background: 'Clean off-white studio background',
    light: 'soft natural lighting',
    expression: 'direct eye contact, soft natural smile',
  },
  coach: {
    background: 'Solid muted-blue background',
    light: 'crisp directional lighting',
    expression: 'confident posture, bright expression, mid-speech',
  },
  local_guide: {
    background: 'Soft-blurred neutral indoor background',
    light: 'natural daylight',
    expression: 'welcoming smile, neighborly',
  },
}

// PR CR — rewrote to drop "no sunglasses, no props blocking the
// face" negations that diffusion models misread as content
// directives. Pure positive phrasing renders the same intent: a
// clean, fully-visible face is implied by "unobstructed view of the
// face" — the absence of obstructions is the shape we want, but we
// describe it as a *positive* attribute the model can render.
const _CONSTRAINTS =
  'Centered face with eyes and mouth fully visible, ' +
  'unobstructed view of the face'
// PR CP cont. — brand-safe finishers mirror the backend
// ``_BRAND_SAFE_TAIL`` so the editable textarea opens with the same
// language the auto-built backend prompt uses.
//
// PR CR — dropped the inline negation list ("no horror, no
// distortion, no extra limbs, no melted anatomy, no uncanny
// realism"). Diffusion models often misread negations as
// instructions to include those concepts, and Donny Sparks
// reproducibly hit `INTERNAL.BAD_OUTPUT.CODE01` against
// gen4_image_turbo until the negations were removed. Positive-only
// phrasing renders the same brand-safe intent without tripping the
// downstream output check.
const _FINISHERS =
  'high detail, mascot portrait, avatar-ready, brand-safe ' +
  'advertising character, polished commercial illustration with ' +
  'believable anatomy'

/**
 * Build the default Character-Studio portrait prompt. Pure function;
 * deterministic for the same inputs. The output mirrors the canonical
 * raccoon test prompt's shape.
 *
 *   buildCharacterPortraitPrompt({
 *     template: 'mascot',
 *     subject:  'a sleepy raccoon coffee mascot',
 *     style:    'realistic fur, plush texture',
 *     personality: 'tired expressive eyes, slightly sarcastic but lovable',
 *     name:     'Brewster',
 *   })
 */
export function buildCharacterPortraitPrompt({
  template = 'mascot',
  subject = '',
  style = '',
  personality = '',
  name = '',
} = {}) {
  const tpl = _TEMPLATES[template] || _TEMPLATES.mascot
  const def = _DEFAULTS[template] || _DEFAULTS.mascot
  const sub = _trim(subject) || def.subject
  const sty = _trim(style) || def.style
  const pers = _trim(personality)
  const nm = _trim(name)

  // Opener: anchor the scene with subject + optional name.
  const namePhrase = nm ? ` named ${nm}` : ''
  const opener = `A front-facing head-and-shoulders portrait of ${sub}${namePhrase}.`

  // Personality clause — kept as a separate beat so users can read +
  // edit it without untangling style or constraints.
  const personalityClause = pers ? `${_terminate(pers)} ` : ''

  // Style is its own beat too. We don't merge it into the subject
  // because Runway gives each comma-clause its own attention slot.
  const styleClause = `${_terminate(sty)}`

  // Background + lighting come from the template preset.
  const bgClause = `${_terminate(tpl.background)}`
  const lightClause = `${_terminate(tpl.light)}`
  const expressionClause = `${_terminate(tpl.expression)}`

  // Constraints + finishers anchor the avatar-ready shape.
  const constraintsClause = `${_CONSTRAINTS}.`
  const finishersClause = `${_FINISHERS}.`

  const beats = [
    opener,
    personalityClause + styleClause,
    bgClause,
    lightClause,
    expressionClause,
    constraintsClause,
    finishersClause,
  ]
    .map((s) => _trim(s))
    .filter(Boolean)

  return beats.join(' ').trim()
}

/**
 * Helper-text shown above the textarea. Single source of truth so the
 * smoke can match either the docs or the rendered UI.
 *
 * PR CR — keep this purely positive. Earlier copy listed
 * "no sunglasses, no props blocking the face" as guidance, but
 * recommending negations to operators teaches them to write prompts
 * that diffusion models misread (Runway gen4_image_turbo rejects
 * negation-laden prompts as `INTERNAL.BAD_OUTPUT.CODE01`). Describe
 * the *positive* shape we want instead.
 */
export const PORTRAIT_PROMPT_HELPER =
  'Best avatar results: centered head-and-shoulders portrait, face ' +
  'visible, eyes visible, mouth visible, clean background, ' +
  'unobstructed view of the face.'
