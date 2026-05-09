# Flow Integration Audit — AdSpark Studio v5

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-m-flow-integration-audit`
**Status:** RESEARCH ONLY — no product code changed. Audit only.

## Question being answered

Can a user create a campaign, generate a video, add usable voice/audio,
create or select a spokesperson/character, generate a spoken
spokesperson clip, and **talk to the spokesperson about the
product**?

**Short answer: mostly yes, but with three real gaps the demo will
expose under any pointed judging question.**

The pipeline is wired end-to-end in code — every flow imports the
right service, the resolution chain (`character > selected > host`)
works, all 36 routes register cleanly, the frontend builds at 203 KB
/ 61.5 KB gzip, the Playwright smoke passes. What's *not* connected
is the **content-level meaning** of three labels:

1. **The campaign video is silent.** The UI never says so.
2. **The Brand Voice "preview" is not the campaign's ad copy.** It's
   a 117-second generic Runway voice-design sample. The Multilingual
   Dub re-voices that 117-second sample, not the ad.
3. **Realtime sessions launch with zero campaign context.** The
   avatar genuinely doesn't know what product it's pitching when the
   user clicks Start Conversation.

These are the gaps. The rest of this document explains where they
live in code, ranks the smallest safe fixes, and stops short of
implementing anything that wasn't tiny + obviously required to keep
the current UI honest.

---

## Verification baseline (this session)

- Backend import: `from app.main import app` → **36 routes**
  registered cleanly.
- Frontend build: **203.12 KB initial JS / 61.53 KB gzip** + 562 KB
  lazy `@runwayml/avatars-react` chunk. No regressions vs PR L.
- Git hygiene: 0 `.env` tracked, 0 media tracked, 0 `backend/data/`
  tracked.
- Playwright smoke: documented as passing in PR K + PR L
  (`1 passed (~22 s)` in mock mode); not re-run this session because
  no code changed.
- ffprobe verification on real cached artefacts:
  - `backend/data/videos/9a717c675ec6.mp4` — h264 video stream only,
    **no audio stream**. 5.04 s.
  - `backend/data/host/9a717c675ec6.mp4` — h264 + AAC 48 kHz.
    11.17 s. Avatar speaking.
  - `backend/data/audio/9a717c675ec6-voice-preview.mp3` —
    mp3 44.1 kHz / 128 kbps. **117.47 s.** *Far longer than the
    ad copy template would produce; this is Runway's generic
    voice-design sample.*

---

## Flow 1 — Campaign video

### What works

- `POST /api/concepts` produces 3 concepts deterministically (mock)
  or via `gpt-4o-mini` (real) from form fields.
- `POST /api/runway/image` (`gen4_image_turbo`) generates a
  reference image, cached at
  `backend/data/images/<id>.png`, served via
  `/api/runway/image/<id>`.
- `POST /api/runway/generate` routes to `image_to_video` or
  `text_to_video` depending on `model` + `textOnly`. Validation
  rejects unsupported model/ratio/duration combos with 400 before
  any HTTP fires.
- `POST /api/campaigns` saves the campaign and downloads the
  presigned MP4 to `backend/data/videos/<id>.mp4` (gitignored,
  100 MB cap).
- `POST /api/campaigns/{id}/finish?format=...` runs local ffmpeg
  with scale-cover + crop + drawtext for Landscape / Reels /
  Square. Outputs cached at `backend/data/finished/`.

### What's misleading / disconnected

**P0 — `Generate Video` button never says the resulting video is
silent.** Every cached `backend/data/videos/*.mp4` I sampled had
*only* an h264 video stream — Runway's `gen4_turbo` and `gen4.5`
produce visual-only output. The UI player plays back muted (because
there is no audio) and the user has no signal that this is by
design.

The Mermaid diagram in `README.md` doesn't call it out either.

**Severity:** judges who hit Play and hear nothing will assume
something is broken, not that it's expected.

### Recommended fix

P0 inline-label fix only — **no new feature, no audio mixing**:

- In `frontend/src/components/CampaignGallery.jsx` near the
  campaign `<video>` element (line 317–354), add a small chip
  reading `silent · ad visual` next to the `cached locally` /
  `pack 3/3` chips, with a `title=` tooltip explaining "Runway
  `gen4_turbo` / `gen4.5` produce visual-only video. The Avatar
  Host Clip below adds the spoken pitch."
- In `frontend/src/components/PromptPreview.jsx` near the
  Generate Video button (line 216–223), add a one-line caption
  underneath: `"Generates the visual ad — silent. Use the Avatar
  Host Clip below to add a spoken spokesperson pitch."`

That's it. Two-string change in two files. Zero behavioural
risk. Brings the UI in line with what the code actually does.

### Pack outputs are correct

Verified earlier in PR D hero-run on campaign `9a717c675ec6` (see
`SUBMISSION.md` "Verified end-to-end against real Runway"). Pack
formats build correctly at 1280×720 / 720×1280 / 960×960 with
`+faststart` and burned-in title + CTA overlays. **Pack outputs
are silent too** — same source clip, same lack of audio. The
silent-label chip should appear on the Pack outputs section as
well.

---

## Flow 2 — Audio Pack (Brand Voice + Multilingual Dub)

### What works

- `POST /api/campaigns/{id}/brand-voice` calls Runway `/v1/voices`
  text-design with a templated description built from
  `tone + business + audience`. Polls READY (~10 s), downloads the
  CloudFront preview MP3, caches at
  `backend/data/audio/<campaign>-voice-preview.mp3`.
- `POST /api/campaigns/{id}/dub` re-voices the cached preview MP3
  via `/v1/voice_dubbing` into one of 29 target languages, caches
  at `backend/data/audio/<campaign>-dub-<lang>.mp3`.
- The voice preview + each dub is playable inline via
  `<audio>` elements in the gallery.
- The voice id + per-language status survive in
  `campaigns.json` so reloads see persisted state.
- Mock mode synthesises silent ffmpeg-`lavfi` MP3 placeholders so
  the UI flow works without keys.

### What's misleading / disconnected

**P0 — "Brand Voice" preview is not the campaign's ad copy.**
Empirically verified: the cached `voice-preview.mp3` for campaign
`9a717c675ec6` is **117.47 seconds** long, way longer than what
the ad copy template (`Meet {biz}. {hook}. {caption}. {cta}.`)
would produce in spoken form. This is Runway's generic
voice-design sample — the audio Runway returns to demonstrate
*the voice's range*, not your script in that voice.

The UI section says:
> "Designs a custom Runway voice from this campaign's tone +
> audience. The preview MP3 caches locally and seeds the
> multilingual dubs below."

This is technically correct but misleading at first read. A judge
listening to the preview will hear "I'm Vincent, a friendly
narrator. I can read your story…" or similar — *not* the campaign's
hook + caption + CTA. They will conclude that the dubs do not dub
the ad.

**P0 — "Multilingual Dubs" section dubs the preview, not the ad.**
Same issue, downstream. `Dub Spanish` re-voices the 117-second
generic preview into Spanish — the ad itself is never spoken in any
language.

### Severity

This is the single most pointed gap. Every judge who clicks Play on
the voice preview will hear something unrelated to the campaign and
conclude that the audio surface is decorative.

### Recommended fixes

**Option A (P0, label-only — keeps current code intact):**

Rename the section labels to match what the code actually
produces. Do this inline in `CampaignGallery.jsx`:

| Current label | Honest label |
|---|---|
| `Audio Pack` (header) | `Brand Voice — Voice Identity` |
| `Brand Voice` (subsection) | `Voice Identity Preview` |
| `Designs a custom Runway voice from this campaign's tone + audience.` | `Designs a custom Runway voice that matches this campaign's tone and audience. The preview is Runway's generic voice sample — not the ad copy. The Avatar Host Clip above is what speaks the ad.` |
| `Multilingual Dubs` | `Voice Identity — Dubbed Samples (29 langs)` |
| `Dub Spanish` button | `Sample Spanish` button |

This makes the demo story immediately honest — "we built a custom
brand voice; here's what it sounds like in 10 languages; the actual
spoken ad is the Avatar Host Clip."

**Option B (P1, deferred — requires real implementation):**

Add a new "Speak the Ad in Brand Voice" path that uses the
custom-designed voice to actually narrate the ad copy in the chosen
language. **Blocked by Runway** — `/v1/text_to_speech` requires a
`voice.type` discriminator that's gated (documented in
`docs/research/RUNWAY_API_CAPABILITY_MAP.md` Appendix C; 30+
probe attempts didn't unlock it). Without TTS we cannot generate
arbitrary spoken text from the brand voice.

Three workarounds, ranked by demo-friendliness:

1. **Use the Avatar Host Clip's audio track as the "ad spoken in the
   brand voice" artefact.** The avatar already speaks the
   campaign script in its assigned voice preset. ffmpeg can extract
   the AAC audio from `host/<id>.mp4` to a standalone `<id>-ad.mp3`
   and present it as "Ad — Spoken Audio." This is **the smallest
   safe change** that gets a real, on-message audio file the user
   can hand off. (Implementation: ~30 LOC in a new
   `_extract_host_audio()` helper + one new GET route + one
   inline player in the gallery.)
2. Re-route the dub source from "voice-preview" to "host-clip
   audio extracted in step 1." Then the existing Multilingual Dubs
   actually multilingually dub the *spoken ad*. Real demo win.
3. Combine both into a "Commercial with Voice" finished output
   (see Flow 3 below).

**Recommendation:** ship Option A immediately (P0 truthfulness fix);
hold Option B's three-step implementation until a follow-up phase
explicitly green-lights it. Option B path 1 (host-audio extraction)
is the smallest of the three and is the foundational step for path 2
and Flow 3 below.

---

## Flow 3 — Commercial sound / voice connection

### What works

Today, **nothing**. There is no path that produces a campaign video
with audio. The artefacts split like this:

| Artefact | Source | Audio? | On-message? |
|---|---|---|---|
| Campaign video (the ad) | `gen4_turbo` / `gen4.5` | **silent** | yes (visual) |
| Campaign Pack (Landscape / Reels / Square) | local ffmpeg over campaign video | **silent** | yes |
| Avatar Host Clip | `avatar_videos` | **AAC 48 kHz** | yes (avatar speaks the ad) |
| Brand Voice preview | `/v1/voices` design | mp3 with audio | **no** (generic preview) |
| Multilingual Dubs | `/v1/voice_dubbing` of the preview | mp3 with audio | **no** (dubs the generic preview) |
| Realtime Spokesperson | `/v1/realtime_sessions` | live WebRTC | depends on user prompts |

The only on-message spoken artefact tied to the campaign is the
Avatar Host Clip. Its audio is locked inside the MP4 — not exposed
as a standalone MP3 and not mixed into the silent campaign video or
Campaign Pack.

### Recommended P1 fix — "Commercial with Voice" output

The smallest safe path that produces a campaign video with on-message
audio:

1. **Extract Host Clip audio** to a standalone MP3 (or AAC file).
   ffmpeg `-vn -c:a copy` over `backend/data/host/<id>.mp4`. ~5 LOC.
2. **Mix the host audio onto the silent campaign video** with
   ffmpeg. Two flavours:
   - `-i video.mp4 -i host-audio.aac -c:v copy -c:a aac -shortest` —
     trims to whichever is shorter. Ad video is 5 s, host clip is
     ~11 s, so the ad gets 5 s of host audio (the first beat of the
     pitch). Keeps existing Pack dimensions unchanged.
   - `-stream_loop` the video so it loops to match the host audio
     duration. The ad visual repeats while the avatar finishes the
     pitch. Possibly more useful but crops harder.
3. **New endpoint:** `POST /api/campaigns/{id}/commercial-with-voice`
   producing `backend/data/finished/<id>-commercial.mp4`.
4. **New gallery section:** "Commercial with Voice" sitting between
   Campaign Pack and Brand Spokesperson, with one Build button.
   Gated on `host_status === 'ok'`.

**Effort estimate:** ~80 LOC backend (one new finisher_service
method + one route + one storage helper) + ~40 LOC frontend (one
new section). No new dependencies — ffmpeg is already in the stack.
Mock mode reuses the existing `_ffmpeg_silent_mp3` shape.

**Risk:** judges have an instinct that "AdSpark made me an ad with
voice" is the headline. Today, the gallery has 7 sections and none
of them is that artefact. P1 fixes that.

---

## Flow 4 — Spokesperson-in-video (Avatar Host Clip)

### What works (this is the strongest flow today)

- Resolution chain is correct in code: `character_host_client.
  active_avatar_id(campaign, settings)` returns
  `character.runway_avatar_id  >  selected_avatar_id  >
  host_avatar_id`. Verified by reading `character_host_client.py:87`
  and the lazy-import resolution path `_character_avatar_for()` at
  line 66.
- `POST /api/campaigns/{id}/host-video` builds a templated script
  from the campaign's saved concept (`build_script(campaign,
  override)` in `character_host_client.py:185`):
  - `Meet {business}. {hook}. {caption}. {cta}.`
  - Capped at 300 chars; ad-copy-shaped.
- The clip is real: `gwm1_avatars` model via `/v1/avatar_videos`,
  output downloaded with content-type check, cached at
  `backend/data/host/<id>.mp4`.
- Empirically verified: cached host clip has h264 + AAC 48 kHz, 11 s.
  The avatar speaks the campaign pitch in the assigned voice preset.

### What's misleading / disconnected

The flow itself is honest. Two minor UI wording gaps:

**P2 — "Avatar Host Clip" copy could spell out audio.** The current
caption ("Uses the Brand Spokesperson Avatar above to record a short
campaign pitch.") is accurate but doesn't say *spoken*. Suggested
rephrase: "Records a short spoken campaign pitch — the avatar
speaks the campaign hook + caption + CTA." Tiny change.

**P2 — When a character is attached, the Host Clip section header
doesn't repeat which character is speaking.** Today it just says
"Avatar Host Clip · ready". Adding "narrated by Brewster the Bear"
when `c.character_id` is populated would tighten the demo story.
~5 LOC in `CampaignGallery.jsx`.

---

## Flow 5 — Realtime conversation

### What works

- `POST /api/campaigns/{id}/spokesperson-session` brokers a Runway
  `/v1/realtime_sessions` and returns only `{session_id,
  session_key, expires_at, avatar_id}`. The API key never reaches
  the browser.
- The resolution chain works here too: avatar_id resolves through
  `character > selected > host` (verified in
  `realtime_avatar_client.py:81`).
- `<AvatarCall>` is lazy-loaded so SDK errors stay isolated.
- 5-min cap from `expiresAt`; mic-only V1; `DELETE` cleanup is
  best-effort.
- Mock mode returns 503 with a friendly disabled-button UX.

### What's misleading / disconnected

**P1 — The realtime session has ZERO campaign context.** Verified
in `realtime_avatar_client.py:92–94`:

```python
body = {
    "model": _REALTIME_MODEL,
    "avatar": {"type": "custom", "avatarId": avatar_id},
}
```

That's the entire POST body. No instructions, no system prompt, no
personality, no campaign hook/caption/CTA, no business name, no
audience. The avatar will start the conversation with whatever
default persona the underlying Runway pipeline gives them. When the
user opens with *"How would you pitch this product?"* the avatar
literally does not know what product is on the screen.

The RealtimeSpokesperson UI then reinforces the gap — its caption
says "Ask your AI spokesperson how they would pitch this campaign,"
which sets a user expectation the broker doesn't actually meet.

The Runway realtime spike
(`docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md`) **never
probed for an `instructions` / `personality` / `context` field** on
`/v1/realtime_sessions`. The schema may or may not support it; we
simply don't know without a live probe.

### Recommended fixes (ranked)

**P0 (smallest, label-only):**

The user-facing copy under Start Conversation says:

> "Ask your AI spokesperson how they would pitch this campaign."

Change to:

> "The avatar speaks in your selected voice but does not yet know
> the campaign details. Ask high-level questions; you can paste the
> campaign hook in chat if you want a focused pitch."

This is honest. ~1 string change in `RealtimeSpokesperson.jsx:118`
and `:179`.

**P1 (next-smallest, frontend-only):**

Add a row of suggested-prompt chips above the Start Conversation
button that the user can read aloud. The avatar still doesn't *know*
the campaign, but the user supplies it in the spoken question, so
the conversation feels grounded:

- "Pitch [business] in one sentence — [hook]"
- "What audience is this for? It's [audience]."
- "Give me three ad angles for [product]."
- "How would you improve this campaign?"

The chips are pre-filled from `campaign.business / product /
audience / selected_concept.hook / .caption / .cta`. ~50 LOC,
zero backend changes, zero Runway calls. **This is the right
demo-week fix.**

**P1 (next, requires a live probe):**

Spend ~5 credits probing whether `/v1/realtime_sessions` accepts an
`instructions` field at the top level (or under `avatar`). If yes,
build a campaign-context string in the broker:

```python
instructions = (
    f"You are the brand spokesperson for {campaign.business}. "
    f"The product is {campaign.product or 'their main product'}. "
    f"The target audience is {campaign.audience or 'general'}. "
    f"Hook: {concept.hook}. Caption: {concept.caption}. CTA: "
    f"{concept.cta}. When asked about the product, pitch it warmly "
    f"and inviting; when asked about the audience, speak about "
    f"why it fits."
)
```

Pass into the create body. This is the *right* fix; the chips above
are the safe fallback if Runway doesn't support it.

**Effort:** 1 short probe request → either ~30 LOC backend if it
works, or skip and ship the chips. Either way, P1, not P0.

---

## Flow 6 — Character Studio connection

### What works

This is the cleanest flow in the audit.

- `POST /api/characters` creates a character record. No Runway
  calls.
- `POST /api/characters/{id}/generate-portrait` calls
  `gen4_image_turbo` with a locked template prompt + caches the
  PNG at `backend/data/characters/<id>-portrait.png`.
- `POST /api/characters/{id}/create-avatar` reads the cached
  portrait, embeds as data URI (≤5 MB cap), POSTs to `/v1/avatars`,
  polls READY. Updates the character record with
  `runway_avatar_id`, status, processed thumbnail URL.
- `POST /api/campaigns/{id}/attach-character` persists the link
  (null detaches). Verifies the character exists before persisting.
- `character_host_client.active_avatar_id(campaign, settings)`
  resolves `character > selected > host`. Both the host-clip path
  (line 418–419) and the realtime broker (line 81–82) use it.
- The Avatar Picker `GET /v1/avatars` auto-surfaces character
  avatars alongside the user's other avatars (since they're real
  Runway avatars on the same account).

### What's misleading / disconnected

Nothing materially broken. Two cosmetic items:

**P2 — When a character is attached, the Host Clip section doesn't
explicitly say "spoken by [character name]."** Same gap as Flow 4.

**P2 — Mock-mode character avatar status is `"mock"`** but the
Avatar Picker reuses the same value for the 4 hard-coded preset
entries. Both paths render identical "mock" pills — unambiguous in
practice but a future K.5 pass could differentiate them.

### Verification

- Real hero-run carried forward from SESSION_008: Brewster the Bear
  (mascot, voice `max`) → `runway_avatar_id
  f00b39e2-e8b5-4a8a-91d5-eca4ab57c4a8`, status `ready`. Attached
  to campaign `de3f19094b79`; host clip used Brewster's avatar id;
  detach + re-attach clean.
- Sir Landsloplot (mascot, this session): record exists, retried
  portrait with armored-warrior subject after Runway content filter
  rejected the original "battle unicorn, beaten and worn down"
  prompt. Portrait now `portrait_source: generated`. Avatar binding
  not yet attempted in this session.
- Resolution chain: ad-hoc tested via reading code paths; smoke
  test exercises the mock-mode attach path on every commit.
- Avatar Picker fallback: still works when no character is
  attached (verified by reading `CampaignGallery.jsx:514` —
  picker only mounts when `!hasCharacter`).

---

## Flow 7 — UI truth audit

| Section | Current label | Honest? | Recommended |
|---|---|---|---|
| Generate Video button | `Generate Video` | **No** — implies audio | `Generate Video (silent)` + caption |
| Cached video player | `cached locally` chip only | **Partial** — silent isn't called out | Add `silent · ad visual` chip |
| Campaign Pack | `Each format runs a local ffmpeg pass — no extra Runway calls.` | Yes | unchanged |
| Pack outputs | (no audio caption) | **Partial** — viewer hears nothing | Add `silent · 1280×720` etc on Build buttons or output chips |
| Brand Spokesperson | `Runway Avatar` pill | Yes | unchanged |
| Avatar Host Clip | `Records a short campaign pitch.` | Yes (could be tighter — *spoken* pitch) | Add "spoken" |
| Talk to Brand Spokesperson | `Ask your AI spokesperson how they would pitch this campaign.` | **No** — avatar has zero context | Honest disclaimer or fix with chips |
| Audio Pack > Brand Voice | `Designs a custom Runway voice from this campaign's tone + audience.` | **No** — preview content is generic | Rename to "Voice Identity Preview" and explain |
| Multilingual Dubs | `Dub Spanish` etc | **No** — dubs the preview, not the ad | Rename to "Sample Spanish" or actually dub the host audio |
| Character Studio | `Generate a brand character once, reuse it across campaigns…` | Yes | unchanged |

---

## Proposed fixes — ranked

### P0 — Must fix before demo (truthfulness only, no new behavior)

| # | Fix | File(s) | LOC | Behaviour change? |
|---|---|---|---|---|
| 1 | Add "silent · ad visual" chip + `title=` near the cached campaign video player | `CampaignGallery.jsx` | ~5 | none |
| 2 | Add one-line caption under Generate Video button — "silent visual; use Avatar Host Clip for spoken pitch" | `PromptPreview.jsx` | ~3 | none |
| 3 | Rename `Audio Pack` → `Brand Voice — Voice Identity`, rename `Brand Voice` subsection caption to make clear the preview is generic, not the ad | `CampaignGallery.jsx` | ~5 | none |
| 4 | Rename Multilingual Dub buttons to `Sample <Lang>` and add a one-line caption explaining the dubbed source is the preview, not the ad | `CampaignGallery.jsx` | ~5 | none |
| 5 | Rephrase the realtime Start Conversation caption to disclose the avatar lacks campaign context | `RealtimeSpokesperson.jsx` | ~2 | none |

**Total P0 budget: ~20 LOC across 3 files. Pure label fixes. No
risk. Demo-truthfulness is on solid ground after this lands.**

### P1 — Strong demo improvements (smallest real implementations)

| # | Fix | Effort | Files |
|---|---|---|---|
| 6 | **Suggested-prompt chips for realtime** populated from the campaign fields | ~50 LOC frontend-only | `RealtimeSpokesperson.jsx` |
| 7 | **Extract Avatar Host Clip audio** to standalone MP3 + new GET route + inline player labelled "Ad — Spoken Audio" | ~50 LOC backend + ~30 LOC frontend | new `_extract_host_audio()` in `character_host_client.py` (or a new `commercial_audio_client.py`) + `routers/campaigns.py` + `CampaignGallery.jsx` |
| 8 | **Commercial with Voice ffmpeg path** — mix host audio over silent campaign video, save as `<id>-commercial.mp4` | ~80 LOC backend + ~40 LOC frontend | `finisher_service.py` (new method) + `routers/campaigns.py` + `CampaignGallery.jsx` |
| 9 | **Realtime instructions probe** — try sending `instructions` in the create body; if Runway accepts it, populate from campaign fields | ~5 credits to probe + ~30 LOC backend if successful | `realtime_avatar_client.py` |

**Recommended P1 sequence:** 6 first (frontend-only, biggest demo
impact, zero risk), then 9 (probe — if Runway supports it, ship the
fix; if not, the chips already cover the gap), then 7 + 8 as a
bundle (host-audio extraction + commercial mix is a coherent unit).

### P2 — Post-demo polish

| # | Fix | Effort |
|---|---|---|
| 10 | Add "narrated by [character name]" subhead under Avatar Host Clip when a character is attached | ~5 LOC |
| 11 | Rephrase Avatar Host Clip caption to spell out "spoken" | ~1 LOC |
| 12 | Distinguish character-mock vs preset-mock pill visually | ~5 LOC |
| 13 | Switch dub source from voice-preview to extracted host audio (depends on P1 #7) | ~10 LOC |
| 14 | "Generate Spoken Ad in Brand Voice" path if Runway opens `/v1/text_to_speech` | unknown (gated) |

---

## Implementation plan for P0 (ready to ship today)

The P0 set is a **single-commit docs+labels-only PR** that takes
the current UI from "technically correct + judges-will-find-the-gap"
to "honest, defensible under cross-examination." No new endpoints,
no new components, no new tests beyond keeping the smoke green.

**Branch:** `feature/pr-n-honest-labels` (suggested name)

**File 1: `frontend/src/components/CampaignGallery.jsx`**

a. Near the campaign `<video>` (around line 320), add to the chip
   row:
   ```jsx
   <span
     className="text-[10px] rounded-full bg-zinc-800 text-zinc-300 px-2 py-0.5 font-mono"
     title="Runway gen4_turbo / gen4.5 produce visual-only video. The Avatar Host Clip below adds the spoken pitch."
   >
     silent · ad visual
   </span>
   ```

b. In the Audio Pack header (line 720), rename:
   ```jsx
   <span className="text-xs font-semibold text-zinc-300">Brand Voice — Voice Identity</span>
   ```

c. Replace the Brand Voice caption (line 775–779):
   ```jsx
   <p className="text-[10px] text-zinc-500 leading-relaxed">
     Designs a custom Runway voice that matches this campaign's
     tone and audience. The preview is Runway's generic voice
     sample — <span className="text-zinc-300">not the ad copy</span>.
     The Avatar Host Clip above is what speaks the ad.
   </p>
   ```

d. Rename `Multilingual Dubs` header (line 804) →
   `Voice Identity — Dubbed Samples (29 langs)` and add a one-line
   caption above the grid:
   ```jsx
   <p className="text-[10px] text-zinc-500">
     Each language dubs the voice sample above — <span className="text-zinc-300">not the ad</span>. Tap to play.
   </p>
   ```

e. Rename per-language buttons from `Dub Spanish` → `Sample Spanish`
   (line 836).

**File 2: `frontend/src/components/PromptPreview.jsx`**

After the Generate Video button (around line 223), add a one-line
caption:
```jsx
<p className="text-[10px] text-zinc-500">
  Generates the visual ad — silent. Use Avatar Host Clip to add a
  spoken spokesperson pitch.
</p>
```

(The existing text-only / blocked-by-image hints already live
nearby; the new caption sits next to them.)

**File 3: `frontend/src/components/RealtimeSpokesperson.jsx`**

Replace both occurrences of the caption text (line 118 + line 179):
```jsx
<p className="text-[10px] text-zinc-500 leading-relaxed">
  The avatar speaks in the selected voice but does not yet know
  the campaign details. Ask high-level questions; paste the
  campaign hook in your spoken question for a focused pitch.{' '}
  <span className="text-zinc-400">Mic required. Webcam optional.</span>
</p>
```

**Smoke impact:** the Playwright assertions check `Audio Pack` and
`Multilingual Dubs` literal headings. Need to update
`tests/adspark-smoke.spec.js`:
- 13c assertion `getByText(/^Audio Pack$/)` → `Brand Voice — Voice Identity`
- 13c assertion uses `Runway Voices` pill — keep
- The `Design Brand Voice` button label is unchanged
- No assertion currently checks "Multilingual Dubs"; safe.

(Verified by re-reading `frontend/tests/adspark-smoke.spec.js`
lines 191–195.)

**Estimated total: ~25 LOC across 4 files (3 components + 1 test).**
**One commit.** **Zero behaviour change.** **All 8 mock-mode test
steps continue to pass.**

---

## Implementation plan for P1 #6 (suggested-prompt chips)

If approved as the next step *after* P0, this is the single most
impactful demo-week change.

**Branch:** `feature/pr-o-realtime-prompt-chips`

**File: `frontend/src/components/RealtimeSpokesperson.jsx`**

In the idle / failed render path (around line 175–207), inject a
chip row above the Start Conversation button. The chips read from
the campaign object (already in scope):

```jsx
const concept = campaign.selected_concept || {}
const chips = [
  campaign.business && `Pitch ${campaign.business} in one sentence — ${concept.hook || 'their hook'}.`,
  campaign.audience && `What audience is this for? It's ${campaign.audience}.`,
  campaign.product && `Give me three ad angles for ${campaign.product}.`,
  'How would you improve this campaign?',
].filter(Boolean)

// Render above the Start button:
<div className="flex flex-wrap gap-1">
  {chips.map((c, i) => (
    <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full" title="Read aloud after Start Conversation — gives the avatar context the realtime API doesn't pass automatically">
      {c}
    </span>
  ))}
</div>
```

**Estimated total: ~25 LOC frontend-only. Zero backend, zero new
Runway calls. Smoke unaffected.**

---

## Verification commands the user can run

```bash
# 1. Backend imports + 36 routes
cd backend && source .venv/bin/activate && \
  python -c "from app.main import app; print(len(app.routes))"

# 2. Frontend build
cd frontend && npm run build

# 3. Mock-mode Playwright smoke
pkill -f uvicorn; pkill -f vite
(cd backend && source .venv/bin/activate && \
  RUNWAY_API_KEY= OPENAI_API_KEY= uvicorn app.main:app --port 8000 &)
(cd frontend && npm run dev &)
sleep 5
(cd frontend && npm run test:e2e)

# 4. Confirm campaign videos are silent
ffprobe -v error -show_streams backend/data/videos/<some-id>.mp4 | grep codec_type
# expected: codec_type=video (no audio line)

# 5. Confirm host clips have audio
ffprobe -v error -show_streams backend/data/host/<same-id>.mp4 | grep codec_type
# expected: codec_type=video AND codec_type=audio

# 6. Confirm voice preview is far longer than the ad copy
ffprobe -v error -show_streams \
  backend/data/audio/<id>-voice-preview.mp3 | grep duration
# expected: ~117 s (Runway's generic preview) — not ~10 s of ad copy

# 7. Inspect realtime broker body
grep -A 5 'body = {' backend/app/services/realtime_avatar_client.py | head -10
# expected: only "model" + "avatar" — no instructions/personality field
```

---

## What this audit explicitly does NOT recommend

- No `/v1/text_to_speech` work. Same gating that blocked Phase H.
- No webcam toggle on realtime.
- No multi-character realtime conversations.
- No avatar marketplace, knowledge documents, conversation
  transcripts.
- No K.5 polish (PATCH character, replace-avatar) — those are
  Phase K.5 territory and orthogonal to the truthfulness gap.
- No new Phase L / M scope creep.
- No backend code changes for P0. The P0 set is purely label-level.

---

## Final take

The pipeline is solid. Every flow is wired, every endpoint
registers, the resolution chain works, the smoke is green. The
**three real gaps** are all label-level except for one (the
realtime context gap), and even that one has a frontend-only fallback
(suggested-prompt chips) that closes 80% of the demo risk.

**Recommended sequence:**

1. **P0 label fixes** (one commit, ~25 LOC, no behaviour change) →
   ship today.
2. **P1 #6 realtime chips** (one commit, ~25 LOC, frontend-only) →
   ship next session.
3. **P1 #9 realtime instructions probe** (~5 credits, optional) →
   if it works, swap the chips for real campaign context in the
   session create body.
4. **P1 #7 + #8 host-audio extraction + Commercial with Voice** —
   only if P0 + P1 #6 are insufficient and the user explicitly
   approves the larger scope.

The P0 set alone takes the demo from "every audio claim is
defensible only with footnotes" to "every audio claim matches what
the user hears." That's the load-bearing change.

---

## Implementation status (this branch)

**P0 truthfulness fixes — implemented.** Three frontend files +
smoke updated on `feature/pr-m-flow-integration-audit`:

- `CampaignGallery.jsx` — visual-only chip + caption near the cached
  campaign video; Audio Pack subcopy now reads *"Voice samples, not
  full ad narration… commercial narration / mixing into the visual
  cut is future work."*; "Brand Voice Identity" pill replaces "Runway
  Voices"; per-language buttons relabeled `Sample Spanish` /
  `Sample French` / etc; "Voice Sample" subhead added when ready.
- `PromptPreview.jsx` — one-line caption under the Generate Video
  button explaining the visual cut is silent.
- `RealtimeSpokesperson.jsx` — replaced both gated + idle captions
  with the honest version: *"Realtime session uses the selected
  avatar. The avatar does not automatically know the campaign — use
  the suggested prompts below to give it context once you're live."*

**P1 #6 suggested-prompt chips — implemented.**
`buildPromptChips(campaign)` in `RealtimeSpokesperson.jsx` produces
six campaign-grounded chips from `business / product / audience /
selected_concept.hook`. Click-to-copy via `navigator.clipboard.
writeText`; visual confirmation flips the chip to `✓ copied` for
1.2 s. Falls back silently if Clipboard API is unavailable
(insecure context / permission denied) — chips still act as
read-aloud cues.

**Smoke updated.** `tests/adspark-smoke.spec.js` now asserts the
visual-only chip, the "Voice samples, not full ad narration"
disclaimer, the "Brand Voice Identity" pill, and (when realtime
mounts) two of the six chips. The "Audio Pack" header assertion was
qualified with `.first()` because the section name now appears
twice on each card (once as the section header, once in the silent
video caption that points users *to* the Audio Pack).

**Verification:**
- Backend import: 36 routes (unchanged).
- Frontend production build: 206.74 KB initial JS / 62.52 KB gzip
  (up ~3.6 KB / 1 KB from PR L's 203/61.5 — the chip row + new
  captions).
- Playwright smoke: **1 passed in 22.6 s** in mock mode.
- Git hygiene: no `.env` / media / `backend/data/` tracked; no
  Runway / OpenAI / `sessionKey` literals introduced.

**Out of scope for this PR (per spec):** backend realtime
instructions probe (P1 #9), Commercial with Voice (P1 #7+#8),
ffmpeg audio mixing, `/v1/text_to_speech`, webcam, marketplace,
Character Studio K.5 polish.

---

## PR S — Commercial with Voice — implemented (2026-05-08)

The "the campaign video is silent and there's no voiced final ad"
gap from §"Flow 3 — Commercial sound / voice connection" is now
closed. Branch `feature/pr-s-commercial-with-voice`, commit
[updated separately on push].

**What landed**:

- New `POST /api/campaigns/{id}/commercial-with-voice` (route count
  37 → 39 with the GET twin; 38 was the upload route on PR R).
  ffmpeg combines `data/videos/<id>.mp4` (silent visual) with the
  audio track from `data/host/<id>.mp4` (Avatar Host Clip); output
  lands at `data/finished/<id>-commercial-voice.mp4`.
- Strategy: `-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest` —
  visual stream is copied verbatim (no re-encode), audio is
  re-encoded to AAC, output trims to the shorter input (typically
  the 5-second visual cut). Falls back to `libx264 -crf 23` re-encode
  if the copy pass fails on unusual codec parameters.
- Preconditions: 409 with friendly UI-facing copy when (a) no cached
  video, (b) no host clip, or (c) host clip has no audio stream
  (mock placeholders are silent — the user gets an honest message).
- New `GET /api/campaigns/{id}/commercial-with-voice` streams the
  cached output (`video/mp4`).
- Three new Campaign fields: `voiced_commercial_url` /
  `voiced_commercial_status` (`ok | failed | no_video | no_host |
  no_audio | unavailable`) / `voiced_commercial_error`. Backward
  compatible — old campaign records read fine without them.
- Frontend Visuals tab gains a spark-tinted "Commercial with Voice"
  section with adaptive states (gated → button enabled → playing →
  rebuild). Exports tab gets a row in the ledger between Pack and
  Host Clip. Prompt-panel copy points users at the post-save flow.
- Playwright smoke asserts the section renders + the gated button is
  disabled with the "Generate the Avatar Host Clip first" copy after
  a fresh save (no host clip yet).

**Real verification**: campaign `9a717c675ec6` (existing real-mode
hero) — POST returned `voiced_commercial_status: ok`. ffprobe on
the output:

| Stream | Codec | Sample rate | Duration |
|---|---|---|---|
| video | h264 | — | 5.04 s |
| audio | aac | 48 kHz | 5.03 s |

GET stream: 200 `video/mp4`, 2.6 MB. Browser-playable. Precondition
probe: campaign without host clip returned 409 with the friendly
"Generate the Avatar Host Clip first" message.

**Remaining limitation — same as PR M's audit**: the audio source
is the Avatar Host Clip's spoken pitch, not direct text-to-speech
of an arbitrary script. Direct TTS (`/v1/text_to_speech`) remains
gated. The host clip's first 5 s typically covers "Meet {business}.
{hook}." which lands the brand identity even though the rest of the
pitch trails off when `-shortest` trims to the 5-second visual cut.

### Next polish (carried out of demo recording — 2026-05-08)

**Loop visual until full host pitch ends** — top priority.
Today's commercial trims host audio to ~5 s (the visual length).
Good enough to prove the feature, but the next polish should swap
the trim for `-stream_loop -1 -i video.mp4` so the visual repeats
until the host audio finishes (~11 s on real Runway clips). The
viewer hears the full hook + caption + CTA instead of just the
opening line. Trade-off: visual loops once or twice; ffmpeg needs
a re-encode pass since `-stream_loop` doesn't compose with
`-c:v copy` on every input.

The exact swap, when ready:

```diff
-  "-i", str(video_path),
-  "-i", str(host_path),
+  "-stream_loop", "-1",
+  "-i", str(video_path),
+  "-i", str(host_path),
   "-map", "0:v:0",
   "-map", "1:a:0",
-  "-c:v", "copy",
+  "-c:v", "libx264",
+  "-preset", "veryfast",
+  "-crf", "23",
   "-c:a", "aac",
   "-b:a", "192k",
   "-shortest",
```

The existing libx264 fallback path already handles re-encode
plumbing, so this is mostly a default-path swap.

### Other future improvements

1. **Direct TTS** if Runway opens the `/v1/text_to_speech` schema
   (would let the user write any script and have the brand voice
   read it over the visual cut).
2. **Per-campaign duration override** — let the user pick "match
   visual" / "match host" / "loop visual to host" in the UI before
   building. ~30 LOC frontend + a `mode` query param backend.

Neither is shipped here. Commercial with Voice today is the
clearest "final ad" artefact AdSpark can produce without crossing
those scope lines.

---

## PR X — Auto-voiced commercial — implemented (2026-05-08)

The "next polish" callout above is now closed. Two upgrades to the
Commercial with Voice route:

### Loop visual until host audio finishes (default)

`finisher_service.build_commercial_with_voice` now takes a
`loop_visual=True` kwarg (default). When set, ffmpeg uses
`-stream_loop -1 -i <video>` + `-map 0:v:0 -map 1:a:0 -c:v libx264
-c:a aac -shortest`. The video stream loops infinitely, so
`-shortest` ends the output when the host audio finishes — the user
hears the full hook + caption + CTA instead of just the opening
beat. Visual is re-encoded with libx264 (since `-stream_loop`
doesn't compose with `-c:v copy`) but the loop is invisible to the
viewer at 5 s ↻ ~10 s.

`loop_visual=False` keeps PR S's original strategy for backward
compatibility — `-c:v copy -shortest` trims audio to the visual cut.

### Auto-generate the Avatar Host Clip when missing

`POST /api/campaigns/{id}/commercial-with-voice` now accepts an
optional body `{auto_generate_host: true, loop_visual: true}`.
When the host clip is missing AND `auto_generate_host` is true:

- If a Brand Spokesperson Avatar is ready (character / selected /
  custom), the route fires `generate_host_video()` in-place,
  persists the host_video_* fields the same way the standalone
  `/host-video` route does, then proceeds to build the voiced
  commercial.
- If no avatar exists, returns **HTTP 409** with the friendly
  *"Create or attach a spokesperson first."* copy.
- Mock mode: same flow with the lavfi-anullsrc placeholder host
  clip; the resulting commercial has a silent audio track but a
  real audio stream so the pipeline doesn't 409 on
  `has_audio_stream`.

### Frontend UX

- "Build Commercial with Voice" → **"Build Voiced Commercial"**.
- Subcopy: *"Uses the selected spokesperson's spoken host clip as
  the voice track. If the host clip is missing, AdSpark will create
  it first."*
- Gated copy when no spokesperson: *"Attach or create a spokesperson
  first (Character tab)."*
- Gated copy when avatar exists but no host clip: *"AdSpark will
  auto-generate the Avatar Host Clip on the first build (~10 s in
  real mode)."*
- Overview "Next:" CTA promoted: when video is cached + a
  spokesperson exists, the suggested next action is *"Build voiced
  commercial →"* before Pack / Brand Voice.
- Exports row label: "Commercial with Voice" → **"Voiced
  Commercial"**.

### Verification

- ffprobe on real-mode output of campaign `9a717c675ec6`
  (Brewster):
  - Pre-PR-X: video 5.04 s + AAC audio 5.03 s (audio cut off
    mid-sentence)
  - Post-PR-X: video **9.79 s** + AAC audio **9.81 s** at 48 kHz
    (full pitch lands)
- Mock-mode preconditions verified via curl:
  - 409 *"Create or attach a spokesperson first"* on a campaign
    without character/avatar
  - 409 *"Save the visual video first"* on a campaign without
    cached video
- Real-mode auto-host path is the same code path as the standalone
  `/host-video` route — already verified end-to-end by SESSION_008's
  Brewster hero-run.

---

## PR AB — Cinematic Ad vs Spokesperson Ad (2026-05-09)

The audio gap that PRs S/X closed produced a **voiceover ad**: a
silent Runway visual cut with the Avatar Host Clip's audio mixed
on top. That works for B-roll-style cinematic ads, but it's the
wrong primitive for **mascot / personality-driven** campaigns where
the user wants the character looking at camera, mouth synced,
speaking the script.

The Avatar Host Clip itself is the right primitive for that use
case — it is already a talking-to-camera Runway `avatar_videos`
render. PR AB renames the surface so users find it, and adds a
clear distinction between the two final outputs a saved campaign
can produce.

### The two ad modes

| Mode | Visual source | Audio source | Lip sync? | Best for |
|---|---|---|---|---|
| **Cinematic Ad** (`/commercial-with-voice`) | Runway `image_to_video` (silent) | Avatar Host Clip audio (extracted via ffmpeg) | **No** — visual is unrelated to mouth movement | B-roll, product shots, atmospheric scenes |
| **Spokesperson Ad** (`/spokesperson-ad` alias of `/host-video`) | Runway `avatar_videos` (the avatar itself) | Same render — speech is rendered with the visual | **Yes** | Mascot ads, founder spokespersons, talking-head campaigns (e.g. Brewster) |

### Why `image_to_video` is not lip-synced

Runway's `gen4_turbo` / `gen4.5` produce visual-only output that
animates a reference image. They do not consume a script and have
no concept of mouth movement. The voice audio must come from a
separate source (`avatar_videos` or `text_to_speech`, the latter
remaining gated). PR S/X's ffmpeg mux is the right answer for that
constraint, but it's a *voiceover* path — the visual and audio
are not synchronised.

### Why `avatar_videos` is the direct talking-ad path

`/v1/avatar_videos` accepts a script + an avatar id and renders the
avatar speaking the script with mouth movement. The output is one
file with both video + audio streams (h264 + AAC, ~1088×704 at the
gwm1_avatars model). No mux is required. This is the artefact
AdSpark already cached at `backend/data/host/<id>.mp4` for every
"Present Campaign" call; PR AB just promotes it as the final
deliverable for spokesperson-driven campaigns.

### Backend surface change

- New alias routes `POST` + `GET /api/campaigns/{id}/spokesperson-ad`
  delegate to `post_host_video` / `get_host_video`. **Same persisted
  fields** (`host_video_url`, `host_status`, `host_task_id`, etc.).
  **Same cached MP4** at `backend/data/host/<id>.mp4`. No new files
  written; no new schema migration. Backward-compatible — every
  pre-PR-AB persisted `host_video_url` continues to resolve.
- Routes 48 → **50** (POST + GET pair).

### Frontend surface change

- Character tab: subsection header "Avatar Host Clip" → **"Spokesperson
  Ad"** with subtitle "Your selected character speaks the saved
  commercial script directly to camera with synced mouth movement"
  and ready badge "lip synced + audio". The Runway-technical phrase
  "Powered by Runway avatar_videos" survives as a small footnote.
- Voice tab: button "Record Host Clip from Script" → **"Generate
  Spokesperson Ad"**. Adds a new top-level **Ad Mode primer card**
  that defines Cinematic vs Spokesperson with one-sentence guidance.
- Visuals tab Final Voiced Ad: subtitle now starts with "This is
  the Cinematic Ad…" and includes a "for a talking-to-camera ad,
  use Spokesperson Ad" jump-button.
- Overview chip "Host clip" → **"Spokesperson Ad"** with hint "lip
  synced + audio" / "not recorded".
- Overview Next-action cascade now surfaces "Generate spokesperson
  ad →" (jumps to Character tab) ahead of the cinematic build.
- Exports row "Avatar Host Clip" → **"Spokesperson Ad"** with meta
  "talking avatar video with synced voice (Runway avatar_videos)".

### Real-mode verification (CEO Buzz / Brewster, 2026-05-09)

- `POST /api/campaigns/8ea08b2fc95d/script` — saved 201-char script.
- `POST /api/campaigns/8ea08b2fc95d/spokesperson-ad` — 200 in 38.7 s.
- ffprobe on `data/host/8ea08b2fc95d.mp4`: h264 1088×704 + AAC mono
  48 kHz, **15.29 s**. Brewster lip-syncs the full "Built for
  founders, coders, and sleep-deprived legends chasing impossible
  ideas at 3AM…" script.
- `GET /api/campaigns/8ea08b2fc95d/spokesperson-ad` → 200 video/mp4,
  4.97 MB. Same file the legacy `GET /host-video` returns.

### Mock-mode parity

The same lavfi placeholder MP4 generation runs unchanged
(`character_host_client._generate_mock`). Mock spokesperson-ads
display "mock · lip sync" instead of "lip synced + audio" so the
demo story stays honest under no-key conditions.

