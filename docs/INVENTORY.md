# AdSpark Studio — Inventory

Snapshot of what is real, mocked, and key-dependent as of the
context-kit refresh after PR AJ (Conversation Transcript Retrieval
+ Replay UX) on top of the PR AG / PR AH / PR AI / SESSION 011
anchors. Backend route count is **63** application routes — PR AJ
adds one new endpoint (`POST /api/campaigns/{id}/realtime-transcript`)
on top of the 62 routes from PR AI.

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, `/health`, router registration (incl. `characters_router`) |
| `app/config.py` | real | pydantic-settings; PR-A vars + PR-F `runway_host_voice_preset` / `runway_host_portrait_url` |
| `app/models.py` | real | Pydantic schemas — Campaign with all PR A → AF fields (Pack, Spokesperson, Audio Pack, Avatar Picker, **`character_id` + `generated_character_prompt`**, **`commercial_script` + `commercial_script_updated_at`**, **storyboard fields + `StoryboardShot`**, **dialogue fields + `DialogueLine`**) plus `Character` / `CharacterCreate` / `CharacterList` models |
| `app/services/concept_service.py` | real + mock fallback | OpenAI `gpt-4o-mini` JSON-mode call; deterministic mock |
| `app/services/runway_client.py` | real + mock | `image_to_video` / `text_to_video` routing; `GENERATION_POLICY` validation |
| `app/services/image_client.py` | real + mock | `/v1/text_to_image` (`gen4_image_turbo`); seeded `referenceImages`; stdlib zlib PNG mock |
| `app/services/finisher_service.py` | real | Local ffmpeg Campaign Pack + **Voiced Cinematic Ad mux** (PR S/X `-stream_loop -1 -shortest`) + **Storyboard concat** (PR Z `concat=n=N:v=1:a=0`) + **Voiced Storyboard** (PR Z) + **Dialogue Scene concat** (PR AF `concat=n=N:v=1:a=1` audio-preserved) + **Reels export** (PR AG `scale=720:1280:force_original_aspect_ratio=decrease,pad=…` letterbox; synthesises a silent AAC track when the source has no audio so output stays h264 + AAC) + **Burned-in captions** (PR AH chained `drawtext=…enable='between(t,start,end)'` per segment, textwrap word-wrap, bottom-safe placement, `probe_duration` ffprobe helper) |
| `app/services/character_host_client.py` | real + mock | Phase 1 `/v1/avatars` + Phase 2 `/v1/avatar_videos`; image-source fallback chain; **`active_avatar_id(campaign, settings)` resolves character > selected > host**; **PR AA — uses `campaign.commercial_script` as `script_override` when no explicit override is supplied** |
| `app/services/avatar_listing_client.py` | real + mock | `GET /v1/avatars` curation; 4 hard-coded mock presets (PR I+) |
| `app/services/realtime_avatar_client.py` | real + mock | `/v1/realtime_sessions` broker — **PR AE injects campaign-aware `personality` + `startScript` overrides**, defensive 400-fallback retries the bare body, `_redact()` scrubs Bearer / sessionKey / JWT patterns from any logged upstream response. **PR AI** — when `campaign.runway_document_id` is set the body also carries `documentIds=[id]` and the personality is swapped for a leaner `_grounded_personality` (~20 % smaller); two-tier 400-fallback drops `documentIds` first, then drops `personality + startScript` if Runway still rejects. **PR AJ** — the broker's session id is captured by the route layer and persisted as `runway_conversation_id` for transcript retrieval (Runway's `sessionId == conversationId`) |
| `app/services/transcript_client.py` | real + mock | **PR AJ** — wraps `GET /v1/avatar_conversations/{id}` plus an empty-/missing-/non-2xx tolerant `_normalise_turns` that maps Runway's documented `transcript[]` shape into our `TranscriptTurn` model. Mock mode synthesises a deterministic 3-turn replay (avatar opener → user question → grounded answer) from the saved business / product / audience / hook / commercial_script + attached Character so the replay UX demos without keys |
| `app/services/documents_client.py` | real + mock | **PR AI** — thin wrapper around `POST /v1/documents` (`{name, content}` ≤ 40,000 chars, plain text + Markdown), `PATCH /v1/avatars/{id}` (`{documentIds: [...]}` best-effort), and `build_campaign_brief_markdown(campaign, character)` for the standard brand-brief shape. Mock mode returns deterministic `mock_doc_<sha256-of-name+content>` ids so smoke + offline demo flows can flip the grounding badge end-to-end without burning credits |
| `app/services/audio_client.py` | real + mock | `/v1/voices` text design + `/v1/voice_dubbing`; 29-language `SUPPORTED_DUB_LANGS`; ffmpeg lavfi mock MP3s |
| `app/services/character_studio_client.py` | real + mock | **PR K** — `PORTRAIT_TEMPLATES` (4 locked: mascot, founder, coach, local_guide); `build_prompt()`; `generate_portrait()` calls `/v1/text_to_image`; `create_avatar()` reads cached portrait → data URI → `POST /v1/avatars` → poll READY |
| `app/services/character_store.py` | real | **PR K** — JSON-file Character store at `backend/data/characters.json`; threading.Lock; atomic writes |
| `app/services/storyboard_service.py` | real + mock | **PR Z + PR AC** — script-aware `_split_script_beats` planner + per-shot `image_to_video` generation + ffmpeg lavfi mock; `_shot_prompt` weaves narrative cues from `campaign.commercial_script` |
| `app/services/dialogue_service.py` | real + mock | **PR AF** — `plan_lines` builds Hook/Beat/Closer with primary + secondary speaker selection from ready characters; `generate_line` wraps `avatar_videos` (real) + ffmpeg lavfi (mock) targeted at the line's speaker avatar |
| `app/services/storage.py` | real | JSON-file campaign store; threading.Lock; per-feature update helpers (cache / finish / host avatar / host video / brand voice / dub / selected avatar / **character attachment** / **commercial_script** / **storyboard plan + per-shot + stitch + voiced** / **dialogue plan + per-line + stitch** / **reels (PR AG, kind=spokesperson|dialogue_scene)** / **realtime document (PR AI)** / **runway_conversation_id + transcript turns (PR AJ)**) |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | All `/api/runway/*` routes including `provider-status`, `organization`, `avatars` (list), `image`, `generate`, `task`, `upload-image` |
| `app/routers/campaigns.py` | real | All `/api/campaigns/*` routes (50+ now — see endpoint list below) |
| `app/routers/characters.py` | real | **PR K** — 7 character routes |
| `requirements.txt` | real | fastapi, uvicorn, pydantic, pydantic-settings, httpx, openai, python-dotenv |
| `.env.example` | real | All PR-A → PR-I knobs documented |
| `data/campaigns.json` | real | Created lazily on first save |
| `data/characters.json` | real | **PR K** |
| `data/{images,videos,finished,host,audio,characters,storyboard,dialogue}/` | real | Per-feature local caches, all gitignored via `backend/.gitignore: data/` |

## Frontend (`frontend/`)

| Path | Status | Notes |
|---|---|---|
| `vite.config.js` | real | Proxies `/api` and `/health` → `http://localhost:8000` |
| `tailwind.config.js`, `postcss.config.js`, `index.html` | real | Tailwind wired |
| `package.json` | real | Adds `@runwayml/avatars-react ^0.15.0` for realtime |
| `src/api.js` | real | Thin fetch wrapper; helpers for every backend route incl. all PR Z/AC storyboard helpers, PR AA `saveCommercialScript`, PR AB `generateSpokespersonAd`, PR AF dialogue helpers (`planDialogue`, `saveDialogueLine`, `generateDialogueLine`, `stitchDialogue`) |
| `src/settings.js` | real | localStorage persistence with safety clamps; `STORAGE_KEY = 'adspark.settings.v1'` |
| `src/errors.js` | real | `friendlyError(e, hint)` + `ERROR_HINTS` per call site |
| `src/scriptBuilder.js` | real | **PR AA + PR AC** — `buildCommercialScript({ campaign, character })` deterministic generator + 300-char cap |
| `src/voicePresets.js` | real | **PR AA** — curated descriptions for 12 featured voice presets + `describeVoicePreset()` fallback |
| `src/promptBuilder.js` | real | **PR T** — structured Runway video prompt builder |
| `src/characterPromptBuilder.js` | real | **PR V** — editable Portrait Prompt builder + helper text |
| `src/App.jsx` | real | Orchestrates form → concepts → image → video → save; loads + persists settings; **mounts CharacterStudio** at Stage 1; **threads commercialScriptDraft + onCommercialScriptChange + onGenerateCommercialScript through PromptPreview** (PR AC follow-up); error banner has `role=alert` + auto-scroll-into-view (PR AC fix) |
| `src/components/CampaignForm.jsx` | real | **PR AC fix** — per-field char counters + maxLength caps mirroring backend ConceptRequest validator |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | **"Creative direction" panel** with two visually distinct sections: Section A Commercial Script editor (textarea, char counter, Generate Script, breadcrumb pill), Section B Runway Video Prompt textarea + selectors. PR AD identity-drift helper on the Use Character branch. |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>`, save button |
| `src/components/CampaignGallery.jsx` | real | The big one. Per-card render of: header + creative-director breadcrumb (Script → Storyboard → Video → Final Ad) + tab row (Overview, Visuals, Character, Voice, **Dialogue**, Realtime, Exports). Overview body owns the **3-card "Pick your ad mode" picker** (Cinematic / Spokesperson / Dialogue). Visuals body renders silent source video + Voiced Commercial section + Storyboard subsection + Voiced Storyboard. Character body renders Brand Spokesperson + Avatar Host Clip → **Spokesperson Ad** (PR AB rename). Voice body renders **Ad Mode primer card** + **Commercial Script editor** + Audio Pack. Dialogue body owns plan/edit/generate/stitch state machine. Exports body renders the per-output ledger including all stitched + voiced outputs. |
| `src/components/AvatarPicker.jsx` | real | PR I+ — fetches `/api/runway/avatars`; 4-up grid; click → `POST /select-avatar` |
| `src/components/RealtimeSpokesperson.jsx` | real | PR I — lazy-loaded `<AvatarCall>` wrapper; **PR AE caption update** ("This avatar knows the campaign brief and saved script…") + chip tooltip + aria-label reframed as starter questions |
| `src/components/CharacterStudio.jsx` | real | **PR K + V + AA** — top-level studio panel with editable Portrait Prompt textarea + voice preset dropdown with **PR AA description chip** + create form + character library |
| `src/components/CharacterCard.jsx` | real | Single tile component reused in studio library and per-campaign attach picker |
| `src/components/ModeBanner.jsx` | real | Readiness chip, per-provider pills, optional credits/cap chip |
| `tests/adspark-smoke.spec.js` | real | Playwright single-shot mock-mode end-to-end; covers PR A through PR AF (Stage-3 Commercial Script + breadcrumb, Storyboard subsection, Ad Mode picker w/ 3 cards, Spokesperson Ad rename, **new Dialogue tab + Plan button**, all Exports rows) |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | All Runway flows mocked: image (stdlib PNG), video (in-memory task), avatar create (synthetic READY), avatar list (4 mock presets), Spokesperson Ad (ffmpeg lavfi placeholder), brand voice (silent MP3), dub (silent MP3 per lang), character portrait (stdlib PNG), character avatar (synthetic READY), storyboard shots (ffmpeg lavfi placeholders), storyboard stitch (real ffmpeg over mock shots), dialogue lines (ffmpeg lavfi placeholders), dialogue stitch (real ffmpeg over mock lines), realtime (HTTP 503 with explanatory copy) | Real Runway end-to-end across all 11+ endpoints |

`RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` are
*optional* PR-F knobs — defaults are `vincent` and a curated
Unsplash portrait URL.

## Endpoints (63 application + FastAPI built-ins)

```
GET    /health
GET    /api/runway/provider-status
GET    /api/runway/organization
GET    /api/runway/avatars                                  (PR I+)
POST   /api/concepts
POST   /api/runway/image
GET    /api/runway/image/{image_id}
POST   /api/runway/upload-image                             (PR R)
POST   /api/runway/generate
GET    /api/runway/task/{task_id}
POST   /api/campaigns
GET    /api/campaigns
DELETE /api/campaigns/{id}                                  (PR N — local delete + cache cleanup; PR Z + PR AF cascade)
GET    /api/campaigns/{id}/video
POST   /api/campaigns/{id}/finish              (?format=landscape|reels|square)
GET    /api/campaigns/{id}/finished-video
GET    /api/campaigns/{id}/finished-video/{fmt}
POST   /api/campaigns/{id}/commercial-with-voice            (PR S + PR X — Final Voiced Cinematic Ad)
GET    /api/campaigns/{id}/commercial-with-voice
POST   /api/campaigns/{id}/storyboard/plan                  (PR Z)
POST   /api/campaigns/{id}/storyboard/generate-shot/{shot_id}
POST   /api/campaigns/{id}/storyboard/stitch
GET    /api/campaigns/{id}/storyboard-video
GET    /api/campaigns/{id}/storyboard/shot/{shot_id}
POST   /api/campaigns/{id}/storyboard/shot/{shot_id}/prompt (PR AC — editable shot prompts)
POST   /api/campaigns/{id}/storyboard/voiced
GET    /api/campaigns/{id}/storyboard-voiced-video
POST   /api/campaigns/{id}/dialogue/plan                    (PR AF)
POST   /api/campaigns/{id}/dialogue/line/{line_id}          (PR AF — edit text + speaker)
POST   /api/campaigns/{id}/dialogue/generate-line/{line_id} (PR AF)
POST   /api/campaigns/{id}/dialogue/stitch                  (PR AF)
GET    /api/campaigns/{id}/dialogue-scene                   (PR AF)
GET    /api/campaigns/{id}/dialogue/line/{line_id}          (PR AF)
POST   /api/campaigns/{id}/script                           (PR AA — Commercial Script)
POST   /api/campaigns/{id}/avatar                          (PR F — custom create)
POST   /api/campaigns/{id}/select-avatar                   (PR I+ — picker)
POST   /api/campaigns/{id}/attach-character                (PR K — null detaches)
POST   /api/campaigns/{id}/host-video                      (PR F)
POST   /api/campaigns/{id}/spokesperson-ad                 (PR AB — alias for /host-video)
POST   /api/campaigns/{id}/spokesperson-ad/reels           (PR AG — Vertical 720x1280 letterbox)
POST   /api/campaigns/{id}/dialogue-scene/reels            (PR AG — Vertical 720x1280 letterbox)
GET    /api/campaigns/{id}/host-video
GET    /api/campaigns/{id}/spokesperson-ad                 (PR AB — alias)
GET    /api/campaigns/{id}/spokesperson-ad/reels           (PR AG)
GET    /api/campaigns/{id}/dialogue-scene/reels            (PR AG)
POST   /api/campaigns/{id}/brand-voice                     (PR H)
POST   /api/campaigns/{id}/dub                             (PR H)
GET    /api/campaigns/{id}/audio/{kind}
POST   /api/campaigns/{id}/realtime-document               (PR AI — Avatar documentIds for grounded realtime)
POST   /api/campaigns/{id}/realtime-transcript             (PR AJ — fetch + persist conversation transcript)
POST   /api/campaigns/{id}/spokesperson-session            (PR I + PR AE + PR AI + PR AJ — campaign context injection + documentIds when grounded + captures session id as conversation id)
DELETE /api/campaigns/{id}/spokesperson-session/{session_id}
GET    /api/characters
POST   /api/characters
GET    /api/characters/{id}
POST   /api/characters/{id}/generate-portrait              (PR K + PR V)
POST   /api/characters/{id}/create-avatar                  (PR K)
GET    /api/characters/{id}/portrait
DELETE /api/characters/{id}
plus /openapi.json, /docs, /docs/oauth2-redirect, /redoc
```

## Avatar resolution chain (PR K, used by PR F / PR AB / PR I+ / PR AE / PR AF)

```
character.runway_avatar_id   ─ wins when a character is attached
  > selected_avatar_id        ─ wins when picker selection exists
    > host_avatar_id           ─ falls back to per-campaign custom avatar
```

`character_host_client.active_avatar_id(campaign, settings)` and
`active_avatar_status(campaign, settings)` implement this. Used by:
host-video / spokesperson-ad, realtime broker (with PR AE
campaign-context overrides), commercial-with-voice (when auto-host
is on), and the dialogue line generator (per-line, falls back to
the line's own `avatar_id`).

## Current ad mode architecture (PR AB / PR AD / PR AF)

| Mode | Visual | Audio | Lip sync | Output filename |
|---|---|---|---|---|
| Final Voiced Cinematic Ad | `image_to_video` (silent) + ffmpeg `-stream_loop -1` | host clip audio | ❌ | `data/finished/<id>-commercial-voice.mp4` |
| Storyboard Commercial | 3 × `image_to_video` ffmpeg-concat | silent | ❌ | `data/finished/<id>-storyboard.mp4` |
| Voiced Storyboard | storyboard visual + host audio (ffmpeg loop) | host clip audio | ❌ | `data/finished/<id>-storyboard-voice.mp4` |
| Spokesperson Ad | `avatar_videos` | spoken script | ✅ | `data/host/<id>.mp4` |
| Dialogue Scene Ad | N × `avatar_videos` ffmpeg-concat (audio preserved) | spoken per line | ✅ per line | `data/finished/<id>-dialogue-scene.mp4` |
| Spokesperson Ad — Captioned Reels (PR AG + AH) | ffmpeg pad/letterbox + drawtext caption from saved Commercial Script | host clip audio (preserved) | ✅ | `data/finished/<id>-spokesperson-reels.mp4` |
| Dialogue Scene Ad — Captioned Reels (PR AG + AH) | ffmpeg pad/letterbox + per-line drawtext segments timed via ffprobe of cached line clips | per-line speech (preserved) | ✅ per line | `data/finished/<id>-dialogue-scene-reels.mp4` |

## Feature stack since v6 (the recent arc)

| PR | Title | Tag |
|---|---|---|
| PR R | Visual Source flow (Generate / Upload / Use Character / Text-only) | (between v6 and v8) |
| PR S | Commercial with Voice (ffmpeg loop + host audio mux) | |
| PR T | Structured Runway Prompt Builder | |
| PR U | Spokesperson-first flow | |
| PR V | Editable Portrait Prompt | |
| PR W | Character visual-source bugfix | |
| PR X | Auto-voiced commercial | |
| PR Y | Newest-saved focus + card clarity | |
| PR Z | Storyboard Commercial Builder | |
| PR Z2 | Silent vs voiced final ad clarification | v8-pre |
| PR AA | Voice preview + script-first flow | **v8** |
| PR AB | Spokesperson Ad mode + alias routes | **v9** |
| PR AC | Creative director controls + script-aware planner | **v10** |
| PR AC follow-up | Move script into PromptPreview + form maxLength + error scroll | **v10** |
| PR AD | Cinematic vs Spokesperson UX (Ad Mode picker + identity-drift helper) | **v11** |
| PR AE | Realtime campaign context injection | **v12** |
| PR AF | Multi-Character Dialogue Scene Builder | **v13** |
| PR AG | Vertical / Reels Export Pipeline (Spokesperson + Dialogue → 720×1280 letterbox) | (post-v13) |
| PR AH | Burned-in Captions for Vertical Reels (drawtext from saved scripts; per-line timing for dialogue) | (post-v13) |
| PR AI | Avatar documentIds for Grounded Realtime (POST /v1/documents + per-session documentIds + best-effort PATCH /v1/avatars/{id}) | (post-v13) |
| PR AJ | Conversation Transcript Retrieval + Replay UX (GET /v1/avatar_conversations/{id} + structured TranscriptTurn persistence + Realtime-tab replay card) | (post-v13) |

## Known limitations (current main)

- **No multi-avatar realtime.** Realtime sessions are still
  single-character only; multi-character scenes use the async
  Dialogue Scene Builder instead.
- ~~**No vertical/Reels export of Spokesperson Ad or Dialogue Scene.**~~
  **Resolved by PR AG.** Both outputs now ship a 720×1280 letterbox
  via local ffmpeg (`scale=…:force_original_aspect_ratio=decrease,pad=…`).
  Source aspect is preserved; bars are filled with a dark slate
  backdrop by default. No new Runway calls; ~1–3 s per export.
- ~~**No caption overlays on Dialogue Scene.**~~ **Resolved by
  PR AH** for the vertical Reels export specifically. Per-line
  text is now burned in over the matching segment of the stitched
  Dialogue Reels via chained `drawtext=…enable='between(t,a,b)'`
  filters, with timings derived from ffprobe of the cached line
  clips. Captions on the horizontal Dialogue Scene Ad are still
  out of scope (the talking-head face is the primary visual; the
  vertical export is where text-over-video matters most).
- ~~**No spokesperson script captions on the social-ready exports.**~~
  **Resolved by PR AH.** The saved Commercial Script (or the
  templated `build_script` fallback) is wrapped via `textwrap`
  and rendered as a bottom-safe drawtext box across the full
  Spokesperson Reels duration.
- **No conversation transcript retrieval.** PR AE gives the avatar
  brand context; we don't yet wire `GET /v1/avatar_conversations/{id}`
  for a "replay your chat" UX.
- ~~**No conversation transcript retrieval.**~~ **Resolved by
  PR AJ.** `POST /api/campaigns/{id}/realtime-transcript` fetches
  `GET /v1/avatar_conversations/{id}` (Runway's session id doubles
  as the conversation id; the route layer captures it from the
  broker on success) and persists structured `TranscriptTurn[]`
  for the Realtime tab's replay card. Mock mode renders a
  deterministic 3-turn replay so the UX demos without keys.
- ~~**No avatar-side RAG documents.**~~ **Resolved by PR AI.**
  `POST /api/campaigns/{id}/realtime-document` POSTs a generated
  Markdown brand brief to `/v1/documents`, persists the returned id
  on the campaign, and (best-effort) `PATCH /v1/avatars/{id}` binds
  it to the resolved Runway avatar. The realtime broker passes
  `documentIds=[id]` on session create and swaps in a slimmer
  personality cue. Mock mode returns deterministic
  `mock_doc_<sha>` ids so the grounding flow can be exercised
  end-to-end without a Runway key.
- **No caption overlays on Dialogue Scene.** Per-line text is
  saved; `subtitles=` ffmpeg pass would burn them in. Tier-1.
- **No reaction shots** between dialogue lines — characters don't
  visually react to each other. Documented as the V1 trade-off.
- **`-stream_loop -1 -shortest` artefact** on Voiced Cinematic Ad —
  visual stream can run ~2 s past audio at GOP boundaries.
  Acceptable for V1 demo.
- **Audio in Brand Voice + dubs is sample-only.** They demonstrate
  the voice; the ad narration is the Spokesperson Ad / Voiced
  Cinematic Ad host clip.
- **Preset character library is not API-listable.** Runway's
  in-app preset characters (Music Superstar, Tooth, Mina, etc.)
  aren't exposed via `GET /v1/avatars`. AdSpark's Avatar Picker
  ships 4 mock-mode presets to preserve the UX shape.

## Current demo path (post PR AF)

1. **Stage 1** — pick or create a Character (Brewster the Raccoon,
   Piper Voltage, etc.).
2. **Stage 2** — fill the brief; concepts auto-generate.
3. **Stage 3** — Creative Direction panel opens. Edit / generate
   the **Commercial Script** above the **Runway Video Prompt**;
   pick **Visual Source = Use Character**; **Generate Video**.
4. Click **Save Campaign Card** — gallery scrolls to the new
   card with "just saved" pill, opens on Visuals.
5. **Pick your ad mode** on Overview:
   - **Spokesperson Ad** — one click on Overview, lip-synced.
   - **Cinematic Commercial** — open Visuals → Build Voiced
     Commercial.
   - **Dialogue Scene** — open Dialogue tab → Plan → Generate
     each line → Stitch.
6. Optional: Storyboard (Visuals → Plan Storyboard), Brand Voice
   (Voice tab), realtime (Realtime tab — campaign-aware
   personality + startScript).

## Out of scope (intentionally not implemented)

- WebRTC features beyond the V1 mic-only spokesperson call (webcam
  toggle, screen share, multi-participant rooms — gated by
  Runway's custom-voice limitations).
- Act-Two `/v1/character_performance` (different primitive — needs
  a driving performance video).
- Multi-character realtime (not exposed by Runway today; V1
  uses async Dialogue Scene Builder instead).
- Custom voice cloning (`/v1/voices` audio-clone path) — Tier-1
  candidate but burns extra credits per character.
- Direct text-to-speech narration (`/v1/text_to_speech`) — gated
  `voice.type` discriminator.
- Audio mixing into Pack outputs. Voiced Cinematic Ad is the
  audio-bearing Pack-shaped artefact; per-format Pack outputs stay
  silent.
- Server-side `/v1/uploads` — public URL + data URI cover current
  paths.
- Stability.ai integration.
- Auth, multi-user, public deploy — out of scope until next-phase
  scope is locked.
- Real-time refresh of `/provider-status`.
- Smart-framing for cross-aspect Pack crops.
- Background-task finishing.
- Avatar marketplace / preset library exposure.
- Knowledge documents (`/v1/documents`) for grounded realtime.
- Conversation transcripts (`/v1/avatar_conversations`).
- Character Studio K.5 polish (PATCH character, replace-avatar).
- Character Studio Phase L / M (export/import, marketplace).

See `docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md` §12 for the
ranked roadmap of what's still on the table.
