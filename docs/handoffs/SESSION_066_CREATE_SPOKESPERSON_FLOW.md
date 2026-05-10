# SESSION 066 — CreateSpokespersonFlow 4-Step Stepper (PR CK)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CK patch in flight on top of `ec70f37`
`docs: spokesperson creation flow audit + proposal (SESSION 065)`;
commit + push pending after this handoff lands)

**Builds on:** SESSION 065's audit + proposal +
PR CJ's portrait-failed retry/skip semantics.

## Goal

PR CB's lightweight 4-field Create Spokesperson modal made
spokespeople feel hollow. SESSION 065 confirmed the backend
already accepts personality, style, portrait_prompt,
metadata, and the full 30 voice library. PR CK delivers
the 4-step UX architecture proposed in SESSION 065, exposing
every rich field without inventing schema columns.

## Endpoint inventory

PR CK adds **one new route**, the smallest possible:

| Method + path | Purpose |
|---|---|
| `POST /api/characters/{id}/metadata` | Merge a partial dict into the existing `Character.metadata` field. Supports: missing keys leave alone, explicit nulls delete, new keys add. Caps at 32 keys + 4 KB serialised. |

Route count **70 → 71**. No schema additions —
`Character.metadata: dict = {}` already exists; PR CK just
gives the frontend a write path.

## What changed

### New files

- **`frontend/src/components/CreateSpokespersonFlow.jsx`**
  (~600 lines) — replaces `CreateSpokespersonModal.jsx`. Owns:
  - Step state machine (1 → 4 with Back/Next).
  - Single `form` object across all steps; React state
    persists Back navigation.
  - 4 internal step renderers (`Step1Identity` /
    `Step2Visual` / `Step3Voice` / `Step4Generate`).
  - PR CJ `portrait-failed` phase logic preserved verbatim.
  - `derivePortraitPrompt` helper mirroring backend's
    `PORTRAIT_TEMPLATES` so the on-screen prompt matches what
    the gen route will use when `prompt_override` isn't sent.
  - `tryGeneratePortrait` helper (extracted from PR CJ) so
    the Retry button re-fires generation on the existing
    character without re-creating.
  - Modal width bumped to `max-w-lg` + `max-h-[85vh]
    overflow-y-auto` so Step 2's prompt textarea has room.

### New backend route + body class

- **`backend/app/routers/characters.py`** —
  - new `MetadataPatchBody` Pydantic model with a single
    `metadata: dict` field.
  - new `POST /api/characters/{id}/metadata` route. 404 if
    character not found · 422 if validation fails · 413 if
    >32 keys or >4 KB serialised. Merges patch into
    existing `record.metadata` via `store.update`.

### Modified files

- **`frontend/src/api.js`** — adds
  `api.patchCharacterMetadata(id, patch)` helper.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - import swap:
    `<CreateSpokespersonModal>` → `<CreateSpokespersonFlow>`.
  - `handleSpokespersonCreated` signature extended to
    `(created, options = {})`; when `options.startCampaign`
    is true, writes `adspark.startCampaignHint = <id>` to
    localStorage. (Workspace mount-time read of that hint is
    a follow-up slice; for PR CK the value sits as captured
    intent so PR CL can pick it up.)
  - inline JSX comment refreshed to describe PR CK semantics.

### Deleted

- **`frontend/src/components/CreateSpokespersonModal.jsx`** —
  replaced by `<CreateSpokespersonFlow>`. No other caller
  referenced it.

### Smoke updates

`adspark-smoke.spec.js` Test 2 (`@ /`) — the existing modal
open + cancel block is rewritten to walk all 4 steps:

| Step | Smoke assertions |
|---|---|
| 1 | `step-title` reads "Step 1 of 4"; `step-1` panel visible; `name`, `template`, `personality`, `audience-vibe` all visible; Next button **disabled** until name fills; once name filled, Next enables. |
| 2 | `step-title` reads "Step 2 of 4"; `step-2` panel visible; `style-chips`, `fashion`, `portrait-prompt` all visible; **prompt textarea has length > 20 chars** (auto-derive populated). |
| 3 | `step-title` reads "Step 3 of 4"; `step-3` panel visible; `voice` select visible; `voice-detail` rich card visible; `voice-featured` row visible. |
| 4 | `step-title` reads "Step 4 of 4"; `step-4` panel visible; `summary` visible; `avatar-toggle` and `campaign-toggle` checkboxes visible. |
| Cleanup | Back × 3 → Cancel on Step 1 → modal dismounts. **No API submit fires; no fixture state mutated.** |

Final smoke: `3 passed (27.1 s)` — Test 1 (`@ /legacy`)
24.5 s, Test 2 (`@ /`) 1.5 s, Test 3 (top-bar round-trip)
604 ms.

## Step-by-step UX

### Step 1 — Identity
- **Name** (text, required, ≤80) → `Character.name`
- **Archetype** (4-card picker: Mascot / Founder / Coach /
  Local Guide; each card shows a one-liner about the visual
  scaffold) → `Character.template`
- **Species or role** (textarea, ≤300) → `Character.subject`
- **Personality** (textarea, ≤500) → `Character.personality`
- **Audience vibe** (textarea, ≤200, optional) →
  `metadata.audience_vibe`

Next gate: name + template (template defaults to mascot, so
just need name).

### Step 2 — Visual Direction
- **Style chips** (10-chip multi-select; clickable buttons):
  *photorealistic*, *stylized*, *plush mascot*, *editorial*,
  *cinematic*, *retro*, *bright palette*, *muted palette*,
  *natural light*, *studio light*. Selected chips comma-join
  into `Character.style`.
- **Fashion / wardrobe** (text, optional, ≤120). Appended to
  `Character.style` after a separator.
- **Portrait prompt** (textarea, ≤1000). Auto-derives from
  archetype + species + style chips + fashion via
  `derivePortraitPrompt`. **`portrait_prompt_dirty` flag**
  stops auto-clobber after the user types. **Reset to auto**
  link reverts to derived. The prompt is sent to
  `POST /generate-portrait` as `prompt_override`.

### Step 3 — Voice
- **Featured voices** (chip row of 6 popular presets — drew
  / ruby / max / victoria / vincent / clara / etc — exact
  list from `FEATURED_VOICE_PRESETS`).
- **All voice presets** (full 30-entry dropdown showing
  `label — summary` per option).
- **Voice character card** — renders
  `describeVoicePreset(form.voice_preset).{label, summary,
  detail, gender}`. The `detail` line ("Conversational
  midrange — feels like a friend recommending the product")
  was hidden in PR CB; PR CK exposes it for the first time.
- **Speaking energy** (6-chip multi-select: calm / energetic
  / playful / measured / fast / deliberate). Selected chips
  append a "Speaks: …" line to `Character.personality` so
  `create-avatar`'s `personality_override` reads them
  downstream.

### Step 4 — Generate
- **Summary card** — every chosen field rendered as a
  read-only row. The "spring to life" review surface.
- **Bind a Runway avatar** checkbox (opt-in). When checked,
  after portrait succeeds the flow also fires
  `POST /create-avatar` so the spokesperson can star in
  `avatar_videos` campaigns immediately.
- **Start a campaign** checkbox (opt-in). When checked,
  `onCreated(character, { startCampaign: true })` fires; the
  parent writes `adspark.startCampaignHint` to localStorage
  for future workspace integration.
- **Create Spokesperson** primary button. Submit pipeline:
  1. `POST /api/characters` with name/template/subject/style
     /personality/voice_preset
  2. `POST /api/characters/{id}/metadata` (best-effort —
     metadata-write failure does NOT block portrait gen)
  3. `POST /api/characters/{id}/generate-portrait` with
     `prompt_override` from Step 2 textarea
  4. (optional) `POST /api/characters/{id}/create-avatar`
- **Phase-aware status row**: `creating spokesperson…` →
  `saving creative direction…` → `rendering portrait via
  Runway image…` → `binding Runway avatar…` (if checkbox
  checked) → `done`.
- **PR CJ portrait-failed branch preserved verbatim** with
  Retry portrait + Save without portrait. Backdrop click in
  this state routes to Save without portrait.

## Backend persistence

| Field on form | Persisted to |
|---|---|
| `name` | `Character.name` |
| `template` | `Character.template` |
| `subject` | `Character.subject` |
| `personality` | `Character.personality` (with appended "Speaks: …" if energy chips selected) |
| `style_chips` + `fashion` | `Character.style` (concatenated with separator) |
| `voice_preset` | `Character.voice_preset` |
| `portrait_prompt` | `Character.portrait_prompt` (via `prompt_override` round-trip — the gen route persists it on success) |
| `audience_vibe` | `metadata.audience_vibe` (PR CK new route) |
| `style_chips` (also) | `metadata.visual_style_chips` (array) |
| `speaking_energy` | `metadata.speaking_energy` (array) |
| (constant) | `metadata.creation_flow = "v2-stepper"` |
| `create_avatar` | drives `POST /create-avatar` (no field; opt-in side effect) |
| `start_campaign` | drives `localStorage.adspark.startCampaignHint` (no field; opt-in side effect) |

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (was 70 — PR CK adds one route) |
| `vite build` | 480.47 KB initial / 131.41 KB gzip + 561.97 KB lazy chunk (+14.07 KB initial / +3.68 KB gzip vs PR CJ) |
| Playwright mock smoke | `3 passed (27.1 s)` — Test 1 (@ /legacy) 24.5 s, Test 2 (@ /) 1.5 s, Test 3 (top-bar round-trip) 604 ms |
| Hygiene scan | empty (no PNG / video committed) |
| Drift guard | `context-kit anchors look recent.` |

**No real Runway calls fired this session.** Smoke walks
all 4 steps with mock-backend POST /api/characters but
**never clicks Create Spokesperson on Step 4** — final API
chain is purely structural assertion.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path (will burn ~1 Runway image credit + ~1
optional avatar credit on a real call):
1. http://localhost:5173 → click `+ Create Spokesperson`.
2. **Step 1**: enter a name (e.g. `QA Test`), pick an
   archetype (e.g. Coach), fill species/role + personality
   + audience vibe textareas. Click Next.
3. **Step 2**: tap a few style chips (e.g. *cinematic*,
   *natural light*, *photorealistic*). Type a wardrobe note.
   Watch the portrait prompt textarea below auto-derive in
   real time as you toggle chips. Edit the textarea
   directly to take control; a `Reset to auto` link
   reverts. Click Next.
4. **Step 3**: pick a featured voice or open the full
   dropdown. Read the rich character card to confirm the
   voice match. Tap a few speaking-energy chips. Click Next.
5. **Step 4**: review the summary. Optionally check `Bind a
   Runway avatar` and/or `Start a campaign`. Click
   `Create Spokesperson`. Status row progresses through the
   creating/metadata/portrait/avatar phases.
6. On success: modal closes, tile appears in library with
   the new portrait. If `Start a campaign` was checked, the
   `adspark.startCampaignHint` localStorage entry is set
   (workspace consumption follows in PR CL).
7. On portrait failure: modal stays open in the PR CJ
   `portrait-failed` phase with Retry portrait + Save
   without portrait. Same as PR CJ.

## Limitations / follow-ups

- **`adspark.startCampaignHint` is captured but not yet
  consumed.** Workspace mount could read it on
  `/spokespeople/{id}` and auto-open the mode modal. PR CL
  candidate; trivial 5-line workspace useEffect that reads
  + clears the hint.
- **No audio preview on voice presets.** Voice character
  card shows the rich text description but doesn't play a
  sample. Adding a preview button means hitting Runway TTS
  on click — feature-add, not in scope here.
- **Step 2 chips are fixed.** 10 chips covers most cases;
  power users still type free-form via the fashion field +
  the editable portrait prompt. Adjust the chip set later
  if the data shows a recurring missing chip.
- **Modal stays at `max-w-lg`.** Works on 1280×900 but
  could tighten for very narrow viewports. Mobile not in
  scope.
- **Optional Runway avatar bind costs a second credit.**
  Default is unchecked. A future polish slice could add a
  cost-warning chip ("burns extra Runway credits") next to
  the checkbox label, mirroring the rose chrome on the
  Cinematic Video button.
- **Avatar bind failure is non-blocking.** If portrait
  succeeds but avatar 502s, the flow surfaces the avatar
  error inline + still calls onCreated with the
  portrait-enriched record. Operator can retry from the
  workspace Identity tab. Acceptable; documented.
- **No keyboard shortcuts.** Tab moves between fields;
  Enter doesn't auto-advance steps (operator must click
  Next). Could add later.

## Recommended next slice

**PR CL — Workspace consumes `startCampaignHint`** (~30
min): add a useEffect to `<SpokespersonWorkspace>` that
reads `localStorage.adspark.startCampaignHint`, compares
to the current `:id` param, and if matched: clears the
key + opens the mode modal in-place. Tiny, closes the
loop on Step 4's `Start a campaign` checkbox.

Alternative: **PR CL' — Library tile simplification**
(SESSION 059 Fix #2; ~half-day) — strip each
`<SpokespersonCard>` to portrait + name + persona pill +
summary chips + Open link, removing the in-tile
CharacterCard duplication.
