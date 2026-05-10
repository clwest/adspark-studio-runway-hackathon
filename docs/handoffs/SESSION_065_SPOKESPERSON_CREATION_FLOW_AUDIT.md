# SESSION 065 — Spokesperson Creation Flow Audit + Proposal

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `8859860` (`fix: create spokesperson modal
stops swallowing portrait failures (PR CJ)`).
**Mode:** Real-mode servers running throughout (backend pid
`580`, vite pid `626`, `runway_mock=false`).
**Type:** **Planning slice — no code changes, no real Runway
calls.** Audit + UX architecture proposal documented before
PR CK starts implementation.

## Why this slice

The Create Spokesperson modal (PR CB) hardened in PR CJ but
still feels lightweight: 4 shallow fields, no personality
direction, no portrait prompt control, no fashion/style
chips, voice preset summary only. Compared to the legacy
CharacterStudio's 7-field inline form, the v2 modal lost
power without gaining clarity.

The user's brief: **reconnect the existing generation system
to a human-friendly multi-step flow** so users feel like
they're designing an AI personality, not filling a row.
**No backend expansion needed** — the audit below confirms
that.

## Naming + filenames

- This planning slice does not ship a PR letter (no code).
  Implementation will be **PR CK — `<CreateSpokespersonFlow>`
  4-step stepper** when locked.
- Handoff filename `SESSION_065_SPOKESPERSON_CREATION_FLOW_AUDIT.md`.
  SESSION_064 was the PR CJ portrait-fix handoff.

## Audit — what's already supported

### Character schema (`backend/app/models.py`)

Fields the flow can write to without expansion:
- `name` (≤80, required)
- `template` enum: `mascot` / `founder` / `coach` / `local_guide`
- `subject` (≤300 free text)
- `style` (≤300 free text)
- `personality` (≤600 free text)
- `catchphrases: list[str]`
- `voice_preset` (default `"vincent"`)
- `portrait_prompt` (post-create patch via `store.update`;
  also accepted as `prompt_override` on the gen route)
- `metadata: dict` — free-form key/value (PR CG put
  `demo=True` here)
- `runway_avatar_id` / `*_status` (set by `create-avatar`)
- All 14+ voice / drift fields

**No schema additions required** for the flow's brief.
`audience_vibe` rides on `metadata`; "speaking energy"
chips append to `personality`; everything else maps to
existing fields.

### Routes (`backend/app/routers/characters.py`)

| Method + path | Used by flow | Body fields the flow could pass |
|---|---|---|
| `POST /api/characters` | Step 4 | name, template, subject, style, personality, catchphrases, voice_preset, source_campaign_id |
| `POST /api/characters/{id}/generate-portrait` | Step 4 | template, subject, style, **prompt_override** |
| `POST /api/characters/{id}/create-avatar` | Step 4 (opt) | voice_preset, **personality_override** |
| `POST /api/characters/{id}/clone-voice` | (deferred) | multipart audio + name |
| `POST /api/characters/{id}/apply-voice` | (deferred) | mode |
| `DELETE /api/characters/{id}` | rollback if needed | — |

The portrait route's `prompt_override` is the unlock for
Step 2's editable portrait prompt — the whole feature
is already wired; the v2 modal just stopped using it.

### Portrait prompt builder (`services/character_studio_client.py`)

`PORTRAIT_TEMPLATES` provides per-archetype scaffolds
(mascot / founder / coach / local_guide). `build_prompt`
fills `{subject}` + `{style}` slots, and `prompt_override`
bypasses the template entirely. `TEMPLATE_DEFAULTS` ships
sensible per-archetype fallbacks so empty fields still
produce reasonable images.

### Voice preset library (`frontend/src/voicePresets.js`)

30 presets, each with `{label, summary, detail, gender}`.
The PR CB modal limited to a featured-six list and only
rendered `label + summary`. **The detail field
("Conversational midrange — feels like a friend
recommending the product") is hidden today** — exactly the
"speaking character" copy the brief asks for.

### Hidden but supported

| Capability | Where it lives | Why hidden in v2 modal |
|---|---|---|
| Editable portrait prompt | `Character.portrait_prompt` + gen route's `prompt_override` | Modal dropped the field |
| Per-character `style` direction | `Character.style` slotted into `PORTRAIT_TEMPLATES.{style}` | Modal dropped the field |
| Long-form personality | `Character.personality` + `create-avatar` reads it as `personality_override` | Modal dropped the field |
| Full 30 voice presets | `VOICE_PRESET_DESCRIPTIONS` | Modal limited to 6 |
| Voice character `detail` | `describeVoicePreset(id).detail` | Modal renders only label+summary |
| Per-template defaults | `TEMPLATE_DEFAULTS` | Not surfaced as placeholders |
| `metadata` storage | `Character.metadata: dict` | Modal never wrote to it |
| Avatar bind on create | `POST /create-avatar` | Modal never offered |
| Starter campaign | `POST /api/campaigns` | Modal never offered |

## Step → field mapping

| Step | UI field | Backend slot | Schema change? |
|---|---|---|---|
| 1 | name | `Character.name` | no |
| 1 | archetype | `Character.template` | no |
| 1 | species / role | `Character.subject` | no |
| 1 | personality | `Character.personality` | no |
| 1 | audience vibe | `metadata.audience_vibe` | no — uses existing dict |
| 2 | portrait prompt | `Character.portrait_prompt` (post-create patch) + `prompt_override` on first gen | no |
| 2 | style chips | join → `Character.style` | no |
| 2 | fashion / cinematic tone | append → `Character.style` | no |
| 2 | mascot ↔ realistic | implicit (`template` × `style`) | no |
| 3 | voice preset | `Character.voice_preset` (full 30) | no |
| 3 | preview / character | `describeVoicePreset(id)` rich card | no |
| 3 | speaking energy | append → `personality` ("Speaks: energetic, playful.") | no |
| 4 | generate portrait | existing `POST /generate-portrait` | no |
| 4 | optional avatar | existing `POST /create-avatar` (opt-in) | no |
| 4 | optional starter campaign | existing `POST /api/campaigns` (opt-in) | no |

**Net result: 0 backend changes. Every step is the existing
system, made visible.**

## Proposed UX architecture

### One-component, four-step modal

**Replace** `<CreateSpokespersonModal>` with
`<CreateSpokespersonFlow>` — same modal overlay shape, same
external API (`isOpen` / `onClose` / `onCreated`), but a
4-step stepper inside.

```
<CreateSpokespersonFlow isOpen onClose onCreated>
  <FlowHeader step={1..4} title={"Identity"|...} />     ← progress dots
  {step === 1 && <Step1Identity ... />}
  {step === 2 && <Step2Visual ... />}
  {step === 3 && <Step3Voice ... />}
  {step === 4 && <Step4Generate ... />}
  <FlowFooter Back / Next or Generate />
</CreateSpokespersonFlow>
```

State: a single `form` object holds every field. Steps are
pure renders that read + write into it. Back navigation
preserves input.

### Step 1 — Identity (5 fields)

- **Name** (text, required)
- **Archetype** (select: mascot / founder / coach / local_guide;
  each option carries a one-liner about the visual scaffold)
- **Species or role** (textarea ≤200) — *"a friendly raccoon
  barista mascot"* / *"a 40-something fintech founder"*
- **Personality** (textarea ≤500)
- **Audience vibe** (textarea ≤200, optional) — saves to
  `metadata.audience_vibe`

Next-button gate: name + archetype + species/role.

### Step 2 — Visual Direction

- **Style chips** (multi-select chip group + free-form):
  *photorealistic*, *stylized*, *plush mascot*, *editorial*,
  *cinematic*, *retro*, *bright*, *muted*, *natural light*,
  *studio light*. Selected chips join into `Character.style`.
- **Fashion / wardrobe** (text, optional) — appended to
  `style` with separator
- **Portrait prompt** (textarea ≤1000) — auto-derives from
  template + species + style chips; `Reset to auto` link
  reverts; `portrait_prompt_dirty` flag prevents auto-clobber
  after edits

Next-button gate: none (style has defaults).

### Step 3 — Voice

- **Voice preset** (dropdown, full 30; featured-six quick-pick
  row above)
- **Voice character card** (read-only) — renders
  `describeVoicePreset(id).{label, summary, detail, gender}`
- **Speaking energy** (chip group, optional) — *calm /
  energetic / playful / measured / fast / deliberate*. Selected
  chips append `"Speaks: …"` line to `personality` so
  `create-avatar`'s `personality_override` reads it.
- (No audio preview in this PR — deferred)

Next-button gate: voice preset (always has default).

### Step 4 — Generate (the "spring to life" step)

- **Generate Spokesperson** primary button. Fires:
  1. `POST /api/characters` with all step 1+2+3 fields
  2. `POST /generate-portrait` with `prompt_override` from
     Step 2's textarea
  3. (optional) `POST /create-avatar` if checkbox checked
- **Optional checkbox: Bind a Runway avatar after portrait**
  — opt-in second Runway call
- **Optional checkbox: Start a campaign for them after
  saving** — when checked, the parent `SpokespersonStudio`
  receives a flag in `onCreated` and navigates to
  `/spokespeople/{id}` with `<CampaignModeModal>` pre-opened
- **Status row** — phase-aware: `creating spokesperson…` →
  `auto-generating portrait via Runway image…` → (if avatar)
  `creating Runway avatar…` → `done`
- **PR CJ portrait-failed phase preserved verbatim** — same
  Retry portrait + Save without portrait buttons + same
  backdrop-routes-to-skip semantics

### Step navigation rules

- Back is enabled from Step 2 onward; preserves all entered
  fields.
- Next is gated only by hard requirements (name, archetype,
  species/role on Step 1).
- Step 4 fires API calls; cannot Back during in-flight calls.
- Backdrop click in `portrait-failed` → Save without portrait
  (PR CJ rule).

## Risks + open questions

1. **Modal width.** `max-w-md` is too tight for Step 2's chip
   group + portrait textarea. Bump to `max-w-lg`.
2. **`portrait_prompt_dirty` race.** Step 1 edits after Step 2
   prompt was hand-tuned must NOT clobber. Track a boolean
   in form state.
3. **Voice grid vs dropdown for 30 presets.** Recommend:
   dropdown for full list + featured-six chip row above for
   quick-pick.
4. **`Start a campaign` callback signature.** Extend
   `onCreated(character, { startCampaign })` so the parent
   can navigate.
5. **Avatar gated on portrait success.** If portrait fails,
   avatar checkbox cannot fire. Phase machine handles
   gracefully: portrait-failed → no avatar attempt; user
   retries portrait first.
6. **Style chip set opinionated.** Track usage; iterate.
7. **`metadata.audience_vibe` doesn't drive anything yet.**
   Document as data-capture-ahead-of-feature.

## Recommended next slice

**PR CK — `<CreateSpokespersonFlow>` 4-step stepper.**

- Frontend-only.
- Replaces `<CreateSpokespersonModal>` verbatim.
- Reuses every audit finding above; no backend changes.
- Preserves PR CJ portrait-failed phase semantics.
- Optional avatar + starter-campaign checkboxes in Step 4.
- Smoke updates: Test 2's modal-open + cancel block extends
  to walk Steps 1→4 + assert each step's testids; the
  current `create-spokesperson-{name|template|voice|subject}`
  testids stay (now scoped to Step 1 + Step 3); add
  `step1-personality`, `step1-audience-vibe`, `step2-style-chip`,
  `step2-fashion`, `step2-portrait-prompt`, `step3-voice-detail`,
  `step3-energy-chip`, `step4-avatar-toggle`, `step4-campaign-toggle`.

Estimated **1 day**, frontend-only. Smoke + drift + hygiene
gates as usual.

## Files this slice touches

Docs only (planning slice):
- New: `docs/handoffs/SESSION_065_SPOKESPERSON_CREATION_FLOW_AUDIT.md` (this file)
- Modified: `docs/INVENTORY.md`, `00-START-NEXT-SESSION.md`
  — pointer to PR CK + this audit doc

## Server status (final)

Real-mode servers running throughout the audit. No real
calls fired this slice.

```
backend: pid=580 · http://localhost:8000 · runway_mock=false
vite:    pid=626 · http://localhost:5173 · http=200
```
