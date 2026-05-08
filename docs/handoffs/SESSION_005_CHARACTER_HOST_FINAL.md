# SESSION 005 — Character Host Final + PR A–G Arc

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch shipped on:** `feature/pr-f-character-host-v1`
**Head:** `e55af2f` (PR G docs update)

## Goal

Close the gap between the SESSION_004 ffmpeg finishing pipeline and the
current submission state. Make AdSpark a Runway-spokesperson story, not
just a Runway-ad-generator. Tag a second submission point that includes
the Brand Spokesperson Avatar feature.

## Why one handoff covers seven PRs

SESSION_004 was the last handoff written, but seven PRs landed since
then in a single working session. Rather than reconstruct each PR's
narrative as a separate handoff after the fact, this single document
captures the arc with enough detail to be load-bearing for the next
session.

## PR-by-PR summary (since SESSION_004)

| PR | Branch | Commit | Scope |
|---|---|---|---|
| **A** | `feature/pr-a-generation-upgrade` | `9813f2c` | True text-to-video for Gen-4.5 + in-app reference image generation via `gen4_image_turbo`; backend resolves local `/api/runway/image/<id>` URLs to data URIs server-side; Mode banner gains Image Gen pill |
| **B** | `feature/pr-b-finished-campaign-pack` | `e6b08aa` | Multi-format Campaign Pack (Landscape 1280×720 / Reels 720×1280 / Square 960×960); ffmpeg `scale=W:H:force_original_aspect_ratio=increase,crop=W:H` cover-fit; per-format `Campaign.finished_videos` dict, legacy `finished_video_url` kept for back-compat |
| **C** | `feature/pr-c-generation-settings` | `3cafe97` | `GENERATION_POLICY` (model → image_required, ratios, durations); 400 on unsupported combos; UI source-ratio + duration selectors with model-aware locking; settings chip row |
| **D** | `feature/pr-d-demo-hardening` | `f64e5b3` | localStorage persistence (`adspark.settings.v1`); friendly error parser; `/api/runway/provider-status` + defensive `/api/runway/organization`; readiness chip + optional credits/cap chip; per-status copy on RunwayPanel; PR D real hero-run on campaign 9a717c675ec6 (concept + Pack) |
| **E** | `feature/pr-e-submission-polish` | `7ed949e` | README / SUBMISSION / 00-START rewrite; new `DEMO_SCRIPT.md`; tagged **`hackathon-submission`** at this commit. PR-E is the pre-avatar baseline — referenced by judges who saw the original submission. |
| **F V1** | `feature/pr-f-character-host-v1` | `dea96f9` | Initial host clip — single button hid avatar create as an implementation detail |
| **F V2** | (same branch) | `2d5688e` | **Reframed** to make Runway Avatar capability visible: two explicit phases — Phase 1 *Create Brand Spokesperson*, Phase 2 *Present Campaign*. Per-campaign avatar identity persisted on `Campaign`. Honest "no recognisable face" failure UX with stock-portrait retry. |
| **G** | (same branch) | `e55af2f` | Submission docs updated to land the Brand Spokesperson story before merge: README pitch + Mermaid + endpoints + section; SUBMISSION "why this matters" + Runway-usage rows + key differentiators + verification trace; 00-START + DEMO_SCRIPT Path D + anti-patterns |

The research note for PR F is at
`docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` (committed to
`research/runway-character-host` and merged forward into PR F's
branch). §12 of that doc records the live API probe that locked the
schema.

## Runway Avatar schema findings (PR F probe)

Public docs were intentionally thin on the exact `/v1/avatars` and
`/v1/avatar_videos` body shapes. Six progressive probes against the
live API closed the gap; total spend was 3 avatar creates (1 success,
2 face-rejected) and 1 short avatar video — tiny fraction of the 50 k
credit pool.

### `POST /v1/avatars`

```jsonc
{
  "name": "AdSpark Brand Spokesperson",
  "referenceImage": "<URL or data: URI>",
  "voice": { "type": "runway-live-preset", "presetId": "vincent" },
  "personality": "Concise, friendly product spokesperson."
}
```

- `referenceImage` (singular) — required. Schema validator dumped a
  three-branch `invalid_union` confirming URL / data URI / `runway://`
  URI are all accepted *at schema level*. Avatar processing then
  rejects images without a recognisable face (a flat charcoal PNG
  fails after PROCESSING).
- `voice.presetId` — required, lowercase, from a 30-name enum the
  validator dumped on a bad value: `victoria`, `vincent`, `clara`,
  `drew`, `skye`, `max`, `morgan`, `felix`, `mia`, `marcus`, `summer`,
  `ruby`, `aurora`, `jasper`, `leo`, `adrian`, `nina`, `emma`, `blake`,
  `david`, `maya`, `nathan`, `sam`, `georgia`, `petra`, `adam`, `zach`,
  `violet`, `roman`, `luna`. **No account-level enablement required.**
- Avatar processing (PROCESSING → READY) takes ~30–45 s.
- Response body provides `id`, `referenceImageUri` (preview), and
  `processedImageUri` (the thumbnail we surface in the gallery).

### `POST /v1/avatar_videos`

```jsonc
{
  "model": "gwm1_avatars",
  "avatar": { "type": "custom", "avatarId": "<uuid>" },
  "speech": { "type": "text", "text": "<≤300 char script>" }
}
```

- `model` enum: only `"gwm1_avatars"`.
- `avatar.type` discriminator: **`"custom"`** for an existing avatar id
  (we tried 11 alternatives — all rejected). Inside the custom branch
  the field is `avatarId`, not `id`.
- `speech.type` discriminator: `"text"` with the script under the
  `text` field (not `content`).
- Returns `{id: "<task uuid>"}`; same `/v1/tasks/{id}` polling shape as
  `image_to_video`. Output `output: ["<presigned mp4 url>"]`.
- ~10 s upstream for an 8-word pitch.

### Avatar Host Clip output

ffprobe of a real production: **h264 1088×704 + AAC** (the spokesperson
*speaks*; this is the only Runway video output today that includes
audio). ~800 KB–2 MB for typical campaign-length scripts. Output ratio
is not user-controllable; V1 keeps the host clip as its own artifact
rather than crop-fitting it into Pack ratios.

## New API routes (PR F)

```
POST /api/campaigns/{id}/avatar
  body: {voice_preset?, image_url?, force_recreate?}
  Phase 1 — Create Brand Spokesperson Avatar.
  Image source priority: explicit override → campaign reference image
  → configured stock portrait. Polls Runway PROCESSING → READY.
  Persists host_avatar_id, host_avatar_status, host_avatar_image_url,
  host_avatar_image_source ("campaign" | "override" | "stock"),
  host_avatar_error.

POST /api/campaigns/{id}/host-video
  body: {script_override?}
  Phase 2 — Avatar Host Clip via /v1/avatar_videos.
  Returns 409 unless host_avatar_status is in {ready, mock}.
  Caches MP4 at backend/data/host/<campaign_id>.mp4.

GET /api/campaigns/{id}/host-video
  Streams the cached host clip (content-type: video/mp4).
```

Plus the PR D readiness-chip endpoints:

```
GET /api/runway/provider-status     (no secrets; policy table for the UI)
GET /api/runway/organization        (defensive; non-blocking)
```

## Demo flow (Path D — Live Avatar Host Demo)

Full click-by-click in `DEMO_SCRIPT.md`. Recommended timing: ~3 min,
spends ~10–15 credits.

1. Scroll to a saved campaign.
2. Click **Create Brand Spokesperson** — Runway Avatar phase. ~30–45 s.
3. If campaign image lacks a face, status flips to `failed`. Click
   **Retry with stock portrait**. ~30–45 s. Avatar `ready` with
   thumbnail + id + source label.
4. Click **Present Campaign** — `avatar_videos` phase. ~10 s. Inline
   `<video>` plays the spokesperson speaking the campaign pitch.

Mock fallback available: switch backend to `RUNWAY_API_KEY=` and the
same UI works in <2 s using stdlib PNG + ffmpeg lavfi placeholder.

## Verification status

**Mock mode (curl + Playwright):**
- All 21 routes register. `/health` reports `runway_mock: true`,
  `image_gen_mock: true`, `any_mock: true`.
- Phase 1 → synthetic READY avatar with stdlib charcoal thumbnail.
- Phase 2 → 720×720 5 s ffmpeg lavfi placeholder (~17 KB).
- Phase 2 without prior avatar → HTTP 409 with the Phase 1 hint.
- Unknown campaign id → HTTP 404.
- Vite production build clean: 40 modules, ~176 KB JS / ~55 KB gzip.
- Playwright smoke: 1 passed in ~21 s. Asserts the **Brand
  Spokesperson** + **Runway Avatar** labels and **Create Brand
  Spokesperson** button render on the saved-card path.

**Real hero-run (PR F V2 verification on campaign 9a717c675ec6):**
- Phase 1 with default source (campaign reference image): `failed`
  with "Runway rejected the reference image — typically because it
  does not contain a recognisable face." The campaign image is a
  Reels-shaped coffee-shop scene — no face. Honest failure UX.
- Phase 1 retry with explicit Unsplash portrait override:
  `host_avatar_id 6f18ad26-5976-4891-b085-61c1646c1251`, status
  `ready`, source `override`.
- Phase 2: `avatar_videos` task `6c69f5a6-8d35-4c40-a986-359c0e9ee546`
  → SUCCEEDED. Output cached at
  `backend/data/host/9a717c675ec6.mp4` — h264 1088×704 11.17 s + AAC,
  2,800,392 bytes.
- HTTP serve: 200 `video/mp4`.

**Hygiene (this session):**
- `git ls-files | grep -E '\.(env|mp4|png|jpg|jpeg|wav|mp3)$|/data/'`
  → empty.
- All `unified-donkey-betz` references are in safety/inspiration
  context (read-only inspection, "do not modify" warnings). Never as
  runtime imports.
- `git check-ignore` confirms `.env`, `backend/data/host/*`,
  `backend/data/images/*`, `backend/data/videos/*`, and
  `backend/data/finished/*` all match the `data/` ignore rule.

## Merge guidance

Recommended order for landing PR F + G on `main`:

```bash
git checkout main
git merge --ff-only feature/pr-f-character-host-v1
# → fast-forwards 7ed949e → e55af2f, four commits ahead of origin

git tag -a hackathon-submission-v2 -m "AdSpark Studio — RunwayML hackathon submission, with Brand Spokesperson Avatar"
# Keep the existing `hackathon-submission` tag at 7ed949e — that's the
# pre-avatar baseline as originally submitted.

# When ready (only on explicit user approval):
git push origin main
git push origin hackathon-submission-v2
```

Both tags coexist:

| Tag | Commit | Story |
|---|---|---|
| `hackathon-submission` | `7ed949e` | Pre-avatar baseline. Concept → Image → Video → Pack. |
| `hackathon-submission-v2` | `e55af2f` | Adds Brand Spokesperson Avatar + Avatar Host Clip. |

## Do-not-build-next guardrails

1. **WebRTC / `/v1/realtime_sessions`** — async `avatar_videos` is the
   right primitive for V1. Realtime adds browser SDK + mic/cam
   permissions + 5-min session caps + mid-demo fragility. Out of
   scope.
2. **Act-Two `/v1/character_performance`** — needs a driving
   performance video, not a script. Wrong primitive for "spokesperson
   reads the campaign."
3. **Multi-character dialogue / avatar conversations.**
4. **Custom voice cloning** (`/v1/voices`) — voice presets cover the
   demo cleanly.
5. **Audio mixing into the existing ad clip** — host stays a sibling
   artifact in V1.
6. **Server-side `/v1/uploads`** — public URL + data URI cover the
   current path.
7. **Stability.ai integration** — `gen4_image_turbo` already covers
   the reference-image pipeline. The 10 k Stability credits are
   parked as post-hackathon insurance only.
8. **Auth / multi-user / public deploy** — out of scope until the
   demo is recorded.
9. **Smart-framing for Pack crops** — center-crop is the V1 strategy.
10. **Background-task finishing** — synchronous works fine for the
    1–3 s ffmpeg passes.

If anything new is requested before the recording, prefer a
clearly-bounded bug-fix branch from `main` over an incremental feature
PR.

## Open V2 ideas (not in scope; for future-Chris)

- Stitch host MP4 + finished-reels MP4 into a single Instagram-ready
  reel via one more ffmpeg `concat` pass.
- Face-detection gate before allowing campaign-image avatars (skip the
  failure path entirely).
- Voice preset selector in the Brand Spokesperson UI (backend already
  validates the 30-name enum).
- Audio-only TTS via `/v1/text_to_speech` for podcast-style ads.
- Surface `processedImageUri` as the gallery card hero thumbnail.

## Real provider calls this session

**Total spend across PRs A–G: ≤200 credits** (rough order of magnitude;
exact figure depends on Runway billing model).

- PR A: 0 (mock-only verification).
- PR B: 0 (real hero from PR D was reused for ffmpeg verification — no
  new Runway calls).
- PR C: 1 short upstream `gen4.5` call to confirm the real-mode guard
  reaches Runway with a valid combination (returned 401 from a fake
  test key — never charged).
- PR D: 1 real `gen4_image_turbo` (~28 s) + 1 real `gen4.5` video
  (~145 s) on campaign 9a717c675ec6.
- PR E: 0 (docs-only).
- PR F probe: 3 avatar creates + 1 avatar video.
- PR F V2 hero: 1 failed avatar create (no face — free) + 1 successful
  avatar create + 1 avatar video.
- PR G: 0 (docs-only).

All artifacts are gitignored. Total session uncommitted media in
`backend/data/`: ~30 MB across images/videos/finished/host caches.

## Reference docs

- `README.md` — quickstart, demo flow, Mermaid pipeline, endpoint table.
- `SUBMISSION.md` — judge-facing pitch, Runway usage table, hero-run
  results, safety controls, roadmap.
- `00-START-NEXT-SESSION.md` — branch ladder, run commands,
  test-the-avatar-flow walkthroughs, do-not-build guardrails.
- `DEMO_SCRIPT.md` — four-path screen-recording script (A/B/C/D).
- `docs/WHAT_IT_IS.md`, `docs/INVENTORY.md` — refreshed in this
  session to reflect the PR A–G state.
- `docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` — full Runway
  Characters API research note + §12 live probe results.
- This file — `docs/handoffs/SESSION_005_CHARACTER_HOST_FINAL.md`.
