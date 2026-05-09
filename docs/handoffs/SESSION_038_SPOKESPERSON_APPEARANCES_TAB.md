# SESSION 038 — Spokesperson Appearances Tab Wiring (PR BG)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BG patch in flight on top of `d897437`
`feat: spokesperson knowledge tab wiring`; commit + push pending
after this handoff lands)
**Builds on:** SESSION_035 (PR BD — UX v2 Flag), SESSION_036
(PR BE — SpokespersonStudio Scaffold), SESSION_037 (PR BF —
Knowledge Tab Wiring).

## Goal

PR BE introduced the gated v2 SpokespersonStudio scaffold with
three-tab cards. PR BF wired Knowledge. PR BG completes the
**first pass** of the v2 SpokespersonCard by wiring the
Appearances tab so each spokesperson surfaces every campaign
they appear in — with an inferred mode badge, a last-touched
timestamp, and a compact output-summary chip row.

A persistent AI spokesperson is more than a portrait + voice +
knowledge graph: they have a filmography. Appearances exposes
that filmography directly inside the spokesperson tile so
operators can scan "where did Brewster show up and how recent
was it?" without leaving the v2 surface.

This is the fourth gated v2 slice. Backend untouched. Default
v1 load is unchanged. PR BH introduces the mode-first creation
modal next — the first slice that visibly diverges from v1
beyond Stage 1.

## Endpoint inventory

PR BG adds **no new routes**. Route count stays at **68**.
Frontend-only. Reuses the `linkedCampaigns` prop SpokespersonStudio
already forwards (added in PR BF).

## What changed

### Modified files

- **`frontend/src/components/SpokespersonCard.jsx`** —
  - new `MODE_PILL_CLASSES` frozen colour map (Cinematic →
    fuchsia, Spokesperson Ad → emerald, Dialogue Scene → sky,
    Storyboard → amber, Realtime → violet, Mixed → pink,
    Draft → zinc).
  - new `inferCampaignMode(campaign)` deterministic helper.
    Inspects `dialogue_*`, `host_video_url` /
    `spokesperson_reels_url`, `storyboard_*`, `cached_video_url`
    / `voiced_commercial_url`, `runway_conversation_id` /
    `realtime_transcript_history`. Two or more *strong*
    output flags (anything except realtime/draft) collapse to
    `"Mixed"`. Single-flag outputs map deterministically;
    realtime-only with no other outputs returns `"Realtime"`;
    nothing populated returns `"Draft"`.
  - new `campaignLastTouched(campaign)` helper. Returns the
    max ISO timestamp across:
    `realtime_transcript_history[*].fetched_at`,
    `realtime_transcript_fetched_at`,
    `commercial_script_updated_at`, `created_at`. String
    compare is correct for ISO-8601.
  - new `campaignOutputSummary(campaign)` helper. Returns an
    ordered array of short labels (`Reels`, `Dialogue
    stitched`, `Dialogue Reels`, `Voiced`, `Storyboard`,
    `Voiced Storyboard`, `Spokesperson cut`, `Grounded`, `N
    transcripts`). Caller slices to 5 visible with overflow
    chip.
  - Appearances tab content replaced. Each linked campaign
    renders one row with: `campaignLabel` (truncated 22
    chars), mode pill via `inferCampaignMode`,
    `formatKnowledgeTime(campaignLastTouched(c))` on the
    right, then a 5-chip output summary (truncated `+N` for
    overflow). Footer of each row carries a disabled
    `Open in gallery →` button (tooltip notes lane routing
    lands in PR BJ–BL).
  - Empty state when `linkedCampaigns.length === 0`: `No
    appearances yet.` + setup hint.
  - Upper-right chip echoes count: `none yet` /
    `{N} campaigns`.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 test untouched.
  - the v2 test's Appearances assertion replaced with a
    disjunction. When ≥1 row, asserts the mode pill text
    matches `Cinematic|Spokesperson Ad|Dialogue Scene|
    Storyboard|Realtime|Mixed|Draft` and the disabled
    `Open in gallery` affordance is present. Empty branch
    asserts the friendly copy.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BG; route
  count narrative confirms unchanged at 68;
  SpokespersonCard.jsx row updated with Appearances helpers
  + testids.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged; the
  v2 surface is gated until PR BN flips the default.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation section
  expands with PR BG; build sizes / route count.
- `docs/handoffs/SESSION_038_SPOKESPERSON_APPEARANCES_TAB.md` —
  this file.

## Appearances tab behaviour

```
Per linked campaign:
  ┌─────────────────────────────────────────────────────────┐
  │ Business · Product       [Mode pill]      <relative time> │
  │ [Reels] [Voiced] [Grounded] [3 transcripts] [+1]          │
  │                                       [Open in gallery →] │
  └─────────────────────────────────────────────────────────┘
```

- **Campaign label**: PR BF's `campaignLabel(c)` — `Business ·
  Product` truncated 28 chars per side, with single-side and
  `Untitled campaign · <prefix>` fallbacks.
- **Mode pill**: deterministic inference (see below); one of
  seven labels with a colour-coded background.
- **Last-touched**: latest of 4 timestamps via
  `campaignLastTouched`; rendered with PR BD's
  `formatHistoryTimestamp` from uiHelpers.js.
- **Output chips**: up to 5 short labels from
  `campaignOutputSummary`; `+N` overflow chip when more
  exist.
- **Open in gallery →**: disabled `<button>` with tooltip
  `Click-through lands with lane routing in PR BJ–BL.`. No
  click handler — the affordance is present so the operator
  expects it; PR BJ–BL will wire it.

## Mode inference behaviour

Deterministic, single-pass. Order of precedence locks the
brief and the operator's mental model:

```
1. Check each output flag:
   dialogue       = bool(dialogue_scene_video_url) ||
                    bool(dialogue_scene_reels_url) ||
                    (dialogue_lines.length > 0)
   spokesperson   = bool(host_video_url) ||
                    bool(spokesperson_reels_url)
   storyboard     = bool(storyboard_video_url) ||
                    bool(storyboard_voiced_url) ||
                    (storyboard_shots.length > 0)
   cinematic      = bool(cached_video_url) ||
                    bool(voiced_commercial_url)
   realtime       = bool(runway_conversation_id) ||
                    (realtime_transcript_history.length > 0)

2. Count strong hits (dialogue, spokesperson, storyboard, cinematic):
   ≥ 2 → "Mixed"
   else use the first true strong flag in order:
     dialogue → "Dialogue Scene"
     spokesperson → "Spokesperson Ad"
     storyboard → "Storyboard"
     cinematic → "Cinematic"

3. If no strong hits but realtime is set → "Realtime"
4. Otherwise → "Draft"
```

Realtime is intentionally NOT counted as a strong hit because
every saved campaign has a transcript history surface; using
realtime as a strong axis would label every saved campaign
"Mixed". Keeping realtime as the soft fallback means a
campaign that only ever ran a realtime conversation (no
visual outputs) reads as "Realtime" rather than getting lost
under "Draft".

## Click-through decision

The brief allowed two paths:
1. Wire navigation to the legacy CampaignGallery if there's a
   safe way to do so without hacking global state.
2. Render a disabled affordance with a tooltip explaining when
   click-through lands.

We took path 2. The legacy CampaignGallery exposes
`setNewestSavedId` to highlight a card, but that's threaded
through App.jsx state and would require lifting a callback up
through SpokespersonStudio → SpokespersonCard. That's
non-trivial wiring for V1 and would need to be re-done when
PR BJ–BL ships lane-first saved cards. Better to leave the
disabled affordance in place so the surface is visible (sets
expectations) without committing to a partial wiring that gets
torn out next slice.

The tooltip is explicit: `Click-through lands with lane
routing in PR BJ–BL.` Anyone reading the slice notes will
understand.

## Empty-state behaviour

When `linkedCampaigns.length === 0`:

```
[ Appearances ]                            none yet

No appearances yet.
Create a campaign with this spokesperson to populate
appearances. Inferred mode + last-touched + available
outputs will surface here automatically.
```

Mirrors the Knowledge tab's empty-state shape from PR BF for
visual consistency.

## Verification (this session)

Servers were killed and restarted in mock mode before testing.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 350.15 KB initial / 97.06 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `2 passed (23.2 s)` — v1 22.0 s, v2 517 ms |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now exercises both Appearances branches via the
disjunction. Fixture state:
- `Piper Voltage` → linked to FocusNet (has cached_video_url
  via the smoke campaign create flow) → mode pill renders
  e.g. `Mixed` or `Cinematic` depending on what outputs the
  smoke generated.
- `Sir Landsloplot` (no linked campaigns) → empty branch.

The smoke only inspects `firstCard` so it runs against
whichever spokesperson sits at index 0; the disjunction
covers both cases.

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200 (via localhost)
```

After implementation, smoke + build ran against fresh
processes. Servers are stopped at end of session.

## Limitations / follow-ups

- **No click-through.** "Open in gallery" is intentionally
  disabled until PR BJ–BL ships lane-first saved cards. An
  operator who wants to inspect a campaign from the v2
  surface today flips back to v1 via the footer toggle.
- **Mode inference is heuristic.** Two strong outputs collapse
  to "Mixed" — useful but lossy. The inference is deterministic
  but doesn't capture intent; PR BH's mode-first creation modal
  will write `metadata.mode` explicitly so future campaigns
  carry their primary lane as a first-class field.
- **Output summary order is fixed.** No way to highlight
  "freshest output first" — Reels always reads first if
  present. Acceptable for V1; the chip vocabulary is small
  enough that the operator can scan in O(5).
- **Last-touched ignores some timestamps.** Storyboard /
  dialogue plan timestamps aren't part of the
  `campaignLastTouched` calculation. Acceptable: the storyboard
  / dialogue stitch operations bump `commercial_script_updated_at`
  in many flows, and the realtime + transcript timestamps
  cover most "recent activity" cases.
- **Client-side filter is O(campaigns).** Inherits the same
  scaling note from PR BF — fine at fixture scale (~13
  campaigns), needs a backend filter route for tenants at
  scale.
- **No drift-status surface.** The Appearances row doesn't
  surface the spokesperson's drift state per-campaign even
  though that data exists. Identity tab handles drift
  per-spokesperson; bringing it into Appearances would feel
  like duplication.

## Recommended next slice

**PR BH — Mode-first Campaign creation modal.**

This is the first slice that visibly diverges from v1 beyond
Stage 1. Per the SESSION_035 design plan:

- Replace the v2 path's "+ New Campaign" affordance with a
  3-card modal launched from SpokespersonStudio (or App.jsx
  in v2 mode). Cards: 🎬 Cinematic Ad / 🎙️ Spokesperson Ad
  / 🎭 Dialogue Scene.
- After picking, the existing 4-stage creation flow runs
  underneath but the saved card opens directly to the
  lane-specific surface (PR BI–BK). Mode choice is persisted
  to `Campaign.metadata.mode` (no backend schema change —
  uses the existing free-form `metadata: dict` field).
- For PR BH itself, lane routing is still placeholder; the
  modal just writes `metadata.mode` and dispatches to the
  legacy creation flow. The v2-native lane surfaces ship in
  PR BI / BJ / BK.
- Smoke: extend v2 case to assert the modal opens, three
  mode cards render, and clicking one routes correctly.

Estimated PR BH size: ~220 LOC across one new component file
(`CampaignModeModal.jsx`) + ~20 LOC of edits to App.jsx /
SpokespersonStudio.jsx. No backend changes. Default v1 smoke
unaffected.
