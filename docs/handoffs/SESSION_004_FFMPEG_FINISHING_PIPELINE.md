# SESSION 004 — ffmpeg finishing pipeline (Option B-lite)

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)

## Goal
Add a local "Finish Ad" pipeline that takes a cached campaign MP4 and
burns title + CTA text overlays into a finished MP4, served from a
stable backend route. No third-party API calls, no Runway tasks.

## Inspection (read-only) before coding
- `ffmpeg -version`: 7.1.1 via Homebrew, with libfreetype + libfontconfig.
- Fonts available: `/System/Library/Fonts/Helvetica.ttc`,
  `/System/Library/Fonts/Supplemental/Arial.ttf`,
  `/System/Library/Fonts/HelveticaNeue.ttc`.
- `unified-donkey-betz/content/davinci_provider.py` (Session 82–83 in
  that repo) uses `subprocess.run` with `capture_output=True, text=True,
  timeout=60`, builds the ffmpeg command as a list, checks
  `result.returncode != 0`, truncates stderr at ~200 chars, catches
  `subprocess.TimeoutExpired` separately, verifies output existence,
  and returns a structured `{success, error, ...}` dict. Borrowed the
  pattern shape; nothing copied verbatim.
- No drawtext-based overlay code in unified-donkey-betz to mirror.
- `unified-donkey-betz/scripts/registrations/register_video_editing_agent.py`
  and `core/agents/video_editing_agent.py` exist but don't actually
  call ffmpeg.

## What was done

### Backend
- **`app/services/finisher_service.py`** (new) — `VideoFinisher` with
  `path_for(id)`, `has(id)`, and
  `finish(campaign_id, source_path, top_text, bottom_text)`. Probes a
  font from a hard-coded candidate list at construction. Writes the
  overlay text to temp `.txt` files and uses ffmpeg's `textfile=`
  drawtext option so apostrophes / colons / backslashes don't need
  escaping. Atomic `.mp4.tmp` rename, never raises (returns a
  `FinishResult` dataclass). Time-bounded at 90 s.
- **`is_ffmpeg_available()`** helper using `shutil.which("ffmpeg")`.
- **`app/models.py`** — `Campaign` gained `finished_video_url`,
  `finish_status: Literal["ok","failed","unavailable"]`,
  `finish_error`. Optional defaults — no migration needed for existing
  rows.
- **`app/services/storage.py`** — `CampaignStore.update_finish_fields`
  mirroring `update_cache_fields`.
- **`app/routers/campaigns.py`** — two new routes:
  - `POST /api/campaigns/{id}/finish`: 404 when campaign missing, 409
    when no cached video to finish, 503 when ffmpeg is not on PATH
    (also persists `finish_status: "unavailable"` so the UI shows a
    stable badge instead of a transient toast). Pulls top text from
    `selected_concept.title || business`, bottom text from
    `selected_concept.cta || selected_concept.caption`. Returns the
    updated `Campaign`.
  - `GET /api/campaigns/{id}/finished-video`: `FileResponse` streaming
    the finished MP4 with download-friendly `content-disposition`.

### Frontend
- **`src/api.js`** — added `finishCampaign(id)` POST helper.
- **`src/components/CampaignGallery.jsx`** — restructured into
  hooks-friendly cards:
  - Preview preference: `finished_video_url` → `cached_video_url` →
    `video_url`.
  - New violet `finished ad` pill alongside the existing
    `video ready` / `no video` pill.
  - **Finish Ad button** under the cache row (only when a cached video
    exists). Disabled while in flight; relabels to `Finishing…`,
    `Finished ✓`, or `Retry Finish Ad` based on `finish_status`. Shows
    a clear amber message when the backend reports
    `finish_status: "unavailable"` (with the brew-install hint), and
    a rose tooltip when `finish_status: "failed"`.
  - Local optimistic-update map (`overrides`) so a finished card
    re-renders immediately after the POST returns, without a full
    `GET /api/campaigns` round-trip.

### Tests
- `frontend/tests/adspark-smoke.spec.js` got a conditional
  step 13a: if the newest card shows `cached locally`, assert the
  Finish Ad button is visible. The test does not click Finish (avoids
  pinning the smoke to ffmpeg behaviour); the button-visible
  assertion is enough to prove the new UI mounted.

### Docs
- README: new "Finish Ad — local ffmpeg overlay pipeline" section
  above the Playwright section.
- SUBMISSION.md: finishing pipeline moved from Future work → done;
  the routes added to "What works now".
- 00-START-NEXT-SESSION.md updated.
- This file.

## Real bug caught during verification
First end-to-end run failed with
`Invalid argument / Error opening output file …mp4.tmp`. ffmpeg infers
the muxer from the output filename's extension; `.mp4.tmp` resolved to
an unknown format. Fix: added explicit `-f mp4` before the output path
so the temp filename doesn't matter. After the fix the same call
produced a valid MP4. This is a class of bug `npm run build` /
TestClient unit checks don't catch — only a real subprocess invocation
surfaces it. Aligns with the runtime-verification rule from Session
001g.

## Verification
- `vite build`: clean (38 modules, ~160 KB JS / ~51 KB gzip).
- Playwright smoke (mock backend forced via shell env override):
  **1 passed** in 18.3 s (post-fix run).
- Real ffmpeg run against the cached Session 001e Runway artifact
  (`backend/data/videos/2798d0a05014.mp4`) — **no new Runway calls**:
  - `POST /api/campaigns/2798d0a05014/finish` → HTTP 200,
    `finish_status: "ok"`,
    `finished_video_url: "/api/campaigns/2798d0a05014/finished-video"`.
  - On-disk: `backend/data/finished/2798d0a05014-finished.mp4`,
    949,356 bytes (~927 KB).
  - `ffprobe`: H.264, 1280×720, 5.04 s, valid stream metadata.
  - `GET …/finished-video`: HTTP 200, `content-type: video/mp4`,
    `content-length: 949356`, valid MP4 magic
    (`ftyp/isom/iso2/avc1/mp41`).
  - 404 path verified for an unknown campaign id.
- `git check-ignore -v backend/data/finished/<id>-finished.mp4` →
  ignored via `backend/.gitignore:5:data/`.
- `git status` shows zero MP4 files in the working tree.
- Backend log audit: 0 outbound `api.dev.runwayml.com`, 0 outbound
  `api.openai.com`, 0 tracebacks, 0 ERROR.
- Servers stopped cleanly afterward.

## Real provider calls this session
**Zero.** No Runway tasks created, no OpenAI calls. The only outbound
HTTP from the backend during the live run was the cache pipeline's
`samplelib` download (mock task), and even that only ran during the
Playwright smoke; the ffmpeg run is purely local subprocess.

## Known caveats / follow-ups
- ffmpeg is a hard dependency of the Finish Ad button. The route
  surfaces an `unavailable` state cleanly when missing, but a public
  deploy will need ffmpeg on the runtime image.
- Overlays are static (single position, single font, fixed colors).
  A sophistication ladder: brand color from the campaign tone, fade
  in/out over the first/last 0.5 s, accent line under the title.
- Finishing is synchronous; saves are unaffected, but a Finish Ad
  click blocks the response for ~1–3 s (5 s clip @ veryfast).
  `BackgroundTasks` would be straightforward if needed.
- DaVinci Resolve provider is not implemented. The route shape and
  campaign schema are ready for it.
