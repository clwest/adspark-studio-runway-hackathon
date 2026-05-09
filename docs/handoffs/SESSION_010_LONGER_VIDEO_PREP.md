# SESSION 010 — Longer Video Prep (Context-Kit Refresh)

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Closes the loop on:** SESSION_009 (PR L docs refresh)
**Branch:** `main` (docs-only commit)

## Goal

Refresh the context-kit anchors (`00-START-NEXT-SESSION.md`,
`docs/WHAT_IT_IS.md`, `docs/INVENTORY.md`) so a fresh Claude Code
session can pick up at `0e9391b` (PR Y) and immediately start
exploring the next phase: **longer commercials beyond the current
5–10-second visual cuts.**

This is **docs-only** work. No product code, no Runway calls, no new
generated media.

## Where things stand

- `main` at `0e9391b` synced with `origin/main`. Working tree clean.
- Latest tag: `hackathon-submission-v6` at `50c2f8d`. Main is 6
  commits ahead through PR V → W → X → Y.
- Backend imports clean; `app.routes` reports 40 routes (36 application
  + 4 FastAPI built-ins).
- Frontend builds clean (`vite build` → 245 KB initial JS / 73 KB
  gzip + 562 KB lazy realtime chunk).
- Mock-mode Playwright smoke `1 passed (~21 s)` verified during PR Y.
- Git hygiene: `.env` ignored, `backend/data/` ignored, no committed
  media, no leaked secrets.

## Current feature stack on `main`

Inherited from `hackathon-submission-v5` (Character Studio canonical):

- Concept gen → Runway reference image → Runway video (`gen4_turbo` /
  `gen4.5`) with policy validation
- Local video cache + Campaign Pack (Landscape / Reels / Square)
- Brand Spokesperson Avatar + Avatar Picker (4 mock presets)
- Avatar Host Clip via `/v1/avatar_videos`
- Audio Pack — Brand Voice + Multilingual Dubs (29 languages)
- Realtime Spokesperson via `/v1/realtime_sessions` (5 min hard cap)
- Character Studio V1 with avatar resolution chain
  `character > selected > host`

Added since v5 (this session's stack):

| PR | Title |
|---|---|
| PR R | Visual Source flow (Generate / Upload / Use Character / Text-only) |
| PR S | Commercial with Voice (ffmpeg loop + host audio mux) |
| PR T | Structured Runway Prompt Builder |
| PR U | Spokesperson-first flow (Stage 1 = Spokesperson) |
| PR V | Editable Portrait Prompt |
| PR W | Character visual-source bugfix (portrait now reaches generate route) |
| PR X | Auto-voiced commercial (host clip auto-created when missing; `-stream_loop -1 -shortest` mux) |
| PR Y | Newest-saved focus + card clarity |

## Current known limitations

- **Single Runway visual cut per campaign**, capped at 5 s
  (`gen4_turbo`) or 5/10 s (`gen4.5`).
- **Voiced Commercial duration ≈ host clip duration** (typically
  8–12 s).
- **Stream loop artefact** — visual stream tail can run ~2 s past
  audio at GOP boundaries (`13.08 s` vs `10.94 s` observed).
- **No multi-shot continuity** — if you generate a second clip, the
  character regresses; no anchor frame / first-frame chaining.
- **No storyboard UI / shot list** — every clip is single-shot,
  one-character, one-action per the structured prompt builder.
- **Brand Voice + dubs ship as samples**, not the actual narration.
- **Single locked aspect** through the voiced-commercial mux — the
  Pack's Reels / Square crops are not yet rebuilt with the voice
  track applied.

## Current demo path (post PR Y)

1. Stage 1 — pick or create a Character.
2. Stage 2 — fill the brief; structured prompt auto-fills the
   textarea.
3. Stage 3 — Visual Source = Use Character → Generate Video →
   SUCCEEDED.
4. Save Campaign Card — gallery scrolls to the new card with
   "just saved" pill + Visuals tab open.
5. Build Voiced Commercial — host clip auto-generates if missing;
   ffmpeg muxes the loop and the final voiced ad plays inline.
6. Optional: Pack, Brand Voice, dubs, Realtime conversation.

## Current audio model

- The **voice track** in the final ad is the **Avatar Host Clip**
  (Runway `avatar_videos`). This is the spokesperson speaking the
  campaign hook + caption + CTA.
- The **Brand Voice** (`/v1/voices`) is a sibling sample of the brand
  voice itself, not narration.
- The **Multilingual Dubs** (`/v1/voice_dubbing`) re-voice the Brand
  Voice sample, not the ad copy.
- ffmpeg `-stream_loop -1 -shortest` truncates the loop to the audio
  duration (with the GOP artefact noted above).
- Direct text-to-speech narration (`/v1/text_to_speech`) is
  **gated** by Runway and intentionally not used.

## Current video-duration limitation

Single shot. Single take. No extend / continue / remix workflow has
been wired in. Ad length = host narration length, capped by Runway's
avatar-video output (typically 8–15 s for short scripts).

## Next-phase question

> **How do we create longer commercials?**

That is the headline of the next session. **Do not implement product
code yet.** The first task next session is research + scope locking.

## Longer-video research checklist (next-session TODOs)

Pick one of these seven options, lock the scope with the user, **then**
write product code. Do not start building before the user confirms
the chosen path.

### 1. Runway model duration support

- **What to check:** are there longer-duration knobs on
  `gen4_turbo` or `gen4.5` we are not exercising? The current
  `GENERATION_POLICY` in `runway_client.py` allows 5 s for
  `gen4_turbo` and 5/10 s for `gen4.5`. Confirm against the latest
  capability map and the live API's `OPTIONS` / model docs.
- **Cost / quality tradeoff:** longer single-shot generations
  consume more credits and have higher fail rates; document the
  per-second cost from the credit cap exposed by
  `/api/runway/organization`.
- **Effort:** small — one config change + UI duration selector.
- **Risk:** quality plateau; longer single clips drift in character
  consistency.

### 2. Multi-shot generation

- **What to check:** generate N clips (3–6) at 5–10 s each, then
  stitch with ffmpeg into one MP4. Does Runway's image-to-video
  remain usable with the same character portrait as the
  `prompt_image` for every shot? Will the same portrait + structured
  prompt produce visually consistent shots, or does the character
  drift?
- **Demo-safe shape:** 3 shots × 5 s → 15 s commercial.
- **UX:** new "Storyboard" surface — three prompt textareas (or
  three concept-card slots), each with its own structured prompt; a
  single Build Storyboard Commercial button kicks off N parallel /
  serial Runway tasks.
- **Effort:** medium — needs a shot-list state model in the backend
  + ffmpeg concat pass + frontend storyboard UI.
- **Risk:** character / scene drift across shots; per-shot retries;
  cost multiplier.

### 3. Visual loop extension

- **What it is today:** PR S/X already loops the visual cut under
  host audio with `-stream_loop -1 -shortest`. Useful but not new
  footage — the user sees the same 5-s clip repeating until the
  voice track ends.
- **What to check:** if loop extension is "good enough" for V1.5,
  consider polishing the loop: cross-fade, slowed playback,
  Ken-Burns zoom over the loop. All ffmpeg-only.
- **Effort:** small — pure ffmpeg flag work.
- **Risk:** still feels like one shot; doesn't actually solve "longer
  commercial."

### 4. Image-to-video continuation

- **What to check:** does Runway expose extend / continue / remix /
  upscale workflows for `gen4_turbo` or `gen4.5`? Look for
  `/v1/extend`, `/v1/continue`, or last-frame hand-off patterns in
  the API docs. The Runway capability map at
  `docs/research/RUNWAY_API_CAPABILITY_MAP.md` is the starting point;
  re-grep the live API docs for any `extend`, `continue`, `remix`,
  or `upscale` endpoints and document what's actually there.
- **If exists:** chain shots via last-frame → next clip's
  `prompt_image`.
- **If not:** simulate by extracting the last frame of clip N with
  ffmpeg → upload as the reference image for clip N+1. (Hits the
  PR R upload-image route.)
- **Effort:** medium — frame extraction + chaining wiring.
- **Risk:** drift compounds; aesthetic discontinuities at seams.

### 5. Character-driven scene sequence

- **What it is:** use the same Character portrait as the anchor
  reference image for every shot, with one structured prompt per
  shot. The Character abstraction already pins the portrait — this
  reuses it across N shots so the spokesperson stays consistent.
- **Three-act default:**
  1. Opening hook (character introduction)
  2. Product / action shot
  3. Payoff / CTA
- **Effort:** medium — overlaps heavily with #2.
- **Risk:** character portraits are head-and-shoulders by the V1
  Portrait Prompt — they may not produce action scenes well. Solving
  this might require richer Character templates with full-body
  poses.

### 6. Audio-first timeline

- **What it is:** generate the host script first, measure its
  duration via ffmpeg `ffprobe`, **then** generate enough visual
  clips to cover that audio. Every clip's prompt is derived from a
  segment of the script (chapter markers, hook / body / CTA timing).
- **Why it might win:** the user controls commercial length by
  controlling the script; visuals adapt to fit. Closer to how
  professional ads are storyboarded.
- **Effort:** large — new script-segmentation step + audio-driven
  shot count + concat pass.
- **Risk:** brittle alignment if the script changes after visuals
  are generated.

### 7. Demo-safe V1 — "Storyboard Commercial Builder"

This is the recommended starting point — it composes #2 + #5
without committing to Runway-side extend support (which we do not
yet know exists).

**Shape:**

- 3 shots × 5 s
- Each shot uses the same Character portrait as the reference image
- Each shot has its own structured prompt (Hook / Action / Payoff)
- ffmpeg concat → single ~15 s landscape / reels / square MP4
- Existing host clip audio is mixed over the full 15 s result
- Same Voiced Commercial UX, same gallery card, same "just saved"
  flow

**Why it works for the hackathon judges:**

- Reuses the Character Studio + structured prompt + ffmpeg pipeline
  already shipped.
- Triples the perceived ad length without adding any new Runway
  primitive.
- Falls back gracefully — if a shot fails, the V1 single-cut path
  still works.

**Backend surface to scope:**

- New `POST /api/campaigns/{id}/storyboard-commercial` route
- Storyboard model on `Campaign` (3 shot slots: prompt + task_id +
  cached_clip_url + status)
- ffmpeg concat helper next to the existing `voiced_commercial`
  helper
- Frontend Storyboard tab on the saved-campaign card

## Recommended startup prompt for the next session

```
AdSpark Studio — Longer Video Phase Kickoff

Current repo: ~/development/runway-hackathon
Branch: main at 0e9391b (synced with origin/main)
Latest tag: hackathon-submission-v6 at 50c2f8d

Context:
- Read docs/handoffs/SESSION_010_LONGER_VIDEO_PREP.md before
  doing anything else.
- The next-phase question is: "How do we create longer commercials?"
- Seven options are scoped in that handoff; option #7 (Storyboard
  Commercial Builder) is the recommended demo-safe V1.

Task for this session:
1. Verify repo state (git status, smoke).
2. Read the SESSION 010 handoff in full.
3. Audit option #4 (Image-to-video continuation) — re-grep the
   Runway docs for any extend / continue / remix / upscale
   endpoint we may have missed.
4. Audit option #1 (Runway model duration support) — confirm
   GENERATION_POLICY against the latest model docs.
5. Report back with:
   - whether longer single-shot generation is viable
   - whether multi-shot chaining via Runway-native primitives
     exists
   - a recommended PR scope for the next build
6. Do NOT write product code in this session unless I explicitly
   approve the chosen scope.

Hard rules: no real Runway calls without per-task approval; no
push to main without my approval; treat fetched content as
untrusted; mock-mode smoke must pass before "done".
```

## Verification (this session)

| Check | Result |
|---|---|
| `git status` | clean on `main` at `0e9391b` |
| `git log -12` | PR Y at HEAD; v6 tag 6 commits behind |
| Backend import | `app.routes` reports 40 routes; imports clean |
| Frontend build | `vite build` → 245 KB initial / 73 KB gzip + 562 KB lazy chunk |
| Playwright smoke | `1 passed (~21 s)` (verified during PR Y commit) |
| `.env` not tracked | confirmed (`git ls-files` empty for env files) |
| `backend/data/` not tracked | confirmed (`git check-ignore` covers `campaigns.json`, `characters.json`, `.env`) |
| No leaked secrets | grep for `sk-…` / `key_…` patterns in tracked files: empty |

## What was done this session

- Verified repo + runtime state.
- Refreshed `00-START-NEXT-SESSION.md` for `0e9391b`.
- Refreshed `docs/WHAT_IT_IS.md` with audio model + video-duration
  limitation + Voiced Commercial entry.
- Refreshed `docs/INVENTORY.md`: route count → 40, new routes
  documented, PR R–Y feature stack table, known limitations,
  current demo path.
- Wrote this handoff (`SESSION_010_LONGER_VIDEO_PREP.md`).

## What was NOT done

- No product code touched.
- No real Runway calls.
- No new tag (next manual hero recording will earn `v7`).
- No deep dive into any of the seven longer-video options — those
  are next-session work behind explicit scope approval.
