# SESSION 102 — The Submission Push: Local LLM + Realtime Agent (PR DS → PR EK-2)

**Date:** 2026-05-11
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` — 18 PRs landed in one marathon session
**Last refresh:** PR EA-prep at `354e864`

> *"We are about to attempt something never tried by one man and an
> AI coding agent."* — Chris, just before this handoff was written.

This document is the single, judge-readable record of how Character
OS crossed the line from "AI ad generator with a wired UI" into
**"talk to your spokesperson and watch them make the ad."** Every
PR in the chain is here. The narrative is in the order it happened,
because the build matters as much as the destination.

---

## TL;DR — what shipped

Across PRs DS → EK-2 (18 commits, 2026-05-10 → 2026-05-11):

1. **Portrait quality + reliability** (DS, DT, DU) — operators can
   reroll a spokesperson's still without rebuilding the avatar; the
   prompt composer no longer occasionally produces "two raccoons";
   regenerated portraits actually reach video via a Rebuild Avatar
   button.
2. **Runway voice schema fix** (DV) — `PATCH /v1/avatars/{id}` now
   uses `voice.id` not `voice.voiceId` (Runway tightened their
   discriminated-union schema).
3. **Product rename: AdSpark Studio → Character OS** (DW, DX) —
   every operator-visible surface plus the narrative docs.
4. **`speech.type=audio` validated** (DY) — real Runway probe
   confirmed `avatar_videos` accepts 42s+ of audio with zero drift.
   Plumbed via `build_avatar_video_body` (DZ-b). Parked for PR EA
   pending TTS source decision.
5. **Realtime tool calling, end to end** (EE) — backend advertises
   a tool catalog on every realtime session; frontend dispatches
   `client_event` messages to per-tool handlers. **The avatar can
   now drive the platform.**
6. **DaVinci Resolve template-driven render** (EF) — Polish in
   Resolve button takes the campaign's cached Spokesperson Ad MP4,
   drops it into the operator's hand-built Resolve timeline, swaps
   the placeholder clip + Fusion title text via the Resolve scripting
   API, renders via H.264 Master preset, lands the polished cut
   alongside the other outputs.
7. **Campaign management UI** (EG × 4) — Delete per row, lanes
   honour selected campaign (Dialogue + Cinematic were missing this),
   mode clears on campaign switch, inline mode picker when no mode
   is active.
8. **Local LLM via Ollama** (EH) — `LLM_PROVIDER=ollama` flips the
   concept service to talk to a locally-running Ollama server. Same
   `OpenAI()` Python client, just a different `base_url`. **No cloud
   API key required.**
9. **Step 2 onboarding fix** (EI) — empty Step 2 no longer reads as
   "nothing here". Beefier CTA + auto-enter edit mode for empty
   variants.
10. **LLM-driven ad script auto-write** (EJ) — new route
    `/auto-write-script` (short or long mode), `✨ Auto-write with
    LLM` buttons on the variant editor + Long Ad form + the empty
    state CTA.
11. **Avatar writes AND renders ads from a prompt** (EK, EK-2) —
    four new realtime tools so the avatar can render verbatim or
    auto-write, in short or long form, all from a spoken command.
    **Voice → LLM → real video, fully local except for Runway video
    gen.**

What it now does, in operator words: *"Hey Donny, make me a long
ad explaining Character OS to the Runway API judges. Walk me
through what's happening as you do it."* Donny acknowledges, the
toast says Llama is drafting, then chunks are rendering, ~3 minutes
later the Videos tab opens itself and the operator watches their
avatar speak a Llama-written multi-beat ad about Character OS.

---

## Where the demo magic lives

| Surface | What it does | Files |
|---|---|---|
| `POST /api/concepts` | Concept generation via configured LLM | `concept_service.generate_concepts` |
| `POST /api/campaigns/{id}/auto-write-script` | Spoken script generation, mode='short' or 'long' | `concept_service.generate_ad_script` + `routers/campaigns.post_auto_write_script` |
| `POST /api/campaigns/{id}/spokesperson-session` | Brokers realtime session + advertises `DEFAULT_REALTIME_TOOLS` | `realtime_avatar_client.create_session` |
| `<AvatarCall onClientEvent={...}>` | Receives `client_event` messages, dispatches to per-tool handler | `RealtimeSpokesperson.jsx` + `realtimeTools.js:dispatchRealtimeToolEvent` |
| `POST /api/campaigns/{id}/resolve-render` | DaVinci template auto-render of cached Spokesperson Ad | `resolve_client.render_via_template` + `routers/campaigns.post_resolve_render` |
| `🦙 chip` in TopBar | Visual badge showing LLM provider + model | `TopBar.jsx` reads `/health.llm_provider` + `llm_model` |

---

## The five realtime tools the avatar can invoke

Defined in `backend/app/services/realtime_avatar_client.py:DEFAULT_REALTIME_TOOLS`,
dispatched in `frontend/src/realtimeTools.js:dispatchRealtimeToolEvent`.

| Tool | When the avatar fires it | Backend / API call | Wall clock |
|---|---|---|---|
| `recall_knowledge` | Operator asks for facts about the brand | Pure frontend: filters `character.knowledge_sources` by query, toasts the matches | <1s |
| `render_spokesperson_ad` | Operator gives a verbatim short script ("render this: …") | `POST /api/campaigns/{id}/spokesperson-ad` with `script_override` | ~30-45s |
| `auto_write_and_render_ad` | Operator gives a high-level brief ("make an ad about X") | Chains `/auto-write-script` mode='short' → `/spokesperson-ad` | ~45-60s |
| `render_long_spokesperson_ad` | Operator gives a verbatim long script | `POST /api/campaigns/{id}/long-spokesperson-ad` (chunks + stitches) | ~2-4 min |
| `auto_write_and_render_long_ad` | Operator gives a high-level brief AND asks for long form | Chains `/auto-write-script` mode='long' → `/long-spokesperson-ad` | ~3-5 min |
| `show_videos_tab` | Operator asks to see their videos, or right after a render | Pure frontend: `window.dispatchEvent(SHOW_VIDEOS_EVENT)` | instant |

Each chained tool fires multiple toasts so the wait doesn't feel
frozen. Failures surface stage-specific error toasts (Llama draft
vs Runway render) so the operator can diagnose without log-diving.

---

## The full demo flow (~3-5 min wall clock)

1. **Setup**: Ollama running with `llama3:latest` pulled. `RUNWAY_API_KEY`
   in `.env`. `LLM_PROVIDER=ollama` in `.env`. Backend up via
   `bash scripts/start-local-real.sh`. Frontend Vite serving.
2. **Open** `http://localhost:5173/spokespeople/<character-id>`
   (Donny or Riggs). Top bar shows the 🦙 chip.
3. **Pick a campaign** with a ready avatar. Spokesperson Lane mounts.
4. **Start Realtime Spokesperson session**. Wait for the live video
   feed to come up.
5. **Speak**: *"Hey Donny, make me a long ad explaining Character
   OS to the Runway API judges. Walk me through what's happening
   as you do it."*
6. **Watch the toasts**:
   - 🤖 Llama is drafting a LONG ad about "explain Character OS to
     Runway API judges". ~10 seconds.
   - ✍️ Long script ready (~1200 chars). Chunking + rendering with
     Donny…
   - 🎬 Rendering Long Spokesperson Ad (multi-chunk stitch)…
     Typically 2-4 minutes total.
   - ✅ Auto-written long ad rendered — see Videos tab.
7. **Tab auto-flips to Videos**. New MP4 plays. Donny in his real
   voice reading a Llama-written multi-beat pitch about Character
   OS aimed at Runway judges. **The whole production pipeline came
   from a spoken command.**

---

## PR-by-PR chain (for the build log)

### Portrait quality + reliability

- **PR DS** `d28f0f0` — Regenerate Portrait button on Identity card.
  `portraitUrl` cache-busted with `?v={updated_at}`.
- **PR DT** `27f519b` — Singular framing in portrait composer.
  Composed prompts now emit "Single solitary figure, one character
  only, centered solo subject." so gen4_image stops hallucinating
  doppelgängers. Riggs's first regenerate had returned two raccoons.
- **PR DU** `b544c77` — Rebuild Avatar button. Regenerate Portrait
  alone leaves the Runway avatar bound to the OLD portrait; videos
  kept showing the old face. New button fires `POST /v1/avatars`
  against the current portrait, overwrites `runway_avatar_id`.

### Runway schema fix

- **PR DV** `44ebac7` — Runway tightened the voice block schema.
  `PATCH /v1/avatars/{id}` now requires `voice.id` not `voice.voiceId`
  under `{type:"custom"}`. Both `voice_clone_client` and
  `character_studio_client` updated.

### Brand rename

- **PR DW** `a99fd08` — UI rebrand AdSpark Studio → Character OS:
  27 files, every operator-visible string + JSDoc.
- **PR DX** `f3b35a6` — Docs rebrand for README, SUBMISSION,
  DEMO_SCRIPT, CLAUDE, WHAT_IT_IS, INVENTORY, OPERATOR_USAGE_MAP,
  DEMO_CHECKLIST. Historical handoffs + research docs intentionally
  left untouched.

### speech.type=audio research (parked)

- **PR DY** `98fd5d5` — Probe script. Real Runway call confirmed
  `avatar_videos` accepts `speech.type=audio` at 42s with -0.04s
  drift.
- **PR DZ-a** `0a80c40` — Second probe: `/v1/voices/preview` is
  NOT a TTS endpoint. It's an ElevenLabs voice-design audition shim.
- **PR DZ-b** `b2f8a14` — `build_avatar_video_body(avatar_id, *,
  chunk_text, audio_source)` pure helper extracted from
  `long_ad_service`. Audio branch ready for PR EA.
- **PR EA-prep** `354e864` — Findings doc:
  `docs/research/SPEECH_TYPE_AUDIO_FINDINGS.md`. PR EA Long Ad
  rewrite plan parked pending external TTS source decision.

### Realtime tool calling

- **PR EE-a probe v1** `b80e72d` — Four candidate `tools[]` shapes
  tested against Runway: all 400 with "No matching discriminator"
  on `type`.
- **PR EE-a probe v2** `336f8b4` — SDK `api.d.ts` line 88 docs
  reveal the wire shape: `{type:"client_event", name, description}`.
  Probe re-fired → 200, session created, DELETE 204. Schema
  confirmed.
- **PR EE-b** `641aa3c` — Backend advertises `DEFAULT_REALTIME_TOOLS`
  on every session create. Defensive 400 fallback strips tools
  before documentIds before persona overrides.
- **PR EE-c/d** `0e0237d` — Frontend dispatcher + 3 demo tools
  (`recall_knowledge`, `render_spokesperson_ad`, `show_videos_tab`)
  wired via `<AvatarCall onClientEvent={...}>`. `SHOW_VIDEOS_EVENT`
  loose-coupling pattern between RealtimeSpokesperson + Workspace.
- **PR EE-d2** `a507834` — `REFRESH_CAMPAIGNS_EVENT` fires after
  successful tool-path render so the Videos tab actually surfaces
  the new OutputRecord.

### DaVinci Resolve integration

- **PR EF-a** `d45a41f` — Probe: connect, version 20.3.1.6, 35
  render presets, MediaPool introspection — all in 0.08s.
- **PR EF-b draft** `0521f8b` — `resolve_client.py` with
  `render_via_template`, `replace_avatar_clip`, `set_title_text`,
  `trigger_render`, `wait_for_render`. Plus
  `probe-resolve-template.py` for inspecting the operator's
  timeline shape.
- **PR EF-c** `27a2162` — `POST /api/campaigns/{id}/resolve-render`
  + `OutputKind.spokesperson_ad_resolve` + amber "🎬 Polish in
  DaVinci Resolve" button next to Reels. Local-only; 503 surfaces
  cleanly when Resolve isn't running.

### Campaign management UI

- **PR EG** `8d448b6` — ✕ Delete per campaign row.
- **PR EG-2** `c13c667` — Dialogue + Cinematic lanes accept
  `focusedCampaign` prop (Spokesperson lane had been migrated; the
  other two were left on "most recent linked"). Fixes the "active
  pill ≠ brief shown" bug.
- **PR EG-3** `fd7954a` — Active mode clears on campaign switch
  so a Dialogue lane doesn't stick on top of a Spokesperson
  campaign.
- **PR EG-4** `6259b5c` — Inline mode picker appears when no mode
  is active so the operator always has a path back into a lane.

### Local LLM

- **PR EH** `d49199b` — Ollama as a switchable provider.
  `LLM_PROVIDER=ollama` + `OLLAMA_BASE_URL` + `OLLAMA_MODEL`
  settings. Same `OpenAI()` Python client, different `base_url`.
  `/health` reports `llm_provider` + `llm_model`. TopBar shows
  🦙 chip with model name.

### Step 2 onboarding

- **PR EI** `647852e` — Beefier empty-state CTA on Step 2
  (`Write your first ad script` + full-width pink button).
  `VariantScriptEditor` auto-enters edit mode for variants with
  empty scripts.

### LLM-driven script generation

- **PR EJ** `6c1fc3c` — `generate_ad_script(business, product,
  audience, tone, settings, *, mode, spin)` in concept_service.
  Mode='short' (200-260 chars) or mode='long' (1000-1400 chars).
  Output cleaner strips "Here is the script:" / "Script:" /
  wrapping quotes that smaller open models add. Soft length-cap
  trimmer cuts at last sentence boundary. New route
  `/auto-write-script`. `✨ Auto-write` buttons on
  `VariantScriptEditor`, Long Ad form, and `NoVariantsState`
  empty CTA.

### Agentic avatar

- **PR EK** `5e77eb6` — `auto_write_and_render_ad({prompt})` tool.
  Frontend handler chains `/auto-write-script` → `/spokesperson-ad`.
  Stage-specific toasts narrate the ~45-60s wait. Stage-specific
  error toasts if either stage breaks.
- **PR EK-2** `47df686` — Long-form variants:
  `render_long_spokesperson_ad({script})` for verbatim long
  scripts and `auto_write_and_render_long_ad({prompt})` for LLM
  drafts of long ads. Tool descriptions tuned so GWM-1 reliably
  picks between the four ad-rendering tools based on operator
  intent.

---

## Verification status (as of submission push)

- ✅ All 18 PRs merged to `main`
- ✅ Backend `pytest -q` 56/56 green
- ✅ Frontend `vite build` clean (~560 KB / ~150 KB gzip)
- ✅ Hygiene scan clean (no `.env` / media / generated files staged)
- ⚠️ Context-kit drift: 18 commits since last refresh (this commit
  resets it)
- ✅ Ollama integration verified end-to-end with `llama3:latest`
  (short: 192 chars in 7.5s; long: 991 chars in 8.4s)
- ✅ DaVinci Resolve integration verified — probe + template smoke
  passed
- ✅ Realtime tool calling verified — operator session live-tested
  with `auto_write_and_render_long_ad` after PR EK-2 landed; toasts
  + tab navigation worked end-to-end; render in flight as of
  this writing

---

## What's parked (deliberate, post-submission targets)

- **PR EA — single-pass Long Ad via `speech.type=audio`**: plumbing
  ready (`build_avatar_video_body`'s audio branch); needs an
  external TTS source (likely OpenAI tts-1-hd or ElevenLabs) + a
  per-Character `tts_voice` field. Plan: `docs/research/SPEECH_TYPE_AUDIO_FINDINGS.md`.
- **Soft-archive ("deactivate") for campaigns**: only hard delete
  exists today. A `Campaign.archived: bool` + a list filter would
  add it cleanly. ~half day.
- **`speech.type=audio` for Dialogue + Cinematic flows**: same
  unlock as Long Ad — single render, music beds, multilingual dubs
  lip-synced. Out of scope for tonight.

---

## Server status at submission push

```
backend: http://localhost:8000 · runway_mock=false · openai_mock=false
         llm_provider=ollama   · llm_model=llama3:latest
vite:    http://localhost:5173 · http=200
ollama:  running (0.6.5)       · models: llama3:latest, qwen2.5-coder:7b, deepseek-coder-v2:latest
DaVinci: Resolve Studio 20.3.1.6 running
         project: 'Runway Hackathon' · timeline: 'character-os-template-v1'
         placeholder clip: 'test_this_file.mp4' · render preset: 'H.264 Master'
```

---

## Sentence from the operator, for the record

> *"We are about to attempt something never tried by one man and an
> AI coding agent."*

Ship it.
