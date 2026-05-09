# SESSION 035 — UX v2 Flag + Shared Helpers Extraction (PR BD)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BD patch in flight on top of `9eae15f`
`feat: per-campaign transcript history audit trail`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_021 (PR AN — Custom Voice Cloning),
SESSION_033 (PR BB — Voice Repair History Audit Trail), and
SESSION_034 (PR BC — Per-Campaign Transcript History).

## Goal

The platform is **persistent AI spokesperson infrastructure**, but
the UI is built around Campaign as the primary unit. The
spokesperson-first redesign (planned across PR BD → PR BO) flips
this: Spokesperson Studio becomes the top-level surface, Campaign
creation becomes mode-first, and a unified Session Log replaces
three separate audit-trail disclosures.

PR BD is the smallest possible foundation slice. It does **not**
build SpokespersonStudio. It does **not** restructure the
gallery. It opens the door — adds a feature flag, lifts the
audit-row helpers into a shared module, and surfaces a tiny
footer toggle so the operator can preview the upcoming v2
surfaces (currently empty) without affecting the default load.

Hard scope locks (carried forward from the brief):
- Foundation only — no SpokespersonStudio.
- No backend route changes.
- Default UX behaviour unchanged.
- No legacy code deleted.

## Endpoint inventory

PR BD adds **no new routes**. Route count stays at **68**.
Frontend-only.

## What changed

### New files

- **`frontend/src/uxFlag.js`** — UX v2 feature flag module.
  - `getUxMode()` resolves the active mode with precedence:
    1. URL search param `?ux=v2` / `?ux=v1` (also persists to
       localStorage on first read).
    2. `localStorage.adspark.ux === "v2"`.
    3. Default `"v1"`.
  - `isUxV2()` — convenience predicate.
  - `setUxMode(mode)` — persist a new mode (rejects invalid
    inputs silently so the legacy mode stays the safe baseline).
  - Exported constants: `UX_MODES = { V1, V2 }` (frozen),
    `UX_STORAGE_KEY = "adspark.ux"`.
  - SSR-safe — guards `window` + `localStorage` for tests / mock
    contexts.

- **`frontend/src/uiHelpers.js`** — shared audit-row helpers.
  Lifted verbatim from `CharacterCard.jsx` (originally PR BB):
  - `formatHistoryTimestamp(iso, nowMs)` — bucket-formatter
    (just-now / Nm / Nh / Nd ago).
  - `HISTORY_ACTION_PILLS` — frozen action→Tailwind class map
    (clone→emerald, apply→indigo, repair→amber,
    refresh/verify→zinc).
  - `historyStatusClass(status)` — emerald (success) / soft-
    emerald (mock) / rose (failure) / zinc (unknown).
  - `historyDriftClass(drift)` — emerald (match) / rose (drift)
    / zinc (unknown).
  - Behaviour identical to the originals; pure relocation.

### Modified files

- **`frontend/src/components/CharacterCard.jsx`** — removes the
  four local helper definitions; imports them from
  `../uiHelpers.js` instead. All call sites continue to resolve
  via the new imports without behaviour change.

- **`frontend/src/App.jsx`** — imports `getUxMode`, `setUxMode`,
  `UX_MODES` from `./uxFlag.js`; renders a new `<UxModeToggle />`
  inside the existing footer. The toggle:
  - reads `getUxMode()` at render time
  - shows `"Try preview UX →"` (v1, default) or
    `"Use classic UX"` (v2)
  - on click: `setUxMode(target)`, strips `?ux=…` from
    `window.location` via `history.replaceState`, then full
    reload so v2-gated components remount with the fresh flag

- **`frontend/tests/adspark-smoke.spec.js`** — minimal
  assertion that the toggle is visible, default
  `data-ux-mode="v1"`, copy reads `"Try preview UX"`. Toggle
  is **not** clicked during the smoke so the rest of the run
  stays on the legacy path.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BD; route
  count narrative confirms unchanged at 68; new rows for
  `src/uxFlag.js` and `src/uiHelpers.js`; CharacterCard.jsx
  + App.jsx rows note the import + toggle additions.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged. PR BD
  is invisible to default operators; the v2 surfaces it
  unlocks will be documented as they ship (PR BE+).
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — new "UX redesign foundation"
  section + build sizes / route count.
- `docs/handoffs/SESSION_035_UX_V2_FLAG.md` — this file.

## UX flag behaviour

```
Resolution order (highest precedence first):
  ?ux=v2 in URL → mode=v2; localStorage.adspark.ux := "v2"
  ?ux=v1 in URL → mode=v1; localStorage.adspark.ux := "v1"
  ?ux=banana   → invalid; ignored; falls back to storage / default
  localStorage.adspark.ux === "v2" → mode=v2
  localStorage.adspark.ux === "v1" → mode=v1
  localStorage value invalid       → mode=v1 (safe baseline)
  no URL, no storage               → mode=v1 (safe baseline)

setUxMode(mode):
  "v1" or "v2" → writes to localStorage
  any other    → no-op (legacy mode wins by default)

isUxV2():
  thin wrapper around getUxMode() === "v2"
```

8/8 scenarios verified via a Node probe at `/tmp/_bd_uxflag_probe.mjs`.

## Helper extraction summary

| Helper | Old location | New location | Behaviour |
|---|---|---|---|
| `formatHistoryTimestamp(iso, nowMs)` | `CharacterCard.jsx` (exported) | `uiHelpers.js` | identical |
| `HISTORY_ACTION_PILLS` | `CharacterCard.jsx` (private) | `uiHelpers.js` (`Object.freeze`) | identical |
| `historyStatusClass(status)` | `CharacterCard.jsx` (private) | `uiHelpers.js` | identical |
| `historyDriftClass(drift)` | `CharacterCard.jsx` (private) | `uiHelpers.js` | identical |

Grep confirmed there were no external consumers of the
previously-exported `formatHistoryTimestamp` from
CharacterCard.jsx. The four helpers are now imported by
CharacterCard.jsx; future v2 surfaces (PR BE+) can import the
same vocabulary without re-defining the swatches.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` |
| Vite dev server | HTTP 200 (via `localhost:5173`) |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 334.75 KB initial / 93.84 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (20.9 s)` |
| `uxFlag.js` Node probe | 8/8 precedence scenarios pass |
| Hygiene scan | empty |
| Drift guard | `context-kit anchors look recent.` |

The 8-scenario flag probe (`/tmp/_bd_uxflag_probe.mjs`) covered:

```
✓ default → v1 when nothing is set
✓ ?ux=v2 wins and persists to storage
✓ ?ux=v1 persists v1 + clears any prior v2
✓ localStorage v2 (no URL param) → v2
✓ invalid storage value → falls back to v1
✓ invalid URL value → ignored, falls back to storage / default
✓ setUxMode("v2") writes; subsequent getUxMode reads it
✓ setUxMode invalid is a no-op
```

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200 (via localhost)
```

After implementation, smoke + build + Node flag probe all ran
against fresh processes. Servers are stopped at end of session.

## Limitations / follow-ups

- **No v2 surface exists yet.** Toggling the flag flips the
  `data-ux-mode` attribute on the toggle button but otherwise
  loads the same legacy UX. PR BE introduces the first v2-gated
  component (SpokespersonStudio scaffold).
- **Reload-on-toggle.** Future v2 components are gated at
  mount, so a hot re-render isn't enough. The toggle does a
  full `window.location.reload()` after persisting the flag.
  Acceptable for V1; a hot-swappable React Context could
  replace this if reloads become annoying.
- **URL param is single-use-ish.** `?ux=v2` deep-links work,
  but the toggle strips the param on click so a follow-up
  reload reads from localStorage instead. This is intentional
  — keeps the URL clean once the operator has chosen.
- **No legacy escape via URL.** `?ux=v1` works today; the
  toggle prefers writing localStorage. If a deployed cookie /
  session is corrupted the user can still recover with
  `?ux=v1`.
- **Smoke does not click the toggle.** Flipping it would
  reload the page mid-test and require a second pass through
  every assertion. Out of scope for V1; PR BE+ smokes will
  handle their own gated assertions.

## Recommended next slice

**PR BE — SpokespersonStudio scaffold (Identity-only)**.

Per the redesign plan (`docs/handoffs/SESSION_035_UX_V2_FLAG.md`
plan section, mirrored from the design conversation):

- New `frontend/src/components/SpokespersonStudio.jsx` rendering
  a Spokesperson Library grid using the same `GET /api/characters`
  data path.
- New `frontend/src/components/SpokespersonCard.jsx` with
  Identity / Knowledge / Appearances tabs (only Identity wired
  in PR BE; the other two render `Coming soon` placeholders).
- Identity tab IS today's CharacterCard voice section (clone,
  recording, mic level, voice history disclosure, freshness,
  drift, repair, refresh) — composed from the new shared
  helpers in `uiHelpers.js`.
- `App.jsx` mounts SpokespersonStudio instead of CharacterStudio
  when `isUxV2()` returns true. Legacy mount path untouched.
- Smoke: when the flag is off (default), legacy fixtures render
  via CharacterStudio. Add a separate assertion block (or a
  second test case) gated on `?ux=v2` if needed.

Other tier-1 candidates that would fit between PR BE and PR BF:

1. **Storybook component sandbox** — render SpokespersonCard
   in isolation without the full app. Out of scope for this
   redesign track; small future slice if the v2 components
   grow complex.
2. **Per-spokesperson backend filter route** — currently the
   Knowledge / Appearances tabs (PR BF / BG) will iterate
   campaigns client-side. A `GET /api/characters/{id}/campaigns`
   route would scale better for tenants with hundreds of
   campaigns. Defer to PR BF if the client-side filter feels
   slow.

Estimated PR BE size: ~250 LOC across 3 new files + ~15 LOC of
edits to App.jsx. Smoke unaffected on the default path.
