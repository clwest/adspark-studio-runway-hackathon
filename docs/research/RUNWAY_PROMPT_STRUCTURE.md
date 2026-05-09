# Runway Video Prompt Structure — PR T

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-t-prompt-builder`
**Status:** Implemented + verified end-to-end on this branch.
Companion to `docs/research/FLOW_INTEGRATION_AUDIT.md` (PR M),
`docs/research/UI_REDESIGN_AUDIT.md` (PR O), and
`docs/research/VISUAL_SOURCE_FLOW_AUDIT.md` (PR R).

## Why long prompts failed

Pre-PR-T, AdSpark seeded the Runway video prompt textarea with the
backend's `concept_service.runway_prompt`, a deliberately dense
"everything at once" sentence. For example:

> *"Cinematic warm cinematic ad for Local coffee shop: slow dolly-in
> on hero Morning blend, golden-hour rim light, shallow depth of
> field, subtle particle haze, smooth handheld motion, final beat
> reveals brand mark."*

What goes wrong when this lands at `gen4_turbo` / `gen4.5`:

1. **Multiple subjects implicit.** "hero Morning blend" + "brand
   mark" + "particle haze" — the model tries to render two distinct
   subjects in 5 seconds, producing a confused blend.
2. **Multiple actions.** "slow dolly-in" + "final beat reveals" —
   the model schedules two camera/scene events in a window that
   should hold one. The clip cuts, glitches, or reverts to a stock
   pan.
3. **Stacked filmic adjectives.** "golden-hour rim light, shallow
   depth of field, subtle particle haze" — each style descriptor
   competes for the limited "look" budget. Output ends up muddy,
   not cinematic.
4. **Abstract metaphors.** "final beat reveals brand mark" — Runway
   has no concept of "beat" or "brand mark"; it falls back to
   generic ad-style cuts.

## Why structured prompts worked

The single best Runway clip we produced during the hackathon used a
**short, single-subject, single-action** prompt:

```
A realistic raccoon wearing a plaid robe and white t-shirt slowly
walks into a small cozy kitchen early in the morning. The raccoon
looks tired and half awake. Warm kitchen lighting. The raccoon
presses the coffee machine button and watches coffee pour into a
mug. Steam rises from the cup. The raccoon takes one sip and relaxes
with a satisfied expression. Static camera shot, cinematic lighting,
realistic fur, natural movement, cozy atmosphere, high detail, 16:9.
```

What this prompt does right:

- **One character.** The raccoon. No additional people, no logo, no
  product reveal.
- **One environment.** A small cozy kitchen. No exterior cuts, no
  scene transitions.
- **One action.** Walks in → presses button → watches coffee →
  takes a sip → relaxes. A coherent ~5-second beat.
- **One camera.** Static. The model doesn't have to plan a move.
- **Concrete physical details.** "plaid robe", "white t-shirt",
  "coffee machine button", "steam rises". These give the model
  things to render rather than vibes to interpret.
- **Explicit constraints at the end.** Lighting, style, fur, format
  — all named separately so each gets its own attention slot.
- **No abstract metaphors.** No "story", no "brand", no "moment".

Runway's gen4_turbo / gen4.5 models reward concrete, single-thread
prompts. AdSpark's structured prompt builder enforces this shape.

## The "one X" rules of thumb

The PR T prompt builder is opinionated:

| Rule | Why |
|---|---|
| **One character / subject** | Multiple subjects compete for the model's attention budget. |
| **One environment** | Scene transitions in 5 s look like glitches. |
| **One action** | The model can render a smooth motion arc; chained actions cut. |
| **One camera move** | Pick static OR slow-push OR pan — never combine. |
| **One emotional tone** | "warm and energetic and mysterious" → muddy. |
| **Concrete > abstract** | "plaid robe" beats "iconic vibe". |
| **Constraints at the end** | Lighting / style / format named separately so each gets its own attention slot. |
| **Add `natural movement` and `high detail`** | These two strings reliably nudge gen4_turbo toward stable, sharp output. |
| **For animal/mascot subjects, add `realistic fur`** | Otherwise the model lapses into clay or plush textures. |
| **For character videos, add `face visible` and `expressive but natural`** | Avoids the "back of head" failure mode that happens when the model can't decide on a pose. |

## The structured template

```js
buildRunwayVideoPrompt({
  subject,       // "raccoon wearing a plaid robe and white t-shirt"
  environment,   // "a small cozy kitchen early in the morning"
  action,        // "presses the coffee machine button"
  camera,        // "static camera shot"
  lighting,      // "warm kitchen lighting"
  style,         // "cinematic lighting"
  mood,          // "cozy atmosphere, satisfied expression"
  constraints,   // "realistic fur, natural movement, high detail, 16:9"
})
```

Composes into:

```
A realistic {subject} {action} in {environment}.
{mood}.
{lighting}.
{camera}.
{style}.
{constraints}.
```

Empty fields are silently dropped. The output is always a single
paragraph with clean punctuation.

## Good vs. bad examples

### ✅ Good — raccoon coffee mascot

```
A realistic raccoon wearing a plaid robe and white t-shirt slowly
walks into a small cozy kitchen early in the morning. The raccoon
looks tired and half awake. Warm kitchen lighting. The raccoon
presses the coffee machine button and watches coffee pour into a
mug. Steam rises from the cup. The raccoon takes one sip and relaxes
with a satisfied expression. Static camera shot, cinematic lighting,
realistic fur, natural movement, cozy atmosphere, high detail, 16:9.
```

One subject. One environment. One action arc. One camera. Concrete
details. Constraints listed.

### ✅ Good — luxury EV at dusk

```
A realistic sleek matte-black luxury electric SUV drives smoothly
past the camera at moderate speed, headlights on, reflections sliding
across the body in a coastal highway at dusk, ocean visible to one
side. Confident, quiet, expensive. Cool blue dusk light with warm
headlight glow. Static camera shot, low angle. Premium automotive
cinematic style. Natural movement, high detail, 16:9.
```

Different domain, same structure. One vehicle, one location, one
maneuver, one camera angle.

### ❌ Bad — pre-PR-T concept_service output

```
Cinematic warm cinematic ad for Local coffee shop: slow dolly-in on
hero Morning blend, golden-hour rim light, shallow depth of field,
subtle particle haze, smooth handheld motion, final beat reveals
brand mark.
```

- Two subjects ("hero Morning blend" + "brand mark").
- Two camera moves ("slow dolly-in" + "final beat reveals").
- Five filmic adjectives stacked into one phrase.
- "Cinematic warm cinematic" — duplicate adjective from naive
  string interpolation.

### ❌ Bad — montage prompt

```
A montage of urban creatives in the morning, at work, and at night,
weaving Morning blend into their day. Quick cuts, neon-and-glass
palette, kinetic camera. Sunrise to skyline.
```

- Three scene changes in 5 seconds.
- "Quick cuts" + "kinetic camera" = camera flailing.
- Multiple time-of-day in one clip = lighting that strobes.

### ❌ Bad — abstract-metaphor prompt

```
A frontier moment for Morning blend. The light blooms outward, the
score swells, the future opens. Hero shot.
```

- Zero concrete physical details.
- "Score swells" — Runway has no audio.
- "The future opens" — uninterpretable. Falls back to generic stock.

## Implementation in AdSpark

**Helper**: `frontend/src/promptBuilder.js`

- `buildRunwayVideoPrompt({...})` — pure composition.
- `simplifyFromConcept({ concept, form, ratio })` — heuristic mapper
  that turns the picked `AdConcept` (title + hook + caption + cta)
  + form fields (business / product / tone / audience) into a
  structured prompt. Marketing copy (hook / caption / CTA) is
  intentionally NOT folded into the video prompt — it lives on the
  campaign for the host clip + overlay text.
- `EXAMPLE_PROMPTS.raccoon_coffee_mascot` and
  `EXAMPLE_PROMPTS.luxury_ev_drive_at_dusk` — the canonical good
  examples kept in code so docs and UI presets stay in sync.
- `PROMPT_QUALITY_HINT` — single source of truth for the UI hint
  string ("Best results: one character, one location, one action,
  one camera move.") so the smoke can match either the docs or the
  rendered UI.

**Wiring**: `frontend/src/App.jsx`

- `handleConcepts` runs the structured builder when concepts arrive,
  not the backend's `runway_prompt` (kept as fallback for safety).
- `ConceptCards.onSelect` rebuilds the prompt when the user picks a
  different concept. (Pre-PR-T this was a silent no-op — switching
  concepts kept the previous prompt.)
- A new `onSimplifyPrompt` callback re-derives the prompt from
  current state when the user clicks the Simplify button — useful
  after manual edits the user wants to discard.

**UI**: `frontend/src/components/PromptPreview.jsx`

- Spark-tinted "structured prompt" pill + the rules-of-thumb hint
  ("Best results: one character, one location, one action, one
  camera move.") sit directly under the textarea.
- "Simplify prompt" button (disabled when no concept is selected)
  rebuilds the textarea from the structured builder.

**Backend**: untouched. `concept_service.runway_prompt` still emits
the dense prose; the frontend just doesn't seed the textarea with
it anymore. The dense prose remains available as a fallback if the
structured builder produces an empty string for any reason.

## Tests

`frontend/tests/adspark-smoke.spec.js` adds step 7a.3:

- Asserts the "structured prompt" pill renders.
- Asserts the rules-of-thumb hint renders.
- Asserts the "Simplify prompt" button renders.
- Asserts the textarea opens with `^A realistic ` (the structured
  builder's deterministic prefix), proving the new wire is in
  effect.
- Edits the textarea + reverts, proving manual editing still works.

The existing PR A–S assertions remain unchanged.

## Known limitations

1. **The simplifier discards `concept.visual` prose.** That's
   intentional — the dense prose is what we're escaping. But it
   does mean the OpenAI-generated visual hints (richer than the
   mock template) get tossed. A future pass could mine `concept.
   visual` for concrete nouns (locations, props, lighting) and
   feed them into the structured fields automatically.
2. **The audience field gets crude singular-conversion.** "urban
   creatives, 25-40" → "urban creative". Good enough for English;
   non-English forms will look weird. Acceptable for a hackathon.
3. **Three concept-title presets only.** "Origin Spark", "Daily
   Ritual", "Frontier" — the mock templates. The OpenAI path
   produces variable titles that fall through to the
   `daily_ritual` default. A future pass could let the LLM emit
   structured fields directly via JSON-mode.
4. **No prompt-quality scoring.** The hint advises rules; it
   doesn't grade the user's edits. A nice future polish.

## Recommended next polish

- **Backend JSON-mode prompt builder.** When OpenAI is live, ask
  `gpt-4o-mini` to emit `{ subject, environment, action, … }`
  directly via JSON-mode instead of the prose `runway_prompt`.
  Keeps the structured shape end-to-end.
- **Prompt examples affordance.** A "Use raccoon example" /
  "Use EV example" button row on the prompt panel that pastes one
  of `EXAMPLE_PROMPTS.*` into the textarea — useful for demos.
- **Inline rule violations.** Highlight the textarea in amber when
  it contains "montage", "quick cuts", multiple distinct subjects,
  or 3+ comma-separated camera adjectives. Pure UI heuristic; no
  backend.
