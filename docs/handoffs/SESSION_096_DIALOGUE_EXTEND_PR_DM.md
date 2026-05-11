# SESSION 096 — PR DM Dialogue Scene Extend

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `b56c049` (`feat: expand dialogue scenes to
six-line multi-character skits (PR DL)`). PR DM patch in flight on
top; commit + push pending operator approval after this handoff
lands.

**Why this slice ran:** Mid-demo, the operator went back to a
Donny Sparks dialogue scene that had been planned **before** PR DL
bumped the default to 6 — and discovered there was no way to grow
it to 6 without losing the existing 3 lines. The PR DL "Reset
scene lines" path was the only option, and it wipes the existing
`dialogue_lines` array entirely (text, speaker, status, *and* the
references to already-rendered MP4s). PR DM closes that gap with
an opt-in extend mode: additive top-up that preserves every
existing line.

## What changed

### Backend — `dialogue_service.extend_lines`

New function in `backend/app/services/dialogue_service.py`. Takes a
`Campaign` record + `Settings`, returns
`(full_lines_list, error)`. Behaviour:

- **Already at default** (`len(existing) >= _DEFAULT_LINE_COUNT`):
  no-op. Returns the existing list unchanged.
- **Empty scene** (`len(existing) == 0`): devolves to
  `plan_lines` so callers don't have to special-case "first plan".
- **Short scene** (1–5 lines): preserves every existing entry
  byte-for-byte (`text`, `character_id`, `character_name`,
  `avatar_id`, `status`, `task_id`, `video_url`, `cache_filename`,
  `error`, `mock_mode`) and appends new idle lines at line-N+1
  through line-6 with default fallback text + auto-assigned
  speakers.

**Cast assembly for the new lines**:

1. Walk existing lines' `character_id`s in order. For each unique
   id, look up the live ready-character record and add to cast. If
   the saved character is no longer in the ready pool but the line
   carries `character_name` + `avatar_id`, fall back to the saved
   data (tolerates a character that lost its avatar after the
   scene was planned).
2. If cast has < 3 entries, supplement with the campaign-attached
   character + other ready characters not already in cast.
3. Cap cast at 3 distinct entries.
4. If cast ends up empty (no usable speakers anywhere), return a
   409-shaped error.

Speaker rotation continues the cycle from where existing lines
left off:

```python
for idx in range(len(existing), _DEFAULT_LINE_COUNT):
    speaker = cast[idx % len(cast)]
```

So line 4 picks `cast[3 % len(cast)]` etc. With a 3-line existing
scene that already exercised A/B/C, the new lines 4–6 continue
A/B/C in order.

### Backend — `DialoguePlanBody` + route

New Pydantic body class:

```python
class DialoguePlanBody(BaseModel):
    mode: Literal["reset", "extend"] = "reset"
```

`post_dialogue_plan` route extended to accept `body:
Optional[DialoguePlanBody] = None`. Branches on `mode`:

- `mode == "reset"` (default — no body / explicit reset): existing
  PR AF / PR DL destructive behaviour. Calls `plan_lines`,
  overwrites `dialogue_lines`.
- `mode == "extend"`: calls `extend_lines`, writes the combined
  list (preserved + new) back via the same
  `store.update_dialogue_plan` helper.

`typing.Literal` added to the imports (only `Optional` was there).

Logger message gained a `mode=...` field so the audit trail
distinguishes reset vs extend calls.

### Frontend — Add-more-lines button

`frontend/src/components/lanes/DialogueLane.jsx`:

- New `DEFAULT_LINE_COUNT = 6` constant in the lane (comment
  pinning to `dialogue_service._DEFAULT_LINE_COUNT`).
- New state: `extendBusy`, `extendError`.
- New gating: `canExtend = onPlanDialogue && hasCampaign &&
  lineCount > 0 && linesToAdd > 0 && !planBusy && !extendBusy`.
- New handler `handleExtendLines` calls `onPlanDialogue(id,
  'extend')`, sets busy/error state.
- New button rendered **only when `canExtend` is true** (so it's
  invisible on empty scenes — the operator uses "Create Scene
  Lines" for that — and on already-full scenes). Label is dynamic:
  "Add 3 more lines" / "Add 2 more lines" / "Add 1 more line".
  Amber ring/background to differentiate from the destructive
  blue/sky "Reset scene lines".
- testid `dialogue-lane-extend` + `data-target-count` +
  `data-busy` attributes for Playwright addressability.
- Reset button title rewrote: *"Seed a fresh 6-line scene from the
  saved brief. No Runway credits. Destructive — replaces any
  existing lines + their rendered MP4 references."*
- Bottom status row gains `Extend: <error>` slot and adds
  `extendBusy` to the busy-line concat.

### Frontend — API + lanes wiring

- `api.js` — `planDialogue(campaignId, mode='reset')` defaults to
  reset for backward compat; sends `{ mode }` in the body.
- `CampaignLanes.jsx` — `handlePlanDialogue(campaignId,
  mode='reset')` threads mode through to the API call.

### Backend tests — three new pytests

1. **`test_dialogue_plan_extend_tops_up_existing`** — plan a 6-
   line scene, then call plan with `mode="extend"`, assert
   identical ids in identical order. Pins the no-op idempotent
   behaviour.

2. **`test_dialogue_plan_extend_preserves_existing_3_line_scene`** —
   reproduces the operator's exact situation: plan, customize the
   first 3 lines' text via `/dialogue/line/{id}`, then directly
   manipulate the saved campaign via `CampaignStore` to trim
   `dialogue_lines` to 3 (simulating a pre-PR-DL state). Mark
   line-1 as rendered (`status="ok"` + `video_url`). Call
   `extend_lines` (service level) and assert:

   - All 3 originals preserved byte-for-byte (id, text,
     character_id, status, video_url).
   - 3 new lines added at line-4..line-6, all idle, all with
     default fallback text, all with auto-assigned cast.
   - Total length == `_DEFAULT_LINE_COUNT`.

3. **`test_dialogue_plan_reset_still_destructive`** — plan, save
   a custom text on line-1, then call plan with explicit
   `mode="reset"` and assert the override is wiped. Also call with
   no body at all and assert the same behaviour (backward compat
   with PR AF / PR DL callers).

## Files changed

```
 backend/app/routers/campaigns.py                    | +35 (DialoguePlanBody + branched plan route + Literal import)
 backend/app/services/dialogue_service.py            | +85 (new extend_lines function)
 backend/tests/test_create_avatar_mock.py            | +135 (3 new pytests)
 frontend/src/api.js                                 | +6 / -2 (mode param)
 frontend/src/components/CampaignLanes.jsx           | +2 / -2 (handler signature)
 frontend/src/components/lanes/DialogueLane.jsx      | +75 (extend button + state + status row)
 00-START-NEXT-SESSION.md                            | (head pointer)
 docs/INVENTORY.md                                   | (PR DM block)
 docs/handoffs/SESSION_096_DIALOGUE_EXTEND_PR_DM.md  | new
```

**Untouched:**

- `/legacy` — preserved
- Routes — count still **76** (route signature widened but no new
  endpoints)
- All models, all storage helpers (extend writes through the same
  `update_dialogue_plan` path)
- Realtime broker, character store, OutputsGallery, VideosTab,
  ConversationsHistory
- `plan_lines` itself — unchanged; `extend_lines` is a sibling

## Behaviour cheat sheet

| Operator action | Existing lines | Result |
|---|---|---|
| **Create Scene Lines** (button visible when `lineCount == 0`) | 0 | Seeds 6 fresh idle lines |
| **Add N more lines** (button visible when `0 < lineCount < 6`) | 1–5 | Existing preserved; appends idle lines to reach 6 |
| **Reset scene lines** (button visible when `lineCount > 0`) | any | Destructive — wipes existing, reseeds 6 fresh idle lines |
| No-body `POST /dialogue/plan` (legacy callers) | any | Treated as reset (backward compat) |

## Verification

| Check | Result |
|---|---|
| Backend pytest | **44/44 passed** (~7.4s) — 41 prior + 3 new PR DM |
| Backend route count | **76** (unchanged) |
| `vite build` | **544.70 KB initial / 146.37 KB gzip** (+1.24 KB / +0.39 KB vs PR DL — the extend button + state) |
| Mock smoke (Playwright) | **3/3 passed** (~31s) |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart after smoke | backend up, `runway_mock=false`, vite http=200 |
| Real Runway calls fired | **0** |
| Donny's `d00dc42fe5cb` campaign state | preserved |

## How the operator uses it

1. Open the existing 3-line Donny dialogue scene → Campaigns tab →
   the campaign with the saved scene.
2. Step 3 of the Dialogue lane now shows **two** buttons:
   - "Reset scene lines" (sky blue — destructive) — wipes + reseeds 6 fresh idle lines.
   - "Add 3 more lines" (amber — additive) — preserves the existing
     3 + appends 3 new idle ones to reach 6.
3. Click "Add 3 more lines" → backend `mode="extend"` round trip
   → campaign now has 6 dialogue lines.
4. Lines 1-3 are exactly as the operator left them (text, speaker,
   any rendered MP4 still linked). Lines 4-6 are fresh idle with
   default fallback text + auto-assigned cast.
5. Operator edits 4-6 in the per-line editor + clicks Render Line
   on each → eventually all 6 render `ok` → Stitch Final Scene.

## Remaining risks

1. **Hardcoded `DEFAULT_LINE_COUNT = 6` in the lane.** If the
   backend bumps to 8 in a future PR, the lane's button gating
   stays at 6 until someone updates the constant. The comment
   inline calls this out. Future polish: expose via a tiny
   `/api/config/dialogue` endpoint or piggyback on the existing
   `/health` payload.
2. **Cast assembly tolerates stale character data.** If an
   existing line carries a `character_id` for a character whose
   avatar was deleted (no live `ready` entry), `extend_lines`
   falls back to the saved name + avatar_id from the line itself.
   Generate-line would still 409 against that character, but the
   extend itself succeeds. Acceptable degradation; matches PR DA's
   tolerant speaker-dropdown behaviour.
3. **No "trim scene" affordance.** Operator can grow 3 → 6 but
   not shrink 6 → 4. If they need to drop a line, the current
   workaround is "Reset scene lines" (destructive). Out of scope
   for PR DM.
4. **The PR DM extend button doesn't fire if the operator's
   existing scene is already at 6.** That's intentional — extend
   is idempotent + no-op past the cap, and the button stays
   hidden because there's nothing to add. If a future bump
   widens the default, existing scenes can grow to the new cap.
5. **No Playwright coverage** of the new button. The existing
   smoke doesn't enter the v2 dialogue lane. A future
   `tests/dialogue-extend.spec.js` would exercise the full flow.
6. **`/legacy` still seeds 3-line scenes.** PR DM is v2-only. Per
   the brief's `/legacy` preservation rule.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

The new extend route + amber button are live in the running
backend + vite processes. Operator can now open the existing 3-
line Donny scene and click "Add 3 more lines" to grow it to 6
without losing any rendered MP4s.
