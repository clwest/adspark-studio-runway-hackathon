# SESSION 052 — V2 Cinematic Video Persistence (PR BU)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BU patch in flight on top of `065a557`
`feat: wire v2 cinematic video async action (PR BT)`; commit
+ push pending after this handoff lands)
**Builds on:** PR BT (Cinematic Video async action wired) +
v1 PR B (`VideoCache.fetch` + `update_cache_fields`
plumbing). Closes the "session-only output" gap PR BT left
open: fresh v2 cinematic videos now survive page reloads.

## Goal

PR BT wired the Cinematic Video button to real Runway
`image_to_video` (start + poll) and surfaced the resulting
URL as a session-only download link. That made demo / testing
fragile — refreshing the page or switching modes dropped the
output. PR BU **persists** the SUCCEEDED output onto the
campaign so it appears in the existing v1 gallery player +
the v2 lane link unchanged on reload.

## Endpoint inventory

PR BU adds **one new route** (the smallest field-specific
endpoint that mirrors v1's create-time caching exactly).
Route count **69 → 70**.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/campaigns/{id}/cinematic-video` | Persist a Runway `image_to_video` output URL onto the campaign. Downloads via `VideoCache.fetch` + flips `cached_video_url` to `/api/campaigns/{id}/video`. |

Reuses existing plumbing — **no new storage helpers, no new
model fields**:

- `VideoCache.fetch(campaign_id, source_url)` —
  `backend/app/services/storage.py`. Same downloader v1
  `POST /api/campaigns` already uses.
- `CampaignStore.update_cache_fields(id,
  cached_video_url, cache_status, cache_error)` —
  `backend/app/services/storage.py`. Same writer v1
  uses to persist the cache result.

## What changed

### Backend

- **`backend/app/routers/campaigns.py`** —
  - new `CinematicVideoBody` Pydantic model. Single
    required field `video_url: str` (min_length 8, max_length
    2000 — leaves room for Runway signed-URL query strings).
  - new `POST /api/campaigns/{id}/cinematic-video` route.
    Mirrors v1 `create_campaign`'s caching block exactly:
    1. 404 if campaign not found.
    2. `result = cache.fetch(campaign_id, body.video_url)`.
    3. on `result.status == "ok"`: `update_cache_fields(id,
       cached_video_url=f"/api/campaigns/{id}/video",
       cache_status="ok", cache_error=None)` + return
       updated campaign.
    4. on failure: `update_cache_fields(id,
       cached_video_url=None, cache_status="failed",
       cache_error=result.error)` + raise 502 with the
       error detail.
  - both branches log via the existing module logger so
    operator visibility matches v1 caching.

### Frontend

- **`frontend/src/api.js`** —
  - new `api.persistCinematicVideo(campaignId, videoUrl)`
    helper. Posts `{ video_url }` to the new route.

- **`frontend/src/components/SpokespersonStudio.jsx`** —
  - `handleGenerateCinematicVideo(id, onProgress)` extended:
    after polling resolves SUCCEEDED, the resulting
    `task.output[0]` URL is POSTed to the new route via
    `api.persistCinematicVideo`. New progress phases:
    `'persisting'` (just before the POST) and `'persisted'`
    (after success) — the `'persist-failed'` phase fires if
    the route 502s. On success the local `campaigns` slice
    swaps in the updated campaign + `onCharactersChanged()`
    bubbles so the v1 gallery refreshes alongside if open.
  - return shape changed from a bare `Task` to
    `{ task, campaign, persistError? }` so the lane can
    render the persisted state vs the session-only fallback.

- **`frontend/src/components/lanes/CinematicLane.jsx`** —
  - new local state: `videoPhase` (idle / starting /
    polling / persisting / persisted / persist-failed /
    failed), `videoSessionUrl` (kept only as a fallback).
  - `videoLabel` flips between Generate / Regenerate based
    on `focused.cached_video_url` (the persisted state) —
    no longer the session-only URL.
  - button now also carries `data-persisted="true|false"`
    reflecting `Boolean(focused?.cached_video_url)`.
  - status row now phase-aware:
    - busy + phase=`'starting'` → "starting Runway
      image_to_video…"
    - busy + phase=`'persisting'` → "saving to campaign…"
    - busy + polling → "polling Runway… status=… progress=…%"
    - phase=`'persisted'` (emerald) → "saved to campaign"
    - phase=`'persist-failed'` (rose) → "saved (persist
      failed — session URL only)"
  - link now prefers the persisted `cached_video_url`
    (`open cinematic video ↗`, `data-persisted="true"`);
    falls back to the session-only `videoSessionUrl`
    (`open generated cinematic video ↗ (session only)`,
    `data-persisted="false"`) when persist 502s.

- **`frontend/tests/adspark-smoke.spec.js`** —
  - existing v1 + footer toggle tests untouched.
  - v2 case extended: asserts the Cinematic Video button
    carries `data-persisted` ∈ {"true", "false"}. Smoke
    never clicks the button (no credit burn in CI).

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR BU; intro
  re-narrates persistence + bumps route count to 70; PR BU
  row added at the bottom of the feature ledger.
- `docs/OPERATOR_USAGE_MAP.md` — intentionally unchanged.
  v2 surface stays gated.
- `docs/WHAT_IT_IS.md` — intentionally unchanged.
- `00-START-NEXT-SESSION.md` — UX redesign foundation
  picks up PR BU; build sizes / smoke results refreshed;
  new bullet describing persistence + new probes section.
- `docs/handoffs/SESSION_052_V2_CINEMATIC_PERSISTENCE.md`
  — this file.
- `docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md` —
  intentionally **not** touched. PR BU did not fire any
  controlled real Runway call this session; the brief
  reserves real-mode generation for explicit per-task
  approval.

## Pipeline (extended from PR BT)

```
SpokespersonStudio.handleGenerateCinematicVideo(id, onProgress):
  ↓ camp = local slice
  ↓ check camp.runway_prompt
  ↓ start = await api.startRunway({...})
  ↓ onProgress({ phase: 'started', task: start })
  ↓ poll loop (5 s ± 800 ms, 60-attempt cap):
      onProgress({ phase: 'polling', task: t, attempts })
      terminal SUCCEEDED → resolve(finalTask)
      terminal FAILED|CANCELED → reject(reason)
      cap → reject('polling timed out…')
  ↓
  ↓ outputUrl = finalTask.output[0]
  ↓ if outputUrl:
  ↓   onProgress({ phase: 'persisting', task: finalTask })
  ↓   updatedCampaign = await api.persistCinematicVideo(id, outputUrl)
  ↓   setCampaigns(replace(id, updatedCampaign))
  ↓   onCharactersChanged?.()
  ↓   onProgress({ phase: 'persisted', task, campaign })
  ↓   return { task, campaign }
  ↓ else if persistError:
  ↓   onProgress({ phase: 'persist-failed', task, error })
  ↓   return { task, campaign: null, persistError }

POST /api/campaigns/{id}/cinematic-video
  ↓ store.get(id) or 404
  ↓ result = cache.fetch(id, body.video_url)
  ↓ if ok: update_cache_fields(id, /api/campaigns/{id}/video, "ok", None)
  ↓ else: update_cache_fields(id, None, "failed", result.error) + 502
```

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **70** (was 69 — PR BU adds one route) |
| `vite build` | 399.68 KB initial / 107.51 KB gzip + 561.97 KB lazy chunk (+1.81 KB initial / +0.44 KB gzip vs PR BT) |
| Playwright mock smoke | `3 passed (29.7 s)` — v1 25.3 s, v2 2.9 s, toggle round-trip 834 ms |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

### Backend probes

End-to-end against the mock backend (no real Runway calls):

| Probe | Curl | Result |
|---|---|---|
| 404 on missing campaign | `POST /api/campaigns/does-not-exist/cinematic-video` | **404** ✅ |
| 422 on missing video_url | `POST .../cinematic-video '{}'` | **422** ✅ |
| 502 on broken upstream URL | `POST .../cinematic-video '{"video_url":"https://this-is-not-a-real-domain-xyz.example/video.mp4"}'` | **502** ✅ |
| Happy-path persist | source URL = `http://localhost:8000/api/campaigns/22fa0a246e33/video` | **200** with `cached_video_url=/api/campaigns/{id}/video` + `cache_status="ok"` ✅ |
| Reload survives | `GET /api/campaigns` after persist | persisted URL + status survive the read ✅ |

The 502 path correctly persisted `cache_status="failed"` +
`cache_error` (verified by inspecting the `GET
/api/campaigns` response after the broken-URL call) so the
v1 gallery surface stays consistent with the failure.

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
4. CinematicLane mounts. Step 3 → "Generate Real Cinematic
   Video" button is rose. Tooltip: "⚠️ POST
   /api/runway/generate (image_to_video) — burns Runway
   credits per click. Polls until SUCCEEDED (≈ 30 s – 5 min
   cap)."
5. Click. Status row progresses: "starting Runway…" →
   "polling Runway… status=RUNNING progress=42%" → "saving
   to campaign…" → "saved to campaign" (emerald).
6. Link below reads "open cinematic video ↗" pointing at
   `/api/campaigns/{id}/video`.
7. **Refresh the page.** Lane remembers the cinematic
   video — the link stays "open cinematic video ↗" and the
   button label flips to "Regenerate Real Cinematic Video".
8. Open the v1 gallery (toggle UX in footer). The same
   campaign card now plays the new cinematic video in its
   Visuals tab.

## Limitations / follow-ups

- **502 leaves the campaign uncached.** When persist fails
  (e.g. mock-mode upstream URL doesn't resolve to video),
  the route 502s and writes `cache_status="failed"`. The
  lane falls back to the session-only Runway URL (download
  link). On real-mode this should be rare — Runway output
  URLs are valid streams.
- **No retry button.** A `persist-failed` state shows the
  rose status but doesn't auto-retry. Operators can re-fire
  Generate (which costs another credit) or re-save the
  campaign in classic UX with the session URL pasted into
  Stage 3. A small "Retry persist" button would close that
  gap; deferred.
- **No transient task_id stored.** v1 stores
  `runway_task_id` at create time only; PR BU follows
  suit and does not update that field on regeneration. The
  freshest Runway task id is observable via the lane's
  status row but isn't persisted.
- **Cinematic-only.** This route is named for cinematic
  outputs — Spokesperson Ads (PR BP) already persist via
  the existing `POST /spokesperson-ad` route's own
  caching, and ffmpeg-only outputs (Voiced Cinematic /
  Storyboard / Dialogue stitch / Reels) all already
  persist via their respective routes.
- **Body cap of 2000 chars.** Runway signed URLs are
  typically <500 chars; the cap leaves headroom but
  rejects unbounded inputs.

## Recommended next slice

The v2 lane render surface is now **fully wired + fully
persistent**. Reasonable next directions:

1. **Retry-persist button** — when `persist-failed` shows,
   render an inline "Retry persist" button that re-fires
   `api.persistCinematicVideo(id, sessionUrl)` without
   re-running Runway. ~15 min, frontend-only.
2. **Move v2 from "preview UX" → default** — flip
   `uxFlag.js` so `getUxMode()` defaults to v2; v1 stays
   reachable via `?ux=v1` / footer toggle. Big UX change;
   would unblock removing the legacy create flow gradually.
3. **Status-banner inside CampaignCard** that names the
   auto-selected tab when the v2 click-through lands
   (deferred from PR BS) — small ~30 min polish.
4. **Apply the persistence pattern to v2 dialogue +
   storyboard outputs** if any of those ever produce
   session-only artefacts. Today they all already persist
   via their existing routes, so this is preventative
   architecture work.

Option 1 is the quickest polish; option 2 is the bigger
narrative win.
