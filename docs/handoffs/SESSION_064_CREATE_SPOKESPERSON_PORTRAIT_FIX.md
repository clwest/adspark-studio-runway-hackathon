# SESSION 064 — Fix Create Spokesperson Portrait Generation (PR CJ)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CJ patch in flight on top of `e10ecb5`
`docs: PR CI demo spokesperson portraits — real Runway gen
log`; commit + push pending after this handoff lands)

## Naming note

The user briefed this slice as **"PR CI — Fix Create
Spokesperson Portrait Generation"**, but the previous
**PR CI — Demo Spokesperson Portrait Generation Pass**
already shipped at commit `e10ecb5`. To preserve a clean
git history this slice ships as **PR CJ — Fix Create
Spokesperson Portrait Generation**. Handoff filename is
`SESSION_064_CREATE_SPOKESPERSON_PORTRAIT_FIX.md`
(SESSION_063 was the previous portrait-gen handoff). The
brief's intent is fully implemented; only the labels
differ.

## Root cause

`<CreateSpokespersonModal>` (introduced in PR CB) wired up
two sequential API calls inside a single submit handler:

```js
const created = await api.createCharacter({...})
let next = created
try {
  next = await api.generateCharacterPortrait(created.id, {})
} catch (portraitErr) {
  setError(friendlyError(portraitErr, 'Portrait generation failed'))
}
setPhase('done')
await onCreated?.(next)  // ← bug: always runs, even after catch
```

When `api.generateCharacterPortrait` threw a 502 (which it
does whenever Runway's image task returns
`portrait task FAILED: An unexpected error occurred.` —
the exact transient error pattern that hit Rex Roadside's
generation in PR CI), the catch block set an `error` state
**but did not stop execution**. The handler fell through to
`setPhase('done')` and `await onCreated?.(next)`, which
called the parent's `handleSpokespersonCreated`. That parent
function added the character to the local list and **closed
the modal** via `setCreateOpen(false)`.

Result from the operator's POV: clicked Create → modal
flashed an error for ~1 frame → modal closed → tile
appeared in library with a blank portrait slot → no
explanation, no retry path other than digging into the
tile's embedded CharacterCard or the workspace Identity
tab.

This was masked in PR CB's smoke because mock backend
always succeeds for portrait gen. The bug only manifests
against real Runway when the image task fails upstream.

## Goal

Stop swallowing the failure. When portrait generation
fails:

1. Keep the modal open.
2. Show the error inline.
3. Offer a **Retry portrait** button that re-fires
   `api.generateCharacterPortrait` against the
   already-created character (no re-create).
4. Offer a **Save without portrait** button that closes
   the modal + lets the tile appear in the library with
   a blank portrait. Operator can render later from the
   tile's existing Generate Portrait affordance or the
   workspace Identity tab.
5. The backdrop click + ESC-style escape paths in this
   phase route to **Save without portrait** so the
   already-created character record is never orphaned in
   the backend.

## Endpoint inventory

PR CJ adds **no new routes**. Backend route count remains
**70**. Reuses the same `POST /api/characters` +
`POST /api/characters/{id}/generate-portrait` routes.

## What changed

### Modified files

- **`frontend/src/components/CreateSpokespersonModal.jsx`** —
  - New state slot `createdCharacter` — pinned to the
    successful `createCharacter` response so Retry / Skip
    can target the existing record without re-creating.
    Cleared on every fresh modal open.
  - New phase value: `portrait-failed`. Triggered when
    `api.generateCharacterPortrait` throws inside
    `handleSubmit`. Replaces the previous fall-through
    behaviour.
  - New helper `tryGeneratePortrait(characterId)` — called
    by both the initial submit path AND the retry button.
    On success, fires `onCreated` and closes the modal.
    On failure, flips phase back to `portrait-failed` with
    the new error.
  - New `handleRetryPortrait` button handler. Re-fires
    portrait generation on `createdCharacter.id`.
    Disabled when busy.
  - New `handleSkipPortrait` button handler. Calls
    `onCreated(createdCharacter)` so the parent prepends
    the un-portrait record to its local slice + closes
    the modal.
  - Backdrop-click handler in `portrait-failed` phase
    routes to `handleSkipPortrait` instead of `onClose`,
    so even an absent-minded backdrop click preserves the
    record.
  - New conditional footer block: when
    `phase === 'portrait-failed'`, render the
    `create-spokesperson-portrait-failed` testid panel
    (rose explainer copy + the two new buttons:
    `create-spokesperson-retry-portrait` and
    `create-spokesperson-skip-portrait`). The original
    Cancel + Submit buttons hide in this phase. When
    phase is anything else, the original footer renders
    unchanged.
  - The original status copy block (`busy && …`)
    unchanged — `creating spokesperson…` /
    `auto-generating portrait via Runway image…` still
    surfaces during the active calls.

### What did NOT change

- **Backend.** No routes touched. The portrait route's
  502 error shape (`{detail: "portrait task FAILED…"}`)
  was already correct; the frontend just needed to react
  to it instead of swallowing it.
- **Legacy CharacterStudio create flow at `/legacy`.**
  CharacterStudio.jsx has the same parallel pattern but
  it lives inside an inline form (not a modal), so the
  error message stays visible in the existing flow. No
  changes needed there.
- **Existing CharacterCard `Generate Portrait` button.**
  Still works as the canonical retry-after-the-fact
  path from any tile, in either the library or the
  workspace Identity tab.
- **Other modal callers.** The modal is only used by
  `<SpokespersonStudio>`'s `+ Create Spokesperson` CTA.
  Its `handleSpokespersonCreated` callback is unchanged
  — works identically whether the character has a
  portrait or not.

## Validation

Two route-intercept Playwright tests written + run + then
deleted (exploratory; not part of the canonical smoke):

| Test | Setup | Assertions |
|---|---|---|
| `portrait-failed phase stays in modal with retry + skip` | Forces every `POST /api/characters/*/generate-portrait` to return 502 with `detail: "portrait task FAILED: forced for QA"` | Modal stays open after submit · `create-spokesperson-portrait-failed` panel visible · error contains the forced 502 string · `create-spokesperson-retry-portrait` + `create-spokesperson-skip-portrait` both visible · original `create-spokesperson-cancel` / `-submit` testids both `toHaveCount(0)` · clicking `Save without portrait` closes the modal + the new tile mounts as the first card with the test name · cleanup deletes the test character via `DELETE /api/characters/{id}` |
| `successful portrait closes modal + tile renders with portrait` | No interception — mock backend's portrait route always succeeds | Modal closes after submit · `create-spokesperson-portrait-failed` panel never mounts · first tile contains the test name + has a visible `<img>` · cleanup deletes the test character |

Both passed against the mock backend. **No real Runway
credits were consumed.** The route-intercept simulates the
exact 502 shape Runway returns when the upstream task
fails — the same error the four PR CI portrait calls
encountered for Rex Roadside.

The exploratory specs were deleted from `tests/` after
running so they don't pollute the canonical smoke (which
remains the 3-test `adspark-smoke.spec.js` set). The
canonical smoke ran clean afterwards: `3 passed (26.8 s)`.

### Was a real portrait generation needed?

**No.** The brief allowed one real call only "if needed
to validate the fix." Since the bug is a React state-
machine failure (silently swallowing a thrown error),
the route-intercept test reproduces the failure mode
deterministically without needing real Runway weather.
A real-mode validation would only confirm what the
intercept already confirmed — at the cost of a Runway
credit and a coin flip on whether Runway actually
errored that day.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (unchanged) |
| `vite build` | 466.40 KB initial / 127.73 KB gzip + 561.97 KB lazy chunk (+1.60 KB initial / +0.19 KB gzip vs PR CF — new state slot + retry helper + failure-footer markup) |
| Canonical Playwright smoke | `3 passed (26.8 s)` — Test 1 (@ /legacy) 24.2 s, Test 2 (@ /) 1.4 s, Test 3 (top-bar round-trip) 562 ms |
| Failure-path Playwright (exploratory) | `1 passed` — modal stays open with retry + skip after forced 502 |
| Success-path Playwright (exploratory) | `1 passed` — modal closes cleanly with portrait when Runway succeeds |
| Hygiene scan | empty (no PNG / video committed) |
| Drift guard | `context-kit anchors look recent.` |

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path (will burn 1 Runway credit on a real call):
1. http://localhost:5173 → click `+ Create Spokesperson`.
2. Type a name (e.g. `QA Test`), pick a template + voice
   preset, click **Create Spokesperson**.
3. Modal shows `creating spokesperson…` then
   `auto-generating portrait via Runway image…`.
4. Outcome A — **portrait succeeds**: modal closes; tile
   appears at the top of the grid with the new portrait.
   Same UX as before the bug.
5. Outcome B — **portrait fails** (Runway 502): modal
   stays open with a clear rose-tinted "Portrait didn't
   render." panel naming the spokesperson. Two buttons:
   - **Retry portrait** — re-fires `generate-portrait`
     against the same character id. If Runway has
     stabilised, the modal closes + the tile appears
     with a portrait. If Runway fails again, the panel
     re-renders with the new error.
   - **Save without portrait** — closes the modal; tile
     appears in the library with a blank portrait. The
     character record is preserved. Operator can later
     click `Generate Portrait` from the tile's
     Identity tab or the workspace Identity tab to
     render the face once Runway recovers.
6. Backdrop click + (no ESC handler today) → routes to
   Save without portrait when in failure state, so the
   record is never orphaned.

## Limitations / follow-ups

- **No automatic retry.** After PR CI's Rex Roadside
  experience (3 attempts, all failed) it's clear that
  some Runway transient errors persist longer than a
  single human retry. A future polish slice could add
  exponential-backoff auto-retry inside
  `tryGeneratePortrait`, but PR CJ stays scoped to the
  manual-retry UX per the bugfix-only brief.
- **Modal stays open indefinitely until user acts.**
  No auto-dismiss timer. Operator who walks away with
  the modal open will find it the same on return —
  acceptable for a destructive-confirmation surface.
- **The orphan-on-X-button concern is moot today.**
  The modal has no X close button (only Cancel + the
  backdrop). The backdrop in `portrait-failed` routes
  to Save without portrait. If a future redesign adds
  an X button, the same routing rule applies: in
  `portrait-failed`, X = Save without portrait, not
  plain dismiss.
- **No keyboard shortcut.** Retry / Save without
  portrait both reachable via Tab; no hotkey
  bindings. Acceptable for a low-frequency error
  surface.
- **`/legacy` Create Character form** still has the
  same fallthrough pattern (silently logs portrait
  errors via `setErrMsg`). Lives in an inline form,
  not a modal, so the error stays visible — but the
  retry path is "fill the form again" since the
  legacy form clears on submit. Out of scope for
  PR CJ; can be a future tidy.

## Recommended next slice

Two options, same as before PR CJ — neither blocked by
this fix:

1. **PR CK — Library tile simplification** (SESSION 059
   Fix #2): strip each `<SpokespersonCard>` tile down to
   portrait + name + persona pill + summary chips +
   `Open Spokesperson →` link. Removes the most-flagged
   duplication from QA. ~half-day, frontend-only.
2. **PR CK' — Real Outputs tab gallery** (SESSION 059
   Fix #3): replace the workspace's Outputs
   `<TabComingSoon>` placeholder with a unified gallery
   surfacing every cached output URL across linked
   campaigns. ~1 day.

Either is the right next move post-PR CJ. Option 1 is
the quickest visual win; option 2 makes the demo
narrative pop the moment outputs land.
