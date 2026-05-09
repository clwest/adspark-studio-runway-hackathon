# SESSION 013 — Burned-in Captions for Vertical Reels (PR AH)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AG + PR AH on top of `ec446e4`; no commit
or tag yet — both pending explicit user approval)
**Builds on:** SESSION_012 (PR AG Vertical / Reels Export Pipeline).

## Goal

Layer burned-in subtitle/caption rendering onto the existing
720×1280 Reels exports so AdSpark's vertical assets are
immediately social-ready — no separate captioning step, no
sidecar SRT, no re-export. PR AH is a **finishing-layer slice**:
it extends PR AG's pipeline rather than introducing new endpoints
or new artefact kinds.

Hard scope locks (carried forward from the brief):
- No transcript replay.
- No avatar RAG.
- No realtime changes.
- No multi-character realtime.
- No new creative primitives.
- No new generation modes.

## API/UX decision

**Captions are on by default.** The two existing PR AG routes
(`POST /api/campaigns/{id}/spokesperson-ad/reels` and
`POST /api/campaigns/{id}/dialogue-scene/reels`) now produce
captioned output. No new routes were added; route count stays
at **61**.

Rationale:
- The brief explicitly preferred this option ("Existing Reels
  export becomes captioned by default").
- Avoids a UI surface that asks operators to choose between
  "with captions" vs "without" — the social-ready output is
  always the captioned one.
- The internal `build_reels_export` helper still accepts a
  `captions=None` argument so future callers can re-export a
  caption-free Reels file if a brand integration ever needs it.
  No public route exposes that today.

## What changed

### Backend

- `backend/app/services/finisher_service.py`:
  - **`probe_duration(path) -> float | None`** — module-level
    helper. ffprobe `format=duration`. Used by both reels routes
    to derive caption timings.
  - **`_wrap_caption_text(text, max_chars=28) -> str`** —
    `textwrap`-based word wrap that returns `\n`-joined output
    suitable for ffmpeg `drawtext` `textfile=`. Whitespace is
    collapsed first so multi-paragraph scripts wrap cleanly.
  - **`build_reels_export(...)`** signature extended with
    `captions: list[tuple[float, float, str]] | None = None` and
    `caption_max_chars: int = 28`. When captions are supplied,
    each tuple becomes a chained
    `drawtext=fontfile=…:textfile=…:fontsize=36:fontcolor=white:`
    `line_spacing=8:x=(w-text_w)/2:y=h-text_h-110:box=1:`
    `boxcolor=black@0.6:boxborderw=18:enable='between(t,a,b)'`
    filter. Caption text files live under `data/finished/.<stem>-cap-<i>.txt`
    and are unlinked in a `try/finally` so they never leak into
    the gitignored ledger. When the system has no usable font
    we log a warning and skip the caption layer rather than
    failing the export.
- `backend/app/routers/campaigns.py`:
  - Added module-level helpers `_spokesperson_caption_schedule`
    and `_dialogue_caption_schedule`.
    - Spokesperson schedule: `[(0, duration, script_text)]` where
      `script_text` prefers `campaign.commercial_script` (PR AA)
      and falls back to `character_host_client.build_script(record)`
      so captions match whatever the host pipeline actually said.
    - Dialogue schedule: per-line ffprobe of the cached
      `data/dialogue/<id>-<line_id>.mp4` clips → accumulating
      `(start, end, text)` tuples. Lines with missing/zero-duration
      clips get an even slice of the leftover stitched runtime so
      the schedule still spans the whole scene.
  - The two existing POST handlers now pass the schedule into
    `build_reels_export(...)` and ffprobe the source for fallback
    duration arithmetic.
  - New imports: `host_build_script`, `probe_duration`. Import
    of `dialogue_service` happens inline at call time to keep the
    helper colocated and avoid a top-level circular hazard.

### Frontend

- `frontend/src/components/CampaignGallery.jsx`:
  - **Spokesperson Ad button copy** updated to
    "Captioned Reels (720×1280)" / "Rebuild Captioned Reels". `title`
    attribute now reads "Letterbox to 720×1280 with burned-in
    captions for TikTok / Reels / Shorts".
  - **Dialogue Scene Reels button copy** updated to the parallel
    "Captioned Reels (720×1280)" / "Rebuild Captioned Reels".
    `title`: "Letterbox to 720×1280 with per-line captions for
    TikTok / Reels / Shorts".
  - **Exports ledger labels** renamed:
    - `Spokesperson Reels · 720×1280 · Captioned`
    - `Dialogue Scene Reels · 720×1280 · Captioned`
    - Meta copy now references the drawtext chain so judges /
      operators can read the implementation truth without playing
      the file.
- `frontend/tests/adspark-smoke.spec.js`:
  - Two ledger-row assertions updated to match the new
    captioned labels.

### Docs

- `docs/INVENTORY.md` — finisher_service row + ad-mode table +
  feature stack + limitations all reflect PR AH.
- `docs/OPERATOR_USAGE_MAP.md` — Export Types rows renamed to
  "Captioned Reels" + new "Captions (PR AH)" subsection in §11
  describing the styling / fallback rules / ffprobe schedule.
- `docs/WHAT_IT_IS.md` — narrative anchor entry 14b updated to
  describe captioned reels.
- `00-START-NEXT-SESSION.md` — Distribution layer section + next-
  phases checklist + headline build sizes.
- `docs/handoffs/SESSION_013_CAPTIONED_REELS.md` — this file.

## Verification (this session)

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **61** (unchanged from PR AG — captions extend, do not add routes) |
| `vite build` | 293.49 KB initial / 83.46 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (23.0 s)` |
| ffprobe spokesperson reels | `h264 720x1280 + aac · duration 5.000000` |
| ffprobe dialogue reels | `h264 720x1280 + aac · duration 15.000000` |
| Visual frame extract (`ffmpeg -ss N -frames:v 1`) | white-on-black caption box renders in the bottom safe zone on every sampled frame |
| Per-line caption variance | dialogue line-1 / line-2 / line-3 frames each show distinct text from the saved per-line `text` field |
| Bright-pixel heuristic in bottom band | sp:0.0806 · dg-line1:0.0299 · dg-line2:0.0542 · dg-line3:0.0415 (all above the empty-frame threshold of 0.005) |
| Hygiene scan | `git ls-files \| grep -E '(\.env$\|backend/data\|\.mp4$\|\.mp3$\|\.png$)'` empty |
| Drift guard | `✅ context-kit anchors look recent.` |

End-to-end probe ran fully under mock-mode (`RUNWAY_API_KEY=`
`OPENAI_API_KEY=` `IMAGE_GEN_PROVIDER=mock`). The probe campaign
saved a real `commercial_script`, generated a Spokesperson Ad
(mock lavfi placeholder), planned + generated + stitched a 3-line
Dialogue Scene with three distinct line texts, then built both
captioned reels exports. Frame extraction confirmed the captions
render visibly without obscuring the talking-head region above.

## Visual verification notes

- **Spokesperson Reels frame at t=2 s** — the saved Commercial
  Script wraps cleanly across 5 lines inside the bottom-safe
  caption box. The mock lavfi visual ("Mock Host" + "Origin
  Spark") sits well above the caption with no overlap.
- **Dialogue Reels frame at t=1 s** — line-1 caption ("Wait —
  captions are already burned into the file?") fills two lines
  in the box.
- **Dialogue Reels frame at t=7 s** — caption flips to line-2's
  text ("Yes. Per-line subtitles sync to the avatar's actual
  speech.") confirming the `enable=between(t,a,b)` time-gating
  works against the ffprobe-derived schedule.
- **Dialogue Reels frame at t=12 s** — line-3 text appears.
- The text box never covers the avatar's face (mock placeholder
  is a centered text block in the upper two-thirds; box sits in
  the bottom 200 px region).

## Limitations / follow-ups

- **No word-level timing.** The Spokesperson caption shows for
  the full clip duration; dialogue captions snap to whole-line
  segments. Real TikTok captions usually pop in/out by the word
  or phrase — a Tier-2 polish pass could call Whisper or
  Runway's per-word timestamps if they ever expose one.
- **No caption styling controls in the UI.** Font size /
  position / box opacity are pinned at the studio defaults.
  Wiring those to a brand-config field is one route arg.
- **No on-Dialogue-Scene-Ad (horizontal) captions.** Captions
  ride the vertical export only — the horizontal Dialogue Scene
  Ad stays caption-free. Adding horizontal captions later is a
  copy of the same `_dialogue_caption_schedule` against the
  stitched MP4 if anyone wants it.
- **Caption text files write under `data/finished/`** with a
  hidden `.` prefix and are removed in `try/finally`. If the
  process is killed mid-export, the temp `.txt` files remain;
  next export with the same campaign id overwrites them.
- **No automatic caption invalidation when `commercial_script`
  changes.** Same caveat as the underlying reels MP4: the user
  clicks **Rebuild Captioned Reels** to refresh.
- **Bright-pixel heuristic is not a real OCR check.** It proves
  *something* light-coloured is rendered in the bottom band but
  doesn't verify the exact text. Manual frame inspection is the
  authoritative visual check; OCR is intentionally out of scope.

## Recommended next slice

In priority order against the SESSION_011 Tier-1 list:

1. **Avatar `documentIds` for grounded realtime** — `POST /v1/documents`
   + `PATCH /v1/avatars/{id}` so the avatar can answer brand
   questions from grounded text instead of relying on the inline
   personality string. (`docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md`
   §12 Tier-1.)
2. **Conversation transcript retrieval** —
   `GET /v1/avatar_conversations/{id}` for "replay your chat".
3. **Brand colour storage** — small Character / Campaign field
   that the existing `build_reels_export` `backdrop_color`
   parameter would accept directly. Ties into both PR AG and
   future brand-themed captions / drawtext styling.
4. **Word-level caption timing** — only worth doing once a
   transcript-with-timing source is wired (probably falls out of
   the transcript retrieval slice above).
