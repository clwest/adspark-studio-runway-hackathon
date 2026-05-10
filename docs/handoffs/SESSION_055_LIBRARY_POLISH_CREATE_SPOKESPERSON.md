# SESSION 055 — Library Polish + Create Spokesperson CTA (PR CB)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CB patch in flight on top of `8681777`
`feat: app shell + router + spokesperson library as home (PR CA)`;
commit + push pending after this handoff lands)
**Builds on:** PR CA (router + library-as-home) plus the
existing `POST /api/characters` + `POST
/api/characters/{id}/generate-portrait` plumbing the legacy
CharacterStudio has used since PR K.

## Goal

PR CA made `/` the Spokesperson Library, but the homepage
was bare: same heading copy, same tagline, no Create CTA, no
stats. PR CB turns it into a real product home — the heading
reads "Spokesperson Library", a 4-chip stats row surfaces
totals at a glance, a primary `+ Create Spokesperson` CTA
opens a focused 4-field modal that creates the character
*and* auto-fires the portrait, and each tile picks up an
at-a-glance summary strip (voice state · linked campaigns ·
outputs).

PR CB is **frontend-only**. Backend routes, storage helpers,
and on-disk media are all untouched. `/legacy` behaviour is
preserved unchanged.

## Endpoint inventory

PR CB adds **no new routes**. Backend route count remains
**70**. The Create Spokesperson flow reuses two long-standing
routes:

| Helper | Backend route | When it fires |
|---|---|---|
| `api.createCharacter(body)` | `POST /api/characters` | First step of submit — creates the row in `characters.json`. |
| `api.generateCharacterPortrait(id, {})` | `POST /api/characters/{id}/generate-portrait` | Auto-fires immediately after create succeeds. Failure surfaces inline + the new character still appears (operator can retry from the tile). |

## What changed

### New files

- **`frontend/src/components/CreateSpokespersonModal.jsx`** —
  4-field modal opened by the new primary CTA. Field set:
  - **Name** (required, max 80 chars)
  - **Template** (mascot / founder / coach / local_guide —
    same enum the legacy CharacterStudio uses)
  - **Voice preset** (limited to the featured-six list from
    `voicePresets.js`; the legacy form's full 30-voice
    selector still lives at /legacy)
  - **Subject** (optional, free text)
  Submit calls `api.createCharacter` then
  `api.generateCharacterPortrait` (best-effort — portrait
  failure does not roll back the create). Phase-aware
  status copy: `creating spokesperson…` →
  `auto-generating portrait via Runway image…` → done.
  Backdrop click + Cancel button both dismiss; both are
  disabled while `busy === true` so an in-flight create
  can't be silently abandoned.

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - Heading copy: `Spokesperson Studio` → `Spokesperson
    Library`. Renders as an `<h1>` with `text-2xl`
    (was `<h3>`); `preview UX` pill removed (PR CA
    graduated v2 to default); `Runway-powered` pill
    preserved.
  - Tagline pinned to brief copy: "Create persistent AI
    spokespeople that star in ads, hold conversations,
    and carry campaign memory." Uses a stable testid
    `spokesperson-library-tagline`.
  - New `library-stats-row`: 4 chips with stable testids
    + numeric `data-count` attrs:
    - `library-stat-spokespeople` (length of `characters`)
    - `library-stat-linked-campaigns` (campaigns with
      `character_id` set, deduplicated)
    - `library-stat-outputs` (sum across all 7 cached
      output URLs: `cached_video_url`, `host_video_url`,
      `voiced_commercial_url`, `storyboard_video_url`,
      `spokesperson_reels_url`, `dialogue_scene_video_url`,
      `dialogue_scene_reels_url`)
    - `library-stat-transcripts` (sum of
      `realtime_transcript_history` lengths)
  - New primary CTA `library-create-spokesperson` opens
    `<CreateSpokespersonModal>`. The existing PR BH
    `+ New Campaign` button stays alongside as a
    secondary (zinc) CTA so the operator can branch into
    either creation path without scrolling into a tile.
  - New `createOpen` state + `handleSpokespersonCreated`
    callback: prepends the new character to the local
    slice, calls `onSetActive(created.id)` so the next
    `+ New Campaign` already targets them, bubbles
    `onCharactersChanged` to the parent (Library /
    LegacyApp).

- **`frontend/src/components/SpokespersonCard.jsx`** —
  - New at-a-glance `spokesperson-card-summary` row above
    the existing tab strip. Three chips:
    - `spokesperson-summary-voice` — colour-coded by
      `custom_voice_status` × `custom_voice_avatar_patch_status`
      × `avatar_voice_drift_status`. States: preset
      (zinc) / cloned (mock zinc) / cloned + pending apply
      (amber) / cloned + applied (emerald) / drift (rose) /
      failed (rose). Tooltip exposes the underlying
      ids/statuses for diagnosis.
    - `spokesperson-summary-linked` — count of linked
      campaigns (always rendered).
    - `spokesperson-summary-outputs` — total cached
      outputs, only renders when > 0.
  - `summariseKnowledge()` extended with `outputCount`
    (mirrors the library-wide stats math so the per-tile
    numbers stay consistent with the row above).

- **`frontend/tests/adspark-smoke.spec.js`** — Test 2
  (`@ /`) extended:
  - Heading copy now asserts "Spokesperson Library".
  - Tagline asserts the exact brief-pinned sentence.
  - All four `library-stat-*` chips visible + each carries
    a `data-count` matching `^\d+$`.
  - Primary `library-create-spokesperson` CTA visible
    alongside the existing `spokesperson-new-campaign`
    button.
  - Open + cancel round-trip on the
    `create-spokesperson-modal`: asserts the modal
    appears with all four form fields visible, then the
    Cancel button removes it. Smoke never submits the
    form (avoids mutating fixture state).
  - Older "Spokesperson Studio" / `Create persistent AI
    spokespeople` regex assertions removed (replaced by
    the new exact-copy assertions above).

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR CB; intro
  re-narrates the new homepage chrome; PR CB row added.
- `docs/OPERATOR_USAGE_MAP.md` — last-updated stamp + the
  section 0 routing reference picks up the new Library-
  level header / Create CTA / per-tile chips.
- `docs/WHAT_IT_IS.md` — intentionally unchanged. PR CA's
  refresh still describes the Library as the homepage.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR CB; build sizes / smoke results refreshed.
- `docs/handoffs/SESSION_055_LIBRARY_POLISH_CREATE_SPOKESPERSON.md`
  — this file.

## Backend / generation preservation

- All **70** backend routes intact. PR CB calls the existing
  `POST /api/characters` + `POST
  /api/characters/{id}/generate-portrait`; no new routes,
  no schema changes.
- `/legacy` untouched: still mounts `<LegacyApp>` with the
  legacy `CharacterStudio` "+ Create Character" form (full
  6-field surface, full 30-voice selector). Both creation
  paths converge on the same backend route + the same
  `Character` schema.
- All gitignored media (videos / portraits / voice MP3s /
  host clips) reachable via the same URL fields. PR BU's
  CEO Buzz cinematic, the existing Brewster portrait, and
  every other on-disk artifact play unchanged.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| `vite build` | 448.47 KB initial / 122.98 KB gzip + 561.97 KB lazy chunk (+9.59 KB initial / +2.00 KB gzip vs PR CA) |
| Playwright mock smoke | `3 passed (25.6 s)` — Test 1 (@ /legacy) 23.7 s, Test 2 (@ /) 820 ms, Test 3 (top-bar round-trip) 600 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The build delta is small (+9.59 KB / +2.00 KB) — the modal
+ stats row + tile chips together. **No real Runway calls
fired this session.**

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh` per
the memory rule + the brief.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 — heading reads **Spokesperson
   Library**; brief-pinned tagline below; 4-chip stats row
   with `N spokespeople · N linked campaigns · N cached
   outputs · N transcript entries`; primary pink
   `+ Create Spokesperson` button + secondary zinc
   `+ New Campaign` button.
2. Each spokesperson tile shows a small summary strip
   above the tab strip: voice state pill (Brewster reads
   `voice · cloned · applied · match` — emerald — given
   the fixture state), linked-campaign count, outputs
   count.
3. Click `+ Create Spokesperson` → modal opens with Name
   focused. Pick a template, voice preset, optional
   subject, type a name, click Create. On success: tile
   appears, portrait auto-renders via Runway image, modal
   closes, the new spokesperson is the active selection
   so `+ New Campaign` already targets them.
4. Click the top-bar `Legacy UI ↗` — the v1 wizard still
   works at `/legacy` with its own legacy
   `+ Create Character` form preserved.

## Limitations / follow-ups

- **No spokesperson edit / delete from the library
  surface.** PR CB only adds Create. Edit + Delete still
  live inside the per-tile Identity tab (which embeds the
  full CharacterCard with all v1 affordances). The
  workspace (PR CC+) will give them a dedicated home.
- **Voice preset selector limited to featured six.** The
  legacy CharacterStudio form exposes all 30; the library-
  level modal stays focused on the popular ones to keep
  the surface tight. Operators who need a less-common
  preset can use /legacy or pick `vincent` and edit later.
- **No portrait override field.** The legacy form has a
  `portrait_prompt` textarea + lock toggle. PR CB skips it
  to keep the modal small; the tile's "Generate Portrait"
  retry button (inside Identity) supports overrides via a
  follow-up flow.
- **Stats counts derive from local slices.** No background
  refresh — counts update only when the local
  `characters` / `campaigns` slice mutates (after a
  Create, after a `+ New Campaign` save, etc). Refresh on
  visibility change is a tiny ~15-min slice if needed.
- **Tile summary chips are read-only.** Clicking the
  voice pill doesn't yet jump to the voice apply flow;
  click-through is deferred to the workspace
  (PR CC+) since that's the cleaner home for it.
- **No "Create Campaign" button on the tile.** The brief
  flagged this as a maybe; operators currently click
  "Use as Spokesperson" inside Identity then `+ New
  Campaign` in the header. The dedicated workspace will
  surface a per-spokesperson "+ New Campaign" CTA.

## Recommended next slice

Two reasonable directions:

1. **PR CC — Spokesperson Workspace shell + Identity tab**
   (the next slice in the SESSION_053 refactor plan).
   Adds `/spokespeople/:id` route mounting
   `<SpokespersonWorkspace>` with header + 5-tab nav
   (Identity / Knowledge / Campaigns / Conversations /
   Outputs). Identity tab is fully implemented — lifts
   CharacterCard's affordances into a dedicated panel.
   Knowledge / Campaigns / Conversations / Outputs render
   `<TabComingSoon>` placeholders. Library tile click
   navigates here. Estimated 1 day.
2. **Tile click-through polish** — wire the
   `+ New Campaign` shortcut directly onto each tile
   (currently the operator has to "Use as Spokesperson"
   first, then click the header CTA). ~30 min, frontend-
   only. Useful interim before the workspace lands.

PR CC is the bigger product win; the tile shortcut is a
nice interim.
