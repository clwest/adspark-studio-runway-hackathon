# SESSION 012 — Vertical / Reels Export Pipeline (PR AG)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (working tree carries PR AG; tag/push pending
explicit user approval)
**Builds on:** SESSION_011 anchors at `ec446e4`
(`hackathon-submission-v13`).

## Goal

Ship the Tier-1 #1 next-phase candidate from SESSION_011: a
**Vertical / Reels export pipeline** that takes the existing
Spokesperson Ad and Dialogue Scene MP4s and reframes them as
720×1280 vertical clips suitable for TikTok / Reels / Shorts —
with **no new Runway calls** and **no extra credit cost**. The
slice belongs to the Distribution Layer of the persistent AI
spokesperson architecture.

Hard scope locks (carried forward from the brief):
- No captions in this slice.
- No transcript replay in this slice.
- No avatar RAG in this slice.
- No multi-character realtime.
- No new creative primitives.

## What changed

### Backend
- `backend/app/services/finisher_service.py`
  - `spokesperson_reels_path(campaign_id) -> Path` and
    `dialogue_scene_reels_path(campaign_id) -> Path` (cache addressing
    that mirrors the existing voiced/storyboard helpers).
  - `has_spokesperson_reels` / `has_dialogue_scene_reels` predicates.
  - `build_reels_export(source_path, target_path, *, backdrop_color,
    target_w=720, target_h=1280, timeout=120)` — the load-bearing
    helper. ffmpeg filter:
    `scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=#0b1220,setsar=1`.
    Output is h264 + AAC. When the source has no audio stream
    (e.g. lavfi mock placeholder), the helper synthesises a silent
    AAC track via `anullsrc=channel_layout=stereo:sample_rate=48000`
    so the output keeps the h264 + AAC contract regardless. Never
    raises — caller inspects the returned `CommercialResult`.
- `backend/app/models.py` — six new optional fields on `Campaign`:
  `spokesperson_reels_url|status|error` and
  `dialogue_scene_reels_url|status|error` with status literal
  `Literal["ok", "failed", "no_source", "unavailable"]`.
- `backend/app/services/storage.py` —
  `update_reels_fields(campaign_id, kind, url, status, error)`
  with `kind ∈ {"spokesperson", "dialogue_scene"}`. Single helper
  chooses the field triplet so a future third reels kind stays
  one-line additive.
- `backend/app/routers/campaigns.py` — four new routes:
  ```
  POST /api/campaigns/{id}/spokesperson-ad/reels
  GET  /api/campaigns/{id}/spokesperson-ad/reels
  POST /api/campaigns/{id}/dialogue-scene/reels
  GET  /api/campaigns/{id}/dialogue-scene/reels
  ```
  Plus the delete cascade in `DELETE /api/campaigns/{id}` extended
  to remove both reels artefacts when a campaign is deleted.
- **Total backend routes: 57 → 61.**

### Frontend
- `frontend/src/api.js` — `buildSpokespersonReels(id)` +
  `buildDialogueSceneReels(id)`.
- `frontend/src/components/CampaignGallery.jsx`:
  - Two new busy flags: `spokespersonReelsBusy`, `dialogueReelsBusy`.
  - Two new derivations: `spokespersonReelsReady`,
    `dialogueSceneReelsReady`.
  - Two new handlers (`handleSpokespersonReels`,
    `handleDialogueSceneReels`) that follow the existing
    `setLocalError` + `onUpdated` pattern used by every other
    button in the card.
  - **Reels (720×1280) button** added next to
    `download Spokesperson Ad ↗` (Character tab) and next to
    `download Dialogue Scene Ad ↗` (Dialogue tab). Once built,
    a `download reels ↗` link unlocks inline. `data-testid`
    hooks (`reels-spokesperson` / `reels-dialogue`) added for
    future test reach without bloating the smoke today.
  - Two new Exports ledger rows:
    `Spokesperson Reels (720×1280)` and
    `Dialogue Scene Reels (720×1280)`.
- `frontend/tests/adspark-smoke.spec.js` — two assertions ensuring
  the new ledger rows render unconditionally on any saved campaign.

## Verification (this session)

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **61** (was 57) |
| `vite build` | 293.35 KB initial / 83.41 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (22.9 s)` |
| ffprobe spokesperson reels | `h264 720x1280 + aac · duration 5.000000` |
| ffprobe dialogue reels | `h264 720x1280 + aac · duration 15.000000` |
| Source ffprobe | spokesperson `720x720 / 5.0 s`, dialogue `1088x704 / 15.0 s` |
| Hygiene scan | `git ls-files \| grep -E '(\.env$\|backend/data\|\.mp4$\|\.mp3$\|\.png$)'` empty |
| Drift guard | `✅ context-kit anchors look recent.` |

End-to-end probe ran fully under mock-mode (`RUNWAY_API_KEY=`
`OPENAI_API_KEY=` `IMAGE_GEN_PROVIDER=mock`). Both reels MP4s
landed at the documented cache paths and were served back via
`GET …/reels` (HTTP 200).

## Audio/visual model post-PR-AG

The reels exports preserve the source's audio track verbatim
(re-muxed via `-c:a aac -b:a 192k`). When the source happens to
be a silent lavfi mock placeholder, the helper synthesises a
silent AAC track so downstream players never see a missing
audio stream. Backdrop colour defaults to `#0b1220` (dark slate)
— it reads as intentional letterboxing on every avatar / dialogue
clip we tested. Brand-colour overrides are deliberately deferred
(see Limitations).

## Limitations / follow-ups

- **Backdrop colour is not yet brand-aware.** No brand colour
  field exists on the campaign or character today. The helper
  already accepts a `backdrop_color` argument — the route hook
  is one line away whenever a brand-colour story lands.
- **No top/bottom drawtext (caption) on the reels.** The slice
  is intentionally caption-free per the brief. Tier-1 captions
  can layer on top of the existing reels output without changing
  this pipeline.
- **Output is letterboxed, not centre-cropped.** This preserves
  the talking head / dialogue framing intact; the bars are the
  trade-off. Centre-crop would chop foreheads and chins on the
  1088×704 source.
- **Cache invalidation on Spokesperson regenerate / Dialogue
  re-stitch is not automatic.** The reels MP4 stays on disk
  until the user clicks **Rebuild Reels** or `DELETE` the
  campaign. Cheap follow-up if it ever surprises an operator.
- **No HEAD probe in the smoke for download links.** The smoke
  asserts the ledger labels render unconditionally; the
  ffprobe + GET 200 verification happened out-of-band in this
  session via a Python `urllib` probe. A future smoke could
  reach the buttons by first creating a host avatar + dialogue
  scene, but that doubles the smoke runtime and isn't required
  to prove the pipeline.

## Demo flow (PR AG addition)

After Path B (Spokesperson Ad) or Path E (Dialogue Scene) lands:

1. On the saved card, find the talking-head player (Character
   tab → Spokesperson Ad section, or Dialogue tab → stitched
   scene).
2. Click **Reels (720×1280)** next to the existing download link.
3. ~1–3 s of local ffmpeg.
4. **`download reels ↗`** appears inline; the Exports ledger
   flips its `Spokesperson Reels (720×1280)` /
   `Dialogue Scene Reels (720×1280)` row from *not generated yet*
   to a `download ↓` link.

No Runway credits spent.

## Recommended next phases (post PR AG)

The Tier-1 list now reorders:

1. **Caption overlays for Dialogue Scene** — burn-in per-line
   subtitles via ffmpeg `subtitles=` filter. Per-line text is
   already saved on the campaign record. ~50 LOC.
2. **Avatar `documentIds` for grounded realtime** —
   `POST /v1/documents` + `PATCH /v1/avatars/{id}`.
3. **Conversation transcript retrieval** —
   `GET /v1/avatar_conversations/{id}` for "replay your chat".
4. **Brand colour storage** — small Character / Campaign field
   that the existing `build_reels_export` `backdrop_color`
   parameter would accept directly.
