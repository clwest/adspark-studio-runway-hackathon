# Spokesperson-First Flow Audit — PR U

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-u-spokesperson-first`
**Status:** Implemented + verified end-to-end on this branch.
Companion to `docs/research/UI_REDESIGN_AUDIT.md` (PR O),
`docs/research/VISUAL_SOURCE_FLOW_AUDIT.md` (PR R), and
`docs/research/RUNWAY_PROMPT_STRUCTURE.md` (PR T).

## Current flow issues

Until PR U, AdSpark's stage order treated the brand identity as an
add-on:

```
Stage 1  Campaign Brief
Stage 2  Generate Visual Ad
Stage 3  Character Studio
Stage 4  Saved Campaigns
```

Practical problems with that order:

1. **The user generates an ad before deciding who's in it.**
   Reference image has to be hand-chosen / generated — but if a
   character will narrate the host clip, the visual ad and the
   spokesperson clip end up disconnected. The recorded demo path
   (`DEMO_SCRIPT.md` Path F) explicitly works around this by
   pre-creating the character "off camera."
2. **Character Studio reads as optional even though it's the v5
   headline.** Sitting in Stage 3 between RunwayPanel and the
   gallery, the Studio looks like a peer of Audio Pack — not the
   primary brand-identity surface AdSpark sells.
3. **No active-spokesperson concept.** When a Character existed,
   the only way it influenced a campaign was by being attached
   *after* the campaign was saved, via the gallery card's
   per-campaign attach picker. The user couldn't think "I'm
   making a Brewster ad" — they had to think "I'm making an ad,
   and oh, also Brewster."
4. **Switching concepts didn't refresh prompts.** Pre-PR-T, the
   silent-keep-old-prompt bug meant choosing a different concept
   broke the relationship between the panel and the textarea.
5. **The Visual Source selector defaults to "Generate image"
   even when the user has just created a character.** That's fine
   on day one but feels wrong on day two when the user clearly
   wants their character to drive the video.

## Proposed stage order

```
Stage 1  Spokesperson    — Choose / create the face of this campaign
Stage 2  Campaign Brief  — Business, product, tone, audience
Stage 3  Generate Visual Ad — Concepts → prompt → silent visual cut → save
Stage 4  Saved Campaigns / Deliverables
```

The new order matches the natural hackathon-demo narrative:
*"Meet Brewster. He's our coffee mascot. Here's the ad he's in."*

## State inheritance

| State | Source | Used by | Cleared by |
|---|---|---|---|
| `activeCharacterId` | User clicks **Use as Spokesperson** in Stage 1 | Stage 2 chip + Stage 3 default Visual Source + Stage 3 Generate Video label + save flow | "Clear" link in Stage 2 chip; deleting the character in Studio |
| `activeCharacter` | Derived from `characters` array + `activeCharacterId` | Stage 2 chip rendering + Stage 3 portrait-as-imageUrl wire | Same as above |
| `characters` | `GET /api/characters` on App mount + after Studio events | Studio library + Stage 2 chip + Stage 3 Visual Source picker | App refresh |

The active-spokesperson state lives entirely in `App.jsx` —
no backend persistence. Saving a campaign with an active spokesperson
calls `POST /api/campaigns/{id}/attach-character` after the create
returns, so the per-campaign attachment lands in the same JSON
record the gallery already reads from.

## What happens if the user skips Spokesperson?

Stage 1 has a visible **Skip for now** affordance. When skipped:

- `activeCharacterId` stays null.
- Stage 2 brief renders without the active-spokesperson chip.
- Stage 3 Visual Source defaults to "Generate image" exactly as it
  did pre-PR-U.
- Generate Video button reads "Generate Video" (no character
  suffix).
- Saved campaign cards look exactly like they did pre-PR-U: the
  per-campaign attach picker still lets the user attach a character
  later from the gallery.

So the skip path is the legacy path verbatim. Existing saved
campaigns are unaffected — their `character_id` stays whatever it
was (null by default).

## Integration with existing components

| Component | What changes | What stays |
|---|---|---|
| `CharacterStudio.jsx` | New `activeCharacterId` + `onSetActive` props; tile on the active character lights up; new "Use as Spokesperson" / "Clear active" affordance | Library grid + Create form + portrait+avatar generation flows unchanged |
| `CharacterCard.jsx` | New `isActive` prop adds an "active" pill + reuses the attached-here styling; new `onSetActive` callback wires the activate button | All existing onGeneratePortrait / onCreateAvatar / onAttach / onDelete callbacks unchanged |
| `AvatarPicker.jsx` | **Untouched.** The picker remains scoped to per-campaign card use in Stage 4. Promoting it to Stage 1 would duplicate the Studio + risk a "two ways to pick the same thing" UX. |
| `CampaignForm.jsx` | New top chip showing the active spokesperson when set | Form fields + submit unchanged |
| `PromptPreview.jsx` | Pre-fills `imageUrl` to `/api/characters/<id>/portrait` when active spokesperson exists; adapts Generate Video button label | Existing Generate Reference Image / Use text-only / model-ratio-duration controls unchanged |
| `CampaignGallery.jsx` | **Untouched in PR U.** Per-campaign attach picker, Avatar Picker, Audio Pack, Realtime, Commercial with Voice (PR S), all preserved verbatim |
| `App.jsx` | Stage shell reorder (1↔3 swap), new `activeCharacterId` state + handler, save flow attaches active character | All existing handlers (handleConcepts / handleGenerateVideo / etc) unchanged |

## Backend shim

One small addition to `backend/app/services/runway_client.py`:
extend `_resolve_image_for_runway` to recognise the
`/api/characters/<id>/portrait` URL prefix. When the frontend sets
`imageUrl` to that route + the user clicks Generate Video,
`runway_client.create_task` posts to Runway with the cached
character portrait embedded as a base64 data URI. Same shim PR R's
"Use Character" Visual Source needs; the two PRs land identical
code via git's three-way merge.

No new endpoints. No new external providers. No model changes.

## Tests

Smoke updates:

- Asserts the stage progress indicator now shows Spokesperson
  first (the heading order in the DOM puts Stage 1 above
  Stage 2).
- Asserts the Character Studio renders inside Stage 1 (heading
  order check; same `Character Studio` heading text as before).
- Asserts the brief form still renders + still works after the
  reorder.
- Skip path remains green — the smoke never sets an active
  spokesperson, so it walks the legacy path verbatim.

Existing PR A–S smoke assertions all preserved.

## Known limitations

1. **Active spokesperson is not persisted across reloads.** It's
   transient `App.jsx` state. When the user reloads, they pick
   again. Saving a campaign with the spokesperson active
   persists it on that campaign, so the work survives — only the
   "currently selected" UI hint resets.
2. **No auto-clear when picking from the gallery's per-campaign
   AvatarPicker.** Those two surfaces work in parallel: the
   Stage-1 active spokesperson is the new-campaign default;
   per-campaign Avatar Picker selections override it on a
   per-campaign basis. That's intentional — gallery selections
   are local to the saved campaign, not the next-new-campaign
   default.
3. **Multiple in-flight characters: fine, but only one is
   "active."** If the user has Brewster + Sir Landsloplot + Donk,
   only the one they clicked Use is active. Others are still
   visible in the Studio library + still attachable per-campaign
   later. Picking another character clears the previous one.
4. **Character Studio still renders the Create form inline** —
   on a small viewport this means the brief stage scrolls farther
   away when a user is mid-creation. UI Phase 4 (modal/sheet
   create form) would close that.
5. **Skip CTA is text-only.** A user who never sees "Use as
   Spokesperson" in the Studio could still arrive at Stage 2 via
   the skip — the chip in Stage 2 is the only visible "you have
   no spokesperson" cue. That's acceptable; the legacy path is
   exactly what skip-users get.

## Recommended next polish

1. **Persist `activeCharacterId` to localStorage** under a new
   `adspark.spokesperson.v1` key so demo recordings can pick a
   character once and have it survive a tab reload.
2. **Generate concepts that are character-aware** — when active,
   pass the character name + template to `/api/concepts` so the
   backend can inject "raccoon barista mascot" etc into the
   subject field. PR T's structured prompt builder is the right
   place to integrate this; document the wire on top of PR T's
   existing `simplifyFromConcept` helper.
3. **Move AvatarPicker to a Stage-1 affordance** in addition to
   per-campaign placement, so users with prior account avatars
   can pick one without going through Character Studio. Adds a
   "Choose from picker" / "Create new" / "Skip" three-up at the
   top of Stage 1.
4. **DEMO_SCRIPT update** — Path F currently pre-creates the
   character off-camera because the previous flow reordered
   awkwardly. With PR U, the character creation IS the on-camera
   opening beat. Update the script.
