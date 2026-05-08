# UI Redesign Audit — AdSpark Studio

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch start:** `feature/pr-n-campaign-delete` (PR N — campaign
delete already committed locally; not yet merged to main)
**Status:** AUDIT — recommends a phased frontend polish; no
backend touched.

## TL;DR

AdSpark is feature-complete but visually flat. Every section uses
the same `rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5`
treatment, so the eye has no hierarchy and the demo path is
invisible. Each saved campaign card is now a 980-line component
that crams a video player, three Pack outputs, a Brand Spokesperson
panel (with three sub-flows: character / picker / custom), an
Avatar Host Clip player, an Audio Pack with 10 dub languages, and
a realtime conversation surface into one tile. The result feels
like a research notebook stack, not a polished AI Campaign +
Character Studio.

The fix doesn't require new features. It requires:

1. A shell + hero with a clear stage indicator showing where the
   user is in the demo path (Brief → Visual → Character → Saved).
2. Numbered, named stages between every major section.
3. Reduced bordered-box repetition in favor of subtle background
   tints + a unified card system.
4. Tabbed/grouped saved-campaign cards (Phase 2 — not in this PR).
5. Empty states + loading states tuned for the demo recording
   (Phase 3 — not in this PR).

This audit drives **UI Phase 1 only.** Phase 1 is the safest first
phase: shell, hero, stage indicator, section containers, typography,
spacing. No component-internal redesigns, no behaviour changes, no
backend touched.

---

## Current state inventory

### Component file sizes

| File | LOC | Notes |
|---|---|---|
| `App.jsx` | 308 | Top-level orchestration + page render |
| `CampaignGallery.jsx` | 980 | **The bloated one.** Card + per-section flows |
| `CharacterStudio.jsx` | 298 | Top-level studio panel + create form |
| `RealtimeSpokesperson.jsx` | 294 | Realtime + chip row (PR M) |
| `PromptPreview.jsx` | 242 | Prompt textarea + model/ratio/duration |
| `AvatarPicker.jsx` | 168 | Avatar grid |
| `CharacterCard.jsx` | 147 | Tile reused in studio + attach picker |
| `ModeBanner.jsx` | 124 | Status pills + readiness + explanatory copy |
| `RunwayPanel.jsx` | 87 | Status pill + Save button |
| `CampaignForm.jsx` | 72 | Brief inputs |
| `ConceptCards.jsx` | 35 | Three selectable concept cards |

Total: ~2.7k lines of frontend across 11 files.

### What renders, in order, top to bottom

1. Header (`<header>`): title `AdSpark Studio` + tagline + a small
   `MOCK MODE` chip on the right when `health.any_mock`.
2. Optional error toast.
3. **`<ModeBanner>`** — full block with readiness chip + per-provider
   pills + "demo mode / real mode" explanatory `<ul>` (~120 px tall).
4. **`<CampaignForm>`** — `Business / Product / Tone / Audience` +
   `Generate Ad Concepts` CTA.
5. **`<ConceptCards>`** (conditional) — three concept buttons.
6. **`<PromptPreview>`** (conditional) — prompt textarea +
   `Model / Ratio / Duration / Use text-only` row + `Reference image
   URL` field + active-settings chip row + `Generate Reference Image`
   + `Generate Video` buttons + caption "Generates the visual cut —
   silent." (PR M).
7. **`<RunwayPanel>`** — task status / `Save campaign card` button.
8. **`<CharacterStudio>`** — pink-pilled "Character Studio" header +
   `+ Create Character` toggle + library grid of `<CharacterCard>`s.
9. **`<CampaignGallery>`** — `Saved campaigns` header +
   responsive 1/2-col grid of saved cards. **Each card is a
   ~700–900px tall scroll target containing all of:**
   1. Card header (business + status pills + delete link)
   2. Concept summary block
   3. Optional `prompt` `<details>` toggle
   4. Cached video `<video>` + `visual-only · silent` chip + "Visual
      cut only…" caption (PR M)
   5. Campaign Pack section (3-up grid of Build buttons or `view ↗`)
   6. Brand Spokesperson section, which itself contains:
      - Attached Character block (when attached)
      - Attach Character affordance (when not attached)
      - `<AvatarPicker>` (when not attached)
      - "Phase 1 visual" avatar identity block
      - `Create Brand Spokesperson` / `Retry with stock portrait`
        button
   7. Avatar Host Clip section (player or button)
   8. **Talk to Brand Spokesperson** section (PR I) with chip row
      (PR M / P1 #6)
   9. Audio Pack section: header + disclaimer + voice player +
      `Voice Samples — Multilingual` 10-language grid
10. Footer.

10 sections + 9 sub-sections per saved card. **The eye has no
anchor.**

---

## What is visually confusing

### 1. No information hierarchy

Every container uses the same:

```css
rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5
```

This means:
- ModeBanner, CampaignForm, ConceptCards (well — uses something
  similar), PromptPreview, RunwayPanel, CharacterStudio, gallery
  outer, AND every saved-campaign card all look like equal-weight
  siblings.
- The user has to read every heading to figure out where they are.
- There is **no visible "you are at step 2 of 4"** affordance.

### 2. Mode info appears three times

- Header pill: `MOCK MODE` (when any provider mocked).
- ModeBanner readiness chip: `demo mode` / `demo ready · concepts
  mocked` / `demo ready · all live` / `backend down`.
- ModeBanner per-provider pills: `Concepts (OpenAI): mock` etc.

A judge sees three different "mocked" signals competing for
attention before they even see the form.

### 3. Demo-path is invisible

`DEMO_SCRIPT.md` Path F is the v5 hero recording:
1. Open Character Studio → create Brewster off-camera
2. Fill the brief + generate concepts + image + video
3. Save campaign → attach Brewster
4. Present Campaign / Brand Voice / Realtime

But the UI renders `CharacterStudio` *between* `RunwayPanel` and
`CampaignGallery` — i.e. **after** the live brief→video pipeline.
The recommended demo flow runs the studio first; the layout puts
it third. This forces the recording to scroll up, then down, then
up again.

### 4. Saved-campaign cards are too tall

A card with everything generated (Pack + Spokesperson + Voice +
Realtime) is roughly 700–900 px tall. On a 1080p screen the user
sees one card and a half. Comparing two campaigns side-by-side is
impossible without a 2k+ display.

### 5. Vertical sprawl in the visual-ad pipeline

Concept generation produces three cards. Picking one mounts the
prompt panel which has 6 controls (model / ratio / duration /
text-only / reference image URL / generate ref image / generate
video). The settings chip row repeats the same values just below
the controls. The Generate Video CTA sits below all of that. From
form submit to "Generate Video" is roughly 6 vertical scroll-stops.

### 6. Three border styles compete

- Heavy: `border-zinc-800` on every section card
- Medium: `border-zinc-800` on inline form elements + chip pills
- Subtle: `border-zinc-800/60` on intra-card sub-section dividers

There's no design-system separation between "this is a section",
"this is a card inside a section", and "this is a divider".

---

## What is duplicated

| Duplicate | Locations |
|---|---|
| Mock-mode signal | Header pill + ModeBanner readiness chip + pill row |
| Settings chip row | Below the controls in `PromptPreview` (mirrors the controls themselves) |
| Brand Spokesperson section header | Section heading + nested "Brand Spokesperson Avatar" wording in copy |
| `Re-create spokesperson` text link | Sits one DOM node below the `Create Brand Spokesperson` button |
| "Avatar id: …" rendering | One copy in attached-character block, another in avatar-picker selection block, a third in the host_avatar block |

---

## What competes for attention

| Pair | Conflict |
|---|---|
| ModeBanner (large block) vs CampaignForm (large CTA) | Both anchor the top of the page |
| Three concept cards vs PromptPreview | Once a concept is selected the cards remain visible above the prompt; selecting a different concept silently swaps the prompt text without scroll cue |
| CampaignGallery card grid vs CharacterStudio panel | Both read as "primary surfaces" with no relationship between them |
| Brand Spokesperson section vs Audio Pack section vs Realtime section (within one card) | All three are equal-weight `border-t border-zinc-800` blocks; the avatar resolution chain is invisible |

---

## Which flows should be primary vs secondary

**Primary (the demo-recording path — must be visually anchored):**
- Stage 1 — Campaign Brief (the form)
- Stage 2 — Generate Visual Ad (concepts → prompt → video → save)
- Stage 3 — Character Studio (create + bind avatar)
- Stage 4 — Saved Campaigns / Deliverables (gallery)

**Secondary (visible but not foregrounded):**
- ModeBanner (status info)
- Settings chip row inside PromptPreview
- Avatar resolution chain detail (character > selected > host)
- Per-language dub grid

**Tertiary (revealed on demand only):**
- Prompt text `<details>` toggle
- Re-design / re-create / regenerate sub-actions
- Mock-mode explanatory `<ul>` in ModeBanner
- Avatar id substring rendering

---

## Ideal information architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  [logo] AdSpark Studio                          [readiness pill]│
│  AI Campaign + Character Studio                  [details ↓]   │
│                                                                 │
│  Stage progress: ●━━○━━○━━○                                    │
│                  Brief  Visual  Character  Saved               │
└─────────────────────────────────────────────────────────────────┘

┌─ 1. Campaign Brief ────────────────────────────────────────────┐
│  Business, product, tone, audience                              │
│  [Generate Ad Concepts]                                         │
└─────────────────────────────────────────────────────────────────┘
↓ (concepts arrive)
┌─ 2. Generate Visual Ad ────────────────────────────────────────┐
│  Concept cards (3-up) ─ pick one                                │
│  Prompt + settings (model/ratio/duration)                       │
│  [Generate Reference Image] [Generate Video] (silent visual cut)│
│  Status pill → Save Campaign                                    │
└─────────────────────────────────────────────────────────────────┘

┌─ 3. Character Studio ──────────────────────────────────────────┐
│  Reusable brand characters · [+ Create Character]               │
│  Library grid (CharacterCards)                                  │
└─────────────────────────────────────────────────────────────────┘

┌─ 4. Saved Campaigns ───────────────────────────────────────────┐
│  Card grid (1-col mobile, 2-col desktop)                        │
│  Each card uses TABS/GROUPS:                                    │
│    [Overview] [Visuals] [Character] [Voice] [Realtime] [Exports]│
└─────────────────────────────────────────────────────────────────┘
```

**Saved campaign card with tabs (Phase 2 — not in this PR):**

```
┌─ Donkey Betz Coffee · 2026-05-07T14:13Z ─────────────────────[×]┐
│ [Overview*] [Visuals] [Character] [Voice] [Realtime] [Exports] │
│                                                                 │
│ * Overview tab body:                                            │
│   - Concept title + caption                                     │
│   - Pack 3/3 ready · video ready                                │
│   - Attached: Brewster the Bear (mascot, voice max)             │
│   - Voice: ready · 117s sample                                  │
│   - Realtime: available                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Which components need redesign first

### Phase 1 (this PR — safest first)

| Target | Change |
|---|---|
| `App.jsx` | Wider container, hero + stage indicator + numbered section headers |
| Hero composition | Title / tagline / readiness chip on a single row; mode-pill ribbon below |
| Section containers | Drop the per-section `border` in favor of a numbered section header + subtle `bg-zinc-900/40` panel |
| Typography | H1 4xl→5xl, H2 stage headers consistent (xl + spark accent), meta text consistent (xs zinc-500) |
| `index.css` / theme | Add radial-gradient-on-ink background detail to give the page depth without per-card borders |

### Phase 2 (next PR)

| Target | Change |
|---|---|
| `CampaignGallery.jsx` | Split per-card sections into a tabbed control (Overview / Visuals / Character / Voice / Realtime / Exports). Reduces the 700–900 px tile to ~300 px per card. |
| `CharacterStudio.jsx` | Convert library grid to a richer card style with template badges + voice preset; create-form modal/sheet instead of inline-collapse |
| `AvatarPicker.jsx` | Tighter 4-up grid; "preset" vs "account" sub-tabs |
| `PromptPreview.jsx` | Move settings into a single dropdown row above the textarea; collapse the chip-row duplication |

### Phase 3 (final polish)

- Empty-state art for "no campaigns yet" / "no characters yet"
- Loading skeletons for in-flight tasks (currently a status pill only)
- Toast/notification system (currently a single inline error band)
- Keyboard nav + focus-ring polish for screen-recording

---

## What should NOT be touched

These are working well and are smoke-test-asserted; leave them
alone unless a Phase 1 layout change demands it:

- `ModeBanner.jsx` — internal pill rendering. Smoke asserts the
  exact pill labels ("Concepts (OpenAI): mock" etc.) and the
  readiness aria-label.
- `CampaignForm.jsx` — placeholder strings drive smoke selectors.
- `ConceptCards.jsx` — concept titles ("Origin Spark", "Daily
  Ritual", "Frontier") are smoke selectors.
- `PromptPreview.jsx` — combobox role + ratio/duration aria-labels
  + active-settings aria-label. Don't touch.
- `RealtimeSpokesperson.jsx` — recently rewritten in PR M; chip
  text is smoke-asserted.
- `CharacterStudio.jsx` — `+ Create Character` button + `Character
  Studio` heading are smoke selectors.
- The audit-asserted text in `CampaignGallery.jsx` ("visual-only ·
  silent", "Visual cut only — Runway gen4_turbo", "Brand Voice
  Identity", "Voice samples, not full ad narration") cannot move
  or rename. Layout / wrapper around them can change freely.

**Backend is entirely off-limits for this redesign work.**

---

## Phase plan

### UI Phase 1 (this PR — implement immediately after this audit)

**Scope:** layout shell, typography, spacing, section containers,
stage navigation, hero composition.

**Files touched (estimated):**
- `frontend/src/App.jsx` — restructure outer layout, add hero,
  stage indicator, numbered section wrappers
- `frontend/src/index.css` — radial gradient background + typography
  utility classes
- `frontend/src/components/ModeBanner.jsx` — only its outer
  container styling; keep all internal pill text identical
- `frontend/tailwind.config.js` — extend theme with a `studio` color
  palette + `zinc-925` mid-tone for cards (optional)

**Files NOT touched in Phase 1:**
- `CampaignGallery.jsx` — gallery card internals untouched
- `CharacterStudio.jsx`, `CharacterCard.jsx`, `AvatarPicker.jsx` —
  internals untouched
- `PromptPreview.jsx`, `CampaignForm.jsx`, `ConceptCards.jsx`,
  `RunwayPanel.jsx`, `RealtimeSpokesperson.jsx` — untouched
- All backend code, all docs except this audit + the SESSION_010
  follow-up handoff

**Smoke-safety:** every assertable text element stays visible. No
collapsing of mode pills behind a toggle. The new stage indicator
is purely additive — it doesn't move the existing form / concepts /
prompt / runway / character / gallery components.

**Demo-recording impact:** Path F still works. The new stage
indicator gives the recording a visible "you are here" cue.

### UI Phase 2 (next PR)

Tabs/groups inside saved-campaign cards. Character Studio polish.
Avatar Picker polish. Prompt panel collapse.

### UI Phase 3 (final polish)

Empty states. Loading skeletons. Toast system. Keyboard polish.

---

## Verification baseline (this session, before any code changes)

- Backend import: 37 routes (PR N's DELETE incremented to 37).
- Frontend production build (PR N state): 207.76 KB initial JS /
  62.87 KB gzip + 562 KB lazy realtime SDK.
- Playwright smoke (PR N state): **1 passed in ~22.3 s** in mock
  mode.
- Git hygiene: 0 `.env` / 0 media / 0 `backend/data/` tracked.
- Branch state: `feature/pr-n-campaign-delete` at `1d92d95`,
  branched from `main` at `3d117fa` (PR M head). PR N is local;
  not merged or pushed.

---

## What this audit does NOT recommend

- **No new product features.** Phase K.5 polish (PATCH character,
  replace-avatar, Create-Character-from-this-Campaign) is still
  K.5 territory.
- **No backend changes.** The 37-route surface is locked for this
  redesign.
- **No removal of any visible label** — everything that the smoke
  asserts on stays exactly where it is.
- **No new Runway calls** beyond what already runs.
- **No tabbed cards in Phase 1.** That's Phase 2 for a reason; it
  requires a per-card state model rewrite.
- **No mode-banner collapsing.** Smoke asserts every pill is
  visible by default.
- **No tagging / pushing.** PR O lands as a separate branch awaiting
  user merge approval.

---

## Recommended UI Phase 2 prompt (for next session)

> AdSpark Studio — UI Phase 2: Tabbed Campaign Cards + Studio Polish
>
> Building on PR O's Phase 1 shell, refactor `CampaignGallery.jsx`
> so each saved-campaign card collapses to a tabbed control: Overview /
> Visuals / Character / Voice / Realtime / Exports. Default tab is
> Overview. Each tab body lazy-renders its content.
>
> Keep all existing labels and assertions intact (the smoke must
> still pass). Add a smoke step that switches between tabs on the
> newest card.
>
> Reduce per-card height from ~800 px to ~300 px in the default
> Overview state.
>
> Also: tighten Character Studio + Avatar Picker visual polish per
> the audit's Phase 2 list.

That's the next prompt to run after the user reviews PR O.
