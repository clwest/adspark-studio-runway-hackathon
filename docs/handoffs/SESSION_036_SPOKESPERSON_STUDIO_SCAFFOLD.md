# SESSION 036 — SpokespersonStudio Scaffold Identity-Only (PR BE)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BE patch in flight on top of `0171078`
`feat: ux v2 flag + shared audit-row helpers`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_035 (PR BD — UX v2 Flag + Shared
Helpers Extraction).

## Goal

PR BD opened the door for the spokesperson-first UX redesign by
adding the `isUxV2()` flag, a footer toggle, and a shared helpers
module. PR BE walks through the door.

This slice introduces the **first gated v2 surface**: a
SpokespersonStudio that replaces the Stage 1 CharacterStudio
panel only when `isUxV2()` returns true. Each row of the library
is a SpokespersonCard with three tabs (Identity / Knowledge /
Appearances). The Identity tab embeds the existing CharacterCard
inline so every v1 voice affordance survives intact; Knowledge +
Appearances render placeholder copy and land in PR BF / PR BG.

Default load remains v1. Backend untouched. v13 demos still ship.

## Endpoint inventory

PR BE adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### New files

- **`frontend/src/components/SpokespersonStudio.jsx`** — gated
  v2 surface. Reads `GET /api/characters` via `api.listCharacters()`
  and renders a heading "Spokesperson Studio" + tagline + library
  grid. Owns the same handler set CharacterStudio uses
  (`handleGeneratePortrait` / `handleCreateAvatar` /
  `handleCloneVoice` / `handleApplyVoiceToAvatar` /
  `handleRefreshAvatarVoice` / `handleRefreshVoicePreview` /
  `handleDelete`) so embedded CharacterCards keep working
  end-to-end. Empty-state copy points operators back to the
  classic UX for creation until PR BH+ ships the mode-first
  creation modal. Loading skeleton mirrors v1 for first-paint
  consistency.

- **`frontend/src/components/SpokespersonCard.jsx`** — single
  tile for the v2 library grid. Three-tab shell:
  - **Identity** (default) — embeds the existing CharacterCard
    inline so the operator gets full feature parity: portrait,
    voice clone, recording, mic level meter, recorded preview,
    cloned preview, avatar PATCH / verify / drift / repair /
    refresh / freshness, voice history disclosure, action row.
  - **Knowledge** — placeholder copy "Knowledge wiring lands
    next." with a forward-looking caption.
  - **Appearances** — placeholder copy "Campaign appearances
    land next."
  Tab state is local to each card; switching tabs unmounts
  Identity (so the embedded CharacterCard re-mounts when
  clicked back) and mounts the placeholder block.

### Modified files

- **`frontend/src/App.jsx`** —
  - imports `isUxV2` from `./uxFlag.js` (already imported the
    rest of the flag module in PR BD).
  - imports the new `SpokespersonStudio` component.
  - Stage 1 mount becomes a ternary: `isUxV2() ?
    <SpokespersonStudio> : <CharacterStudio>`. Both consume
    the same `onCharactersChanged / activeCharacterId /
    onSetActive` props so refresh wiring is identical.

- **`frontend/tests/adspark-smoke.spec.js`** — adds a second
  Playwright test (`AdSpark Studio UX v2 SpokespersonStudio
  scaffold`) that loads with `?ux=v2`. Asserts:
  1. Footer toggle reflects `data-ux-mode="v2"` + copy "Use
     classic UX".
  2. `spokesperson-studio` testid is visible with
     `data-ux-mode="v2"`.
  3. Heading contains "Spokesperson Studio".
  4. Tagline copy contains the literal "Create persistent AI
     spokespeople".
  5. Library grid renders ≥1 spokesperson card OR the empty
     state (resilient to fixture state).
  6. When ≥1 card exists: Identity tab has `data-active="true"`,
     Knowledge + Appearances tabs are present, Identity content
     renders.
  7. Clicking Knowledge: placeholder copy renders + Identity
     content unmounts.
  8. Clicking Appearances: same shape with the appropriate copy.
  9. No console / page errors on the v2 path.

The original v1 smoke test is unchanged and still covers the
default path end-to-end.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BE; route
  count narrative confirms unchanged at 68; new rows for
  `SpokespersonStudio.jsx` + `SpokespersonCard.jsx`; App.jsx
  row notes the conditional Stage 1 mount.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged. The
  v2 surface is gated and behaviour-equivalent to v1 in this
  slice; once Knowledge + Appearances + lanes ship, the
  operator-facing flow document gets a new "Preview UX
  (PR BD–BO)" section.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BE; build sizes / route count.
- `docs/handoffs/SESSION_036_SPOKESPERSON_STUDIO_SCAFFOLD.md` —
  this file.

## v2 mount behaviour

```
App.jsx Stage 1:
  isUxV2() === true   → <SpokespersonStudio …handlers… />
  isUxV2() === false  → <CharacterStudio …handlers… />  (default)

Both components consume:
  onCharactersChanged: () => { refreshCharacters(); refreshCampaigns() }
  activeCharacterId
  onSetActive

Stages 2–4 (Campaign Brief / Creative Direction / Saved Gallery)
remain identical in both modes — PR BE does not restructure the
brief / script / gallery flow. Lane-first creation and the
4-tab saved card land in PR BH–BL.
```

## Identity tab behaviour

Inside SpokespersonCard's Identity tab, the embedded CharacterCard
receives every handler the v1 CharacterStudio passes today. The
operator can:

- generate / regenerate portrait
- create Runway avatar
- clone a custom voice (file upload OR in-browser recording with
  mic level meter + recorded preview)
- apply / repair the cloned voice on the avatar
- refresh avatar status (read-only verify + drift recompute)
- refresh the cloned voice preview URL
- read the verification freshness caption (auto-tick every 60 s)
- expand the voice history audit trail (PR BB)
- set the spokesperson active for the current campaign brief
- delete the spokesperson (local-only)

Smoke confirms the Identity tab renders and the tab strip
toggles correctly; full feature-by-feature coverage is inherited
from the existing v1 CharacterCard tests.

## Placeholder behaviour

| Tab | data-testid | Copy |
|---|---|---|
| Knowledge | `spokesperson-knowledge-tab` | `Knowledge wiring lands next.` + caption noting cross-campaign transcripts + grounding documents will surface there |
| Appearances | `spokesperson-appearances-tab` | `Campaign appearances land next.` + caption noting linked campaigns + mode badge + last-touched will surface there |

Both placeholders share a `min-h-[140px]` class so switching tabs
inside a card doesn't cause the grid to collapse / jump. Tab
strip width stays constant.

## Verification (this session)

Servers were killed and restarted in mock mode before testing.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 342.57 KB initial / 95.25 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (22.9 s)` — v1 test 21.8 s, v2 test 450 ms |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

The new v2 smoke test covers:
- footer toggle reflects v2 state + offers classic-UX escape
- SpokespersonStudio mounts with correct heading + tagline
- library grid renders ≥1 card OR empty state (resilient)
- Identity is the default selected tab
- Knowledge tab shows placeholder copy when clicked
- Appearances tab shows placeholder copy when clicked
- no console / page errors on the v2 path

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200 (via localhost)
```

After implementation, smoke + build ran against fresh processes.
Servers are stopped at end of session.

## Limitations / follow-ups

- **Visual double-frame.** SpokespersonCard wraps CharacterCard
  inline, so the Identity tab shows the existing tile chrome
  inside an outer SpokespersonCard container. Acceptable for
  this scaffold slice; PR BE.1 (or a later refactor in PR BO's
  legacy-prune sweep) replaces the embed with v2-native UI so
  the double frame collapses.
- **No creation flow in v2 yet.** The empty state points the
  operator back to the classic UX for character creation. The
  mode-first creation modal lands in PR BH; until then, an
  operator who toggles to v2 with an empty library has no path
  to add a spokesperson without flipping back.
- **Library grid layout is wider.** v1 used 4 columns; v2 uses
  3 columns to accommodate the embedded CharacterCard + tab
  strip without crowding. On large viewports the v2 grid feels
  slightly more spacious; on narrow viewports both render the
  same single-column stack.
- **Knowledge + Appearances are placeholders only.** No data
  wiring yet. PR BF / PR BG fill them in.
- **Tab state is per-card and ephemeral.** Switching to
  Knowledge then back to Identity remounts the embedded
  CharacterCard, which restarts any in-flight state (recording
  in progress, cloning request, expanded history disclosure).
  Acceptable for V1; if the remount cost hurts UX we can keep
  all tabs mounted under a `hidden` class instead.
- **No backend filter route.** Knowledge tab in PR BF will
  iterate `GET /api/campaigns` client-side and filter by
  `character_id`. With the current ~9 fixture campaigns this is
  fine; a backend filter route is a future slice if libraries
  grow.

## Recommended next slice

**PR BF — Knowledge tab data wiring.**

- Inside SpokespersonCard's Knowledge tab, replace the placeholder
  with real content sourced from existing campaign records:
  - Filter `GET /api/campaigns` client-side by `character_id ===
    spokesperson.id`.
  - For each matched campaign, surface:
    - the grounding document state (`runway_document_status`,
      `runway_document_id`)
    - the realtime transcript history count (PR BC's
      `realtime_transcript_history.length`)
    - the most recent transcript turn count + fetched-at
  - Aggregate counts across all matched campaigns into a small
    summary header ("Grounding docs: N · Transcripts: M
    sessions across K campaigns").
- No backend changes. No new endpoints.
- Smoke: extend the v2 case to assert Knowledge tab renders the
  summary instead of the placeholder when the spokesperson
  appears in any campaign; falls back to a tighter "Not used in
  any campaign yet" state otherwise.

Estimated PR BF size: ~120 LOC. Default v1 smoke unaffected.

After PR BF: PR BG wires Appearances (campaign list with mode
badges), then PR BH introduces the mode-first creation modal —
the first slice that visibly diverges from v1 beyond the Stage
1 surface.
