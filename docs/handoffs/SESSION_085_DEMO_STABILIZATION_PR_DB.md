# SESSION 085 — PR DB Demo Stabilization

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR DB patch in flight on top of
`168094a` `feat: wire conversation tab + per-line
dialogue editor (PR DA Demo Pillars)`; commit + push
pending after this handoff lands)

**Why this slice ran:** Submission-video recording is
the next thing to happen. PR DA Demo Pillars wired the
three demo flows; PR DB stabilises them for live
recording. Three targeted additions: a pre-call
checklist for the Conversation tab (mic feedback was
making the avatar pause mid-reply in manual testing), a
one-click hackathon demo preset for the Dialogue Scene
lane (loads the 4 demo lines + auto-assigns speakers),
and a live per-spokesperson readiness panel + a
written `docs/DEMO_CHECKLIST.md`.

## Files changed

```
 frontend/src/components/SpokespersonWorkspace.jsx | 156 ++++++++++++++-
 frontend/src/components/lanes/DialogueLane.jsx    | 222 ++++++++++++++++++++-
 docs/DEMO_CHECKLIST.md                            | (new, ~5 KB)
 00-START-NEXT-SESSION.md                          | (head pointer)
 docs/INVENTORY.md                                 | (PR DB block)
 docs/handoffs/SESSION_085_DEMO_STABILIZATION_PR_DB.md (new)
```

No backend changes. Backend route count unchanged at
**74**. No new endpoints. `/legacy` untouched.
Cinematic lane untouched.

## What was improved for conversation reliability

New `<ConversationPreCallChecklist>` `<details>`
mounted above `<RealtimeSpokesperson>` in the
Conversations tab. Opens by default; collapses on
click for repeat sessions. testid
`spokesperson-workspace-conversations-precall`. Copy:

```
Before you click Start Conversation
- Use headphones if you can — open speakers let the
  avatar's voice loop into your mic.
- Reduce background noise (close noisy tabs, mute
  Slack, kill the fan).
- Click Allow when the browser asks for mic permission.
- Wait for the avatar to finish speaking before you
  reply — overlapping audio is what makes it pause.
- If the avatar stalls or repeats, click End
  Conversation, then Retry Conversation. The 5-minute
  Runway session restarts fresh.
- Sessions auto-end at the countdown timer (Runway's
  hard 5-min cap).

Webcam is off by default. The avatar reads your
selected campaign's brief + saved script as context
— pick a different campaign in the Campaigns tab to
change the conversation focus.
```

The `@runwayml/avatars-react` SDK doesn't expose a
mute toggle programmatically (the `<AvatarCall>`
component owns its own audio routing), so the
operator-side guidance is the cleanest lever. End +
Retry is the recovery path the checklist names
explicitly.

No changes to `RealtimeSpokesperson.jsx` itself —
the wrapper does the heavy lifting and the component
keeps its existing well-tested gated / idle / live /
failed state machine.

## Whether demo dialogue preset/helper was added

**Yes.** New `<DialogueDemoPreset>` subcomponent in
`DialogueLane.jsx` mounts above `<DialogueLinesEditor>`
when `lineCount > 0` (i.e. after the operator clicks
Plan Dialogue Lines).

```
Hackathon demo preset
— populates the three planned lines with the
submission-video copy and auto-assigns Donny /
Riggs / Miles. You still click Generate per line
to render.

[ Load hackathon demo lines ]
```

Behaviour:

- **Eligibility check** — needs all three demo
  speakers (Donny, Riggs, Miles by first-name match
  to tolerate `"Donny Sparks"` → `"Donny"`) in
  `availableCharacters` with a ready Runway avatar
  (`runway_avatar_status in {ready, mock}`). When
  one is missing, the disabled button surfaces
  `Demo preset needs Donny / Riggs / Miles with
  ready avatars. Missing: Riggs, Miles.` so the
  operator knows what to fix.
- **Idempotent** — if the three demo lines are
  already loaded (text + speaker match), the button
  label flips to `Reload hackathon demo lines` and
  re-clicking is a no-op per row (skipped, doesn't
  reset status from `ok` back to `idle`).
- **One-click save** — POSTs `/dialogue/line/{line_id}`
  sequentially for line-1 / line-2 / line-3 with the
  exact demo copy from the brief + the resolved
  speaker `character_id`.
- **No Runway credits** — `/dialogue/line/{line_id}`
  is text-only. Operator still has to click
  `Generate line` per row to render the
  `avatar_videos` clips (rose chrome, ⚠️ burns
  credits per click).
- **Demo lines hard-coded** in the component as
  `HACKATHON_DEMO_LINES` — verbatim from the
  brief, including the punchy phrasing. Trim to 3
  lines (the planner only creates 3 by default).

testids: `dialogue-lane-demo-preset` (the wrapper) +
`dialogue-lane-demo-preset-load` (the button), with
`data-can-fire` and `data-already-loaded` attributes
for smoke / manual QA.

## Final demo checklist status

Two surfaces:

1. **`docs/DEMO_CHECKLIST.md`** (new, ~5 KB). The
   authoritative pre-record checklist covering all
   three pillars + the submission-video recording
   pass. Includes per-spokesperson knowledge prep,
   ad-render walk, conversation walk, dialogue-scene
   walk (calling out the demo preset), and a
   "Known demo-day risks" section at the bottom.

2. **`<DemoReadinessPanel>` UI component** mounted
   above the tab content in `SpokespersonWorkspace.jsx`.
   Live derivation from the loaded character +
   linked-campaigns slice. Six items:
   - Portrait generated
   - Runway avatar ready
   - At least one knowledge source
   - At least one linked campaign
   - A campaign has a saved script
   - At least one rendered Spokesperson Ad

   Collapsed by default. Summary reads
   `🟡 Demo readiness · 4/6 for Donny Sparks` (amber)
   or `✅ Demo readiness · 6/6 for Donny Sparks`
   (emerald) when complete. testid
   `spokesperson-workspace-demo-readiness`. Each
   item has `data-ok="true|false"` for testability.

The UI panel covers items 1–4 of the markdown
checklist for the currently-open spokesperson; the
markdown covers everything (pre-flight, all three
demo pillars, submission-video recording pass,
demo-day risks).

## What was preserved

- `/legacy` reachable via top-bar round-trip
  (smoke Test 3).
- Real-mode startup unchanged (`bash scripts/start-local-real.sh`).
- Output history preservation (PR CY) — no changes.
- Knowledge flow (PR CX) — readiness panel reads
  `character.knowledge_sources` without modification.
- Clean prompt composer (PR CW) — unchanged.
- `gen4_image` without seed reference (PR CV) —
  unchanged.
- Spokesperson Ad lane (PR CY + PR DA selection +
  PR DA Demo Pillars) — unchanged.

## Verification

| Check | Result |
|---|---|
| Backend route count | **74** (unchanged) |
| Backend pytest | **20/20 passed (~0.92 s)** — no test changes |
| `vite build` | 521.13 KB initial / 140.84 KB gzip + 561.97 KB lazy chunk (+7.12 KB / +2.20 KB vs PR DA Demo Pillars — `<ConversationPreCallChecklist>` + `<DemoReadinessPanel>` + `<DialogueDemoPreset>` + the demo-lines preset data). |
| Mock smoke | **3/3 passed (~29.8 s)** — Test 1 26.4 s, Test 2 2.0 s, Test 3 808 ms. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| `/legacy` reachable | smoke Test 3 round-trip. |
| Real Runway calls fired | **0** — preset + checklist are JSON-only / UI-only. |

## Manual test notes for the demo path

1. **Open Donny** → the live readiness panel above
   the tabs surfaces the current item state. Click
   to expand and verify 6/6 before recording.
2. **Conversations tab** → pre-call checklist
   visible above the Start Conversation button.
   Read once, click Allow on mic prompt, exercise
   one short turn, click End.
3. **Campaigns tab** → `+ New Campaign` → Dialogue
   Scene → Save brief → Step 3 Plan → click
   `Load hackathon demo lines` → all three rows
   filled with the demo copy + speakers assigned →
   click `Generate line` per row → click
   `Stitch Dialogue Scene` → Outputs tab.

No `/legacy` round-trips required at any step.

## Remaining risks before recording

- **Real Runway flakes on `gen4_image`** —
  occasional `INTERNAL.BAD_OUTPUT.CODE01`. PR CR's
  auto-retry + the "Try safer prompt" operator
  button mitigates. If a render fails mid-demo: end
  the conversation/render, click Retry / Try safer
  prompt, continue.
- **Mic feedback even with headphones** — the
  pre-call checklist names it; if the avatar still
  stalls, end + retry is the cleanest path.
- **Demo preset matching requires exact-ish names**
  — first-name match (`"Donny"` → `"Donny Sparks"`)
  is tolerated, but a character named
  `"Mr. Donny Bolt"` won't match. Library naming
  should use bare first names where possible.
- **Per-line dialogue rendering still costs ~$0.30
  for the full 3-line scene** — practice the stitch
  once; only re-render lines that failed. The
  `Re-render line` label appears on `ok` rows so
  operators don't accidentally double-bill.
- **Dialogue scene outputs[] gap** — Dialogue
  stitches/reels don't append to `Campaign.outputs`
  yet (PR CY hooks only `host-video` + `spokesperson-
  ad/reels`). Outputs gallery shows them via the
  legacy single-field fallback. Acceptable for the
  demo; flagged for PR DC if we need history.
- **5-minute Runway session cap** — the conversation
  hard-ends. End + restart for a longer pass.
- **Conversation = real WebRTC** — requires the
  browser + the `@runwayml/avatars-react` SDK
  loading cleanly. If the SDK fails to load, the
  component surfaces `Realtime SDK: <err>` and the
  Conversations tab falls into `failed` state with
  the operator-readable error.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```
