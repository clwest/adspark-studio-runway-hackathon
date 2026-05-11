# SESSION 100 — PR DQ Toast Surface + Form Clear

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `503e8f2` (`feat: seed team interview
personas for submission (PR DP)`). PR DQ patch in flight on top;
commit + push pending operator approval after this handoff lands.

**Why this slice ran:** Operator feedback after PR DO landed —
"can we add a toast or alert when the video is created, and clear
the forms when everything is done running? Right now I get
nothing." Render-completion events were silent: the campaign
slice refreshed and the new Videos card appeared, but if the
operator was looking at another tab or pane they had no signal
the render finished. PR DQ adds a top-right toast surface for all
render completions and collapses the Long Ad textarea panel after
a successful render so the "next action" surface is unobscured.

## What changed

Pure frontend UX polish. Zero backend changes. Three files
modified + one new file.

### 1. `frontend/src/components/Toast.jsx` (new, ~135 LoC)

React Context-based toast surface. Public surface:

```jsx
import { ToastProvider, useToast } from './Toast.jsx'

// Wrap the surface that needs toasts:
<ToastProvider>
  <SpokespersonWorkspace />
</ToastProvider>

// Inside any descendant:
const { push } = useToast()
push('Spokesperson Ad rendered', { kind: 'success' })
push('Render failed — retry from Step 3', { kind: 'error' })
push('Mock-mode placeholder created', { kind: 'info' })
```

**Behaviour:**

- Fixed top-right stack inside the Provider's own DOM subtree (no
  portals needed — the stack is `position: fixed; z-50`).
- Three kinds: `success` (emerald), `error` (rose), `info` (sky).
  Each maps to a colour band + an icon (`✓` / `⚠` / `ⓘ`).
- Auto-dismiss after 4 seconds (success/info) or 6 seconds (error
  — operator needs more time to read).
- Click-to-dismiss on the entire toast.
- Stacking when multiple toasts fire in quick succession; the
  short TTL keeps the stack thin (rarely more than 1-2 visible).
- ARIA: `aria-live="polite"` + `aria-atomic="true"` on the stack
  container so screen readers announce each toast cleanly.
- Timer cleanup on unmount + on click-dismiss so no leaks.

testids: `toast-stack`, `toast-item` (each with `data-kind`).

### 2. `SpokespersonWorkspace.jsx` (Provider mount)

The main `<main>` element gets wrapped in `<ToastProvider>` so
every lane below it can call `useToast()` without prop drilling.
Tiny edit — two lines added.

### 3. `CampaignLanes.jsx` (handler toast integration)

Eight existing success handlers got a `pushToast` call after
their `propagate(...)`:

| Handler | Toast message |
|---|---|
| `handleGenerateSpokespersonAd` | "Spokesperson Ad rendered — see Videos tab." |
| `handleGenerateLongSpokespersonAd` | "Long Spokesperson Ad rendered (N clips · ~Xs) — see Videos tab." |
| `handleBuildSpokespersonReels` | "Captioned Reel exported — see Videos tab." |
| `handleBuildVoicedCinematic` | "Voiced Cinematic Ad built — see Videos tab." |
| `handleStitchStoryboard` | "Storyboard stitched — see Videos tab." |
| `handleStitchDialogue` | "Final Scene stitched — see Videos tab." |
| `handleBuildDialogueReels` | "Captioned Reel exported — see Videos tab." |
| `handleGenerateDialogueLine` | "Line N rendered — see Videos tab." |

**Long Ad toast detail:** pulls `chunk_count` +
`duration_estimate` off the freshly-appended OutputRecord and
announces real numbers ("4 clips · ~64s"). Generic message when
those fields are missing (legacy / pre-PR-DO renders).

**Per-line dialogue toast detail:** strips the `line-` prefix
from the line id so the toast reads "Line 3 rendered" instead of
"Line line-3 rendered".

**Defensive wrap:** `pushToast` is called via a tiny `announce(msg, kind)`
helper that swallows exceptions — if a future caller drops the
ToastProvider, the handler doesn't break on a missing context.
The handler's real work has already succeeded by the time the
toast fires; failing the toast must not mask success.

### 4. `SpokespersonLane.jsx` (Long Ad panel collapse)

`handleGenerateLongAd` success branch adds
`setLongAdExpanded(false)` so the textarea panel collapses after
a successful render. Operator sees the toast + the Render Long Ad
button returns to its collapsed state (the chip flips back to
"click to expand").

**Why this is correct:** The Long Ad script is persisted on
`variant.long_script` via the backend write-through (PR DO). When
the operator clicks Render Long Ad again, the textarea pre-
populates with the same script (the panel-expand `useEffect` syncs
from `selectedVariant.long_script`). So collapsing on success
doesn't lose any state; it just gets the operator out of "editing
mode" and back to "review and pick next action" mode.

## Files changed

```
 frontend/src/components/Toast.jsx                  | new (~135 LoC)
 frontend/src/components/SpokespersonWorkspace.jsx  | +3 / -1 (Provider wrap)
 frontend/src/components/CampaignLanes.jsx          | +35 / -8 (announce() + 8 handler updates)
 frontend/src/components/lanes/SpokespersonLane.jsx | +6 (Long Ad collapse on success)
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR DQ block)
 docs/handoffs/SESSION_100_TOAST_FORM_CLEAR_PR_DQ.md | new
```

**Untouched:**

- All backend code — routes, services, models, storage
- Realtime broker — zero changes
- All other lane handlers in CampaignLanes (handlers that don't
  produce a render — brief edit, variant upsert, plan dialogue,
  save dialogue line, attach character)
- Existing inline error renders in each lane stay — toasts are
  additive, not replacements (inline errors persist next to the
  failing surface)
- `/legacy` — preserved
- Route count still **77**
- Pytest still **53/53** (unchanged)

## Verification

| Check | Result |
|---|---|
| `vite build` | **552.18 KB / 148.33 KB gzip** (+2.55 KB / +0.91 KB vs PR DP baseline from the Toast component + handler updates) |
| Mock smoke (Playwright) | **3/3 passed** (~42s) — existing tests don't probe the toast surface yet but didn't break |
| Backend pytest | **53/53 passed** (unchanged — frontend-only PR) |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | backend up, `runway_mock=false`, vite http=200 |
| Real Runway calls fired | **0** |

## Manual walkthrough

1. **Open Donny → Campaigns → submission campaign** ("Character OS
   Creates Reusable AI Ads").
2. Step 3 → click **Render new Spokesperson Ad**. The button
   shows "Generating Real Spokesperson Ad…" busy state for ~30-60s
   while Runway renders.
3. On completion, a **green toast** appears top-right: *"✓
   Spokesperson Ad rendered — see Videos tab."* Auto-dismisses
   after 4s, or click to dismiss immediately.
4. Switch to the **Videos** tab → new card visible.
5. Back to Step 3 → click **Render Long Ad**. Textarea panel
   expands with the seeded long_script pre-populated.
6. Click the (now rose-red) button to fire the render. ~2-3
   minutes of chunked rendering.
7. On completion: textarea panel **collapses back**, and a green
   toast fires: *"✓ Long Spokesperson Ad rendered (4 clips · ~64s)
   — see Videos tab."*
8. Same pattern for Dialogue Scene per-line renders (each line
   gets its own toast: "✓ Line 1 rendered", "✓ Line 2 rendered",
   etc.), and for Stitch / Reels actions.

## Remaining UX gaps

1. **No error toasts wired yet.** When a render fails (502 from
   Runway, ffmpeg unavailable, etc.) the error still renders
   inline in the lane via the existing per-handler error state.
   Adding error toasts on the rejection path would surface
   failures to the same top-right region. ~10-LoC follow-up if
   the operator wants it.
2. **Toasts don't link directly to the Videos tab.** They include
   the text "— see Videos tab" but clicking the toast just
   dismisses it. A clickable variant could `setActiveTab('outputs')`
   directly. ~20-LoC follow-up.
3. **No Playwright coverage of the toast surface.** Existing smoke
   doesn't enter the lanes deeply enough to trigger renders + see
   toasts. A future smoke could mount the workspace, fire a mock
   render, assert `toast-item[data-kind="success"]` appears.
4. **Toast stacking limit is implicit.** No hard cap on the
   number of toasts. Operator firing 10 renders in quick
   succession would see 10 toasts stack. The 4s TTL keeps the
   stack thin in practice but a `max=5` cap would be defensive.
5. **Long Ad collapse may surprise some operators** who expected
   the textarea to stay open for visual confirmation. The toast
   provides that confirmation, and the script is preserved on the
   variant, so re-expanding restores state. Worth watching during
   actual demo use.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

The new toast surface + Long Ad collapse are live in the running
vite process. Operator's next render of any kind will flash a
green toast top-right when it lands.
