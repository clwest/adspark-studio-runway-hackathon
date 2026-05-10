# SESSION 078 — PR CU Fix Campaign Creation Dead-End

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CU patch in flight on top of
`cc38d7d` `fix: gen4_image_turbo broken upstream —
switch to gen4_image (PR CT)`; commit + push pending
after this handoff lands)

**Why this slice ran:** With the portrait/avatar
pipeline now reliable under `gen4_image`, the next
operator-blocker is the campaign-creation UX. Picking
"Spokesperson Ad" mode mounted a 3-step lane scaffold
that READ as a workflow but had **no path forward** —
Step 1 said "Create or select a campaign to edit the
brief." with no button, Step 2 instructed the operator
to "use the legacy wizard", Step 3 buttons surfaced
cryptic chips like "no avatar" / "no source". The lane
felt broken even though every primitive existed.

## What changed

### 1. Step 1 — Empty-state CTA (closes the dead-end)

New `frontend/src/components/lanes/LaneBriefCreator.jsx`
component. Two states:

- **Collapsed:** primary `+ Create campaign brief` button
  + one-line empty-state copy ("No campaign yet. Start
  a spokesperson ad brief — the rest of the lane unlocks
  once it's saved.").
- **Expanded:** Business* / Product / Audience / Tone
  inline form + `Save brief` / `Cancel`.

Field shape mirrors `LaneBriefEditor` (PR BQ) verbatim
so the operator transitions seamlessly from "create" to
"edit" the moment the campaign exists. Wired into all
three lanes (Spokesperson / Cinematic / Dialogue) —
every empty-state dead-end across the v2 surface is
closed by the same component.

`CampaignLanes.handleCreateCampaign(brief)` builds a
minimal valid `CampaignCreate` payload from the four
brief fields:

```js
{
  business, product, audience, tone,
  selected_concept: {
    title: business,
    hook: audience || `Meet ${business}.`,
    visual: product || business,
    caption: product || business,
    cta: 'Learn more',
  },
  runway_prompt: `A polished commercial visual for ${business}…`,
  social_post: { caption: product || business, cta: 'Learn more', hashtags: [] },
}
```

POSTs `/api/campaigns`, then `/api/campaigns/{id}/attach-character`
with the active spokesperson id. Propagates the new
campaign to the parent's local slice via
`onCampaignsChanged` so the lane re-renders with the
focused campaign immediately. **No Runway calls.**

### 2. Step 2 — Inline script CTA + textarea

New `Step2Script` subcomponent at the bottom of
`SpokespersonLane.jsx`. Three states, each with a
clear next action:

- **No campaign** — disabled CTA pointing back to Step 1.
- **Campaign + script** — preview + `Edit script`
  reveals textarea.
- **Campaign no script** — primary `+ Save script` CTA
  reveals textarea.

Plain `<textarea>`, ≤300 chars (matches Runway's
`avatar_videos` speech cap), Save calls
`onSaveScript(campaign.id, draft)` → POSTs
`/api/campaigns/{id}/script` (existing PR AA route).
**No legacy-wizard round-trip required.** Counter at
the bottom right shows `N/300`. Cancel discards.

### 3. Step 3 — Disabled-state language

Two button chips in Step 3 used to render terse,
cryptic states:

- "no avatar" → **"requires avatar"**
- "no source" → **"requires video"**

Plus when no campaign exists yet:

- → **"requires brief"**

The `title` tooltips on disabled buttons also got
operator-readable rewrites:

- ❌ `"Pick a linked campaign first."`
- ✅ `"Requires campaign brief — save the brief in Step 1 first."`
- ❌ `"A usable avatar is required (character_id / selected_avatar_id / host_avatar_id ready)."`
- ✅ `"Requires avatar — generate or attach a Runway avatar to the campaign first."`
- ❌ `"Generate the Spokesperson Ad cut first (host_video_url + host_status=ok required)."`
- ✅ `"Requires saved video — generate the Spokesperson Ad in Step 3 first."`

### 4. Architecture preserved

- Lane system unchanged (Spokesperson / Cinematic /
  Dialogue still mount per `activeMode`).
- Campaign / Character schemas unchanged.
- Backend route count unchanged at **71** — every new
  call uses an existing route.
- `/legacy` untouched.
- `LaneBriefEditor` (PR BQ) unchanged — still mounts
  on Step 1 the moment a campaign exists.

## Files modified

- `frontend/src/components/CampaignLanes.jsx` —
  new `handleCreateCampaign` + `handleSaveScript`
  handlers; passed to all three lane components as
  new props (`onCreateCampaign`, `onSaveScript`).
- `frontend/src/components/lanes/SpokespersonLane.jsx` —
  Step 1 empty state mounts `<LaneBriefCreator>` instead
  of dead copy; Step 2 extracted into new
  `<Step2Script>` subcomponent with inline textarea
  + Save CTA; Step 3 chip + tooltip rewrites.
- `frontend/src/components/lanes/CinematicLane.jsx` —
  Step 1 empty state mounts `<LaneBriefCreator>` (mode
  label "cinematic ad", testid prefix "cinematic").
- `frontend/src/components/lanes/DialogueLane.jsx` —
  Step 1 empty state mounts `<LaneBriefCreator>` (mode
  label "dialogue scene", testid prefix "dialogue").
- `frontend/src/components/lanes/LaneBriefCreator.jsx`
  (new) — the empty-state CTA + inline create form.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — appended PR CU block.
- `docs/handoffs/SESSION_078_CAMPAIGN_DEAD_END_PR_CU.md`
  (this file, new).

No backend changes. No new endpoints. No new feature
surface beyond the empty-state CTA + Step 2 inline
script editor.

## Exact UX flow change

### Before (dead-end)

```
Workspace > Campaigns tab > "+ New Campaign" > pick "Spokesperson Ad"
  ↓
Lane mounts:
  Step 1 · Brief        Step 2 · Script              Step 3 · Render
  "Create or select a   "Create or select a          [Generate Real…]
   campaign to edit      campaign to author a         no avatar
   the brief."           script."                    [Build Captioned…]
                         "Authoring lives in the      no source
                          legacy wizard until
                          inline editing ships."
  ↓
operator: ¯\_(ツ)_/¯  → flips to /legacy
```

### After (linear)

```
Workspace > Campaigns tab > "+ New Campaign" > pick "Spokesperson Ad"
  ↓
Lane mounts:
  Step 1 · Brief                       Step 2 · Script              Step 3 · Render
  No campaign yet. Start a             Save a campaign brief        [Generate Real Spokesperson Ad]
   spokesperson ad brief — the          in Step 1 to author          requires brief
   rest of the lane unlocks             a script.                   [Build Captioned Reels]
   once it's saved.                                                  requires brief
   [+ Create campaign brief]
  ↓
operator clicks → form expands inline → fills Business + Product → Save brief
  ↓
Lane re-renders with focused campaign:
  Step 1 · Brief                       Step 2 · Script              Step 3 · Render
  [LaneBriefEditor — 4 fields,         No script yet.               [Generate Real Spokesperson Ad]
   Save / Cancel]                       [+ Save script]              requires avatar
                                                                     [Build Captioned Reels]
                                                                     requires video
  ↓
operator clicks "+ Save script" → textarea expands inline → types script → Save
  ↓
Step 2 now shows preview + "Edit script"
Step 3 buttons remain disabled until avatar + video exist (clearer messaging)
```

## Verification

| Check | Result |
|---|---|
| Backend route count | **71** (unchanged) |
| Backend pytest | **7/7 passed** — no test changes this slice |
| `vite build` | 491.14 KB initial / 133.39 KB gzip + 561.97 KB lazy chunk (+9.64 KB / +1.51 KB vs PR CT — `LaneBriefCreator` + `Step2Script` + handler wiring across 3 lanes). |
| Mock smoke | **3 passed (~45.6 s)** — Test 1 42.7 s, Test 2 1.7 s, Test 3 656 ms. |
| End-to-end mock probe | ✅ create-character → save-campaign-with-PR-CU-minimal-payload → attach-character → save-commercial-script all round-trip cleanly. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | uvicorn + vite up · `runway_mock=false` · `vite http=200`. |
| `/legacy` reachable | smoke Test 3 round-trip. |
| Real Runway calls fired | **0** — every new call uses existing JSON-only routes. |

## Manual walkthrough (real-mode)

1. **Open `/`.** Library lists spokespeople. Pick one with a
   portrait (Donny `23b969f1288b` works after PR CT).
2. **Open spokesperson workspace** → Campaigns tab → click
   `+ New Campaign` → pick **🎙️ Spokesperson Ad**.
3. **Step 1 empty state** now shows `+ Create campaign brief`
   (pink primary button) + helper copy. Click it.
4. **Inline form expands.** Type a Business name (required,
   e.g. "Probe Co"). Optionally fill Product / Audience / Tone.
5. **Click `Save brief`.** Status flips to "creating campaign…",
   then the lane re-renders with the focused campaign visible
   in Step 1's `<LaneBriefEditor>`. The new campaign appears
   in `linkedCampaigns` (testable via the workspace Campaigns
   list above the lane).
6. **Step 2 now shows `+ Save script` CTA** (pink primary).
   Click it → textarea expands → type a short script (≤300
   chars, e.g. "Hey there. Try Probe Co — devs love it.") →
   Save. Status banner clears, preview replaces the textarea,
   `Edit script` button takes over.
7. **Step 3 buttons** stay disabled until you bind a Runway
   avatar to the campaign (via the legacy /spokesperson-ad
   route or a future v2 binder). The chips now read
   `requires avatar` instead of `no avatar`.
8. **Click "Generate Real Spokesperson Ad"** once an avatar
   exists. Real Runway call fires.

No legacy-wizard round-trip needed for steps 1–7. Step 8
remains the only step that touches Runway credits in this
flow (intentional — it's the actual ad-render step).

## Does progression now feel linear?

Yes. The lane reads as a 3-step funnel:

1. Step 1 has a CTA when empty, an editor when populated.
2. Step 2 unlocks naturally after Step 1 (CTA visible the
   moment a campaign exists).
3. Step 3 has clear prerequisite chips (`requires brief`
   when no campaign, `requires avatar` when no avatar bound,
   `requires video` for Reels until the Spokesperson Ad
   render lands).

No surface left says "go to legacy wizard". Every prompt
the operator sees has an inline action.

## Remaining UX confusion points

- **Avatar binding is still a separate workflow.** The lane
  surfaces an `requires avatar` chip on Step 3, but the
  *binder* lives in the workspace Identity tab (`Create
  Avatar` on the embedded CharacterCard). A future PR could
  add a small "Bind avatar to campaign" link in Step 3
  pointing to the right place. Out of scope today.
- **Cinematic / Dialogue lanes** got the empty-state CTA but
  not the equivalent Step 2 / Step 3 polish. The dead-end
  blocker is closed; their step-by-step polish is a
  follow-up if they're demo-critical.
- **Brief refinement is shallow.** The 4 fields
  (Business / Product / Audience / Tone) match the
  existing `Campaign` schema but don't expose richer
  fields (`selected_concept`, `runway_prompt`,
  `social_post`) without flipping back to `/legacy`. The
  inline `Save brief` posts placeholder values for those
  fields; the legacy wizard refines them. Acceptable
  trade for a "make it usable" pass.
- **Multiple campaigns per spokesperson.** Lanes
  auto-focus the most-recent linked campaign. There's no
  picker yet for switching between linked campaigns from
  inside the lane — operators have to use the workspace
  Campaigns list above the lane. Fine for now.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

**PR CV — bind avatar from inside the campaign lane.**
Add a small `Bind avatar` action in Step 3 (or as part of
the "requires avatar" disabled state) that triggers
`POST /api/campaigns/{id}/avatar` against the active
spokesperson's `runway_avatar_id`. This closes the last
operator-blocking gap before "Generate Real Spokesperson
Ad" can fire end-to-end from the v2 workspace without a
single legacy-wizard click.
