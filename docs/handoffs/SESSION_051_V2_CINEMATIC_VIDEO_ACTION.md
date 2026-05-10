# SESSION 051 — V2 Cinematic Video Async Action (PR BT)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BT patch in flight on top of `bcbc1d8`
`feat: v2 appearances tab hints (PR BS)`; commit + push
pending after this handoff lands)
**Builds on:** PR BK (CinematicLane scaffold) +
PR BO (Voiced Cinematic action wired) + PR BP (real Runway
buttons pattern: rose chrome + `data-burns-credits="true"` +
inline warning copy). Closes the **last v2 lane render
placeholder**.

## Goal

PR BO + PR BP wired the synchronous CinematicLane render
buttons (Voiced Cinematic — ffmpeg; Storyboard Commercial —
ffmpeg) but Cinematic Video stayed a disabled placeholder
because it needs **async polling** of the
`image_to_video` task. PR BT finally wires it.

PR BT is **frontend-only**. Reuses `api.startRunway`
(POST `/api/runway/generate`) + `api.pollRunway` (GET
`/api/runway/task/{id}`) that v1 `App.handleGenerateVideo`
already uses, with the same polling cadence and terminal
status handling. No new backend routes; no schema changes.

## Endpoint inventory

PR BT adds **no new routes**. Route count remains **69**.
Frontend-only — uses the two long-standing helpers:

| Helper | Backend route | Purpose |
|---|---|---|
| `api.startRunway(body)` | `POST /api/runway/generate` | Submit `image_to_video` (or `text_to_video` when `prompt_image=null`) task |
| `api.pollRunway(id)` | `GET /api/runway/task/{id}` | Poll task progress / status / output |

## What changed

### Modified files

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - new `handleGenerateCinematicVideo(campaignId, onProgress)`
    handler. Mirrors v1 `App.handleGenerateVideo` polling
    pattern exactly:
    - reads `runway_prompt` + `reference_image_url` +
      `runway_model` from the local campaigns slice; throws
      `'campaign has no runway_prompt — re-save in classic UX'`
      when the focused campaign has no saved prompt.
    - calls `api.startRunway({prompt_text, prompt_image,
      duration: 5, ratio: '1280:720', model: runway_model ||
      'gen4_turbo'})`.
    - polls `api.pollRunway(task_id)` every **5 s ± 800 ms
      jitter** for up to **60 attempts** (≈ 5-min cap).
    - terminal statuses **SUCCEEDED / FAILED / CANCELED**
      handled exactly as v1: SUCCEEDED resolves with the
      final task; others reject with the failure_reason or
      status; cap-on-attempts rejects with a "polling timed
      out at the 5-min cap" error. **No infinite loops**.
    - optional `onProgress({phase, task, attempts})`
      callback fires on `started` + every poll tick so the
      lane can render live status.
  - threaded into `<CinematicLane>` as
    `onGenerateCinematicVideo`.

- **`frontend/src/components/lanes/CinematicLane.jsx`** —
  - imports `useEffect` + `useRef` (added to existing
    `useState` import).
  - new prop `onGenerateCinematicVideo = null`.
  - new gating block (mirrors PR BO/BP shape):
    - `videoPromptReady = Boolean(focused.runway_prompt)`
    - local state: `videoBusy`, `videoError`,
      `videoTaskInfo` (last poll result), `videoOutputUrl`
      (fresh output URL from this session).
    - `videoActiveRef` cancellation flag (set false on
      unmount via `useEffect` cleanup) so a mid-poll mode
      switch doesn't try to `setState` after the lane is
      gone.
    - `videoCanFire = onHandler && hasCampaign &&
      videoPromptReady && !videoBusy`.
    - label flips: idle → 'Generate Real Cinematic Video' /
      'Regenerate Real Cinematic Video' (when fresh URL
      cached or campaign has `cached_video_url`); busy →
      'Generating Real Cinematic Video…'.
    - tooltip + disabled-reason copy follow PR BP's
      vocabulary ("⚠️ POST /api/runway/generate
      (image_to_video) — burns Runway credits per click.
      Polls until SUCCEEDED (≈ 30 s – 5 min cap).").
  - replaces the disabled placeholder Cinematic Video
    button with a wired one carrying:
    - `data-burns-credits="true"`
    - `data-source-ready={videoPromptReady}`
    - `data-busy={videoBusy}`
    - `data-render-target="cinematic-video"` (preserved)
    - `data-has-output` now reflects either the fresh
      `videoOutputUrl` OR the persisted `cached_video_url`.
    - rose chrome (`ring-rose-400/50` /
      `bg-rose-500/30 hover:bg-rose-500/45` /
      `text-rose-100`) when fireable; zinc
      cursor-not-allowed otherwise.
  - new `<p data-testid="cinematic-lane-video-warning">⚠️
    Real Runway. Each click bills `image_to_video`.</p>`
    inline below the button when fireable (mirrors PR BP's
    `spokesperson-lane-horizontal-warning`).
  - new status row inside the existing render column:
    - `<p data-testid="cinematic-lane-video-status">` shows
      either the rose error from the click handler, or
      "starting Runway image_to_video…" / "polling
      Runway… status=RUNNING progress=42%" while busy.
    - `<a data-testid="cinematic-lane-video-link">` links
      to the fresh output URL when SUCCEEDED in this
      session ("open generated cinematic video ↗"). Persisted
      `cached_video_url` is intentionally NOT surfaced
      here — that view stays in the classic gallery's
      Visuals tab (PR BT's output URL is **not** persisted
      to the campaign — would require a new backend route,
      kept out of scope per brief).

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 + footer toggle tests untouched.
  - v2 case Cinematic lane assertions extended:
    - drops the "Cinematic Video stays disabled" assertion.
    - asserts `data-burns-credits="true"` on the button
      (alongside PR BP's Spokesperson Horizontal as the
      second platform-wide credit-burn surface).
    - asserts `data-busy="false"` (idle precondition).
    - reads `data-source-ready` and asserts it's one of
      `'true'` / `'false'`. When `true`, button is enabled
      and label matches `/(Generate|Regenerate) Real
      Cinematic Video/`. When `false`, button is disabled.
    - smoke never clicks the button (real Runway is mocked
      via the mock backend, but keeping smoke
      click-free preserves the "no credit burn in CI"
      contract).

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BT;
  intro re-narrates the Cinematic Video wiring + clarifies
  route count stays 69; PR BT row added at the bottom of
  the feature ledger.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
  v2 surface stays gated.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation
  picks up PR BT; build sizes / smoke results refreshed;
  new bullet describing the Cinematic Video wiring.
- `docs/handoffs/SESSION_051_V2_CINEMATIC_VIDEO_ACTION.md`
  — this file.
- `docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md` —
  intentionally **not** touched. PR BT did not fire any
  controlled real call this session; the brief explicitly
  reserves real-mode generation for explicit per-task
  approval.

## Polling pattern (matches v1 exactly)

```
SpokespersonStudio.handleGenerateCinematicVideo(id, onProgress):
  ↓ camp = campaigns.find(x => x.id === id)
  ↓ check camp.runway_prompt is non-empty (else throw)
  ↓ start = await api.startRunway({
        prompt_text: camp.runway_prompt,
        prompt_image: camp.reference_image_url || null,
        duration: 5,
        ratio: '1280:720',
        model: camp.runway_model || 'gen4_turbo',
      })
  ↓ onProgress?.({ phase: 'started', task: start })
  ↓ enter polling loop:

  attempts = 0
  loop {
    attempts++
    t = await api.pollRunway(start.task_id)
    onProgress?.({ phase: 'polling', task: t, attempts })
    if t.status in {SUCCEEDED, FAILED, CANCELED}:
      if SUCCEEDED → resolve(t)
      else → reject(failure_reason || status)
      return
    if attempts >= 60: reject('polling timed out…'); return
    setTimeout(tick, 5000 + Math.random() * 800)
  }
```

The 60-attempt cap is the same `POLL_MAX_ATTEMPTS` constant
v1 uses at the top of `App.jsx`; the 5 s + jitter cadence
is the same `POLL_INTERVAL_MS + Math.random() * 800` v1
uses inside `startPolling`. **No infinite loops** — every
non-terminal path has a bounded retry budget.

## Cancellation safety

`videoActiveRef` is a `useRef` flag set `true` on mount and
`false` on unmount via the lane's first `useEffect`
cleanup. The handler's `setTimeout` callbacks check
`videoActiveRef.current` before any `setState`, so a
mid-poll mode switch (operator picks Spokesperson or
Dialogue while polling) silently drops the in-flight
updates instead of warning about state-after-unmount. The
underlying `setTimeout` chain still runs in the studio's
handler closure — bounded by the 60-attempt cap — so the
final `resolve` / `reject` doesn't leak past the cap, but
no UI side-effects fire after the lane unmounts.

## Save / state preservation

- `cached_video_url` (campaign-persisted) — **untouched**.
  PR BT does not call any campaign-update route; the fresh
  output URL only lives in lane-local state until the lane
  unmounts.
- `runway_prompt` / `reference_image_url` / `runway_model`
  on the focused campaign — read-only inputs to the new
  handler.
- `activeMode` (PR BH) — preserved.
- `activeCharacterId` (PR U) — preserved.
- v1 `App.handleGenerateVideo` — completely unchanged.
  PR BT lives entirely inside the v2 `SpokespersonStudio` /
  `CinematicLane` tree.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **69** (unchanged) |
| `vite build` | 397.87 KB initial / 107.07 KB gzip + 561.97 KB lazy chunk (+3.00 KB initial / +0.80 KB gzip vs PR BS) |
| Playwright mock smoke | `3 passed (27.3 s)` — v1 23.1 s, v2 2.8 s, toggle round-trip 810 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

The v2 smoke now exercises the Cinematic Video button
end-to-end at the structural level: presence,
`data-burns-credits`, `data-render-target`, `data-busy`,
and a `data-source-ready` disjunction so fixture variation
(no active spokesperson → no linked campaigns → no focused
campaign → button disabled with `data-source-ready="false"`)
keeps the smoke green.

**No real Runway calls were fired.** Per CLAUDE.md hard
rules + brief, real-mode generation is reserved for
explicit per-task approval. Mock-mode smoke never burns
credits.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule + the brief.

```
backend: pid=… · http://localhost:8000 · runway_mock=false
vite:    pid=… · http://localhost:5173 · http=200
```

Manual test path (will burn credits):
1. http://localhost:5173 → footer "Try preview UX →".
2. On Brewster's tile, click "Use as Spokesperson".
3. Click "+ New Campaign" → pick **Cinematic Ad**.
4. CinematicLane mounts. The lane's Step 1 brief editor
   targets the most-recent linked campaign for Brewster
   (CEO Buzz fixture works).
5. Step 3 → "Generate Real Cinematic Video" button is now
   pink/rose. Tooltip: "⚠️ POST /api/runway/generate
   (image_to_video) — burns Runway credits per click.
   Polls until SUCCEEDED (≈ 30 s – 5 min cap)."
6. Click. Status row shows "starting Runway
   image_to_video…" then "polling Runway… status=RUNNING
   progress=42%" updates every 5 s.
7. On SUCCEEDED, a green link "open generated cinematic
   video ↗" appears. Click to open the resulting MP4.

The output URL is **session-scoped** — refreshing the
page or switching modes drops it. The campaign's
persisted `cached_video_url` (set at create time) is
unchanged.

## Limitations / follow-ups

- **No campaign persistence.** The fresh output URL lives
  in lane state only. To persist it onto the saved
  campaign would require a new backend route (e.g. POST
  `/api/campaigns/{id}/cinematic-video`) — explicitly
  out of scope per brief ("Do not add backend routes
  unless absolutely necessary"). Operators who want the
  output as the canonical visual still need to re-save the
  campaign in classic UX with the new `video_url`.
- **No inline prompt edit.** The lane uses the campaign's
  saved `runway_prompt` verbatim. To edit the prompt,
  operators round-trip back to classic UX Stage 3
  PromptPreview. PR BT keeps the lane's role as
  "regenerate from saved inputs" deliberately narrow.
- **Fixed duration / ratio.** PR BT hard-codes
  `duration: 5` + `ratio: '1280:720'` (the v1 defaults).
  The lane has no controls for either yet; classic UX
  RunwayPanel still owns those settings.
- **No text-only model gate.** v1 `App.handleGenerateVideo`
  honours a `useTextOnly = model === 'gen4.5' && textOnly`
  setting that bypasses the reference image even if
  present. PR BT skips that flag — sends the saved
  reference image when present, falls back to text-only
  when null. Functionally equivalent for the common path
  but skips the explicit gen4.5-only bypass.
- **Status row over-eager polling text.** The status row
  reads back the most-recent `task` object's status +
  progress on every tick, but the mock backend returns
  SUCCEEDED on the first poll, so smoke never sees the
  intermediate "polling Runway…" copy. Real-mode
  validation will exercise this path.
- **No retry-after-failure UX.** A FAILED task surfaces
  the failure reason in the status row but doesn't auto-
  retry. Operators must click again. This matches v1's
  failure UX exactly.

## Recommended next slice

The v2 lane render surface is now **fully wired** —
every render button on every lane fires a real production
behaviour. Reasonable next directions:

1. **Cinematic Video → campaign persistence** — add a
   minimal backend route to attach the fresh output URL
   onto the saved campaign so the lane's "cached" state
   reflects v2-generated visuals, not just create-time
   ones. Estimated 30–60 min: new POST route +
   storage helper + lane state update on success. **One
   new route would be the only backend addition since
   PR BQ.**
2. **Text-only video toggle** — surface a checkbox or
   pill in the Cinematic lane Step 2 ("Visual Source")
   that bypasses the reference image. Mirrors v1
   RunwayPanel's `textOnly` setting. ~30 min, frontend-
   only.
3. **Move v2 from "preview UX" → default** — flip
   `uxFlag.js` so `getUxMode()` defaults to v2; v1 stays
   reachable via `?ux=v1` / footer toggle for backward
   compatibility. Big UX change; would unblock removing
   the legacy create flow gradually.
4. **Polish status copy + add a "cancel polling" button**
   to the busy state. Tiny ~15 min slice.

Option 1 is the obvious follow-up if persisting fresh v2
outputs matters; otherwise option 3 is the bigger
narrative win.
