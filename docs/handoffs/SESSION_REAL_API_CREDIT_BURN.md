# SESSION REAL-API — Controlled Runway Credit Burn

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `af48e28` (clean working tree, up to date
with `origin/main`).

## Goal

Burn remaining hackathon Runway credits on real-mode demo
asset generation before they expire. Log every API call so we
can show the demo committee exactly what came out of the real
pipeline.

**No frontend redesign work this session.** PR BH (mode-first
modal) is paused.

## Hard rules (carried from the brief)

- `IMAGE_GEN_PROVIDER=mock` is **NOT** set during this run.
  Real `RUNWAY_API_KEY` is loaded from `.env`.
- Servers killed/restarted before testing.
- Every real API action logged with timestamp + endpoint +
  status + output URL/path.
- No generated media committed.
- No infinite loops.
- Stop after enough demo-worthy outputs OR repeated real-mode
  failures.

## Pre-flight

| Check | Status |
|---|---|
| `git status` | clean working tree, on `main` at `af48e28` |
| `git pull --ff-only origin main` | already up to date |
| `RUNWAY_API_KEY` in `.env` | present (132 chars, prefix `key_1bb4…`) |
| `OPENAI_API_KEY` in `.env` | **not set** — concepts will mock; Runway visual / avatar / voice / dub / realtime / documents are real |
| `IMAGE_GEN_PROVIDER` | unset (defaults to real) |
| Servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` |

## Server boot — real mode

```
cd backend && source .venv/bin/activate
RUNWAY_API_KEY=<from .env> uvicorn app.main:app --port 8000 \
  > /tmp/uvicorn-real.log 2>&1 &
```

Health probe expectation: `runway_mock=false` while
`openai_mock=true` (no OpenAI key set), `image_gen_mock=false`.

**Confirmed:**

```
GET /health
{"status":"ok","service":"adspark-studio",
 "openai_mock":true,"runway_mock":false,
 "image_gen_mock":false,"any_mock":true}
```

`any_mock=true` is just because OpenAI is the only mocked
component; `runway_mock=false` is what matters for the visual
+ avatar + voice + dub + realtime + documents flows.

## API call log

Each row appended live during the run. Format:
`<ISO timestamp> · campaign · spokesperson · endpoint · status · output · notes`.

### Inventory before run

```
Characters (3, all avatar_status=ready):
  5f1b3738d084 Piper Voltage         voice='mock'  voice_id=mock_voice_…  ⚠️ avatar PATCHed with mock id
  d047894984a4 Brewster the Raccoon  voice=None    voice_id=None          ✅ pristine avatar, preset voice
  438916e176b1 Sir Landsloplot       voice='mock'  voice_id=mock_voice_…  ⚠️ avatar PATCHed with mock id

Linked campaigns (2 of 14):
  22fa0a246e33 FocusNet  → Piper  (host_status=ok, storyboard=ready, dialogue=ok)
                                  ⚠️ existing host MP4 is 16 KB / 720×720 → likely mock
  fc8a20c42bc5 CEO Buzz  → Brewster (host_status=ok)
                                    ⚠️ existing host MP4 is 16 KB / 720×720 → likely mock
```

**Strategy:** start with Brewster on CEO Buzz — pristine avatar
+ no mock voice id polluting the bind. Skip Piper-driven flows
unless we explicitly repair the voice patch (costs more credits
than we want for a re-bind we don't need to demo). Reuse the
existing storyboard-shot-1 (1.5 MB / real-sized) on FocusNet
where possible.

### API call log

| TS (UTC) | Campaign | Spokesperson | Endpoint / flow | Status | Output URL / path | Notes | Demo-worthy |
|---|---|---|---|---|---|---|---|
| 2026-05-09T21:30:32Z | CEO Buzz `fc8a20c42bc5` | Brewster the Raccoon `d047894984a4` | `POST /api/campaigns/{id}/spokesperson-ad` (real `avatar_videos`) | **200** in 44.3 s | `data/host/fc8a20c42bc5.mp4` (6.1 MB) | task `54cf1e7d-…`; `host_mock_mode=False`; ffprobe `1088×704` h264 + AAC 48kHz mono, **18.4 s**. Lip-synced narration of saved Commercial Script. | ✅ |
| 2026-05-09T21:33:19Z | CEO Buzz `fc8a20c42bc5` | Brewster | `POST /api/campaigns/{id}/spokesperson-ad/reels` (PR AG/AH ffmpeg) | **200** in 0.76 s | `data/finished/fc8a20c42bc5-spokesperson-reels.mp4` (1.3 MB) | ffprobe `720×1280` h264 + AAC, **18.4 s**, captioned via PR AH `drawtext` over the saved Commercial Script. | ✅ |
| 2026-05-09T21:34:52Z | CEO Buzz `fc8a20c42bc5` | Brewster | `POST /api/campaigns/{id}/commercial-with-voice` (ffmpeg `-stream_loop -1 -shortest`) | **200** in 1.37 s | `data/finished/fc8a20c42bc5-commercial-voice.mp4` (5.5 MB) | ffprobe `1280×720` h264 + AAC, **20.1 s** video / 18.4 s audio. Mux of cached cinematic visual + the new real Brewster narration. Not lip-synced (PR S/X by design). | ✅ |
| 2026-05-09T21:35:25Z | CEO Buzz `fc8a20c42bc5` | (n/a — campaign-level) | `POST /api/campaigns/{id}/realtime-document` (real `POST /v1/documents` + best-effort `PATCH /v1/avatars/{id}`) | **200** in 1.6 s | `runway_document_id=de68fe2c-2f39-4619-90f7-1037536852f2`; `runway_document_status=ready`; `runway_document_mock_mode=False` | Brand brief Markdown POSTed to Runway, returned a real document id, bound to Brewster's avatar. Realtime broker now passes `documentIds` on session create. | ✅ (proof of grounding) |
| 2026-05-09T21:35:52Z | CEO Buzz `fc8a20c42bc5` | (n/a) | `POST /api/campaigns/{id}/realtime-transcript` | **409** in 0.005 s | `no realtime session for this campaign yet` | Expected — no live session has been started. We deliberately skipped starting one to preserve credits; PR AJ + PR AI flows already proved end-to-end in mock mode. | n/a (sanity only) |
| 2026-05-09T23:26:53Z | CEO Buzz `fc8a20c42bc5` | Brewster the Raccoon `d047894984a4` | `POST /api/campaigns/{id}/spokesperson-ad` (real `avatar_videos`) — **PR BP validation** | **200** in 44.9 s | `data/host/fc8a20c42bc5.mp4` (6.3 MB) | task `cf7e6067-0a11-4dbb-be17-21169c5a0177`; `host_mock_mode=False`; ffprobe `1088×704` h264 + AAC 48kHz mono, **18.25 s**. Equivalent to one click of the new v2 Spokesperson Lane "Generate Real Spokesperson Ad" button. Fresh take overwrites the prior SESSION_REAL_API output (same script, same character, same avatar — slightly different lip-sync timing). | ✅ |

### Skipped flows + rationale

| Flow | Skipped because |
|---|---|
| Spokesperson Ad on FocusNet (Piper Voltage) | Piper's avatar was previously PATCHed with a mock voice id (`mock_voice_2feea13763d0fa58`); a real `avatar_videos` call against that bind would 502 because Runway doesn't recognize the id. Repairing would cost extra credits we don't need to demo. |
| Dialogue Scene (FocusNet has 3 planned lines) | Same reason — Piper is the primary speaker and her avatar voice bind is poisoned. Per-line render would 502. |
| Storyboard shot 2 / 3 + stitch (FocusNet) | Shot 1 already cached in real mode (1.5 MB / 1280×720 / 5 s). Generating shots 2 + 3 would burn 2× `image_to_video` credits for a Cinematic-mode demo we already have via the new Voiced Commercial. |
| Live realtime session start | Per brief — "only if practical." We have the grounding-doc proof point + transcript-fetch 409 sanity already; starting a live session would burn realtime credits without a recorded transcript to capture (one-shot consume + WebRTC + 5-min cap). |

## Outcome summary

### Demo-worthy assets (all real-mode, all gitignored)

```
1. CEO Buzz · Spokesperson Ad
   data/host/fc8a20c42bc5.mp4
   1088×704 · h264 + AAC mono 48kHz · 18.4 s · 6.1 MB
   Real lip-synced talking-avatar render. Brewster the Raccoon
   speaks the saved Commercial Script directly to camera.
   API: POST /v1/avatar_videos via /spokesperson-ad route.
   Runway task: 54cf1e7d-73da-414a-ad44-13961887a3d8

2. CEO Buzz · Spokesperson Reels (vertical, captioned)
   data/finished/fc8a20c42bc5-spokesperson-reels.mp4
   720×1280 · h264 + AAC · 18.4 s · 1.3 MB
   Letterbox of the lip-synced spokesperson cut + burned-in
   captions from the saved Commercial Script (PR AG + PR AH).
   ffmpeg-only post-processing — no Runway credits.

3. CEO Buzz · Voiced Cinematic Ad (horizontal)
   data/finished/fc8a20c42bc5-commercial-voice.mp4
   1280×720 · h264 + AAC · 20.1 s video / 18.4 s audio · 5.5 MB
   Cached image-to-video silent visual + real Brewster narration
   muxed via ffmpeg -stream_loop -1 -shortest. Visual is not
   lip-synced (intentional per PR S/X — "Final Voiced Cinematic
   Ad" spec).

4. CEO Buzz · Grounding document (proof point, no media file)
   runway_document_id = de68fe2c-2f39-4619-90f7-1037536852f2
   status = ready · mock_mode = false
   Real Brand-Brief Markdown stored on Runway + bound to
   Brewster's avatar. Future realtime sessions will ground
   answers in the brief instead of relying solely on
   personality + startScript.
```

### Recommendations for the hackathon demo

1. **Lead with #1 (Spokesperson Ad).** Open the campaign in
   the saved gallery, click the Character tab, play
   `host/fc8a20c42bc5.mp4`. Real lip-synced avatar speaking the
   campaign script — strongest "this is real Runway" proof.
2. **Show #2 (Spokesperson Reels) on a phone-shaped frame.**
   Vertical 720×1280 with burned-in captions reads as
   social-ready. Demonstrates the post-Runway ffmpeg pipeline
   that turns one render into a TikTok/Reels-shaped asset.
3. **Show #3 (Voiced Cinematic Ad) as the "B-roll" cinematic
   alternative.** Same script + same voice, different format.
   Demonstrates the modular generation graph.
4. **Show #4 in the Realtime tab.** The grounding card flips to
   `Document-grounded` (emerald) — proof that the avatar can
   ground answers in a Markdown brand brief on a real session.
5. **Talk through the Audit Trails (PR BB voice history,
   PR BC transcript history) in mock mode** — they're shipped
   and visible in the saved gallery without burning more
   credits.

### Failures / surprises

- **Zero real-mode failures.** All five real API calls
  returned 2xx (or the expected 409 for the no-session
  transcript probe). No 502s, no upstream Runway errors, no
  retries.
- **Brewster's clean avatar paid off.** The strategic
  decision to use the un-patched character over the
  mock-patched ones meant we never hit the "Runway doesn't
  recognize mock_voice id" failure mode.
- **Spokesperson Ad latency was 44 s end-to-end** (route call
  to JSON response). That's the avatar_videos task lifecycle
  including the poll-to-READY loop. Reasonable.

### Git status at end of session

```
git status:
  modified:   docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md  (this file)
  no other changes

Generated media:
  data/host/fc8a20c42bc5.mp4                       (gitignored ✅)
  data/finished/fc8a20c42bc5-spokesperson-reels.mp4 (gitignored ✅)
  data/finished/fc8a20c42bc5-commercial-voice.mp4   (gitignored ✅)
```

## Server stop

```
pkill -f "uvicorn app.main:app"   # killed at end of session
```

No frontend dev server was started this session — backend was
the only running process. Stopped at end.


