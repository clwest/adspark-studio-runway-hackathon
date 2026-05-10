# SESSION 091 — PR DH Direct-a-Scene Dialogue Lane

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `df2af0a` (`fix: separate context-kit from
Character OS runtime copy (PR DG)`). PR DH patch in flight on top;
commit + push pending operator approval after this handoff lands.

**Why this slice ran:** Final-day demo prep flagged the Dialogue
Scene lane as the last surface that "technically worked but felt
underwhelming". Symptoms: Step 2 labeled "CAST" but had no real
casting interaction (just a read-only list inferred from saved
lines), "Plan Dialogue Lines" felt backend/procedural, render
buttons appeared before the scene felt created, and the whole lane
read like a form rather than directing a scene. PR DH rewires the
lane's mental model to **pick cast → write scene → render each
actor → stitch the final scene** without touching backend
architecture.

## What changed (all in `frontend/src/components/lanes/DialogueLane.jsx`)

### 1. Interactive Cast picker — Step 2

Replaced the PR BL read-only "cast inferred from saved lines"
display with a new `<CastPicker>` sub-component:

- Up to 8 character cards sorted ready-first then alphabetical.
- Each card: thumbnail (or initial fallback), name, role/template,
  avatar status pill.
- Click toggles `picked` state (pink ring + ✓ indicator).
- Cards for characters without a ready avatar render in disabled
  state with an inline reason ("Avatar processing — wait...",
  "Avatar create failed — retry from the workspace.", "No Runway
  avatar yet — open the spokesperson and click Create Avatar.").
- Pre-seeds `selectedCastIds` from `inferredCastIds` (characters
  already used in saved lines) so existing scenes show their
  speakers as already-picked without forcing a re-pick.
- Resets on focused-campaign change via `useEffect([focused?.id])`.
- Footer status line adapts: "Picked: N. A scene needs at least 2
  speakers." / "A 3-speaker scene fits the office-style format
  best." / "Open Step 3 to author lines for these speakers."

Selection is **visual + intent-capture only** — it does NOT gate
the speaker dropdowns in the lines editor. That's deliberate: a
hard filter would break already-saved scenes whose speakers might
not match the freshly-picked cast.

testids: `dialogue-lane-cast-picker`, `dialogue-lane-cast-grid`,
`dialogue-lane-cast-card` (per card with `data-character-id`,
`data-picked`, `data-ready`).

### 2. Script Preview — Step 3

New `<ScriptPreview>` block renders saved lines as a
screenplay-style ordered script above the per-line editor:

```
DONNY    "We were supposed to make one ad…"   ✓ rendered
RIGGS    "Many AI coding sessions…"
MILES    "The result is Character OS…"
```

- Speaker label uppercased, pink when assigned.
- Line text in italic quotes.
- ✓ rendered badge (emerald) appears when `line.status === 'ok'`.
- Empty rows render with a muted "LINE N · (no line text yet)"
  placeholder so the operator sees the scene shape before any text
  is authored.

The block sits between the demo preset and the lines editor so the
operator can read the full scene before clicking Render Line on any
row. testid: `dialogue-lane-script-preview`.

### 3. Procedural labels renamed

| Was | Now |
|---|---|
| Plan Dialogue Lines | **Create Scene Lines** |
| Re-plan Dialogue Lines | Reset scene lines |
| Stitch Dialogue Scene | **Stitch Final Scene** |
| Restitch Dialogue Scene | Re-stitch Final Scene |
| Build Captioned Reels | **Export Captioned Reel** |
| Rebuild Captioned Reels | Re-export Captioned Reel |
| Generate line | **Render Line** |
| Re-render line | Re-render Line |
| download dialogue scene ↗ | download final scene ↗ |
| download captioned reels ↗ | download captioned reel ↗ |
| Load hackathon demo lines | **Load Hackathon Office Scene** |
| Reload hackathon demo lines | Reload Hackathon Office Scene |

Disabled-reason copy rewritten in operator voice:

- Stitch button when partial: *"Render each line first, then stitch
  the final scene locally with ffmpeg (N/3 rendered)."* (was
  *"N/M lines ready — click Generate per line below to render the
  rest before stitching."*)
- Reels button when no scene: *"Stitch the final scene first."*
- Wire-handler-missing: *"Wire the v2 onPlanDialogue handler before
  this can fire."* (dropped redundant "button")

Bottom-row status messages while busy went from backend-shaped
*"posting to /dialogue/plan…"* to operator-shaped *"creating scene
lines…"* / *"stitching final scene…"* / *"exporting captioned
reel…"*.

### 4. Inline credit warning per line

Per-line Render Line button gained a sibling `⚠ 1 credit` chip
(rose-300 font-mono) right next to it — was only in hover tooltip.
Operator sees the credit cost without hovering.

### 5. Hackathon Office Scene preset polish

- Banner copy updated: *"Hackathon Office Scene — drops in the
  three-line office-style skit (Donny → Riggs → Miles) and
  auto-assigns speakers. Backend caps a scene at 3 lines;
  rendering each line still burns one Runway credit."*
- Miles line aligned to the PR DH spec: *"The result is Character
  OS: persistent AI spokespeople that learn the brand, create
  campaigns, and show up again."* (was *"The result is a persistent
  AI spokesperson system: characters that learn the brand..."*)
- Donny and Riggs lines unchanged — Donny's was already correct in
  PR DB; Riggs was already correct in PR DG.

### 6. Lane header reframed

- Section title: *"Plan a dialogue scene"* → **"Direct a dialogue
  scene"**.
- Section subtitle rewrote from backend-flavored *"Build a Hook /
  Beat / Closer skit across multiple spokespeople. Plan, edit
  lines, render each line, and stitch the scene — all inline. Real
  Runway credits per line; ffmpeg-only stitch + reels."* to
  operator-voiced *"Pick a cast, write the scene as a Hook → Beat →
  Closer skit, render each actor's line, then stitch the final
  scene. Each rendered line burns one Runway credit; stitching and
  captioned reels are local ffmpeg only."*

### 7. Step 3 panel header

*"Step 3 · Lines & Stitch"* → **"Step 3 · Scene Lines & Render"**.
Added a count chip on the right showing `N lines · M rendered` when
lines exist.

## Backend constraints flagged but not changed

`backend/app/services/dialogue_service.py:48` —
`_DEFAULT_LINE_COUNT = 3` with `labels = ("Hook", "Beat", "Closer")`.
PR DH brief listed **four** demo lines (the fourth being Donny's
closer: *"So yes, we are the demo. And apparently also the dev
team."*) but the backend hardcodes three slots. Bumping to four
would require:

- `_DEFAULT_LINE_COUNT = 4`
- New label tuple, e.g., `("Hook", "Beat", "Continue", "Closer")`
- ffmpeg stitch already supports N inputs so no concat change

That's a small backend edit, but the PR DH brief explicitly said
*"Do not touch backend architecture unless unavoidable"*, so the
fourth line is preserved as an inline comment in `HACKATHON_DEMO_LINES`
for a future follow-up PR. The current 3-line skit (Donny / Riggs /
Miles) is the demo-day Office Scene.

## What was intentionally NOT changed

- Grid layout — kept 3 panels per the brief's "if changing to 4
  steps is too risky, keep 3 panels but make the middle contain
  Cast." Cast got upgraded in place; Step 3 contains both authoring
  and render/stitch/export.
- `/legacy` — untouched.
- Spokesperson Ad lane — untouched (PR DH scope was Dialogue only).
- Backend routes — count still 76, no signature changes.
- The existing per-line save/render/preview flow inside
  `<DialogueLineRow>` — only the button labels and a credit chip
  changed.
- Realtime broker, character store, campaign store — all untouched.

## Files changed

```
 frontend/src/components/lanes/DialogueLane.jsx              | +220, -50 (net +170; two new sub-components + rename pass)
 00-START-NEXT-SESSION.md                                    | (head pointer)
 docs/INVENTORY.md                                           | (PR DH block)
 docs/handoffs/SESSION_091_DIRECT_A_SCENE_DIALOGUE_LANE_PR_DH.md | new
```

## Verification

| Check | Result |
|---|---|
| `vite build` | **531.51 KB initial / 143.30 KB gzip + 561.97 KB lazy chunk** (+4.07 KB initial / +1.24 KB gzip vs PR DG baseline from `<CastPicker>` + `<ScriptPreview>`). Build clean, no warnings beyond the standing >500 KB chunk-size advisory. |
| Backend pytest | **36/36 passed** (~1.25s, unchanged — PR DH is frontend-only) |
| Mock smoke (Playwright) | **3/3 passed** (~30s) — `/legacy` smoke, library route, Legacy UI round-trip. Existing tests don't probe the dialogue lane deeply but the build artefact loaded without runtime errors. |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` (1 commit since touch, threshold 5) |
| Real-mode restart after smoke | backend up, `runway_mock=false`, vite http=200 |
| Donny's `d00dc42fe5cb` self-demo campaign | preserved through mock-smoke cycle — business "Character OS", product "AI spokesperson platform built for the Runway hackathon", `runway_document_id: 47de9efd-c0b1-4405-a6bb-df72ee0bf257`, status `ready`, commercial_script intact. |
| Real Runway calls fired | **0** |

## Manual walkthrough (the brief's sequence)

1. **Open Donny workspace** → **Campaigns** tab.
2. **Choose Dialogue Scene** — click a Dialogue Scene campaign
   (or `+ New Campaign` → 🎭 Dialogue Scene).
3. **Select Donny / Riggs / Miles** in Step 2 — three cards in the
   grid get pink rings + ✓ indicators. Cards for characters
   without ready avatars are dimmed with the explicit reason.
4. **Load Hackathon Office Scene** in Step 3 — amber banner button,
   loads three lines + auto-assigns speakers.
5. **Lines appear** — DialogueLinesEditor renders three rows; each
   row shows speaker dropdown, text textarea, status pill, Save +
   Render buttons.
6. **Render buttons are clear** — Render Line button (rose) +
   sibling `⚠ 1 credit` chip. Re-render label flips when status
   is `ok`.
7. **Stitch disabled until lines rendered** — disabled-reason copy
   reads *"Render each line first, then stitch the final scene
   locally with ffmpeg (0/3 rendered)."* and updates as lines flip
   to `ok`.
8. **Mock render lines** — fire each Render Line; status pill
   walks idle → running → ok.
9. **Stitch Final Scene** enables and runs ffmpeg concat (no
   Runway).
10. **Export Captioned Reel** enables once the scene is stitched.

## Remaining demo risks

- **No 4-speaker scene** — backend caps at 3 lines. The user's
  brief listed a 4th Donny closer for narrative symmetry; today
  that closer is a code comment, not a renderable line. Not
  blocking — the 3-line skit holds up on its own.
- **Hard cast filter not enforced** — the speaker dropdown in
  `<DialogueLineRow>` still lists all ready characters, not just
  the operator's picked cast. Intentional (backward-compat for
  already-saved scenes), but means an inattentive operator could
  assign a non-picked character. Mitigation: ScriptPreview makes
  speaker identity visible at a glance.
- **CastPicker initial state on first-touch existing scene** —
  pre-seeds from inferredCastIds; if a scene already had Donny,
  Riggs, Miles assigned, all three show "picked + in scene". A
  scene saved before PR DH with no character_id on its lines will
  show zero picked. Operator can click to fix; not blocking.
- **No keyboard shortcuts** for Render Line / Stitch — mouse-only.
  Acceptable for the demo; voice-controlled triggers are out of
  scope.
- **Script preview doesn't reflect unsaved edits** — it reads from
  the saved `line.text`, not the textarea's draft. Operator sees
  the script of what was last saved; intended (preview is the
  source of truth, the editor below is for changes).

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

PR DG state (Donny's self-demo campaign) intact and ready for the
operator's continued realtime testing.
