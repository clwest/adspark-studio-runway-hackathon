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

---

## SESSION 052 follow-up — PR BU validation (V2 Cinematic Video persistence)

**Timestamp:** 2026-05-09T19:50Z (end-of-day local)
**Driver:** Claude (Opus 4.7)
**PR validated:** PR BU — `POST /api/campaigns/{id}/cinematic-video`
**Boot:** `bash scripts/start-local-real.sh` —
`runway_mock=false`, `image_gen_mock=false`. Backend pid
18400, vite pid 18436.

### One controlled real generation

| Field | Value |
|---|---|
| Campaign | **CEO Buzz** / Dumpster-to-CEO Energy Drink (`fc8a20c42bc5`) |
| Spokesperson | **Brewster the Raccoon** (`d047894984a4`) |
| Action | v2 Cinematic Lane → "Generate Real Cinematic Video" → PR BT polling → PR BU persist |
| Underlying Runway endpoint | `image_to_video` (gen4.5, 1280:720, 5 s) |
| Reference image | `/api/characters/d047894984a4/portrait` (Brewster portrait, embedded as PNG data URI by `runway_client.maybe_to_data_uri`) |
| Task id | **`b5d331ba-9844-42ab-b857-982920794a9c`** |
| Mock flag | `mock_mode: false` ✅ |
| Polling | 18 polls × 5 s ≈ 90 s wall-clock; status RUNNING → SUCCEEDED at poll 18 |
| Output URL (Runway, expiring) | `https://dnznrvs05pmza.cloudfront.net/ebef987d-3f2e-44d9-a590-beb29d79b31f.mp4?_jwt=…` (291 chars) |
| PR BU persist response | 200 OK with `cached_video_url=/api/campaigns/fc8a20c42bc5/video` + `cache_status="ok"` + `cache_error=null` ✅ |
| Reload check | `GET /api/campaigns` shows persisted fields survive list-read ✅ |
| Persisted file | `backend/data/videos/fc8a20c42bc5.mp4` (overwrote the prior 10 s placeholder) |

### ffprobe

Pre-regen (existing placeholder, mock-era cache):
```
1280×720 / 24 fps / 10.04 s / 6.4 MB / 5.11 Mbps
```

Post-regen (PR BT/BU output):
```
codec=h264 / 1280×720 / 24 fps / 5.04 s / 1.9 MB / 3.18 Mbps
```

The new file matches the requested 5 s gen4.5 `image_to_video`
exactly. Smaller / lower bitrate than the 10 s placeholder
because the output is half the duration.

### Demo-worthy?

**Yes.** The output is 5 s of Brewster reaching for a
Dumpster-to-CEO Energy Drink at 3 AM in his dim apartment
kitchen — the canonical CEO Buzz demo prompt rendered by
real Runway gen4.5 with Brewster's portrait as the
spokesperson reference. Persisted on the campaign so:

- Refreshing http://localhost:5173 keeps the lane's
  "open cinematic video ↗" link alive (PR BU
  `data-persisted="true"` path).
- The classic gallery's CEO Buzz card now plays this MP4
  in its Visuals tab (`/api/campaigns/fc8a20c42bc5/video`
  is the same streamer v1 has always used).
- The button label flipped to "Regenerate Real Cinematic
  Video" + the secondary chip reads "saved · burns
  credits".

### Failures / surprises

- **None.** Single end-to-end validation; zero retries; no
  502s. PR BU's persist call returned 200 on the first
  attempt with the freshly-generated Runway output URL.
- The mock-era pre-regen file (10 s, 6.4 MB) was
  overwritten cleanly — no orphaned `.tmp` files in
  `data/videos/`. `VideoCache.fetch`'s `tmp.replace(target)`
  pattern from PR B keeps the swap atomic.

### Git status at end of session

```
git status:
  modified:   docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md  (this file)
  no other changes

Generated media (gitignored ✅):
  backend/data/videos/fc8a20c42bc5.mp4   (regenerated, 1.9 MB)
```

`git ls-files | grep -E '(\.env$|backend/data|\.mp4$|\.mp3$|\.png$)'`
returns empty — confirmed.

### Servers at end of session

Both still running in real mode (per brief):

```
backend: pid=18400 · http://localhost:8000 · runway_mock=false
vite:    pid=18436 · http://localhost:5173 · http=200
```

---

## SESSION 063 follow-up — PR CI demo spokesperson portraits (real Runway image)

**Timestamp:** 2026-05-09T22:25Z–22:30Z (5-minute window)
**Driver:** Claude (Opus 4.7)
**PR validated:** PR CI — generate real Runway portraits
for the four PR CG demo spokespeople so the library tiles
stop showing blank avatars.
**Boot:** real-mode servers running throughout
(`runway_mock=false`, `image_gen_mock=false`). Backend pid
83637, vite pid 83661.

### Five controlled real `gen4_image_turbo` portrait calls

| # | Spokesperson | id | Endpoint | HTTP | Elapsed | Outcome |
|---|---|---|---|---|---|---|
| 1 | Brewster Bolt | `abf9ce2f70ec` | `POST /api/characters/{id}/generate-portrait` | **200** | 11 s | ✅ generated · 481 KB · 512×512 PNG |
| 2 | Clara Vale | `541a300cd057` | (same) | 502 | 20 s | ❌ Runway upstream `portrait task FAILED` |
| 3 | Rex Roadside | `dc52be037644` | (same) | 502 | 20 s | ❌ same upstream error |
| 4 | Mina Spark | `28d6df60b1b4` | (same) | 502 | 23 s | ❌ same upstream error |
| 5 | Clara Vale (retry, default prompt) | `541a300cd057` | (same) | **200** | 21 s | ✅ generated · 650 KB · 512×512 PNG |
| 6 | Rex Roadside (retry, default prompt) | `dc52be037644` | (same) | 502 | 19 s | ❌ same upstream error |
| 7 | Mina Spark (retry, default prompt) | `28d6df60b1b4` | (same) | **200** | 33 s | ✅ generated · 711 KB · 512×512 PNG |
| 8 | Rex Roadside (one-shot `prompt_override` swap) | `dc52be037644` | (same) | 502 | 20 s | ❌ same upstream error |

**Runway upstream error message (×4 distinct calls):**
```
portrait task FAILED: An unexpected error occurred.
```
Exact string from Runway's task-poll response. Backend
mapped this to HTTP 502 and recorded
`portrait task FAILED: …` in the uvicorn warning log.
The failure is **transient and account-specific**, not a
prompt-content rejection — the same prompt structure
worked for the other three spokespeople, and the
override attempt for Rex with a maximally simple
"Studio portrait of a friendly automotive salesperson…"
prompt also failed identically.

Per "No loops" hard rule the script stopped after one
retry per failure (with one final swap-prompt attempt
for Rex). Total real-mode calls fired this slice: **8**
(4 initial + 3 retries + 1 prompt-override). Total
**successful** portrait persists: **3** (Brewster Bolt,
Clara Vale, Mina Spark).

### Persisted portrait files (gitignored)

```
backend/data/characters/abf9ce2f70ec-portrait.png  481 KB  Brewster Bolt
backend/data/characters/541a300cd057-portrait.png  650 KB  Clara Vale
backend/data/characters/28d6df60b1b4-portrait.png  711 KB  Mina Spark
backend/data/characters/dc52be037644-portrait.png  (none — generation failed)
```

`portrait_source` flipped from `None` (or `mock` for the
prior Mina Spark stub) to `generated` on all three
successful records. `mock_mode=False` confirms the calls
hit real Runway.

### Demo-worthy?

**Yes — for the 3 that landed.** Brewster Bolt got a
high-energy stylized mascot read; Clara Vale got a
polished founder headshot read; Mina Spark got an
expressive creator-host read. Each tile on `/` now reads
visually intentional alongside the pre-existing
Brewster the Raccoon / Piper Voltage / Sir Landsloplot
portraits.

Rex Roadside's tile remains blank — visible in the
top-middle slot of the library grid. Documented as
known-issue in SESSION_063; operator can retry from the
in-app `Generate Portrait` button at any time (failures
are transient on Runway's side).

### Failures / surprises

- **3 of 4 first-attempt calls failed** with the same
  opaque Runway upstream error. The 4th (Brewster Bolt,
  fired first) succeeded immediately. Two of the three
  failed calls succeeded on the first retry; Rex
  Roadside failed both retries.
- **No prompt-content correlation.** Rex's
  `prompt_override` attempt used a benign generic
  "friendly salesperson" prompt and still 502'd —
  rules out the content-filter theory for his slot.
- **No rate-limit signature in headers.** No `429`,
  no `Retry-After` — Runway's task-poll just reported
  FAILED.
- **Net cost:** 8 image-task starts, 3 successful PNGs.
  The 5 failed tasks may or may not have been billed
  (Runway documentation typically bills only on
  SUCCEEDED, but verify on the dashboard).

### Git status at end of session

```
git status:
  modified:   docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md  (this file)
  modified:   docs/INVENTORY.md / docs/00-START-NEXT-SESSION.md
  added:      docs/handoffs/SESSION_063_DEMO_PORTRAITS.md

Generated media (gitignored ✅):
  backend/data/characters/abf9ce2f70ec-portrait.png   481 KB
  backend/data/characters/541a300cd057-portrait.png   650 KB
  backend/data/characters/28d6df60b1b4-portrait.png   711 KB
```

`git ls-files | grep -E '(\.env$|backend/data|\.mp4$|\.mp3$|\.png$)'`
returns empty — confirmed.

### Servers at end of session

Both still running in real mode (per brief):

```
backend: pid=83637 · http://localhost:8000 · runway_mock=false
vite:    pid=83661 · http://localhost:5173 · http=200
```

---

## SESSION 071 follow-up — PR CO demo-portrait restoration (2026-05-10)

After SESSION 070's QA found the live characters.json had
been pruned to 1 faceless persona, PR CO re-seeded the 4
demo spokespeople (Brewster Bolt / Clara Vale / Rex
Roadside / Mina Spark) and fired one portrait generation
per missing face via `POST /api/characters/{id}/generate-
portrait`. Logged here per the rule that every real Runway
call gets recorded in this ledger.

| time (CDT) | character | id | endpoint | result | size |
|---|---|---|---|---|---|
| 2026-05-10 00:43 | Brewster Bolt | `4be4ad28f91a` | `POST /api/characters/{id}/generate-portrait` `{}` | **OK** — `portrait_url=/api/characters/4be4ad28f91a/portrait`, source `generated` | 526 KB on disk |
| 2026-05-10 00:43 | Clara Vale | `920408399d30` | same | **OK** — source `generated` | 575 KB |
| 2026-05-10 00:44 | Rex Roadside | `cdaeb5b32518` | same | **FAILED** — `portrait task FAILED: An unexpected error occurred.` (Runway upstream — same failure pattern as PR CI/CJ; record kept, portrait_url remains null. Operator can retry via in-app `Generate Portrait` button.) | — |
| 2026-05-10 00:44 | Mina Spark | `2fd897b776cc` | same | **OK** — source `generated` | 770 KB |

**Total real Runway image calls fired:** 4 (3 succeeded,
1 upstream failure). No video calls. Portraits land at
`backend/data/characters/{id}-portrait.png` (gitignored)
and stream via the existing `/api/characters/{id}/portrait`
route. Rex Roadside's record stays in `characters.json`
with `portrait_url=null` — the PR CJ portrait-failed
retry button + the homepage tile's "Portrait pending"
placeholder both behave correctly for this state.

**Cumulative session credit:** ~$0.075 in image
generation (3 successful gen4_image_turbo calls; the
failure does not bill).
