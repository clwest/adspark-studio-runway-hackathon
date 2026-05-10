# SESSION 060 — V2 Copy Cleanup + Remove Dev Jargon (PR CF)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CF patch in flight on top of `16fa39f`
`docs: post-CE v2 UI manual QA findings (SESSION 059)`;
commit + push pending after this handoff lands)

**Builds on:** SESSION 059's QA findings + the v2 UX
foundation (PR BD–PR CE). Closes the **first** of the
three SESSION 059 demo-readiness blockers (lane copy + dev
jargon). The remaining two (library tile / workspace
Identity duplication, real Outputs gallery) are next slices.

## Goal

The v2 architecture is right; SESSION 059's manual QA
confirmed end-to-end behaviour works (library → workspace →
Campaigns tab → lanes; real Brewster assets survive). What
held v2 back from feeling like a real product was the copy
— every lane carried `scaffold · PR BI/BK/BL` pills, every
mode modal said `preview UX`, and several Step-2 hints
told users to go to `/legacy` for things that work
in-place. PR CF rewrites every user-visible string in v2
surfaces to product language and adds a smoke regex sweep
that prevents the jargon from creeping back in.

PR CF is **frontend copy polish only**. No backend changes,
no component reorgs, no routing changes. `/legacy` and the
real Brewster assets are untouched.

## Endpoint inventory

PR CF adds **no new routes**. Backend route count remains
**70**.

## What changed

### Lane headers + taglines

- **`SpokespersonLane.jsx`** — header swaps from
  `Spokesperson Ad lane` + `scaffold · PR BI` pill to
  **`Build a spokesperson ad`** (no pill). Tagline from
  "Lip-synced talking-avatar render + captioned vertical
  reels export. Generation lives behind PR BJ; for now this
  lane previews what the Brief → Script → Render flow will
  look like." → **"Render this spokesperson speaking your
  script directly to camera, then export a captioned
  vertical reel. Real Runway credits when you click
  Generate."**

- **`CinematicLane.jsx`** — header swaps from `Cinematic Ad
  lane` + `scaffold · PR BK` pill to **`Create a cinematic
  video`** (no pill). Tagline from "Silent image_to_video
  cut + voiced cinematic mux + optional 3-shot storyboard
  concat. The Cinematic lane previews the Brief → Visual
  Source → Render flow; render handlers ship in a follow-up
  slice." → **"Generate a polished image-to-video cut for
  this campaign, mux in the spokesperson's narration, and
  optionally stitch a 3-shot storyboard. Real Runway
  credits when you click Generate."**

- **`DialogueLane.jsx`** — header swaps from `Dialogue
  Scene lane` + `scaffold · PR BL` pill to **`Plan a
  dialogue scene`** (no pill). Tagline from "Multi-character
  stitched skit. Plan Hook / Beat / Closer lines across
  multiple spokespeople; per-line `avatar_videos` render
  then ffmpeg-concat into one branded scene. Render
  handlers ship in a follow-up slice." → **"Build a Hook /
  Beat / Closer skit across multiple spokespeople. Plan and
  stitch the scene here; per-line renders run in the legacy
  wizard until inline rendering lands."**

### Lane Step-2 hint copy

- **SpokespersonLane Step 2 (Script)** — both branches
  rewritten. Cached path: "Lane uses the saved Commercial
  Script (PR AC). Editor inline-mounts in PR BJ; today,
  edit via the classic Stage 3 PromptPreview." → "The
  spokesperson speaks this script verbatim during render.
  Inline editing lands in a follow-up slice; use the legacy
  wizard if you need to rewrite it now." Empty path: "The
  Commercial Script editor lives in classic UX Stage 3
  PromptPreview." → "Create or select a campaign to author
  a script."

- **CinematicLane Step 2 (Visual Source)** — cached path:
  "Sourced from `image_to_video` (gen4_turbo / gen4.5).
  Re-render via the classic gallery's Visuals tab." →
  "Click Regenerate Real Cinematic Video below to refresh
  the silent cut in place — the new MP4 saves directly onto
  this campaign." Empty path: "Visual source picker
  (Generate / Upload / Use Character / Text-only) lives in
  classic UX Stage 3." → "Click Generate Real Cinematic
  Video below to render a new silent cut. Voiced and
  storyboard mixes layer on top once the silent cut is
  cached."

- **DialogueLane Step 2 (Cast)** — empty-state copy:
  "Plan a Hook / Beat / Closer in classic UX Dialogue tab;
  speakers will surface here automatically." → "Click Plan
  Dialogue Lines below to seed a Hook / Beat / Closer
  structure — speakers will surface here automatically once
  the plan saves."

### Disabled-reason tooltips

- CinematicLane storyboard disabled-reason: `classic UX` →
  `legacy wizard` (kept as the real fallback name; per-shot
  storyboard generation genuinely still requires the legacy
  surface).
- CinematicLane video disabled-reason: "Campaign has no
  runway_prompt — re-save in classic UX." → "This campaign
  has no saved prompt — re-save it in the legacy wizard so
  we have something to send to Runway."
- DialogueLane stitch disabled-reason: `classic UX` →
  `legacy wizard` (per-line dialogue rendering genuinely
  still requires the legacy surface).
- DialogueLane Plan button title: "POST
  /api/campaigns/{id}/dialogue/plan — template-driven plan,
  no Runway credits. Per-line generation happens in classic
  UX." → "Seed a 3-line Hook / Beat / Closer plan from the
  saved campaign brief. No Runway credits. Per-line
  rendering still happens in the legacy wizard."
- The thrown error inside `handleGenerateCinematicVideo`
  (in both `CampaignLanes.jsx` and `SpokespersonStudio.jsx`)
  rewritten to "This campaign has no saved prompt — re-save
  it in the legacy wizard before regenerating."

### CampaignModeModal

- Title row: `New Campaign` + `preview UX` pink pill →
  **`Choose campaign type`** (no pill).
- Subhead: "Pick a lane up front. Each mode is purpose-built
  for a different output shape; you can always create
  another campaign in a different mode later." → "Each type
  is purpose-built for a different output shape. Pick one
  to start; you can always create another campaign in a
  different type later."
- Footer: "Selection persists locally as
  `adspark.activeMode`. Lane-specific builders ship in
  PR BJ–BL — until then, campaign creation continues to use
  the legacy 4-stage flow underneath while the chosen lane
  is surfaced as a pill." → **"Your selection is remembered
  for this spokesperson — the matching builder mounts
  inside the workspace below."**

### Workspace placeholders

`SpokespersonWorkspace.jsx` `<TabComingSoon>` teases match
the brief's product copy verbatim:

| Tab | Tease |
|---|---|
| Knowledge | **`Knowledge sources will appear here.`** (was `Knowledge panel lands next.`) |
| Conversations | **`Conversation history will appear here.`** (was `Realtime conversations land next.`) |
| Outputs | **`Generated videos and reels will appear here.`** (was `Output gallery lands next.`) |

Summary copy under each tease also rewritten to be more
direct ("Cinematic visuals, spokesperson ads, dialogue
scenes, reels, and voice clips across every linked
campaign — one playable gallery." for Outputs, etc.).

### SpokespersonStudio empty state

When no spokespeople exist on `/`:

- Old: "The classic Character Studio (toggle UX in the
  footer) still owns creation — picker + portrait + voice
  clone flows ship into the preview UX in subsequent
  slices."
- New: "Click **+ Create Spokesperson** above to add the
  first one. Each spokesperson carries their own portrait,
  voice, and campaign history."

### What did NOT change

- Code comments (`{/* */}`, `//`, JSDoc) keep their
  PR-by-PR traceability tags. They're not user-visible; the
  cleanup explicitly targets only rendered strings.
- TopBar's brand tagline (`persistent AI spokesperson
  infrastructure`) is fine — kept.
- `Real Runway. Each click bills \`avatar_videos\`.` warning
  copy on the Spokesperson + Cinematic lanes is intentional
  product language (ties cost to action) — kept.
- Status row labels (`saved to campaign`, `polling
  Runway…`, `saving to campaign…`) — already product
  language; kept.
- Lane disabled-reason references to `legacy wizard` where
  the v2 surface genuinely defers (per-shot storyboard
  generation, per-line dialogue rendering) — kept as honest
  pointer copy.

### Smoke

`adspark-smoke.spec.js` Test 2 (`@ /`) gains a
`FORBIDDEN_JARGON` sweep at the end of the workspace
navigation block:

```js
const FORBIDDEN_JARGON = [
  /scaffold ·/i,
  /preview UX/i,
  /\blands next\b/i,
  /\bships in PR\b/i,
  /\bclassic UX\b/i,
  /\bclassic gallery\b/i,
  /\bPR B[A-Z]\b/, // PR BI / PR BJ / PR BK …
]
```

The check walks `/` (library), the mode modal, and each of
the three lanes (Spokesperson / Cinematic / Dialogue
mounted in turn inside the workspace's Campaigns tab). For
each surface, `await page.textContent('body')` is matched
against every regex; a hit fails the smoke with a
descriptive message. **Catches regressions before they
land.**

The earlier copy assertions for "Spokesperson Studio" /
"Create persistent AI spokespeople" are unchanged from
PR CB and PR CD; the heading `Spokesperson Library` and
the brief-pinned tagline are still asserted.

Test 1 (`@ /legacy`) and Test 3 (top-bar round-trip)
unchanged.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR CF; intro
  re-narrates the copy cleanup; PR CF row added.
- `docs/OPERATOR_USAGE_MAP.md` — last-updated stamp moved.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR CF; build sizes / smoke results refreshed.
- `docs/handoffs/SESSION_060_V2_COPY_CLEANUP.md` — this
  file.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| `vite build` | 464.80 KB initial / 127.38 KB gzip + 561.97 KB lazy chunk (-0.84 KB initial / -0.16 KB gzip vs PR CE — copy got tighter) |
| Playwright mock smoke | `3 passed (32.2 s)` — Test 1 (@ /legacy) 29.5 s, Test 2 (@ /) 1.5 s incl. jargon sweep, Test 3 (top-bar round-trip) 650 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

**No real Runway calls fired this session.**

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — homepage reads "Spokesperson
   Library" + brief tagline + 4 stat chips + + Create
   Spokesperson + tiles. **No `scaffold` / `preview UX`
   / `lands next` strings anywhere.**
2. Open Brewster's workspace → Identity tab default →
   click **Campaigns**.
3. Click `+ New Campaign` → modal heading reads **`Choose
   campaign type`**, footer reads "Your selection is
   remembered for this spokesperson — the matching builder
   mounts inside the workspace below." No `preview UX`
   pill.
4. Pick **Cinematic Ad** → lane mounts with header **`Create
   a cinematic video`** + the new product tagline. Step 2
   reads "Silent visual cached and ready" (or "No cinematic
   visual on this campaign yet."), pointing the operator at
   the Generate / Regenerate button below — no `classic
   gallery` references.
5. Dismiss → switch to **Spokesperson Ad**: header **`Build
   a spokesperson ad`**.
6. Dismiss → switch to **Dialogue Scene**: header **`Plan a
   dialogue scene`**, Step 2 says "Click Plan Dialogue
   Lines below to seed a Hook / Beat / Closer structure".
7. Knowledge / Conversations / Outputs tabs read
   "Knowledge sources will appear here." / "Conversation
   history will appear here." / "Generated videos and reels
   will appear here."
8. /legacy still works unchanged — the wizard's own
   `Try preview UX` toggle was already removed in PR CD;
   the legacy `+ Create Character` flow is its own
   surface.

## Limitations / follow-ups

- **Two SESSION 059 demo-readiness blockers remain.** Per
  the QA punch list, PR CF was Fix #1. The next two are
  Fix #2 (library tile + workspace Identity duplication —
  strip the tile to portrait + name + summary chips +
  Open link) and Fix #3 (real Outputs tab gallery — surface
  the cached MP4s sitting on each campaign).
- **`legacy wizard` references are intentional.** Where the
  v2 lane genuinely can't complete a flow (per-shot
  storyboard generation, per-line dialogue rendering),
  copy points users to the legacy wizard as an honest
  fallback. PR CG/CH could close those gaps to remove the
  remaining `legacy wizard` mentions.
- **Code comments still use `PR Bxx` tags.** They're
  invisible to users; intentional traceability.
- **Modal heading change is meaningful.** "Choose campaign
  type" reframes the modal as a categorisation step
  instead of "this is a new feature you're previewing." If
  product wants to swap "type" for "format" or "style" the
  swap is a one-line edit.
- **Smoke regex sweep covers `/`, the mode modal, and each
  lane** — it does **not** walk the workspace's Knowledge /
  Conversations / Outputs placeholder tabs because
  `lands next` is the regex's most aggressive pattern and
  the placeholders previously used it. Today none of the
  placeholders mention forbidden strings (rewrites moved
  them to "X will appear here") so they would pass; but
  the sweep skipping them keeps Test 2 fast. Future PRs
  can extend coverage if needed.

## Recommended next slice

**PR CG — Library tile simplification (Fix #2 from
SESSION 059).** Strip each `<SpokespersonCard>` tile down
to: portrait, name, persona pill, summary chips (voice /
linked / outputs), and the `Open Spokesperson →` primary
CTA. **Remove** the in-tile tab strip + the embedded
`<CharacterCard>` Identity tab — those affordances already
live inside the workspace's Identity tab (`/spokespeople/:id`).
Estimated half-day. Frontend-only. Smoke needs the
existing in-tile assertions
(`spokesperson-tab-{identity,knowledge,appearances}`)
deleted; everything else (summary chips, open link,
workspace navigation) preserved.

After PR CG, the only remaining demo-readiness blocker is
the Outputs gallery (PR CH).
