# SESSION 023 — Cloned Voice Preview Surface (PR AR)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AR patch in flight on top of `ec35c0e`
`feat: patch existing avatar with cloned voice`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_022 (PR AQ Avatar Voice Swap), SESSION_021
(PR AP Recording Preview), SESSION_020 (PR AO Browser Recording),
SESSION_019 (PR AN Custom Voice Cloning), SESSION_018 (PR AM
Caption Contrast), SESSION_017 (PR AL Transcript Export),
SESSION_016 (PR AK Brand Colour), SESSION_015 (PR AJ Transcript
Replay), SESSION_014 (PR AI Avatar Documents), SESSION_013
(PR AH Captioned Reels), SESSION_012 (PR AG Vertical Reels),
SESSION_011 anchors at `ec446e4`.

## Goal

Close the voice-identity UX loop. The arc is:

1. **Record / upload** → PR AN/AO/AP captured a sample.
2. **Clone** → PR AN turned the sample into a Runway voice id.
3. **Apply** → PR AQ swapped the cloned voice into the existing
   avatar without a recreate.
4. **Preview** → PR AR (this slice) lets operators **hear** the
   cloned result inline before they wire it into ads / realtime
   sessions.

Hard scope locks (carried forward from the brief):
- No voice library management.
- No voice deletion.
- No waveform / VU meter.
- No UI redesign.

## Endpoint inventory

PR AR adds **no new routes**. Route count stays at **66**.

The brief preferred avoiding a new route if the clone flow
already captures the URL reliably — and it does. The same poll
loop that watches for `READY` (PR AN) now also captures the
`previewUrl` from whichever poll response carries it.

A `fetch_voice_preview(voice_id, settings)` helper is added in
the same module so a future refresh route would be a one-liner;
no caller wires it today.

## What changed

### Backend

- **`backend/app/services/voice_clone_client.py`**:
  - **`_extract_preview_url(payload) -> Optional[str]`** —
    tolerant key-walker that accepts `previewUrl` /
    `preview_url` / `preview`, returns `None` for missing /
    empty / non-string / non-dict inputs. Pure helper; covered
    by the targeted probe.
  - **`_create_voice_real(...)`** — return type widened to
    `(voice_id, final_status, preview_url)`. The poll loop now
    keeps the last full payload it received so the caller can
    extract `previewUrl` from whichever poll response flipped
    status to `READY`.
  - **`VoiceCloneResult`** gained `preview_url: Optional[str]`.
    Mock branch returns `None` (no playable URL); real branch
    threads the value through from `_create_voice_real`.
  - **`fetch_voice_preview(voice_id, settings)`** — new
    best-effort helper (`GET /v1/voices/{id}` →
    `_extract_preview_url`). Returns `None` in mock mode + when
    the voice id is mock + on any HTTP / network error. Never
    raises.
- **`backend/app/models.py`** — one new optional `Character`
  field: `custom_voice_preview_url: Optional[str] = None`.
- **`backend/app/routers/characters.py`** —
  `post_clone_voice` now persists `custom_voice_preview_url=
  result.preview_url` alongside the existing PR AN/AQ fields.
  Same atomic `CharacterStore.update(...)` call.

### Frontend

- **`frontend/src/components/CharacterCard.jsx`**:
  - **New "Cloned voice preview" block** appended to the
    voice section (after the PR AQ helper line). Two render
    branches:
    1. `customVoiceReady && c.custom_voice_preview_url` →
       compact `Cloned voice preview` label + native
       `<audio controls src=preview_url preload="metadata">`
       with `data-testid="custom-voice-preview"`.
    2. `customVoiceReady && !c.custom_voice_preview_url` →
       single helper line *"Preview unavailable in mock mode."*
       (when `customVoiceMock`) or *"Preview unavailable for
       this cloned voice."* (otherwise) with
       `data-testid="custom-voice-preview-unavailable"`.
  - Distinct from PR AP's recorded-take preview, which lives
    inside the **Or record** row above and renders the
    pre-clone Blob.
- **`frontend/tests/adspark-smoke.spec.js`** — new resilient
  assertion: `previewAudio + previewUnavailable <= patchPills`.
  This holds whether the library has zero cloned voices, all
  mock clones (preview_url=None → unavailable copy), or
  real-mode clones (preview_url set → audio element). The
  combined count is bounded above by the patch-pill count
  (one per cloned voice).

### Docs

- `docs/INVENTORY.md` — service inventory, feature stack reflect
  PR AR; route count narrative confirms unchanged at 66.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 gained a
  "Hearing the cloned voice (PR AR)" subsection covering the
  audio element, helper text, and the recorded-take vs cloned
  preview distinction.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AR is one
  finishing step on top of PR AN/AQ already documented in
  entry 8.
- `00-START-NEXT-SESSION.md` — Character-layer section,
  next-phases checklist, build sizes / route count.
- `docs/handoffs/SESSION_023_CLONED_VOICE_PREVIEW.md` — this
  file.

## Preview URL source / payload behavior

```
POST /v1/voices  body={name, from:{type:audio, audio:<data-uri>}}
  ↓ create response → {id, status, ...}
GET /v1/voices/{id}  (poll every 3s until READY/FAILED, max 90s)
  ↓ each poll response saved into last_payload
on READY:
  preview_url = _extract_preview_url(last_payload)
                  ├─ payload["previewUrl"]      (Runway docs)
                  ├─ payload["preview_url"]     (snake-case rename)
                  └─ payload["preview"]         (legacy)
                  → empty/whitespace = None
                  → non-string = None
return (voice_id, "READY", preview_url)
```

The audio_client's PR H text-design path uses `previewUrl` (the
existing real-mode contract), so audio-clone follows the same
Runway shape. The tolerant walker is defensive against future
casing changes — a server-side rename to `preview_url` or
`preview` won't silently drop the URL on AdSpark's side.

`fetch_voice_preview(voice_id, settings)` exposes the same
extraction for any future refresh route. Today the clone flow
captures the URL reliably so no separate refresh surface is
wired.

## Mock behavior

| Probe | Result |
|---|---|
| Default `Character` payload | `custom_voice_preview_url` field present, default `None` ✅ |
| Mock-mode clone | `voice_id = mock_voice_<sha>`, `custom_voice_preview_url = None`, `custom_voice_mock_mode = True` ✅ |
| `_extract_preview_url({"previewUrl": "https://…"})` | the URL ✅ |
| `_extract_preview_url({"preview_url": "https://…"})` | the URL ✅ |
| `_extract_preview_url({"preview": "https://…"})` | the URL ✅ |
| `_extract_preview_url({"previewUrl": "  "})` | None ✅ (whitespace trimmed) |
| `_extract_preview_url({})` | None ✅ |
| `_extract_preview_url("garbage")` | None ✅ (non-dict) |

UI branch (`customVoiceMock` true + `custom_voice_preview_url`
null) renders *"Preview unavailable in mock mode."* — the brief's
explicit fallback when no playable mock URL is practical.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **66** (unchanged) ✅ |
| `vite build` | 317.95 KB initial / 89.43 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (22.8 s)` ✅ |
| `_extract_preview_url` coverage probe | 6/6 cases match expected ✅ |
| Mock-mode clone probe | persisted `custom_voice_preview_url=None` cleanly; UI shows unavailable copy ✅ |
| Hygiene scan (incl. `\.webm`) | empty ✅ |
| Drift guard | `✅ context-kit anchors look recent.` ✅ |

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200
```

After every backend code change in PR AR (helper, poll-payload
change, model field, route persist), the backend was killed and
restarted before the probe + smoke. Each verification ran
against fresh code. Servers are stopped at the end of the
session.

## Limitations / follow-ups

- **Real-mode preview not exercised this session.** The mock
  smoke + helper coverage proves the wire-level state machine
  and UI rendering branches; testing the real `previewUrl`
  capture would need a real Runway key, which is out of scope.
- **No refresh-preview route.** A `fetch_voice_preview` helper
  exists for the future, but no operator-facing surface calls
  it today. If a previously cloned voice never got a preview
  URL (poll timeout edge case), the operator would need to
  re-clone to refresh — a small `POST /api/characters/{id}/refresh-voice-preview`
  is a one-liner if it ever matters.
- **Preview audio doesn't auto-play.** Browsers correctly block
  autoplay-with-audio; the operator clicks play. The
  `preload="metadata"` hint loads the duration without buffering
  the full file.
- **No transcoding.** Runway's `previewUrl` is whatever Runway
  serves (typically MP3); modern browsers handle it. Older
  Safari might fall through to a not-supported audio element —
  same compatibility envelope as PR AP/AO.
- **No CSP / authentication on the preview URL.** Runway's
  served URL is presigned; AdSpark just renders it as the
  `<audio src>`. If Runway changes their preview URL auth
  policy in the future, the audio element silently fails.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR slices are
all ✅ shipped. Next-tier candidates:

1. **Avatar resource introspection** — `GET /v1/avatars/{id}`
   after the PR AQ PATCH and surface the resolved voice on the
   character record so the operator can confirm the bind.
2. **Refresh-voice-preview route** — wire `fetch_voice_preview`
   to a small `POST /api/characters/{id}/refresh-voice-preview`
   so a missing preview can be re-fetched without a full clone.
3. **Live mic level meter** — `AnalyserNode` + tiny canvas bar
   so the operator knows the mic is hot before recording.
4. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ so operators maintain multiple
   session replays.
5. **Voice swap A/B** — quickly toggle a character between
   preset voice and cloned voice via two `/apply-voice` payload
   shapes; useful for demos.

Each is a 1–2 hour slice. None blocking.
