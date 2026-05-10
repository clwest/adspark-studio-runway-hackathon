# SESSION 073 — PR CP cont. Portrait Prompt Hardening

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CP cont. patch in flight on top of
`82b695f` `feat: restore delete spokesperson + endpoint
audit (PR CP)`; commit + push pending after this handoff
lands)

**Why this slice ran:** PR CP (commit `82b695f`) shipped
Tasks 1 + 2 of the brief — the rose-themed `<DangerZone>`
delete affordance in the workspace Identity tab, and the
audit verdict that `gen4_image_turbo` via
`/v1/text_to_image` for stills + `/v1/avatars` for
talking-head identities are both correct. Task 3 of the
brief — "improve prompt handling without overbuilding,
favouring clean commercial mascot portraits, brand-safe
look, no horror / distortion / extra limbs / melted
anatomy / uncanny realism" — was deferred in
SESSION_072 to a recommended PR CQ. The follow-up
brief asked us to fold Task 3 into PR CP scope rather
than carve a separate PR. This slice is that fold.

## Endpoint inventory

PR CP cont. adds **no new routes**. Backend route count
remains **71**. Backend service-layer + frontend prompt-
builder strings only.

## Files modified

- `backend/app/services/character_studio_client.py` —
  rewrote all four `PORTRAIT_TEMPLATES` entries; new
  shared `_BRAND_SAFE_TAIL` constant.
- `frontend/src/characterPromptBuilder.js` — tightened
  the `_FINISHERS` constant so the editable textarea
  picks up the same brand-safe / anti-uncanny cues.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — PR CP block re-narrated to
  describe the prompt template hardening.
- `docs/handoffs/SESSION_073_PORTRAIT_PROMPT_HARDENING.md`
  (this file, new).

No backend route changes. No JSON data committed. No
generated media committed. No real Runway calls fired.

## Audit recap — does `portrait_prompt` get consumed?

Yes, end-to-end, on every code path:

1. `frontend/src/components/CreateSpokespersonFlow.jsx`
   maintains `form.portrait_prompt` as a controlled
   textarea seeded by `derivePortraitPrompt(form)` from
   `characterPromptBuilder.js`. If the operator types,
   `portrait_prompt_dirty` flips true and a Reset link
   appears.
2. `CharacterStudio.jsx` (the legacy v1 surface) uses
   the same form field shape with the same dirty
   tracking + Reset link.
3. On `Generate Portrait` click, both surfaces send
   `{ prompt_override: form.portrait_prompt.trim() }` to
   `POST /api/characters/{id}/generate-portrait`.
4. `GeneratePortraitBody` (`backend/app/routers/characters.py:96`)
   accepts `prompt_override` and forwards it to
   `studio_generate_portrait(...)`.
5. `build_prompt(...)` (`character_studio_client.py:106`)
   short-circuits to the override when present
   (`prompt_override.strip()[:1000]`) — used **verbatim**.
6. When no override, the chosen `PORTRAIT_TEMPLATES[template]`
   is filled with `{subject}` + `{style}` from the
   character record (or `TEMPLATE_DEFAULTS`).
7. `_generate_portrait_real` POSTs the resolved prompt
   as `promptText` to `gen4_image_turbo` via
   `/v1/text_to_image`, polls
   `/v1/tasks/{id}` until SUCCEEDED, downloads the PNG
   to `data/characters/{id}-portrait.png`.

`portrait_prompt` is also **persisted** on the
`Character` record (`portrait_prompt: Optional[str]` —
`models.py:429`). The full resolved prompt is saved in
`PortraitResult.portrait_prompt` and stored by the
router after each successful generate.

**Anthropomorphic animal flow before this slice:**
identical to humans. The mascot template said
`"Studio portrait of {subject}. {style}. ..."` with no
"anthropomorphic" or "creature" anchor. So when
Brewster Bolt's seed `subject` was the v1 ad-copy
("high-energy brand mascot — kinetic, animated, playful
shape with bold accent colours"), `gen4_image_turbo`
had no signal that the persona is a raccoon and
defaulted to a humanoid silhouette.

## What changed

### Backend `PORTRAIT_TEMPLATES`

Every template now leads with **"A polished commercial
spokesperson portrait of …"** (mascot reads "A polished
commercial mascot portrait of an anthropomorphic
mascot spokesperson — {subject}"). All four end with
the shared `_BRAND_SAFE_TAIL`:

> Brand-safe advertising character suitable for a
> marketing campaign. No horror, no distortion, no
> extra limbs, no melted anatomy, no uncanny realism.
> No props or sunglasses.

Sample render against the live backend after the edit:

```
$ python -c "from app.services.character_studio_client import build_prompt; \
             print(build_prompt('mascot'))"
A polished commercial mascot portrait of an
anthropomorphic mascot spokesperson — a friendly
raccoon barista mascot. Photorealistic stylised plush
texture. Head-and-shoulders framing, expressive
friendly face, soft warm smile. Simple solid mid-grey
background. Soft three-point studio lighting. High-
quality 3D character design. Brand-safe advertising
character suitable for a marketing campaign. No
horror, no distortion, no extra limbs, no melted
anatomy, no uncanny realism. No props or sunglasses.
```

The template still flows `{subject}` + `{style}` from
the Character record, so an operator who hand-edits the
character `subject` to "an anthropomorphic raccoon
mascot, mid-stride, confident grin" gets a prompt that
opens with that creature in the noun position
**twice** — once via the template anchor and once via
the slot — which is intentional belt-and-braces.

### Frontend `_FINISHERS`

`characterPromptBuilder.js` now renders the textarea-
seeded prompt with finishers reading:

> high detail, mascot portrait, avatar-ready, brand-
> safe advertising character, no horror, no distortion,
> no extra limbs, no melted anatomy, no uncanny realism

So when the operator opens the CreateSpokespersonFlow
Step 2 textarea, they see the same safety cues that
the backend template-fill path enforces. If they
edit, those cues survive into the `prompt_override`
they post (unless they actively delete the line).

### What did NOT change

- `prompt_override` semantics (operator-typed text used
  verbatim, capped 1000 chars).
- `GeneratePortraitBody` request shape.
- `build_prompt(...)` signature.
- Character model fields.
- Avatar create payload (`/v1/avatars`).
- Demo seed fixture `subject` strings — preserved per
  brief ("Preserve existing demo data scripts unless
  repair is required"). Sharpening seed `subject`
  strings is left to PR CQ if portraits still look
  rough after the next regen.
- Mock-mode behaviour: same deterministic stdlib zlib
  PNG path (`_solid_png` + `_mock_color_for(prompt)`).
  The hash colour shifts because the prompt string is
  longer, but the file format / dimensions are
  identical.
- Smoke spec — no new assertions; the smoke does not
  inspect the prompt text.

## Verification

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| Backend module import | ok — `build_prompt('mascot')` renders the new anchor + brand-safe tail. `prompt_override` path returns verbatim. |
| `vite build` | 479.84 KB initial / 131.00 KB gzip + 561.97 KB lazy chunk (+0.12 KB initial / +0.07 KB gzip vs PR CP — three new safety phrases in `_FINISHERS`). |
| Mock backend booted | `bash scripts/start-local-mock.sh`; `runway_mock=true`. |
| Playwright mock smoke | **3 passed (~36.9 s)** — Test 1 (@ /legacy) 33.7 s, Test 2 (@ /) 1.9 s, Test 3 (top-bar round-trip) 667 ms. |
| Hygiene scan | empty (no .env / data / media tracked). |
| Drift guard | `✅ context-kit anchors look recent.` |
| `/legacy` | reachable via top-bar link round-trip in Test 3. |

**No real Runway calls fired this session.** Per the
brief and CLAUDE.md "no automated real-mode generation
runs" rule.

## Manual QA notes (operator script)

When the user runs real-mode (`bash
scripts/start-local-real.sh`), the recommended
verification path is:

1. Open `http://localhost:5173/`. Pick any demo
   spokesperson with portrait quality you found rough
   in PR CO (Brewster / Clara / Mina).
2. In the workspace Identity tab, scroll to the
   `<CharacterCard>` action footer, click `Generate
   Portrait`. The textarea-resolved prompt now opens
   with "A polished commercial spokesperson portrait
   of …" and ends with the brand-safe / anti-uncanny
   tail.
3. Wait for the `gen4_image_turbo` task to land
   (typically 30–60 s). Compare the new portrait to the
   PR CO baseline cached in
   `data/characters/{id}-portrait.png`.
4. If the new portrait still reads as a humanoid for
   Brewster Bolt, the seed `subject` is the bottleneck
   — proceed to PR CQ (sharpen seed `subject` strings).

To exercise the override path explicitly: open
`/spokespeople/new` (CreateSpokespersonFlow Step 2),
type a custom prompt into the textarea, click
through to Step 4. The textarea content posts as
`prompt_override` and is used verbatim.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Risks

- **Longer prompts.** The mascot template now resolves
  to ~80 tokens vs ~40 before. `gen4_image_turbo`
  caps at 1000 characters; we're still well under,
  but very long character `subject` strings (>500
  chars) plus the new template tail could hit the cap
  on edge cases. `build_prompt` already truncates to
  1000 chars, so the failure mode is silent
  truncation — not an exception.
- **Mock mode determinism.** The hash that drives
  `_solid_png` colour now reads a longer prompt, so
  cached mock portraits regenerated under PR CP cont.
  will have a different swatch colour than ones
  cached pre-slice. Cosmetic only; the smoke does
  not assert colours.
- **Tail steers Runway away from photorealistic
  realism on human personas.** "No uncanny realism"
  may nudge `gen4_image_turbo` toward more stylised
  founder/coach renders. If founder portraits start
  looking too illustrated, the founder-specific tail
  can be pruned in a follow-up; the brief flagged
  uncanny realism as a portrait failure mode worth
  the trade.

## Recommended next slice

**PR CQ — Sharpen seed fixture `subject` strings.**
Now that the templates anchor on "anthropomorphic
mascot spokesperson" + brand-safe finishers, the
remaining lever is the per-persona `subject` text.
The PR CG seeds describe roles, not creatures. Brief
edit list (no template work):

- Brewster Bolt: `"an anthropomorphic raccoon
  mascot, mid-stride, confident grin, punk-energy
  streetwear in bold accent colours"`
- Clara Vale: `"polished founder Clara Vale, mid-30s,
  neutral blazer, modern office backdrop, direct
  trustworthy gaze"`
- Rex Roadside: `"automotive salesperson Rex
  Roadside, mid-40s, casual flannel, leaning on a
  Ford F-150 tailgate, warm afternoon light"`
- Mina Spark: `"creator-style social host Mina
  Spark, mid-20s, casual streetwear, expressive
  smile, warm desaturated palette"`

Re-fire the 4 portraits via
`POST /api/characters/{id}/generate-portrait` (~$0.125
in image credits). Requires explicit user approval
under the "no automated real-mode generation runs"
rule.
