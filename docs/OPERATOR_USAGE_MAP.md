# AdSpark Studio — Operator Usage Map

**Last updated:** 2026-05-09 (post `hackathon-submission-v13`,
PR AF Multi-Character Dialogue Scene Builder).

**Read order:** This is the top-to-bottom "how do I actually use
this thing?" guide. New operators (humans or AI) should read
sections 1–4 to understand the flow, then jump to whichever ad
mode (5 / 6 / 9) or surface (7 / 8) they want to demo. Section 12
has six end-to-end demo paths with timings and credit estimates.

**Companion docs:**
- `docs/WHAT_IT_IS.md` — narrative anchor.
- `docs/INVENTORY.md` — runtime anchor (every file + route).
- `docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md` — full Runway
  surface map.
- `docs/handoffs/SESSION_011_OPERATOR_USAGE_MAP.md` — current
  product state + next-phase candidates.

---

## 1. Stage 1 — Spokesperson / Character Studio

### What it is

The first stage of the on-page flow. The user picks **who** the
campaign is about before they fill out **what** the ad is.
Characters are first-class resources — created once, reused across
every campaign and every ad mode.

### What you can do

#### Create a Character
1. Click **`+ Create Character`** at the top of the Character
   Studio panel (Stage 1).
2. Fill the form:
   - **Name** (e.g. `Brewster the Raccoon`)
   - **Template** — `mascot` / `founder` / `coach` / `local_guide`
     (locked set; each maps to a portrait template prompt).
   - **Subject** — short physical description.
     Example: *"a friendly raccoon barista mascot, warm
     hospitable smile, coffee shop apron"*.
   - **Style** (optional) — *"photorealistic stylised plush
     texture"*.
   - **Voice preset** — pick from the 30-preset dropdown. Featured
     presets show curated descriptions inline (Drew, Ruby, Max,
     Victoria, Vincent, Clara, Skye, Morgan, Aurora, Felix,
     Marcus, Emma). Other presets fall back to a generic
     description; the disclaimer note explains Runway doesn't
     expose preset audio previews.
   - **Personality** (optional) — short prose about how the
     character behaves on camera (≤ 600 chars).
   - **Portrait Prompt** — opens auto-derived from the other
     fields. **Editable** — append your own framing cues. Helper
     text spells out the avatar-ready rules of thumb (centered
     head-and-shoulders, good lighting, no text artefacts).

   Click **Create**. The portrait generation fires automatically —
   `gen4_image_turbo` returns a 1280×720 PNG in ~25–45 s real /
   instant in mock.

#### Bind the Runway Avatar
After the portrait lands, the character tile shows a **`Create
Runway Avatar`** button. Click it. AdSpark reads the cached
portrait, embeds it as a data URI (≤ 5 MB), and posts to
`POST /v1/avatars`. Polls READY in ~30–45 s (real). The status
chip flips from `pending` → `ready` (or `failed` if Runway
rejects the image).

#### Select active spokesperson
Each character tile has a **`Use as Spokesperson`** button. Click
it. The orange "active" pill appears + the choice persists in
`localStorage` under `adspark.spokesperson.v1`. The Stage 2 brief
gets a pink chip showing the active spokesperson; saving any
campaign auto-attaches them via `/api/campaigns/{id}/attach-character`.

#### What makes a good portrait
- **Centered head-and-shoulders.** Not full-body, not a profile
  shot. Runway's avatar processor uses face detection.
- **Good lighting + neutral background.** Don't fight the avatar
  pipeline.
- **One subject only.** Multi-character or busy scenes get rejected.
- **No on-image text** (logos, captions, signage). The processor
  treats text as artefacts.
- **Stylised is fine** — animated mascots, plush textures, illustrated
  founders all work as long as they read as a single character with a
  visible face.

### Voice preset limitations
- Runway presets (`runway-live-preset` ids) are zero-config and
  demo-clean.
- There is **no documented endpoint to preview a preset MP3**
  without first creating an avatar bound to that preset. PR AA
  ships curated text descriptions instead so users don't burn
  credits previewing.
- Once an Avatar is bound, the **Spokesperson Ad** itself is the
  fastest way to hear the voice in context.
- ~~Custom voice cloning via `POST /v1/voices` `from.type=audio`
  is documented but not yet wired in AdSpark.~~ **Resolved by
  PR AN — see "Cloning a custom voice" below.**

### Cloning a custom voice (PR AN)

Each Character Studio library tile carries a compact **Voice**
section under the portrait + status pill:

- A **status pill** that reads `preset · <name>` (default), or
  `cloned` (real Runway), or `cloned · mock` (mock mode), or
  `clone failed` with the upstream error in the tooltip.
- A **file picker** (`<input type="file" accept="audio/*">`)
  + **Clone voice** button. Audio mimetypes accepted:
  `audio/mpeg`, `audio/wav`, `audio/m4a`, `audio/mp4`,
  `audio/aac`, `audio/webm`, `audio/ogg`. Cap: 15 MB locally
  (Runway docs say 10 MB).
- Helper copy: "Upload a sample to clone a custom voice for this
  character. Used the next time you Create Runway Avatar." When
  a voice is cloned but the avatar still uses the preset:
  "Voice ready — Create Runway Avatar to bind it."

Backend:

```
POST /api/characters/{id}/clone-voice
  multipart/form-data
    audio: <file>      # required, ≤ 15 MB, audio/* mime
    name:  "..."       # optional voice label (defaults to "AdSpark — <character>")
```

In mock mode the route returns a deterministic
`mock_voice_<sha256(name + audio bytes)[:16]>` id and persists
the `cloned · mock` status on the character. Re-uploading the
same sample is idempotent; a fresh sample yields a new id.

In real mode the backend embeds the audio as a base64 data URI
and POSTs `/v1/voices` with `from.type=audio`. Failure modes:

- **404** — character not found.
- **413** — audio sample exceeds the 15 MB cap.
- **415** — unsupported audio mime type.
- **422** — empty / unreadable audio body.
- **502** — Runway upstream rejection.

Wiring: when the operator next clicks **Create Runway Avatar**
on the character, `services.character_studio_client._create_avatar_real`
sees `character.custom_voice_id` and posts
`voice: {type: "custom", voiceId: <id>}` instead of the
`runway-live-preset` binding.

#### Auto-PATCH for existing avatars (PR AQ)

Already-bound avatars no longer have to be re-created to pick up
a freshly cloned voice. After every successful
`POST /clone-voice`, the route runs a best-effort
`PATCH /v1/avatars/{id}` body `{voice: {type: "custom",
voiceId: <id>}}` against the character's existing
`runway_avatar_id`. The result is persisted on the character
record as one of:

| Patch state | When | UI pill (alongside the cloned-voice pill) |
|---|---|---|
| `pending_avatar` | Voice cloned but no avatar bound yet | grey *"pending avatar"* |
| `applied` | Real PATCH returned 2xx | emerald *"applied to avatar"* |
| `mock_patched` | runway_mock OR avatar id starts with `mock_` | amber *"applied · mock"* |
| `failed` | Non-2xx / network / unexpected | rose *"patch failed"* + tooltip |

When the patch state is `failed`, the voice section also surfaces
a small **`Apply to existing avatar`** button (testid
`custom-voice-apply-avatar`) that retries via
`POST /api/characters/{id}/apply-voice` without re-uploading the
audio. Failure stays best-effort — the cloned `custom_voice_id`
remains usable for any future avatar recreate.

Backend manual-retry route:

```
POST /api/characters/{id}/apply-voice
  → 200  { ...character, custom_voice_avatar_patch_status: "applied" | "mock_patched" }
  → 409  no custom voice cloned yet
  → 502  Runway upstream rejection
```

`data-testid` hooks: `custom-voice-avatar-patch-status` (the
status pill), `custom-voice-apply-avatar` (the manual retry
button — only renders on the `failed` branch).

#### Hearing the cloned voice (PR AR)

When Runway returns a `previewUrl` during the clone poll
(real-mode only — mock clones never emit one), the voice
section renders an inline native `<audio controls>` element
labeled **"Cloned voice preview"** so operators can hear the
result before binding it to an avatar.

- Persisted on `Character.custom_voice_preview_url`.
- Captured by the same poll loop that watches for `READY` —
  no extra HTTP round trips.
- Tolerant `_extract_preview_url` accepts `previewUrl` /
  `preview_url` / `preview` casings so a future server-side
  rename never silently drops the preview.
- Mock mode: persists `null`. The UI shows
  *"Preview unavailable in mock mode."* instead of an audio
  element.
- Real-mode poll timeout: persists `null`. The UI shows
  *"Preview unavailable for this cloned voice."*

`data-testid` hooks: `custom-voice-preview` (the audio element),
`custom-voice-preview-unavailable` (the fallback line).

This preview is **distinct** from the PR AP recorded-take
preview, which renders inside the Or-record row above and shows
the captured Blob *before* the clone fires. PR AR's preview
shows what Runway returned *after* the clone landed.

#### Recording in-browser (PR AO)

Below the file picker on each library tile sits a small
**Or record** row that captures audio straight from the
operator's microphone via `MediaRecorder` — no separate audio
editor needed.

State machine + buttons:

- **`idle`** (zinc pill) — `Start recording` (rose) is enabled.
- **`recording`** (rose pill, animate-pulse) — shows live
  `recording · Ns` counter; `Stop` button replaces start.
- **`recorded`** (emerald pill) — `Clone from recording`
  (emerald) + `discard` link.
- **`cloning`** (emerald pill, animate-pulse) — POST in flight
  to `/v1/voices`.

Codec preference: the recorder picks the first supported mime
from
`audio/webm;codecs=opus → audio/webm → audio/ogg;codecs=opus → audio/mp4`.
The captured `Blob` is wrapped in a `File` named
`adspark-voice-sample-<character-slug>.webm` (or `.m4a` when the
fallback Safari mp4 codec was selected) and POSTed through the
existing PR AN clone route — no new backend surface.

Fallback: when `MediaRecorder` or `navigator.mediaDevices.getUserMedia`
is unavailable (older browsers, insecure contexts), the row
collapses to a single helper line:

> *Recording unavailable — upload an audio file instead.*

Microphone-permission denial surfaces inline with
*Microphone permission denied — upload an audio file instead.*
The file upload path stays fully functional in every fallback
state.

`data-testid` hooks (for the smoke + future tests):
`custom-voice-record-status`, `custom-voice-record-start`,
`custom-voice-record-stop`, `custom-voice-record-use`.

#### Previewing a take before cloning (PR AP)

Once a recording lands (state ⇒ `recorded`), the row reveals an
inline native `<audio controls>` player bound to the captured
Blob via `URL.createObjectURL`. A one-line helper underneath
reads *"Preview your take before cloning."* The operator can
play, scrub, and decide whether to keep or discard before
clicking **Clone from recording**.

Object-URL lifecycle (always cleaned up):

- **Discard** — URL revoked, state → `idle`, blob ref cleared.
- **Successful clone** — URL revoked (handled by the auto-discard
  inside `handleUseRecording`), persisted PR AN status pill
  shows the cloned state.
- **Component unmount** — `useEffect` cleanup revokes the URL.
- **Next recording start** — previous URL revoked before the new
  capture begins so the `<audio>` never points at a stale Blob.

`data-testid` hooks: `custom-voice-record-preview` (the audio
element), `custom-voice-record-preview-help` (the helper line).
Both render only in `recorded` state.

### Where this maps to backend
- `POST /api/characters` (record), `POST /api/characters/{id}/generate-portrait`,
  `POST /api/characters/{id}/create-avatar`, `GET /api/characters`,
  `DELETE /api/characters/{id}`.
- Files: `backend/data/characters.json`,
  `backend/data/characters/<id>-portrait.png`.

---

## 2. Stage 2 — Campaign Brief

### What it is

A four-field form that drives the entire downstream chain.
Concepts, prompts, scripts, storyboard, and dialogue all derive
from these inputs.

### What you fill in

| Field | Limit | Example |
|---|---|---|
| **Business / brand** | 2–200 chars (required) | `CEO Buzz` |
| **Product / service** | ≤ 200 chars | `Dumpster-to-CEO Energy Drink` |
| **Tone** | ≤ 80 chars | `Absurd startup comedy with cinematic overconfidence.` |
| **Audience** | ≤ 200 chars | `Founders, coders, late-night grinders chasing impossible deadlines.` |

Per-field char counters live next to each label (PR AC fix). The
browser blocks input past the cap, so you never silently hit a
backend 422.

Click **Generate Ad Concepts**. Three concept cards render:
`Origin Spark` / `Daily Ritual` / `Frontier`. The recommended
card is starred. The selected concept feeds:

- The structured Runway video prompt (Stage 3).
- The deterministic Commercial Script (Stage 3).
- The storyboard planner narrative cues (Visuals tab).
- The dialogue scene planner narrative cues (Dialogue tab).
- The realtime broker's `personality` + `startScript` overrides
  (Realtime tab — PR AE).

### How to recover from "nothing happens"

If the Generate button appears to do nothing:

1. **Look at the top of the page** — error banner has
   `role="alert"` + auto-scroll-into-view (PR AC fix). Any
   422 / 502 / 503 lands in the middle of your viewport.
2. Per-field counters show whether you typed past a cap.
3. Backend logs (`/tmp/uvicorn.log`) show every POST + status code.

---

## 3. Stage 3 — Creative Direction

### What it is

The unified panel where the **spoken pitch** + the **visual prompt**
sit together. Title is **"Creative direction"**. Two visually
distinct sections, top to bottom:

### Section A — Commercial Script (pink card)

The spoken pitch the spokesperson will read. Drives:
- **Spokesperson Ad** (lip-synced render)
- **Final Voiced Cinematic Ad** (audio mux)
- **Voiced Storyboard** (audio mux over stitched visual)
- **Realtime session** (`startScript` opening line + `personality`
  context)
- **Dialogue Scene** planner (script sentences distributed across
  Hook / Beat / Closer beats)

Controls:
- **Editable textarea** with 300-char counter.
- **Generate Script** — pulls a deterministic pitch from business
  + product + audience + selected concept hook/caption/CTA + the
  active character's personality.
- **Save** (saved-campaign card) — the Stage 3 panel auto-saves
  via the `commercial_script` field on the initial save call.
- Helper copy: *"This is what the spokesperson says. The Runway
  prompt below controls what the visual does."*
- Breadcrumb pill: `Script → Storyboard → Video → Final Ad`.

### Section B — Runway Video Prompt

The visual ad prompt the camera sees. Drives:
- The `image_to_video` / `text_to_video` call (one Cinematic shot).
- The Storyboard planner falls back to the structured builder
  template for shot prompts that aren't yet directed.

Controls:
- **Editable textarea** (auto-filled by the structured builder
  with `"A realistic …"` openers).
- **Simplify Prompt** — re-derives a clean structured prompt from
  the selected concept + form + ratio. Replaces whatever's in the
  textarea.
- **Hint chip**: *"structured prompt"* + rules-of-thumb hint
  *"Best results: one character, one location, one action, one
  camera move."*

### Structured prompt rules (PR T)

- **One character / subject.** Multiple subjects compete for the
  model's attention budget.
- **One environment.** Scene transitions in 5 s look like glitches.
- **One action.** The model can render a smooth motion arc;
  chained actions cut.
- **One camera move.** Pick static OR slow-push OR pan — never
  combine.
- **One emotional tone.** "Warm and energetic and mysterious" →
  muddy.
- **Concrete > abstract.** *"plaid robe"* beats *"iconic vibe"*.
- **Constraints at the end.** Lighting / style / format named
  separately so each gets its own attention slot.

Full guide: `docs/research/RUNWAY_PROMPT_STRUCTURE.md`.

### Visual Source picker (PR R)

Four explicit options:

| Source | What happens |
|---|---|
| **Generate image** | Runway `gen4_image_turbo` produces a fresh reference image from the prompt. Cached to `backend/data/images/<id>.png`. |
| **Upload image** | Multipart upload via `POST /api/runway/upload-image`. Accepts URL or file. Cached to `backend/data/images/<id>.{png,jpg,jpeg,webp}`. |
| **Use Character** | Pins the active character's portrait as `prompt_image`. PR AD warning: the cinematic visual is **not lip-synced** and identity may drift across frames. For the character speaking directly to camera, use **Spokesperson Ad** instead. |
| **Text-only** | Only valid for `gen4.5`; routes to `text_to_video`. |

### Generate Video / save flow

1. Pick model (`gen4_turbo` 5 s / `gen4.5` 5–10 s) + ratio
   (1280:720 / 720:1280 / 960:960) + duration. Settings persist
   in `localStorage`.
2. Click **Generate Video**. Status pill PENDING → RUNNING →
   SUCCEEDED (~12 s mock / 60–90 s real).
3. Click **Save Campaign Card**. Backend saves the campaign +
   downloads the presigned MP4 to `data/videos/<id>.mp4`. Active
   spokesperson auto-attaches; the Stage-3 Commercial Script
   draft persists into `commercial_script` in the same atomic
   save.
4. Gallery scrolls to the new card with the "just saved" pill +
   pink ring + Visuals tab pre-selected.

### Why image_to_video isn't lip-synced

Runway's `gen4_turbo` and `gen4.5` animate a reference image with
a text prompt. They consume a single still as a style + composition
anchor and generate motion from there. They don't read scripts and
have no concept of mouth movement. PR AD added an amber identity-
drift warning to the Use Character branch so users don't expect
the wrong primitive.

---

## 4. Saved campaign cards

Every saved campaign renders as a tab-laden card in Stage 4.

### Newest-saved focus (PR Y)

The just-saved card gets:
- A pink **"just saved"** pill in the header.
- A spark-coloured ring + glow.
- Auto-scroll into view.
- Pre-selected Visuals tab (so the user lands on the cached video
  + Voiced Commercial CTAs).

### Creative-director breadcrumb (PR AC)

Above the tab row, a small nav reads:
```
✓ Script → · Storyboard → · Video → · Final Ad
```
Each step lights up when its underlying state is ready
(`commercial_script` saved / storyboard planned / hasVideo /
commercial or host clip ready).

### Tabs

| Tab | What's there |
|---|---|
| **Overview** | Status chips (Visual / Pack / Spokesperson / Spokesperson Ad / Voice / Realtime) + the **3-card "Pick your ad mode" picker** (Cinematic / Spokesperson / Dialogue) + Next-action CTA |
| **Visuals** | Silent source video + Final Voiced Cinematic Ad section + Storyboard subsection + Campaign Pack |
| **Character** | Brand Spokesperson card + Avatar Picker + Spokesperson Ad section (PR AB rename of "Avatar Host Clip") |
| **Voice** | Ad Mode primer card + **Commercial Script editor** + Audio Pack (Brand Voice + Multilingual Dubs) |
| **Dialogue** | Multi-character dialogue scene builder (PR AF) — Plan / per-line edit + generate / Stitch / final scene player |
| **Realtime** | Talk to Brand Spokesperson (live WebRTC) — campaign-aware personality + startScript injected (PR AE) |
| **Exports** | Per-output ledger of every cached artefact with download links |

### Exports ledger

The Exports tab lists every cached output as a row:

- Visual ad (silent cut)
- Campaign Pack — Landscape / Reels / Square
- Voiced Commercial (= Final Voiced Cinematic Ad)
- Storyboard Commercial
- Voiced Storyboard
- **Dialogue Scene Ad** (PR AF)
- Spokesperson Ad
- Brand Voice Sample
- Voice Sample — Spanish / French / German / etc (per language built)

Rows that aren't built yet say *"not generated yet"* in italic
grey; built rows show a `download ↓` link.

---

## 5. Cinematic Commercial mode

### What it is

The b-roll / atmospheric / product-shot ad. Visual is a Runway
`image_to_video` cut; audio is the Avatar Host Clip's track
extracted and looped under the visual via ffmpeg.

### Outputs

- **Raw silent visual** (`/api/campaigns/{id}/video`) — what
  Runway returned. h264, 1280×720 default, 5–10 s, no audio
  stream.
- **Final Voiced Cinematic Ad**
  (`/api/campaigns/{id}/commercial-with-voice`) — visual loops
  under host audio, output trims to audio length. Cached at
  `data/finished/<id>-commercial-voice.mp4`.

### Why it isn't lip-synced

The visual was generated from a single reference image; the audio
came from a separate `avatar_videos` render. The two are
synchronised in length only, not in mouth shape. Use this mode
when the visual is **not a talking-head** — product shots,
atmospheric scenes, scenic b-roll.

### When to use it

- Product launch with cinematic visuals.
- Brand-mood spots (coffee shop, sunrise, hands-on craftsmanship).
- Anything where the camera *isn't* on a face that needs to speak.

### How to generate it

1. Save a campaign in Stage 3.
2. Open the saved card → Visuals tab.
3. Either click **"Build Cinematic Ad ↗"** on the Overview Ad Mode
   picker (jumps to Visuals) or directly hit **"Build Voiced
   Commercial"** in the Visuals tab's Voiced Commercial section.
4. AdSpark auto-creates the Avatar Host Clip first if it's
   missing (only requires that **some** spokesperson is ready).
5. ffmpeg `-stream_loop -1 -shortest` produces the final MP4.

Backend route: `POST /api/campaigns/{id}/commercial-with-voice`
with body `{ "auto_generate_host": true, "loop_visual": true }`.

---

## 6. Spokesperson Ad mode

### What it is

The talking-head ad. Runway `avatar_videos` renders the selected
character speaking the saved Commercial Script directly to camera
with synced mouth movement. **One MP4 with both video + audio
streams.**

### Why it's lip-synced

`/v1/avatar_videos` takes an Avatar id + a script and renders the
avatar speaking it. The model is conditioned on speech timing,
producing visemes-aligned output. The Avatar id is a managed
Runway resource bound at create time, so identity stays stable
across renders.

### When to use it

- Mascot ads (Brewster, Piper).
- Founder explainers ("Hi, I'm the CEO and here's why we built
  this").
- TikTok / Reels-style talking-head content.
- Anywhere the character's face needs to appear on camera while
  speaking.

### How to generate it

1. Have a Character with a ready Runway avatar (Stage 1).
2. Save a campaign that's attached to that character (Stage 2/3 with
   the active spokesperson set, or use the Character tab's
   **Attach Character** affordance after save).
3. Save a Commercial Script in the Voice tab (or accept the
   templated fallback).
4. **Click "Generate Spokesperson Ad"** from any of three places:
   - Overview tab → Spokesperson Ad picker card → **Generate**
     button.
   - Character tab → Spokesperson Ad section → **Generate
     Spokesperson Ad** button.
   - Voice tab → Commercial Script → **Generate Spokesperson Ad**
     (saves the script first if dirty).

### Output

- Cached at `data/host/<campaign_id>.mp4`.
- 1088×704 h264 + AAC mono 48 kHz.
- Duration matches the script length (~8–15 s typical).
- Served via both `/host-video` and the PR AB alias `/spokesperson-ad`.

---

## 7. Storyboard Commercial Builder

### What it is

A 3-shot Cinematic Commercial. Each shot is a separate
`image_to_video` render anchored on the active character's
portrait. ffmpeg concatenates them into a longer (~15 s)
landscape MP4.

### Where it lives

Visuals tab → Storyboard subsection (between Voiced Commercial
and Campaign Pack).

### What you can do

#### Plan storyboard
Click **Plan Storyboard**. AdSpark calls
`POST /api/campaigns/{id}/storyboard/plan` and persists three
default shots (Hook / Action / Payoff) on the campaign record.
Default prompts use the structured builder + the saved
`commercial_script` to weave narrative cues into each shot.

Re-plan via **`re-plan from script`** to overwrite all three
prompts with fresh AI suggestions (clobbers any local edits).

#### Edit shot prompts (PR AC)
Each shot card has an **editable textarea**. Edit freely; the char
counter shows usage; **`unsaved`** appears next to the counter
when the draft diverges from the persisted text.

- **Save Prompt** persists via
  `POST /api/campaigns/{id}/storyboard/shot/{shot_id}/prompt`,
  resets that shot to `idle`, invalidates the stitched output.
- **reset to AI suggestion** reverts the local draft to the
  currently-saved text.

#### Generate shots
Click **Generate Shot N** per shot. AdSpark fires
`POST /api/campaigns/{id}/storyboard/generate-shot/{shot_id}` —
the same `image_to_video` primitive AdSpark uses for the main
campaign video, just targeted at one shot's prompt + the active
character's portrait.

If you have an unsaved edit, Generate Shot **flushes the draft
first** so Runway sees the on-screen text.

Status pills: `idle` → `running` → `ok` (or `failed`).

#### Stitch
Once all 3 shots are `ok`, **Stitch Storyboard Commercial**
becomes enabled. ffmpeg `filter_complex concat=n=3:v=1:a=0`
normalises every input to 1280×720 / 30 fps and outputs the final
MP4. Audio is dropped (the Cinematic ad mode doesn't carry audio).

#### Voiced storyboard
After stitching succeeds, the section unlocks a **Build Voiced
Storyboard** sub-button. Same `-stream_loop -1` audio mux pattern
as Voiced Commercial, but over the stitched 15-s visual.

### Current limitations

- **Landscape only.** 1280×720 output. Vertical / Reels variants
  are deferred (Tier-1 future polish).
- **Identity drift** between shots — even with the same character
  portrait pinned, `image_to_video` can shift small details
  (hat angle, fur pattern) frame-to-frame. Use Spokesperson Ad
  if visual identity must stay perfect.
- **Voiced storyboard duration** = host audio length (visual
  loops if shorter). Last shot may visually be cut when audio
  ends.
- **No audio on the silent stitch** — by design. Voiced storyboard
  is a separate ffmpeg pass.

Full design: `docs/research/STORYBOARD_COMMERCIAL_BUILDER.md`.

---

## 8. Realtime Spokesperson

### What it is

A live WebRTC conversation with the campaign's active avatar via
`/v1/realtime_sessions`. Mic-only V1; webcam optional.

### Where it lives

Realtime tab on every saved campaign card.

### What it knows about the campaign (PR AE + PR AI)

The broker injects up to three override fields into
`POST /v1/realtime_sessions`:

- **`personality`** — composed from business / product / audience
  / tone / character voice + personality / hook / caption / CTA /
  `commercial_script`. Capped at 9,500 chars (Runway limit is
  10,000). Order: business context → character voice → script +
  concept → behaviour rule. **PR AI** — when the campaign has a
  grounding document attached, the broker swaps in a slim
  ~300-char personality that anchors identity + tone and points
  at the document for facts.
- **`startScript`** — first sentence of `commercial_script`, or a
  templated *"Hi, I'm {character}. I'm here to talk about
  {business} and {product}."* fallback. Capped at 280 chars.
- **`documentIds`** (PR AI) — `[campaign.runway_document_id]` when
  the operator clicked **Attach grounding doc** on the Realtime
  tab and the document is `ready` or `mock`. The avatar grounds
  factual answers in the document instead of hallucinating
  outside the brief.

Defensive (two-tier): if Runway returns 400 with documentIds
present, the broker first retries without `documentIds` (keeps
personality + startScript). If that still 400s, it falls back to
the bare `{model, avatar}` body — same as pre-PR-AE behaviour.

### Attaching the grounding doc (PR AI)

The Realtime tab now opens with a **"Realtime grounding"** card
above the conversation control. Two states:

- **`Prompt-grounded`** (default, grey pill) — the broker injects
  campaign context inline as personality only. No documentIds on
  the session body.
- **`Document-grounded`** (emerald pill) — `runway_document_id`
  is set; the broker passes documentIds on every session create.
  In mock mode the pill shows **`Document-grounded · mock`** in
  amber so the operator can see the grounding hooked end-to-end
  without thinking the live session is actually grounded.

Click **`Attach grounding doc`** (or **`Refresh grounding doc`**
when one already exists) to:

1. Build a Markdown brand brief from
   business / product / audience / tone / selected concept /
   `commercial_script` + the attached Character (name / template /
   voice / personality / catchphrases) + a behaviour rule block.
2. `POST /v1/documents` with `{name, content}`. Mock mode returns
   a deterministic `mock_doc_<sha256>` id — the same content
   hashes to the same id across runs, but editing the script
   produces a fresh id.
3. Best-effort `PATCH /v1/avatars/{avatar_id}` with
   `documentIds=[id]` so a brand that hits the avatar without a
   campaign-scoped session also sees the grounding. Skipped in
   mock mode + when the active avatar is mock/unset. Failure is
   logged but never breaks the route — the per-session
   `documentIds` body is the primary grounding path.

Backend route:

```
POST /api/campaigns/{id}/realtime-document
```

Returns the updated `Campaign` with `runway_document_id` /
`runway_document_status` / `runway_document_error` /
`runway_document_mock_mode` populated. 502 on real-mode upstream
failure (caller surfaces the error in the rose-coloured row);
409 only when the campaign has zero content to ground on.

### Replaying a conversation (PR AJ)

Below the grounding card sits the **"Conversation transcript"**
card — the replay surface for completed realtime sessions. State
machine:

- **`No transcript yet`** (default, grey pill) — campaign has no
  cached transcript yet. Click **`Fetch transcript`**.
- **`No session yet`** (after a real-mode fetch with no recorded
  session) — operator hasn't run a live realtime session for this
  campaign. Start one in the conversation control below.
- **`Replay ready · N turns`** (emerald) — turns are cached and
  rendered as a colour-coded list (avatar = violet, visitor = sky,
  system = grey). Scrollable up to 11rem.
- **`Replay ready · mock · N turns`** (amber) — same, but the
  source is the deterministic mock 3-turn replay so judges +
  operators don't mistake it for a real recording.
- **`Empty`** — Runway has the conversation id but no recorded
  turns yet (still processing). Refresh in a few seconds.

Backend route:

```
POST /api/campaigns/{id}/realtime-transcript
{
  "conversation_id": "..."   // optional override for replaying a
                              //   session created elsewhere
}
```

Where the conversation id comes from: Runway's `sessionId`
returned by `POST /v1/realtime_sessions` doubles as the
`conversationId`. AdSpark captures it server-side immediately
after the broker succeeds (see
`POST /api/campaigns/{id}/spokesperson-session` in PR AJ).

Mock mode: short-circuits to a deterministic 3-turn replay built
from `business / product / audience / hook / commercial_script /`
the attached Character. The conversation id is a stable
`mock_conv_<sha-of-campaign-id>` so re-fetches return the same
handle and the cached turns survive a page reload.

Returns the updated `Campaign` with `runway_conversation_id`,
`realtime_transcript_status` (`ok` / `failed` / `mock` / `empty`
/ `no_session`), `realtime_transcript_error`,
`realtime_transcript_fetched_at`, `realtime_transcript_turns[]`,
and `realtime_transcript_mock_mode` populated.

Real-mode failure modes:
- **409** — no recorded session for this campaign yet (and no
  override on the body).
- **502** — Runway returned an error fetching the transcript.

#### Exporting a transcript (PR AL)

Two compact buttons sit next to **`Fetch transcript`** and unlock
the moment turns exist on the campaign record:

- **`Copy Markdown`** — copies a readable Markdown dump to the
  clipboard via `navigator.clipboard.writeText` with a
  hidden-textarea fallback for older browsers / restricted
  contexts. Header includes `Campaign`, `Conversation ID`,
  `Fetched`, optional `Mock mode: yes`, then a `## Transcript`
  section with `**Speaker:** message` blocks per turn.
- **`Download TXT`** — saves a plain-text version using `Blob` +
  `URL.createObjectURL` + a transient `<a download>` click. The
  filename comes from `transcriptFilename(campaign, 'txt')`
  (e.g. `adspark-transcript-ceo-buzz-8ea08b2f.txt`).

A small status banner under the controls reads `Copied as
Markdown` / `Download ready` (emerald) on success or
`Clipboard unavailable — try Download TXT` /
`Browser blocked the download` (rose) on failure. The banner
auto-clears after 2.5 s.

Frontend-only — no new backend route. The export operates on
the turns already persisted by PR AJ.

### Lifecycle

```
Browser            FastAPI broker              Runway
1. Click Start →  2. POST /v1/realtime_sessions
                  3. poll until READY
                  4. POST /{id}/consume
                  ← {url, token, roomName}  (one-shot)
5. WebRTC connect ────────────────────────► live A/V
                  ← session ends at 5-min cap (or DELETE)
```

### Suggested questions

The chip row above Start Conversation surfaces six campaign-grounded
starter questions (PR M Flow 5 + PR AE caption update):
- "Pitch [business] in one sentence — [hook]"
- "Who is this campaign for?"
- "Make this pitch funnier"
- "Give me three ad angles for [product]"
- "How would you improve this campaign?"

Click any chip to copy it to the clipboard, then read it aloud
once the session is live.

### Hard limits

- **5 minutes** maximum session duration. The frontend countdown
  surfaces Runway's `expiresAt`.
- **One-shot consume.** If the browser drops, restart the session.
- **Custom-voice avatars cannot use webcam or screen share**
  (Runway constraint). AdSpark stays mic-only for V1.
- **Mock mode** returns 503 with the friendly *"available in real
  mode only"* copy.

### Known limitations

- ~~**No transcript retrieval yet.**~~ **Resolved by PR AJ.** The
  Realtime tab now ships a "Conversation transcript" card that
  hits `POST /api/campaigns/{id}/realtime-transcript`, which
  proxies `GET /v1/avatar_conversations/{id}` and persists the
  turns. Mock mode renders a deterministic 3-turn replay.
- ~~**No RAG document attachment.**~~ **Resolved by PR AI.**
  `POST /v1/documents` + per-session `documentIds` + best-effort
  `PATCH /v1/avatars/{id}` are wired through the Realtime tab's
  Attach grounding doc affordance. Mock mode supported; long
  catalogues now grounded in the document instead of inflating
  the personality string.

---

## 9. Dialogue Scene Builder

### What it is

A 3-line multi-character branded skit. Each line is its own Runway
`avatar_videos` render targeted at a specific character's avatar
id; ffmpeg stitches the lines into one MP4 with audio preserved
across lines. **Different from Spokesperson Ad** — multiple
characters take turns speaking. **Different from Storyboard** —
the visuals are talking-head clips, not b-roll, and audio is
preserved.

### Where it lives

**Dialogue tab** on every saved campaign card (between Voice and
Realtime). Also surfaced as the third card in the Overview "Pick
your ad mode" picker.

### What you can do

#### Plan dialogue scene
Click **Plan Dialogue Scene**. AdSpark calls
`POST /api/campaigns/{id}/dialogue/plan` with these defaults:

- **3 lines** with labels Hook / Beat / Closer.
- **Speakers**: attached character → second-distinct ready
  character → attached character (so a back-and-forth lands as
  Character A → Character B → Character A closer). Falls back to
  single-speaker monologue when only one Character has a ready
  avatar.
- **Beat content**: `commercial_script` sentences distributed
  across the three beats; templated fallback per line when the
  script is too short or missing.

#### Choose characters
Each line card has a **speaker dropdown** populated from your
ready-character library (anyone with `runway_avatar_status` in
`{ready, mock}`). Pick a different character per line for true
multi-character dialogue.

#### Edit lines
Each line has an **editable textarea** with a 300-char counter
(matches the avatar_videos speech cap). **Save Line** persists via
`POST /api/campaigns/{id}/dialogue/line/{line_id}` with body
`{text?, character_id?}`; the line resets to `idle`.

#### Generate each line
Click **Generate Line Clip** per line. AdSpark calls
`POST /api/campaigns/{id}/dialogue/generate-line/{line_id}`. Same
`avatar_videos` primitive as Spokesperson Ad, just per-line.

If you have an unsaved edit, Generate Line **flushes the draft
first** so Runway sees the on-screen text + speaker.

Status pills: `idle` → `running` → `ok` (or `failed`).

#### Stitch the scene
Once every line is `ok`, **Stitch Dialogue Scene** unlocks.
ffmpeg `filter_complex concat=n=N:v=1:a=1` (audio preserved)
normalises every input to 1088×704 / 30 fps and outputs the final
MP4. Output: `data/finished/<id>-dialogue-scene.mp4`.

### When to use it

- **Office-style cold opens** — three characters trading lines.
- **Founder vs mascot reactions** — Brewster says something
  unhinged; the founder character reacts.
- **Fake podcasts** — host A asks, host B answers, host A wraps.
- **Recurring social bits** — characters carry over between
  campaigns; each campaign = a new "episode".
- **Explainer dialogues** — character A poses a question, B
  answers, A summarises.

### Limitations

- **Sequential, not simultaneous.** Characters are filmed in
  isolation per line — line N's character doesn't visually react
  to line N+1's character. Acceptable for skit-style cuts; real
  multi-character co-presence would need Runway-side simultaneous
  realtime or Act-Two with driving videos (deferred).
- ~~**Output is 1088×704 horizontal.** Vertical export is Tier-1
  future polish.~~ **Resolved by PR AG.** A 720×1280 vertical
  letterbox is now one click away on both the Spokesperson Ad and
  Dialogue Scene cards. See §11 "Building the Reels exports".
- **No caption overlays.** Per-line text is saved but not yet
  burned in via `subtitles=`. Tier-1 future polish.
- **300 chars per line.** Matches `avatar_videos` speech limit.
- **Default 3 lines fixed.** Custom line count + drag-to-reorder
  deferred.
- **No reaction shots.** 1 s cutaways between lines listed as
  Tier-1 polish.

Full design: `docs/research/DIALOGUE_SCENE_BUILDER.md`.

---

## 10. Audio / Voice model

A single mental model that holds across every ad mode:

| Surface | Visual carries audio? | Source of audio |
|---|---|---|
| Raw `image_to_video` | **silent** | Runway `gen4_turbo` / `gen4.5` produce visual only |
| `text_to_video` | **silent** | Same — visual only |
| Storyboard Commercial (silent) | **silent** | ffmpeg concat with `a=0` |
| Final Voiced Cinematic Ad | h264 + AAC | Avatar Host Clip audio extracted, looped under visual |
| Voiced Storyboard | h264 + AAC | Avatar Host Clip audio mixed over stitched storyboard |
| Spokesperson Ad | h264 + AAC | Runway `avatar_videos` renders the script with synced audio |
| Dialogue Scene Ad | h264 + AAC | Per-line `avatar_videos` audio preserved; ffmpeg concat with `a=1` |
| Brand Voice Identity | mp3 | `/v1/voices` text-design preview MP3 — **sample only**, not the ad copy |
| Multilingual Dubs | mp3 | `/v1/voice_dubbing` of the Brand Voice preview into 29 languages — **sample only**, not the ad copy |
| Realtime Spokesperson | live WebRTC audio | `/v1/realtime_sessions` uses the avatar's voice (preset or custom) |

### What this means in practice

- **Brand Voice + Dubs are not the ad narration.** They demonstrate
  the brand voice in 29 languages but are sibling samples.
- **The ad voice track is always the Avatar Host Clip / Spokesperson
  Ad audio.** That's the single source of truth for spoken pitch.
- **`/v1/text_to_speech` is gated** by Runway and not used.
- **No preset preview MP3.** Curated descriptions only (PR AA).

---

## 11. Export types

Every cached artefact a saved campaign can produce:

| Output | Cache path | Mode | Notes |
|---|---|---|---|
| Raw visual video | `data/videos/<id>.mp4` | both | h264 1280×720 default; silent |
| Campaign Pack — Landscape | `data/finished/<id>-finished.mp4` | both | 1280×720 silent + drawtext title/CTA |
| Campaign Pack — Reels | `data/finished/<id>-finished-reels.mp4` | both | 720×1280 silent |
| Campaign Pack — Square | `data/finished/<id>-finished-square.mp4` | both | 960×960 silent |
| Final Voiced Cinematic Ad | `data/finished/<id>-commercial-voice.mp4` | both | visual loop + host audio |
| Storyboard Commercial | `data/finished/<id>-storyboard.mp4` | both | 3-shot stitch, ~15 s, silent |
| Voiced Storyboard | `data/finished/<id>-storyboard-voice.mp4` | both | storyboard + host audio mux |
| Spokesperson Ad | `data/host/<id>.mp4` | both | `avatar_videos` render |
| Spokesperson Reels (PR AG + AH) | `data/finished/<id>-spokesperson-reels.mp4` | both | 720×1280 letterbox + burned-in caption from the saved Commercial Script — h264 + AAC |
| Dialogue Scene Ad | `data/finished/<id>-dialogue-scene.mp4` | both | N-line stitch with audio preserved |
| Dialogue Scene Reels (PR AG + AH) | `data/finished/<id>-dialogue-scene-reels.mp4` | both | 720×1280 letterbox + per-line burned-in captions timed via ffprobe — h264 + AAC |
| Brand Voice Sample | `data/audio/<id>-voice-preview.mp3` | both | mock = silent placeholder |
| Voice Sample — `<lang>` | `data/audio/<id>-dub-<lang>.mp3` | both | per-language dub of the Brand Voice sample |
| Realtime session | (no cache; live WebRTC only) | real only | mock returns 503 |

### Building the Reels exports

The **Captioned Reels (720×1280)** button lives next to
**`download Spokesperson Ad ↗`** (Character tab) and next to
**`download Dialogue Scene Ad ↗`** (Dialogue tab) once the
underlying clip is ready. Click it; ffmpeg runs locally
(~1–3 s); the inline `download reels ↗` link unlocks and the
matching Exports row flips from *not generated yet* to a
`download ↓` link.

Backend routes (unchanged from PR AG; PR AH layered captions on
top without adding new endpoints):

```
POST /api/campaigns/{id}/spokesperson-ad/reels
GET  /api/campaigns/{id}/spokesperson-ad/reels
POST /api/campaigns/{id}/dialogue-scene/reels
GET  /api/campaigns/{id}/dialogue-scene/reels
```

Preconditions surface as 409s the UI handles: source MP4 must
already exist (Spokesperson Ad rendered or Dialogue Scene stitched).
ffmpeg-missing surfaces as 503. Output dimensions are pinned at
720×1280; the backdrop colour defaults to dark slate (`#0b1220`)
and is overridable per campaign via PR AK (see "Brand colour"
below).

### Brand colour (PR AK)

Every saved campaign card carries a compact **Brand colour**
control between the creative-director breadcrumb and the tab row:
a native `<input type="color">` swatch + the live hex value + a
**reset** link.

- Default state: shows `#0b1220 (default)`. The next reels build
  uses the dark slate backdrop.
- Picker change: the colour is normalised + persisted on commit
  (input `onBlur`) via `POST /api/campaigns/{id}/brand-color`.
  The next reels build picks it up automatically — no additional
  rebuild button.
- Reset: clears the stored value; reels revert to the default.

Backend route:

```
POST /api/campaigns/{id}/brand-color
{ "color": "#ff7a00" }   // null or "" clears
```

The route accepts `#RRGGBB` / `RRGGBB` / `0xRRGGBB` / `#RGB` and
422s on anything else (e.g. `"not-a-color"`). The value persists
on `Campaign.brand_color` as lowercase `#RRGGBB`. The reels routes
read `record.brand_color`, run it through
`color_utils.to_ffmpeg_color(...)` (which falls back to
`0x0b1220`), and pass the result as `build_reels_export(...,
backdrop_color=...)`.

Output guarantees from PR AG / PR AH are unchanged: 720×1280,
h264 + AAC, captioned by default. Only the letterbox bars'
colour changes.

### Contrast-aware captions (PR AM)

PR AM auto-flips the PR AH caption styling so captions stay
readable on light brand backdrops:

- **Dark / unset backdrop** (WCAG luminance < 0.5) — captions
  render as **white text on a 60 %-opaque black box**. Same as
  the PR AH original; untouched callers see no rendering change.
- **Light backdrop** (luminance ≥ 0.5) — captions flip to
  **black text on a 70 %-opaque white box**, slightly more
  opaque so the box edge stays crisp against bright brand bars.

The decision lives in
`services.color_utils.caption_style_for_backdrop(value)` and is
exposed as a dict `{font_color, box_color, box_alpha,
is_light_backdrop}`. Callers can pass an explicit `caption_style`
into `build_reels_export(...)` to override the auto-derivation;
the existing reels routes use the auto path.

Threshold: WCAG sRGB relative luminance, channels linearised
before the photopic-weighted sum. ≥ 0.5 reads as "light"; below
that stays on the dark default. Reference samples:

| Brand colour | Y | Style |
|---|---|---|
| `#0b1220` (default) | 0.006 | dark |
| `#ff7a00` (PR AK orange) | 0.352 | dark |
| `#ffeb3b` (yellow) | 0.810 | light |
| `#7ed4ff` (sky) | 0.587 | light |
| `#ffffff` (white) | 1.000 | light |

### Captions (PR AH)

Captions are **on by default**. Both Reels routes burn text into
the output via chained ffmpeg `drawtext` filters; nothing extra
to click.

- **Spokesperson Reels** captions = `campaign.commercial_script`
  (PR AA) when set, otherwise the deterministic
  `character_host_client.build_script` template that the host
  pipeline itself uses. The full caption shows for the whole
  clip duration (no word-level timing).
- **Dialogue Scene Reels** captions = each saved line's text,
  timed to its segment by ffprobe-ing the cached
  `data/dialogue/<id>-<line_id>.mp4` files and accumulating
  durations. Lines whose cached clip is missing get an even
  share of the leftover stitched-output runtime as a fallback,
  so the caption schedule still spans the whole scene.

Styling: `fontsize=36`, white text on a 60 %-opaque black box,
`boxborderw=18`, line spacing 8, `textwrap` width 28 chars,
positioned at `y=h-text_h-110` (bottom-safe / TikTok-safe). The
`box=1` background guarantees readable contrast over any avatar
or backdrop. When no usable system font is found, the export
still completes — the caption layer is silently skipped rather
than failing.

The Exports tab on each saved campaign card is the canonical UI
ledger of all of the above.

---

## 12. Recommended demo paths

Six paths covering safest mock walkthroughs through deepest
real-mode demos. Each path lists steps, time, expected Runway
spend, and verification cues.

### Path A — Fastest mock demo (60–90 s, 0 credits)

**Best for:** zero-key smoke check, recording a CI-safe walkthrough,
testing that the UI mounts cleanly.

```bash
# Terminal 1 (mock backend)
cd backend && source .venv/bin/activate
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000

# Terminal 2 (frontend)
cd frontend && npm run dev
```

1. Open `http://localhost:5173`. Mode banner reads `demo mode`
   (amber). Header shows `MOCK MODE`.
2. Stage 2 — fill the brief (any text > 1 char in business).
3. Generate Ad Concepts → pick `Daily Ritual`.
4. Stage 3 — accept the auto-filled prompt or click Simplify.
5. Visual Source = Upload image; paste any URL.
6. Generate Video → mock task succeeds in ~12 s.
7. Save campaign card.

**What to verify:** "just saved" pill, Visuals tab with cached
video chip, Voiced Commercial gated state ("Attach or create a
spokesperson first"), Overview Ad Mode picker (3 cards), Dialogue
tab Plan Dialogue Scene button.

### Path B — Real Spokesperson Ad (~3–4 min, ~10–15 credits)

**Best for:** mascot / founder lip-sync demo. Headline product
moment.

Pre-flight (off camera): pre-create a Character (e.g. Brewster)
and bind their Runway avatar. Pre-warm browser mic permission.

1. Open the saved campaign card on Visuals.
2. Visit Voice tab → Commercial Script editor → click **Generate
   Script** if empty → **Save Script**.
3. Open Overview tab → **Generate Spokesperson Ad** on the
   Spokesperson Ad picker card.
4. Wait ~30–45 s. Inline player + download link unlock.

**Spend:** 1 × `avatar_videos` (~10–15 credits depending on
script length).

**What to verify:** ffprobe shows h264 1088×704 + AAC 48 kHz mono;
the avatar lip-syncs the saved script; "lip synced + audio" badge
in the picker card.

### Path C — Real Cinematic Commercial (~5–7 min, ~25–35 credits)

**Best for:** B-roll / atmosphere / product-shot demo. Shows the
silent visual + voiceover mux story.

1. Stage 3 — Generate Reference Image (~30 s) → Generate Video
   (~2–3 min real on `gen4.5`) → Save campaign.
2. Visuals tab → **Build Voiced Commercial**. Auto-creates the
   Spokesperson Ad if missing (~30 s avatar_videos), then ffmpeg
   muxes the audio over the visual loop.

**Spend:** 1 × text_to_image + 1 × image_to_video + 1 ×
avatar_videos = ~25–35 credits.

**What to verify:** Final Voiced Cinematic Ad section shows the
prominent ring + "with sound" badge + auto-played player.

### Path D — Real Storyboard Commercial (~6–10 min, ~30–45 credits)

**Best for:** longer multi-shot ad demo (15 s instead of 5–10 s).

Pre-flight: have a Character with a portrait — the storyboard
planner pins the same portrait as `prompt_image` for every shot.

1. Save a campaign with a Character attached.
2. Visuals tab → Storyboard subsection → **Plan Storyboard**.
3. Edit any shot prompt; **Save Prompt** on the dirty shot.
4. **Generate Shot 1**, **Shot 2**, **Shot 3** (each ~60–90 s real).
5. **Stitch Storyboard Commercial**. ffmpeg concat (~5 s).
6. (Optional) **Build Voiced Storyboard** — adds host audio over
   the stitched visual.

**Spend:** 3 × image_to_video (~30 credits) + 1 × avatar_videos
(if voiced) = ~30–45 credits.

**What to verify:** ffprobe stitched output is 1280×720, ~15 s,
silent (or with host audio if voiced).

### Path E — Real Dialogue Scene Ad (~6–8 min, ~30–45 credits)

**Best for:** Office-style branded skit demo. The new flagship for
multi-character content.

Pre-flight: have **two** Characters with ready avatars (Brewster +
Piper, founder + mascot, etc.).

1. Save a campaign with Character A attached + a Commercial Script
   saved.
2. Open the **Dialogue** tab (between Voice and Realtime).
3. **Plan Dialogue Scene** — auto-picks Character A as primary +
   Character B as secondary; populates 3 lines.
4. Edit each line + speaker. **Save Line** on dirty lines.
5. **Generate Line Clip** for each (each ~30–60 s).
6. **Stitch Dialogue Scene** — ffmpeg concat with audio preserved.

**Spend:** 3 × avatar_videos (~30–45 credits depending on script
lengths).

**What to verify:** ffprobe stitched output is 1088×704 h264 +
AAC stereo, ~12–25 s; play audibly hears each character's
distinct voice in turn; Exports ledger shows the new Dialogue
Scene Ad row.

### Path F — Realtime campaign-aware conversation (~3 min live, ~30–60 credits/session)

**Best for:** "talk to the brand spokesperson" demo. Showcases
PR AE campaign context injection + PR AI document grounding.

Pre-flight: save a campaign with a Character + Commercial Script.
Pre-warm the browser mic permission (visit the page once + Allow).

1. Open the saved card → Realtime tab.
2. (Optional, recommended) Click **Attach grounding doc** in the
   "Realtime grounding" card (PR AI). Badge flips to
   `Document-grounded`. The avatar will ground answers in the
   generated Markdown brief instead of relying on the inline
   personality alone.
3. Click **Start Conversation**. Broker creates the session with
   campaign-aware personality + startScript (PR AE) — and
   `documentIds=[id]` when the badge is green (PR AI). The
   session id (which doubles as the conversation id) is captured
   server-side so step 6 below works automatically (PR AJ).
3. Avatar opens with the script's first sentence
   (e.g. *"Meet CEO Buzz."*) instead of a generic greeting.
4. Ask one of the suggested questions: *"What is this product for?"*,
   *"Who is the audience?"*, *"Make this pitch funnier."*
5. Avatar answers in tone using the brand context.
6. End Conversation cleanly within the 5-min cap.
7. (PR AJ) Click **`Fetch transcript`** in the Conversation
   transcript card. AdSpark hits
   `GET /v1/avatar_conversations/{sessionId}` and renders the
   recorded turns inline. **`Refresh transcript`** repulls
   in case the recording is still processing.
8. (PR AL) **`Copy Markdown`** dumps a readable Markdown version
   to the clipboard, or **`Download TXT`** saves a plain-text
   copy. Both buttons unlock the moment turns are cached.

**Spend:** Realtime sessions are billed per minute of avatar
runtime. Budget ~30–60 credits per 5-min session.

**What to verify:** the avatar references the campaign by name;
backend logs show the personality + startScript on the create POST
(redacted by `_redact()` so no secrets leak); 400-fallback path
hasn't fired (would log "retrying without personality/startScript").

---

## Maintenance — context-kit drift guard

Context-kit anchors (`00-START-NEXT-SESSION.md`, `docs/WHAT_IT_IS.md`,
`docs/INVENTORY.md`, `docs/handoffs/`) drifted ~14 PRs behind the
code during the v6 → v13 push. To prevent silent drift before a
push or tag, run:

```bash
bash scripts/check-context-kit-drift.sh
```

Warning-only — never blocks the command. Default threshold is 5
commits since the last anchor edit. Override with
`CONTEXT_KIT_DRIFT_LIMIT=N`. Full rules in `CLAUDE.md`.

If the script prints `⚠️ context-kit drift: …`, propose a `docs:`
refresh commit before pushing / tagging — same shape as
`docs/handoffs/SESSION_011_OPERATOR_USAGE_MAP.md`.

## Where to read more

- `docs/WHAT_IT_IS.md` — narrative anchor.
- `docs/INVENTORY.md` — every file + every route.
- `docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md` — full Runway
  surface map + ranked roadmap of what's still on the table.
- `docs/research/STORYBOARD_COMMERCIAL_BUILDER.md`,
  `DIALOGUE_SCENE_BUILDER.md`,
  `FLOW_INTEGRATION_AUDIT.md`,
  `RUNWAY_PROMPT_STRUCTURE.md`,
  `CHARACTER_STUDIO_SPIKE.md`,
  `RUNWAY_CHARACTER_HOST_SPIKE.md`,
  `RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` — design spikes for each
  major surface.
- `docs/handoffs/SESSION_011_OPERATOR_USAGE_MAP.md` — current
  product state + Tier-1/2/3 next-phase candidates.
- `README.md`, `SUBMISSION.md`, `DEMO_SCRIPT.md` — quickstart, judge
  pitch, screen-recording paths.
