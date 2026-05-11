# `speech.type=audio` Long Ad Rewrite — Probe Findings + PR EA Plan

**Status:** Parked. Plumbing landed (PR DZ-b); plan validated to the
TTS-source decision; PR EA paused for other work.

**Date:** 2026-05-10. Pick up from here when ready.

---

## TL;DR

- Runway's `/v1/avatar_videos` **does accept** `speech.type=audio` at
  long durations (verified 42s, drift -0.04s, single 200 OK). The
  documented "1–15s typical" duration in
  `RUNWAY_AVATAR_API_DEEP_REVIEW.md` §4 only applies to the text path.
- Runway's `/v1/voices/preview` is **not** a "TTS arbitrary text in
  voice X" endpoint. It's an ElevenLabs voice-DESIGN audition endpoint
  (`{prompt, model: "eleven_ttv_v3"|"eleven_multilingual_ttv_v2"}`).
- **No Runway endpoint TTSes arbitrary text in a specific avatar's
  bound voice.** The whole `/v1/voices` family designs voices, it
  doesn't synthesize scripts.
- PR EA Long Ad rewrite needs an **external TTS source**. Build body
  is already audio-ready (PR DZ-b's `build_avatar_video_body`).
  Plumbing the orchestrator + adding a per-character TTS voice field
  + wiring an external TTS provider is what remains.

---

## What's already shipped

| PR | Status | Files |
|---|---|---|
| **DY** | merged | `scripts/probe-avatar-videos-audio.py` (one-shot Runway probe) |
| **DZ-a** | merged | `scripts/probe-voices-preview.py` (one-shot voices/preview probe) |
| **DZ-b** | merged | `backend/app/services/long_ad_service.py` — extracted `build_avatar_video_body(avatar_id, *, chunk_text, audio_source)` pure helper; orchestrator still passes `chunk_text` so behaviour unchanged. 3 unit tests cover both branches + invalid combos. |

`_render_chunk_real` in `long_ad_service.py` is the wire-up point: it
already accepts `audio_source` as a keyword. PR EA wires the
orchestrator to pass `audio_source` instead of `chunk_text`.

---

## PR DY findings — `speech.type=audio` works at scale

Probe: 42.11s macOS `say`-generated MP3 → data URI → single
`POST /v1/avatar_videos` call against Riggs's avatar
(`992b4dc1-b0c4-4bf6-a06c-d26bd9fb2a9a`).

```
audio in:    42.11s          (~3× the documented 15s text-typical)
video out:   42.07s
drift:       -0.04s          (no silent truncation)
HTTP:        200             (accepted the data URI at 878 KB)
render:      61.1s wallclock
output:      18.9 MB MP4, h264 1088×704
```

Lip-sync was visually clean against macOS `say` audio — and macOS `say`
is NOT Riggs's bound Runway voice. **Lip-sync is phoneme-driven, not
voice-keyed.** Any clean audio source → clean lip-sync.

## PR DZ-a findings — `/v1/voices/preview` is not TTS

Probe body: `{voice: {type: "runway-live-preset", presetId: "max"},
text: "..."}`. Runway responded 400 with:

```
issues:
  - path: ["prompt"]  expected: string  received: undefined
  - path: ["model"]   must be: "eleven_ttv_v3" | "eleven_multilingual_ttv_v2"
```

Interpretation: the endpoint takes `{prompt: "<voice description>",
model: "<elevenlabs-design-model>"}` and returns a sample of that
*designed* voice. The "audition before committing" doc note is
literal. You can't pass a `text` field and get TTS back. The whole
`/v1/voices` family is for designing voices, not synthesizing scripts.

This was decisive — we didn't probe the other three shapes
(`custom-block-pr-dv`, `flat-voiceId`, `from-text-design`) because the
validation error already explained the endpoint's purpose. Re-running
with `--custom-voice-id` would just produce another 400 about
`prompt`/`model`.

---

## What remains — PR EA Long Ad rewrite plan

### The TTS-source decision

Runway can't TTS arbitrary text in a specific voice. The audio source
must come from somewhere else. Three real options:

1. **OpenAI TTS** (`tts-1-hd`)
   - 6 voices: alloy, echo, fable, onyx, nova, shimmer
   - Already have OpenAI key plumbing in `audio_client.py`
   - ~$0.015 per Long Ad (30s × 1¢/1k chars)
   - Voice quality is good but doesn't match Runway preset character
2. **ElevenLabs** (their actual TTS endpoint, not Runway's
   `/v1/voices/preview` shim — Runway proxies their voice-design model
   but not their TTS endpoint)
   - 100s of voices, can match Riggs's `max`-like timbre
   - New API key required, new HTTP client wrapper
   - ~$0.06 per Long Ad
3. **Runway round-trip** (chunked text → extract audio → concat →
   re-render via audio)
   - In-vocabulary but burns 2× credits per Long Ad
   - Defeats the simplification PR EA is trying to deliver
   - Don't do this

**Recommendation: OpenAI TTS.** Smallest dependency surface, cheapest,
operator-explainable as "long-form ads use a different voice than
short ads." Per-character `tts_voice` field lets the operator pick
which OpenAI voice each spokesperson uses.

### PR EA implementation sketch

| Change | Lines | Notes |
|---|---|---|
| `Character.tts_voice: Optional[str]` (model + storage) | ~10 | Maps to `'alloy' \| 'echo' \| 'fable' \| 'onyx' \| 'nova' \| 'shimmer'`. Default `'onyx'`. |
| `services/openai_tts_client.py` (new) | ~80 | `tts_to_data_uri(text, voice)` returns `data:audio/mpeg;base64,…`. Mirrors `voice_clone_client._data_uri`. Mock path returns a deterministic silent placeholder. |
| `long_ad_service.generate_long_ad_v2` (new) | ~60 | Whole script → OpenAI TTS → single `_render_chunk_real(audio_source=…)`. No chunking. Replaces current per-chunk loop when v2 is enabled. |
| `long_ad_service` v1 ↔ v2 feature flag | ~10 | Settings field `long_ad_mode = 'chunked-text' \| 'single-pass-audio'`. Default `'chunked-text'` until proven on real campaigns. |
| Frontend Identity card — `tts_voice` picker | ~30 | Dropdown next to Voice Preset on `CharacterCard.jsx`. |
| Frontend Long Ad form — mode badge | ~10 | Shows "v2 · single-pass · OpenAI {voice}" when enabled. |
| Backend tests — mock TTS, v2 orchestrator path | ~50 | New `test_long_ad_v2_*` cluster. |

Approx 250 LoC across ~6 files. No more `chunk_script` or
`stitch_chunks` calls in the v2 path — both stay in v1 for the feature
flag's life. When v2 is the default we can deprecate v1.

### Risks to confirm during PR EA

1. **OpenAI TTS rate limits.** 50 RPM on `tts-1-hd` default tier.
   Long Ad volume is low (operator-triggered, not automated). Safe.
2. **MP3 size for ~60s audio.** 60s × 128kbps mono = ~960 KB raw,
   ~1.28 MB as data URI. Within the empirical 5 MB cap.
3. **`gwm1_avatars` duration cap above 42s.** Unknown. PR DY only
   verified 42s. PR EA should re-probe at ~60s and ~120s before
   shipping the v2 default. Adds ~$1 in real-mode test credits.
4. **Lip-sync quality on OpenAI voices.** PR DY showed lip-sync works
   on any audio. Empirically verify on OpenAI `tts-1-hd` output
   (different prosody than macOS `say`) during the PR EA real-mode
   smoke.

### Things explicitly NOT in PR EA scope

- Music bed mixing — defer to PR EB
- Multi-language dub via `/v1/voice_dubbing` → audio input — defer to PR EC
- Dialogue Scene + Spokesperson Ad audio-mode — separate PR, not Long Ad

---

## Quick-start when resuming

1. Read this doc + the head-pointer entry in `00-START-NEXT-SESSION.md`
2. Skim `build_avatar_video_body` and its 3 tests
3. Decide: OpenAI TTS now, or ElevenLabs for better voice match?
4. Run the duration probe at 60s + 120s before committing to v2 default:
   ```bash
   python3 scripts/probe-avatar-videos-audio.py \
       --character-id <id> --target-duration 60 --yes-fire
   ```
5. Ship PR EA per the sketch above.

## File breadcrumbs

- `scripts/probe-avatar-videos-audio.py` — proven probe, rerun anytime
- `scripts/probe-voices-preview.py` — proven probe; conclusion documented
- `backend/app/services/long_ad_service.py:build_avatar_video_body` —
  the audio-ready helper PR EA needs
- `backend/app/services/audio_client.py` — patterns for HTTP client +
  data URI + mock fallback that PR EA's OpenAI TTS client should mirror
- `frontend/src/components/CharacterCard.jsx` — where the `tts_voice`
  picker lands

## Open questions parked for resumption

- Does `gwm1_avatars` accept >60s audio? (probe before shipping)
- Should `tts_voice` be on the `Character` (one voice per spokesperson)
  or on the `AdVariant` (one voice per script)?  Probably Character —
  voice = identity.
- Do we want a "Riggs sounds different in Long Ad" disclaimer in the
  UI, or is that operator-internal trivia?
