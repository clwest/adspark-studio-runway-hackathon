# SESSION 050 — V2 Appearances Click-Through Tab Hints (PR BS)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BS patch in flight on top of `ae7c130`
`feat: v2 appearances click-through to campaign gallery (PR BR)`;
commit + push pending after this handoff lands)
**Builds on:** SESSION_049 (PR BR) — the Appearances row's
"Open in gallery →" affordance now scrolls + flashes the
matching CampaignCard. PR BS extends the same handler so the
card also opens its most-relevant tab based on the row's
inferred campaign mode.

## Goal

PR BR's recommended follow-up #2 verbatim: "extend PR BR so
the click also hints which tab to open inside the
CampaignCard (Visuals vs Voice vs Realtime) based on the
row's inferred mode." PR BR landed the scroll + highlight;
operators still had to click into the right tab manually
once the card came into focus. PR BS closes that loop.

PR BS is **frontend-only**. Reuses the existing
`inferCampaignMode` helper from SpokespersonCard (Cinematic /
Spokesperson Ad / Dialogue Scene / Storyboard / Realtime /
Mixed / Draft) and maps it to CampaignCard's existing seven
tab ids (overview / visuals / character / voice / dialogue /
realtime / exports). The mapping lives in App.jsx as a tiny
module-level helper so future callers can reuse it.

## Endpoint inventory

PR BS adds **no new routes**. Route count remains **69**.
Frontend-only.

## What changed

### Modified files

- **`frontend/src/App.jsx`** —
  - new module-level `_tabFromInferredMode(mode)` helper
    mapping spokesperson → character, cinematic / storyboard →
    visuals, dialogue → dialogue, realtime → realtime, mixed /
    draft → overview, anything else → null.
  - new `openCampaignTab` state alongside `openCampaignId`.
    `null` = leave the gallery card's `activeTab` alone.
  - new `handleV2OpenCampaign(campaignId, inferredMode)` —
    calls `setOpenCampaignId(campaignId)` and
    `setOpenCampaignTab(_tabFromInferredMode(inferredMode))`
    in one shot. Threaded into `<SpokespersonStudio>` as the
    `onOpenCampaign` prop (replacing PR BR's inline arrow).
  - `<CampaignGallery>` now also receives `openCampaignTab`;
    `onClearOpen` clears both state slots in tandem.

- **`frontend/src/components/CampaignGallery.jsx`** —
  - top-level component accepts new prop `openCampaignTab =
    null`. Threads to each `<CampaignCard>`.
  - `CampaignCard`:
    - existing PR BR `useEffect` keyed on `isOpenedFromV2`
      now also calls `setActiveTab(openTargetTab)` whenever
      `openTargetTab` is one of the seven valid ids
      (`overview` / `visuals` / `character` / `voice` /
      `dialogue` / `realtime` / `exports`). Unknown values
      are ignored — the card keeps whatever tab the operator
      already had open.
    - outer `<li>` carries new `data-active-tab={activeTab}`
      attribute so the smoke can assert which tab landed.
    - other PR BR attrs (`data-testid`, `data-campaign-id`,
      `data-opened-from-v2`) preserved.

- **`frontend/src/components/SpokespersonCard.jsx`** —
  - "Open in gallery →" button's `onClick` now passes the
    row's inferred mode as the second arg:
    `onClick={() => onOpenCampaign?.(cm.id, mode)}` (where
    `mode` is the `inferCampaignMode(campaign)` value
    rendered in the same row's mode pill). Disabled
    placeholder branch unchanged.
  - testid `spokesperson-appearance-open` preserved.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - `handleOpenCampaign(campaignId, inferredMode = null)`
    now accepts a second arg and bubbles it: calls
    `onOpenCampaign?.(campaignId, inferredMode)` then
    extends `openStatus` to `{ campaignId, label, mode }`.
  - banner `data-testid="spokesperson-open-status"` copy
    extended: when `mode` is truthy renders
    "Opened campaign in gallery: {label} · {mode} tab" so
    the operator sees which tab the card jumped to.
  - testid + auto-clear behaviour unchanged.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched; v2 case Appearances rows
    branch extended:
    - captures the row's mode-pill text before clicking via
      `await modePill.textContent()` and normalises it
      to the studio's inferred-mode vocabulary.
    - clicks the Open button (existing PR BR step).
    - asserts the status banner now contains the resolved
      mode + " tab" suffix when the inferred mode maps to a
      known tab id.
    - asserts the highlighted `<li
      data-opened-from-v2="true">` carries
      `data-active-tab` matching the resolved tab id.
    - falls back to the PR BR-level assertions (banner
      visible, card highlighted) when the mode pill is
      empty / unknown, so fixture variations don't fail
      the smoke.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BS; route
  count narrative confirms unchanged at 69.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
  v2 surface stays gated.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation list
  picks up PR BS; build sizes / smoke results refreshed.
- `docs/handoffs/SESSION_050_V2_APPEARANCES_TAB_HINTS.md`
  — this file.

## Inferred-mode → tab mapping

| inferred mode (`SpokespersonCard`) | resolved tab (`CampaignCard`) |
|---|---|
| `Spokesperson Ad` | `character` |
| `Cinematic` | `visuals` |
| `Storyboard` | `visuals` |
| `Dialogue Scene` | `dialogue` |
| `Realtime` | `realtime` |
| `Mixed` | `overview` |
| `Draft` | `overview` |
| (anything else / empty) | `null` → leave activeTab alone |

The mapping is intentionally narrow — it doesn't try to
guess between Voice and Visuals for ambiguous campaigns;
those land on Overview so the operator can pick. The seven
known tab ids are the whitelist; anything outside that set
is treated as "unknown" and skipped.

## Click-through behaviour (extended from PR BR)

```
Operator on SpokespersonStudio (?ux=v2):
  ↓ clicks "Use as Spokesperson" on Brewster's tile
  ↓ clicks Appearances tab
  ↓ row shows mode pill: "Spokesperson Ad"
  ↓ clicks "Open in gallery →"

SpokespersonCard:
  ↓ onOpenCampaign?.(cm.id, "Spokesperson Ad")

SpokespersonStudio.handleOpenCampaign:
  ↓ onOpenCampaign?.(id, "Spokesperson Ad")  — bubbles to App.jsx
  ↓ setOpenStatus({campaignId, label, mode}) — banner appears

App.jsx.handleV2OpenCampaign:
  ↓ setOpenCampaignId(id)
  ↓ setOpenCampaignTab("character")          — resolved via _tabFromInferredMode

CampaignGallery → CampaignCard with matching id:
  ↓ isOpenedFromV2 flips true; openTargetTab = "character"
  ↓ useEffect: setActiveTab("character") + scrollIntoView
              + setOpenHighlight(true)
  ↓ ring + glow flip to pink; tab content swaps to character
  ↓ data-opened-from-v2="true"; data-active-tab="character"
  ↓ after 2.2 s: setOpenHighlight(false) + onClearOpen?.()

App.jsx:
  ↓ setOpenCampaignId(null) + setOpenCampaignTab(null)

After ~2.5 s in studio:
  ↓ openStatus auto-clears (banner disappears)
```

The card's `activeTab` does **not** revert when the highlight
fades — once the operator's been deep-linked into a tab they
keep that tab as the working surface until they manually
click another tab. That matches PR Y's just-saved scroll
semantics: the highlight is ephemeral but the navigation
target sticks.

## Save / state preservation

- `activeMode` (PR BH) preserved — click-through doesn't
  flip the mode pill or unmount the active lane.
- `activeCharacterId` (PR U) preserved — the active
  spokesperson stays selected.
- `newestSavedId` (PR Y) **not touched** — v1's just-saved
  scroll pattern is independent.
- Other CampaignCards' `activeTab` state untouched — only
  the targeted card flips.
- The CampaignGallery + saved cards re-render with the same
  campaigns data they already had; no refetch fires.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **69** (unchanged from PR BR) |
| `vite build` | 394.87 KB initial / 106.27 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `3 passed (26.2 s)` — v1 22.0 s, v2 2.8 s, toggle round-trip 753 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now exercises the tab-hint end-to-end: mode
pill captured, button clicked, status banner shows the
expected `· {mode} tab` suffix, and the highlighted card
carries the resolved `data-active-tab`. Falls back to the
PR BR-level assertions (banner visible, card highlighted)
when the fixture's mode pill is empty / unknown so the
smoke stays green across fixture variations.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule + the brief.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path:
1. http://localhost:5173 → footer "Try preview UX →".
2. On Brewster's tile, click "Use as Spokesperson".
3. Click Appearances tab on Brewster's card.
4. CEO Buzz row → click "Open in gallery →" (now pink).
5. Page scrolls to the saved CEO Buzz card; it flashes a
   pink ring + glow for ~2 s; the card auto-opens its
   **Character** tab; emerald banner reads "Opened campaign
   in gallery: CEO Buzz · Spokesperson Ad tab." and
   auto-clears.
6. Click Appearances again, pick a different mode (or any
   row whose pill says Cinematic / Storyboard) — the same
   flow lands on **Visuals** instead.

## Limitations / follow-ups

- **No exports / voice tabs targeted.** The mapping skips
  voice → there's no inferred-mode value that resolves to
  the voice tab; operators looking for the voice timeline
  still land on Overview and click in. Same for exports.
  Could be added in a future slice if a clear inferred-mode
  signal emerges (e.g. campaigns with cached spokesperson-ad
  outputs auto-target exports).
- **No persistence.** The deep-linked tab state lives only
  in CampaignCard's `activeTab`, which resets to its own
  default on a hard reload. Reload-after-deep-link is not
  preserved.
- **Single-card scope.** Only the targeted card flips its
  tab. Other cards' `activeTab` state untouched (correct —
  this would be surprising otherwise, and PR BR already
  established the single-card highlight pattern).
- **Mode pill text is the source of truth.** The smoke
  captures the rendered pill text and feeds it back through
  the same mapping; if `inferCampaignMode` ever drifts from
  the pill copy, the smoke would catch it. The studio
  banner reuses the inferred-mode string as-is so operators
  see the same vocabulary on both surfaces.

## Recommended next slice

The last unlit v2 placeholder is **Cinematic Video**
(async `image_to_video` + polling on
`/runway/task/{id}`). The placeholder has been carrying a
disabled tooltip since PR BK; PR BP wired the synchronous
real-Runway buttons (Spokesperson Ad horizontal +
Cinematic Visual still image) but didn't tackle the async
poll yet.

If we keep deferring, the obvious smaller polish is a
**tab-hint banner inside the CampaignCard** that names the
auto-selected tab when the highlight first lands ("Opened
to Character tab — auto-detected from Spokesperson Ad
mode"), so the operator understands why the deep-link
chose what it chose. Tiny ~30 min slice; nice-to-have, not
blocking.

Either is fine. Cinematic Video is the bigger win
(closes the last placeholder); the inline banner just
polishes PR BS's edge.
