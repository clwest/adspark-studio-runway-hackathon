# AdSpark Studio — Inventory

Snapshot of what is real, mocked, and key-dependent as of the
context-kit refresh after PR CB (Spokesperson Library Polish
+ Create Spokesperson CTA) on top of the PR AG–CA /
SESSION 011 anchors. Backend route count remains **70**
(PR CB reuses the existing `POST /api/characters` +
`POST /api/characters/{id}/generate-portrait` routes — no
new endpoints). The frontend is now organised around two
top-level routes: `/` mounts the **Spokesperson Library**
(heading reads "Spokesperson Library", PR CA + PR CB), and
`/legacy` mounts the verbatim v1 four-stage wizard +
saved-campaign gallery (frozen, demo-fallback). A persistent
`<TopBar>` carries the AdSpark logo, a tiny health pill,
and a `Legacy UI ↗` link. The Library homepage now shows a
4-chip stats row (spokespeople / linked campaigns / cached
outputs / transcript entries), a primary `+ Create
Spokesperson` CTA opening a 4-field modal, and per-tile
summary chips (voice state · linked campaigns · outputs).
PR BR scrolls + highlights the matching CampaignCard; PR BS
extends the path so the card also lands on the **most
relevant tab** inferred from the Appearances row's mode pill
(Spokesperson Ad → character; Cinematic / Storyboard →
visuals; Dialogue Scene → dialogue; Realtime → realtime;
Mixed / Draft → overview). PR BT closed the last v2 lane
placeholder: the **Cinematic Video** button now fires real
Runway `image_to_video` (start + poll, 5 s ± 800 ms jitter,
60-attempt 5-min cap), mirroring v1 `App.handleGenerateVideo`
exactly. PR BU **persists** that output: after polling
SUCCEEDED, the studio handler POSTs the Runway URL to the new
`POST /api/campaigns/{id}/cinematic-video` route; backend
downloads via `VideoCache.fetch`, then flips
`cached_video_url → /api/campaigns/{id}/video` (same path the
existing gallery player already streams). Persisted state
survives reloads + appears unchanged in the v1 gallery.
PR BQ's inline brief editor still mounts at lane Step 1;
the action count from PR BP / BT now covers **every** lane
render target:
**Spokesperson Lane** Horizontal (real `avatar_videos`, burns
credits) + Captioned Reels (PR BN); **Cinematic Lane**
Cinematic Video (real `image_to_video`, burns credits — PR BT)
+ Voiced Cinematic (PR BO) + Storyboard Commercial
(`stitchStoryboard`, ffmpeg-only); **Dialogue Lane** Plan Lines
(`planDialogue`, no credits) + Stitch Scene (`stitchDialogue`,
ffmpeg) + Captioned Reels (`buildDialogueSceneReels`, ffmpeg).
Every credit-burning button carries `data-burns-credits="true"`
+ a rose-chrome warning + a "burns credits" caption. Real-mode validated: one
fresh `avatar_videos` task on CEO Buzz / Brewster (task
`cf7e6067-…`) confirms the Horizontal wiring end-to-end. **Real-mode credit-burn session preserved on disk:**
Brewster / CEO Buzz spokesperson MP4 (1088×704, 18.4 s, 6.1 MB),
captioned reels (720×1280), voiced cinematic mux (1280×720),
real Runway grounding doc — all gitignored, served from cached
files regardless of mock/real flags.

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, `/health`, router registration (incl. `characters_router`) |
| `app/config.py` | real | pydantic-settings; PR-A vars + PR-F `runway_host_voice_preset` / `runway_host_portrait_url` |
| `app/models.py` | real | Pydantic schemas — Campaign with all PR A → AF fields (Pack, Spokesperson, Audio Pack, Avatar Picker, **`character_id` + `generated_character_prompt`**, **`commercial_script` + `commercial_script_updated_at`**, **storyboard fields + `StoryboardShot`**, **dialogue fields + `DialogueLine`**) plus `Character` / `CharacterCreate` / `CharacterList` models. **PR BB** — adds `VoiceRepairHistoryEntry` (timestamp, action ∈ clone/apply/repair/refresh/verify, before_voice_id, after_voice_id, resolved_voice_id, drift_status, status, error, mock_mode) + `voice_repair_history: list[VoiceRepairHistoryEntry] = []` on Character, capped at the most recent 20 entries by the store. **PR BC** — adds `TranscriptHistoryEntry` (fetched_at, conversation_id, status ∈ ok/failed/mock/empty/no_session, turn_count, turns, mock_mode, error) + `realtime_transcript_history: list[TranscriptHistoryEntry] = []` on Campaign, capped at the most recent 20 entries by the store |
| `app/services/concept_service.py` | real + mock fallback | OpenAI `gpt-4o-mini` JSON-mode call; deterministic mock |
| `app/services/runway_client.py` | real + mock | `image_to_video` / `text_to_video` routing; `GENERATION_POLICY` validation |
| `app/services/image_client.py` | real + mock | `/v1/text_to_image` (`gen4_image_turbo`); seeded `referenceImages`; stdlib zlib PNG mock |
| `app/services/finisher_service.py` | real | Local ffmpeg Campaign Pack + **Voiced Cinematic Ad mux** (PR S/X `-stream_loop -1 -shortest`) + **Storyboard concat** (PR Z `concat=n=N:v=1:a=0`) + **Voiced Storyboard** (PR Z) + **Dialogue Scene concat** (PR AF `concat=n=N:v=1:a=1` audio-preserved) + **Reels export** (PR AG `scale=720:1280:force_original_aspect_ratio=decrease,pad=…` letterbox; synthesises a silent AAC track when the source has no audio so output stays h264 + AAC) + **Burned-in captions** (PR AH chained `drawtext=…enable='between(t,start,end)'` per segment, textwrap word-wrap, bottom-safe placement, `probe_duration` ffprobe helper) + **Contrast-aware caption styling** (PR AM — `caption_style` argument or auto-derived from backdrop; light backdrops swap to black-on-white box, dark/unset backdrops keep the PR AH white-on-black baseline) |
| `app/services/character_host_client.py` | real + mock | Phase 1 `/v1/avatars` + Phase 2 `/v1/avatar_videos`; image-source fallback chain; **`active_avatar_id(campaign, settings)` resolves character > selected > host**; **PR AA — uses `campaign.commercial_script` as `script_override` when no explicit override is supplied** |
| `app/services/avatar_listing_client.py` | real + mock | `GET /v1/avatars` curation; 4 hard-coded mock presets (PR I+) |
| `app/services/realtime_avatar_client.py` | real + mock | `/v1/realtime_sessions` broker — **PR AE injects campaign-aware `personality` + `startScript` overrides**, defensive 400-fallback retries the bare body, `_redact()` scrubs Bearer / sessionKey / JWT patterns from any logged upstream response. **PR AI** — when `campaign.runway_document_id` is set the body also carries `documentIds=[id]` and the personality is swapped for a leaner `_grounded_personality` (~20 % smaller); two-tier 400-fallback drops `documentIds` first, then drops `personality + startScript` if Runway still rejects. **PR AJ** — the broker's session id is captured by the route layer and persisted as `runway_conversation_id` for transcript retrieval (Runway's `sessionId == conversationId`) |
| `app/services/transcript_client.py` | real + mock | **PR AJ** — wraps `GET /v1/avatar_conversations/{id}` plus an empty-/missing-/non-2xx tolerant `_normalise_turns` that maps Runway's documented `transcript[]` shape into our `TranscriptTurn` model. Mock mode synthesises a deterministic 3-turn replay (avatar opener → user question → grounded answer) from the saved business / product / audience / hook / commercial_script + attached Character so the replay UX demos without keys |
| `app/services/color_utils.py` | real | **PR AK** — `normalize_brand_color` accepts `#RRGGBB` / `RRGGBB` / `0xRRGGBB` / `#RGB`, normalises to lowercase `#RRGGBB` for storage, returns `None` on unparseable input. `to_ffmpeg_color` wraps the value as `0xRRGGBB` for ffmpeg's `pad=…:color=…`, falling back to `DEFAULT_REELS_BACKDROP` (`0x0b1220`) when the input is missing or invalid. **PR AM** — adds `hex_to_rgb`, WCAG `relative_luminance`, `is_light_color` (>= 0.5 luminance threshold), and `caption_style_for_backdrop(value) -> {font_color, box_color, box_alpha, is_light_backdrop}`. The dark default style mirrors PR AH exactly (white text / black@0.6 box) so untouched callers see no rendering change |
| `app/services/documents_client.py` | real + mock | **PR AI** — thin wrapper around `POST /v1/documents` (`{name, content}` ≤ 40,000 chars, plain text + Markdown), `PATCH /v1/avatars/{id}` (`{documentIds: [...]}` best-effort), and `build_campaign_brief_markdown(campaign, character)` for the standard brand-brief shape. Mock mode returns deterministic `mock_doc_<sha256-of-name+content>` ids so smoke + offline demo flows can flip the grounding badge end-to-end without burning credits |
| `app/services/audio_client.py` | real + mock | `/v1/voices` text design + `/v1/voice_dubbing`; 29-language `SUPPORTED_DUB_LANGS`; ffmpeg lavfi mock MP3s |
| `app/services/voice_clone_client.py` | real + mock | **PR AN** — wraps `POST /v1/voices` with `from.type=audio` for custom voice cloning. `clone_voice_from_audio(name, audio_bytes, mime, settings)` returns a `VoiceCloneResult`; mock mode emits a deterministic `mock_voice_<sha256(name + bytes)[:16]>` so re-uploads of the same sample are idempotent and a fresh sample yields a new id. Caps audio at 15 MB (Runway docs say 10 MB) so an oversized sample fails with a friendly 413 before hitting the wire. Allowlist of `audio/mpeg`, `audio/wav`, `audio/m4a`, `audio/mp4`, `audio/aac`, `audio/webm`, `audio/ogg`. **PR AQ** — adds `apply_voice_to_avatar(avatar_id, voice_id, settings)` which `PATCH /v1/avatars/{id}` with `{voice: {type: "custom", voiceId: ...}}` so a freshly cloned voice swaps into an existing avatar without re-creating it. Mock-aware (mock id or runway_mock → returns `mock_patched`); never raises. **PR AR** — captures Runway's `previewUrl` from the READY poll response (with a tolerant `_extract_preview_url` helper that accepts `previewUrl` / `preview_url` / `preview`); surfaces it on `VoiceCloneResult.preview_url`. Adds `fetch_voice_preview(voice_id, settings)` for future refresh routes. **PR AS** — adds `fetch_avatar_voice(avatar_id, settings, *, expected_voice_id, avatar_is_mock)` running `GET /v1/avatars/{id}` to confirm the bind landed; returns an `AvatarVoiceState` (`verified` / `mock_verified` / `unverified` / `failed`) with resolved type / id / label fields. Tolerant `_extract_voice_block` (accepts `voice` / `voiceBlock` / `voice_block`) + `_resolve_voice_fields` (accepts `type` / `voiceType`, `voiceId` / `voice_id` / `id`, `name` / `label` / `presetId`) survive future Runway shape renames. **PR AT** — adds `compute_voice_drift_status(custom_voice_id, resolved_id, verify_status)` pure helper returning `match` / `drift` / `unknown`. Case-insensitive id comparison after whitespace strip; whitespace-only ids treated as missing. Used by both clone-voice + apply-voice routes via the shared `_verify_avatar_voice_after_patch` helper |
| `app/services/character_studio_client.py` | real + mock | **PR K** — `PORTRAIT_TEMPLATES` (4 locked: mascot, founder, coach, local_guide); `build_prompt()`; `generate_portrait()` calls `/v1/text_to_image`; `create_avatar()` reads cached portrait → data URI → `POST /v1/avatars` → poll READY. **PR AN** — when `character.custom_voice_id` is set, the avatar create body uses `voice: {type: "custom", voiceId: ...}` instead of the runway-live-preset binding |
| `app/services/character_store.py` | real | **PR K** — JSON-file Character store at `backend/data/characters.json`; threading.Lock; atomic writes. **PR BB** — adds `append_voice_history(character_id, entry, *, max_entries=VOICE_HISTORY_MAX=20)` for the audit-trail field; newest-first insertion + cap inside the same lock the rest of the store uses |
| `app/services/storyboard_service.py` | real + mock | **PR Z + PR AC** — script-aware `_split_script_beats` planner + per-shot `image_to_video` generation + ffmpeg lavfi mock; `_shot_prompt` weaves narrative cues from `campaign.commercial_script` |
| `app/services/dialogue_service.py` | real + mock | **PR AF** — `plan_lines` builds Hook/Beat/Closer with primary + secondary speaker selection from ready characters; `generate_line` wraps `avatar_videos` (real) + ffmpeg lavfi (mock) targeted at the line's speaker avatar |
| `app/services/storage.py` | real | JSON-file campaign store; threading.Lock; per-feature update helpers (cache / finish / host avatar / host video / brand voice / dub / selected avatar / **character attachment** / **commercial_script** / **storyboard plan + per-shot + stitch + voiced** / **dialogue plan + per-line + stitch** / **reels (PR AG, kind=spokesperson|dialogue_scene)** / **realtime document (PR AI)** / **runway_conversation_id + transcript turns (PR AJ)** / **brand_color (PR AK)**); also normalises the brand colour at create-time so an unparseable initial-save input falls back to `None` instead of 422-ing. **PR BC** — adds `TRANSCRIPT_HISTORY_MAX = 20` + `append_transcript_history(campaign_id, entry, *, max_entries=…)` returning the post-append Campaign so the route can include the freshly-added row in its response |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | All `/api/runway/*` routes including `provider-status`, `organization`, `avatars` (list), `image`, `generate`, `task`, `upload-image` |
| `app/routers/campaigns.py` | real | All `/api/campaigns/*` routes (50+ now — see endpoint list below) |
| `app/routers/characters.py` | real | **PR K** — 7 character routes. **PR BB** — clone-voice + apply-voice + refresh-avatar-voice each call `_append_voice_history_safe(...)` after their primary update so the audit trail mirrors operator actions; apply-voice gains an optional `ApplyVoiceBody { mode: "apply" \| "repair" }` so the PR AU repair button labels its entry correctly. History append is best-effort: an exception inside the wrapper is logged but never aborts the underlying flow |
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
| `src/uxFlag.js` | real | **PR BD** — UX v2 feature flag. `getUxMode()` resolves precedence (URL `?ux=v1\|v2` > localStorage `adspark.ux` > default `v1`). `isUxV2()` convenience predicate, `setUxMode(mode)` mutator, `UX_MODES` + `UX_STORAGE_KEY` constants. SSR-safe (guards window/localStorage). Foundation for the spokesperson-first redesign — every v2 surface (PR BE+) gates its render at mount via this module. **PR BH** — adds `getActiveMode()`, `setActiveMode(mode)`, `clearActiveMode()` for the mode-first creation flow plus `CAMPAIGN_MODES` + `ACTIVE_MODE_KEY` constants. Mode is one of `"cinematic" \| "spokesperson" \| "dialogue"`; persisted as `localStorage.adspark.activeMode` |
| `src/uiHelpers.js` | real | **PR BD** — shared audit-row helpers extracted from CharacterCard.jsx so future spokesperson-first surfaces can reuse them: `formatHistoryTimestamp(iso, nowMs)` (compact relative-time bucket formatter, no `"Last checked "` prefix), `HISTORY_ACTION_PILLS` (frozen action→Tailwind class map), `historyStatusClass(status)`, `historyDriftClass(drift)`. Behaviour identical to the originals from PR BB; pure relocation slice |
| `src/components/SpokespersonStudio.jsx` | real | **PR BE/BF/BH/BI/BK/BL** — gated v2 Stage 1 surface. Reads `GET /api/characters` + `GET /api/campaigns`; indexes campaigns by `character_id`; renders heading + library grid + mode-first creation modal + per-mode lane (SpokespersonLane / CinematicLane / DialogueLane) below the active-mode pill. **PR BN** — adds `handleBuildSpokespersonReels(campaignId)` that calls `api.buildSpokespersonReels`, updates the local campaigns slice in place, and bubbles `onCharactersChanged`; threaded into SpokespersonLane via `onBuildReels`. **PR BO** — adds `handleBuildVoicedCinematic(campaignId)` mirroring the same shape; threaded into CinematicLane via `onBuildVoicedCinematic`. data-testid: `spokesperson-studio`, `spokesperson-studio-heading`, `spokesperson-empty-state`, `spokesperson-library`, `spokesperson-new-campaign`, `spokesperson-active-mode`, `spokesperson-active-mode-dismiss`; `data-ux-mode="v2"` on the wrapper, `data-mode="cinematic\|spokesperson\|dialogue"` on the active-mode pill |
| `src/components/CampaignModeModal.jsx` | real | **PR BH** — mode-first campaign creation modal (gated v2). Three-card picker: 🎬 Cinematic Ad / 🎙️ Spokesperson Ad / 🎭 Dialogue Scene. Each card carries summary + detail copy. Backdrop click + Escape key + close button all dismiss without persisting. `onSelect(mode)` fires when a card is clicked; parent (SpokespersonStudio) persists via `setActiveMode` and renders the pill. data-testid: `campaign-mode-modal`, `campaign-mode-modal-backdrop`, `campaign-mode-modal-close`, `campaign-mode-modal-cards`, `campaign-mode-card-{cinematic\|spokesperson\|dialogue}` |
| `src/components/lanes/SpokespersonLane.jsx` | real | **PR BI** — first v2 mode lane scaffold (gated; mounts when `activeMode === "spokesperson"`). 3-step layout: **Step 1 Brief** (campaign business / product preview or "no linked campaign" copy), **Step 2 Script** (commercial_script preview when set, else placeholder), **Step 3 Render**. Receives `activeSpokesperson` (Character object set via PR U "Use as Spokesperson") + `linkedCampaigns` (campaigns indexed by `character_id` upstream). Picks the most-recent linked campaign as the lane's "focused" record. Friendly empty-state hint when neither active spokesperson nor linked campaign exists. **PR BN** — Captioned Reels button now wired to `api.buildSpokespersonReels(focused.id)` via the new `onBuildReels` prop; gated on `focused.host_status === "ok"` + `focused.host_video_url` set; busy/error states surface inline; on cached reels renders a download link to `focused.spokesperson_reels_url`. Horizontal button stays a disabled placeholder pending follow-up wiring. data-testid: `spokesperson-lane`, `spokesperson-lane-step-brief`, `spokesperson-lane-step-script`, `spokesperson-lane-step-render`, `spokesperson-lane-horizontal`, `spokesperson-lane-reels`, `spokesperson-lane-reels-status`, `spokesperson-lane-reels-link`, `spokesperson-lane-empty-hint`. Reels button attrs: `data-render-target="reels"`, `data-source-ready="true\|false"`, `data-busy="true\|false"`, `data-has-output="true\|false"` |
| `src/components/SpokespersonCard.jsx` | real | **PR BE** — single tile for the v2 Spokesperson Library. Three-tab shell (`Identity` / `Knowledge` / `Appearances`); Identity is selected by default and renders the existing `CharacterCard` inline so every v1 affordance (clone / record / mic level / preview / patch / verify / drift / repair / refresh / freshness / voice history disclosure / action row) survives unchanged. data-testid: `spokesperson-card`, `spokesperson-tab-identity`, `spokesperson-tab-knowledge`, `spokesperson-tab-appearances`, `spokesperson-identity-tab`, `spokesperson-knowledge-tab`, `spokesperson-appearances-tab`. **PR BF** — Knowledge tab wires real campaign data: receives `linkedCampaigns`, renders a compact summary line + one row per linked campaign with grounding label / transcript count / last-fetched time. Empty state otherwise. Local helpers `formatKnowledgeTime`, `groundingLabel`, `campaignLabel`, `summariseKnowledge`. **PR BG** — Appearances tab now lists each linked campaign with an inferred mode badge (Cinematic / Spokesperson Ad / Dialogue Scene / Storyboard / Realtime / Mixed / Draft), last-touched relative time, and a 5-label output summary chip row. Disabled "Open in gallery →" affordance per row carries a tooltip noting click-through lands with PR BJ–BL lane routing. New helpers `inferCampaignMode`, `campaignLastTouched`, `campaignOutputSummary` + `MODE_PILL_CLASSES` colour map. data-testid: `spokesperson-knowledge-summary`, `spokesperson-knowledge-empty`, `spokesperson-knowledge-row`, `spokesperson-appearance-row`, `spokesperson-appearance-empty`, `spokesperson-appearance-mode`, `spokesperson-appearance-open` |
| `src/settings.js` | real | localStorage persistence with safety clamps; `STORAGE_KEY = 'adspark.settings.v1'` |
| `src/errors.js` | real | `friendlyError(e, hint)` + `ERROR_HINTS` per call site |
| `src/scriptBuilder.js` | real | **PR AA + PR AC** — `buildCommercialScript({ campaign, character })` deterministic generator + 300-char cap |
| `src/voicePresets.js` | real | **PR AA** — curated descriptions for 12 featured voice presets + `describeVoicePreset()` fallback |
| `src/promptBuilder.js` | real | **PR T** — structured Runway video prompt builder |
| `src/characterPromptBuilder.js` | real | **PR V** — editable Portrait Prompt builder + helper text |
| `src/App.jsx` | real | Orchestrates form → concepts → image → video → save; loads + persists settings; **mounts CharacterStudio** at Stage 1 by default; **threads commercialScriptDraft + onCommercialScriptChange + onGenerateCommercialScript through PromptPreview** (PR AC follow-up); error banner has `role=alert` + auto-scroll-into-view (PR AC fix). **PR BD** — footer renders a small `<UxModeToggle />` that flips the v2 flag (writes localStorage + reloads); legacy default unchanged. **PR BE** — when `isUxV2()` returns true, Stage 1 swaps to `<SpokespersonStudio>` instead of `<CharacterStudio>`; both consume the same `onCharactersChanged / activeCharacterId / onSetActive` props so refresh wiring stays identical |
| `src/components/CampaignForm.jsx` | real | **PR AC fix** — per-field char counters + maxLength caps mirroring backend ConceptRequest validator |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | **"Creative direction" panel** with two visually distinct sections: Section A Commercial Script editor (textarea, char counter, Generate Script, breadcrumb pill), Section B Runway Video Prompt textarea + selectors. PR AD identity-drift helper on the Use Character branch. |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>`, save button |
| `src/components/CampaignGallery.jsx` | real | The big one. Per-card render of: header + creative-director breadcrumb (Script → Storyboard → Video → Final Ad) + tab row (Overview, Visuals, Character, Voice, **Dialogue**, Realtime, Exports). Overview body owns the **3-card "Pick your ad mode" picker** (Cinematic / Spokesperson / Dialogue). Visuals body renders silent source video + Voiced Commercial section + Storyboard subsection + Voiced Storyboard. Character body renders Brand Spokesperson + Avatar Host Clip → **Spokesperson Ad** (PR AB rename). Voice body renders **Ad Mode primer card** + **Commercial Script editor** + Audio Pack. Dialogue body owns plan/edit/generate/stitch state machine. Exports body renders the per-output ledger including all stitched + voiced outputs. **PR BC** — Realtime body's Conversation transcript card gains a compact "Transcript history" disclosure under the existing fetched-at caption (newest first, default 5 visible, "Show all (N)" toggle expands to the 20-entry cap; status / turn-count / conversation-id / fetched-time row per entry). data-testid: `transcript-history`, `transcript-history-entry` |
| `src/components/AvatarPicker.jsx` | real | PR I+ — fetches `/api/runway/avatars`; 4-up grid; click → `POST /select-avatar` |
| `src/components/RealtimeSpokesperson.jsx` | real | PR I — lazy-loaded `<AvatarCall>` wrapper; **PR AE caption update** ("This avatar knows the campaign brief and saved script…") + chip tooltip + aria-label reframed as starter questions |
| `src/components/CharacterStudio.jsx` | real | **PR K + V + AA + BA** — top-level studio panel with editable Portrait Prompt textarea + voice preset dropdown with **PR AA description chip** + create form + character library + **PR BA** library-level "Refresh all voice statuses" button + compact `idle / refreshing X/Y / refreshed N skipped M failed K` status caption that reuses the per-character PR AV refresh-avatar-voice + PR AX refresh-voice-preview routes |
| `src/components/CharacterCard.jsx` | real | Single tile component reused in studio library and per-campaign attach picker. **PR BB** — adds a "Voice history" disclosure rendered at the bottom of the voice section using `formatHistoryTimestamp` / `HISTORY_ACTION_PILLS` / `historyStatusClass` / `historyDriftClass` helpers. Default 5 newest visible; "Show all (N)" link expands up to the 20-entry cap. data-testid: `custom-voice-history`, `custom-voice-history-entry`. **PR BD** — those four helpers were moved out to `frontend/src/uiHelpers.js`; CharacterCard now imports them so the upcoming spokesperson-first surfaces (PR BE+) can reuse the same audit-row vocabulary |
| `src/components/ModeBanner.jsx` | real | Readiness chip, per-provider pills, optional credits/cap chip |
| `tests/adspark-smoke.spec.js` | real | Playwright single-shot mock-mode end-to-end; covers PR A through PR AW (Stage-3 Commercial Script + breadcrumb, Storyboard subsection, Ad Mode picker w/ 3 cards, Spokesperson Ad rename, Dialogue tab + Plan button, all Exports rows + the captioned reels labels, Realtime grounding card + Conversation transcript card with **export button assertions: copy-markdown, download-txt, post-fetch enable + status banner**, brand colour control, Character custom-voice section + **MediaRecorder Start recording button** + **negative assertions for the PR AP preview audio + helper text in idle state** + **PR AS/AT/AU/AV/AW resilient assertions for resolved/drift/unverified pills, repair button, refresh button, and freshness label**) |
| `src/transcriptExport.js` | real | **PR AL** — pure helpers `buildTranscriptMarkdown`, `buildTranscriptText`, `transcriptFilename`, `copyToClipboard`, `downloadTextFile`. No backend round-trip — operates on the turns persisted by PR AJ on the Campaign payload. Markdown output uses bold-speaker syntax + the campaign / conversation-id / fetched-at preamble; text output is plain ASCII with `Speaker:` prefixes |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | All Runway flows mocked: image (stdlib PNG), video (in-memory task), avatar create (synthetic READY), avatar list (4 mock presets), Spokesperson Ad (ffmpeg lavfi placeholder), brand voice (silent MP3), dub (silent MP3 per lang), character portrait (stdlib PNG), character avatar (synthetic READY), storyboard shots (ffmpeg lavfi placeholders), storyboard stitch (real ffmpeg over mock shots), dialogue lines (ffmpeg lavfi placeholders), dialogue stitch (real ffmpeg over mock lines), realtime (HTTP 503 with explanatory copy) | Real Runway end-to-end across all 11+ endpoints |

`RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` are
*optional* PR-F knobs — defaults are `vincent` and a curated
Unsplash portrait URL.

## Endpoints (69 application + FastAPI built-ins)

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
POST   /api/campaigns/{id}/brief                            (PR BQ — inline brief editor: business/product/audience/tone)
POST   /api/campaigns/{id}/avatar                          (PR F — custom create)
POST   /api/campaigns/{id}/brand-color                     (PR AK — set/clear brand colour for reels backdrop)
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
POST   /api/characters/{id}/create-avatar                  (PR K + PR AN — uses custom_voice_id when set)
POST   /api/characters/{id}/clone-voice                    (PR AN + PR AQ — multipart audio upload → /v1/voices from.type=audio + auto-PATCH avatar voice when bound)
POST   /api/characters/{id}/apply-voice                    (PR AQ — manual retry for the avatar voice swap when the auto-PATCH after a clone failed)
POST   /api/characters/{id}/refresh-avatar-voice           (PR AV — read-only: GET /v1/avatars/{id} + drift recompute, no PATCH)
POST   /api/characters/{id}/refresh-voice-preview          (PR AX — re-fetch cloned voice previewUrl via GET /v1/voices/{voice_id})
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
| PR AK | Brand Colour Storage + Reels Styling Polish (compact card-header colour picker + ffmpeg pad colour wired into both reels routes) | (post-v13) |
| PR AL | Transcript Export / Share (frontend-only Copy Markdown + Download TXT on the PR AJ replay card; navigator.clipboard + Blob/object-URL with safe textarea fallback) | (post-v13) |
| PR AM | Caption Contrast Polish for Brand-Coloured Reels (WCAG luminance threshold flips drawtext fontcolor + boxcolor + alpha so captions stay readable on light brand backdrops) | (post-v13) |
| PR AN | Custom Voice Cloning Foundation (POST /v1/voices from.type=audio, multipart upload UI on the Character Studio library tile, persisted on Character, used at Avatar create time) | (post-v13) |
| PR AO | In-Browser Audio Recording for Custom Voice Cloning (frontend-only MediaRecorder capture → audio/webm Blob → reuses the PR AN clone route, with graceful fallback when MediaRecorder/microphone unavailable) | (post-v13) |
| PR AP | In-Card Voice Recording Playback Preview (frontend-only `<audio controls>` bound to URL.createObjectURL of the captured Blob, with full lifecycle revoke on discard / clone / unmount / next start) | (post-v13) |
| PR AQ | Avatar PATCH for Custom Voice Swap (auto-PATCH /v1/avatars/{id} with the cloned voice after every successful clone; manual retry route + UI pill on patch failure; mock_patched / pending_avatar / applied / failed state machine on Character) | (post-v13) |
| PR AR | Cloned Voice Preview Surface (capture Runway voice previewUrl during the PR AN clone poll; persist on Character; render inline `<audio controls>` in CharacterCard with a friendly fallback when the URL is missing or in mock mode) | (post-v13) |
| PR AS | Avatar Resource Introspection After Voice Patch (run GET /v1/avatars/{id} after every successful PR AQ PATCH; persist resolved voice block + verify status on Character; surface a third pill "Avatar using cloned voice" / "Avatar voice unverified" in CharacterCard) | (post-v13) |
| PR AT | Avatar Voice Drift Detection (compare cloned vs resolved voice id; persist match/drift/unknown; collapse PR AS pill into three operator-facing branches: match / drift / unverified) | (post-v13) |
| PR AU | Voice Drift Repair Action (frontend-only one-click "Repair voice drift" button on the PR AT mismatch branch; reuses POST /apply-voice for PATCH + verify + drift; rose pill flips to emerald on success) | (post-v13) |
| PR AV | Avatar Status Manual Refresh (read-only POST /refresh-avatar-voice route + Refresh avatar status button; reuses fetch_avatar_voice + compute_voice_drift_status without invoking PATCH; PR AQ patch fields preserved across refreshes) | (post-v13) |
| PR AW | Voice Verification Freshness Label (frontend-only relative-time formatter + inline "Last checked … ago / Not checked yet" caption beside the verify pill) | (post-v13) |
| PR AX | Refresh Missing Cloned Voice Preview (POST /refresh-voice-preview wires existing fetch_voice_preview helper to a Refresh preview button; preserves existing URL when fetch returns nothing) | (post-v13) |
| PR AY | Live Mic Level Meter for Voice Recording (frontend-only AnalyserNode hooked into the PR AO MediaStream; RAF-driven horizontal bar with direct DOM mutation; full lifecycle teardown on stop / discard / clone / unmount / error; graceful "Mic level unavailable" fallback) | (post-v13) |
| PR AZ | Voice Verification Auto-Tick Freshness Caption (frontend-only 60-s setInterval bumps a per-tile nowMs state so PR AW's caption advances buckets without polling; gated on caption visibility; cleanup on unmount + visibility change) | (post-v13) |
| PR BA | Character Library Refresh All (frontend-only library-level "Refresh all voice statuses" button on the Character Studio header; iterates the library and reuses the per-character PR AV refresh-avatar-voice + PR AX refresh-voice-preview routes; compact status caption reports refreshed/skipped/failed; one failure does not abort the loop) | (post-v13) |
| PR BB | Voice Repair History Audit Trail (`VoiceRepairHistoryEntry` model + `voice_repair_history: list[…]` on Character capped at 20 entries; appended from clone-voice / apply-voice / refresh-avatar-voice; apply-voice gains an optional `mode` body so the PR AU repair button is distinguishable from a plain apply; CharacterCard renders a compact "Voice history" disclosure with action / status / drift / time pills, default 5 newest, "Show all (N)" expand) | (post-v13) |
| PR BC | Per-Campaign Transcript History (`TranscriptHistoryEntry` model + `realtime_transcript_history: list[…]` on Campaign capped at 20 entries; every branch of `POST /realtime-transcript` appends a row including no_session / failed / empty / mock / ok; latest-fetch state preserved in the existing `realtime_transcript_*` fields so preview + Copy Markdown / Download TXT exports continue operating against the latest fetch; CampaignGallery transcript card adds a compact "Transcript history" disclosure with status / turn-count / conversation-id / fetched-time per row) | (post-v13) |
| PR BD | UX v2 Flag + Shared Helpers Extraction (foundation for the spokesperson-first redesign tracked in SESSION_035; new `frontend/src/uxFlag.js` resolves URL `?ux=…` → localStorage `adspark.ux` → default `v1`; new `frontend/src/uiHelpers.js` lifts `formatHistoryTimestamp` / `HISTORY_ACTION_PILLS` / `historyStatusClass` / `historyDriftClass` out of CharacterCard.jsx for reuse; tiny `<UxModeToggle />` footer link flips the flag and reloads; default UX unchanged) | (post-v13) |
| PR BE | SpokespersonStudio Scaffold Identity-Only (gated v2 Stage 1 surface tracked in SESSION_036; new `SpokespersonStudio.jsx` reads same `GET /api/characters` data; new `SpokespersonCard.jsx` wraps existing CharacterCard in a three-tab shell — Identity active, Knowledge + Appearances placeholders; App.jsx swaps mounts conditionally on `isUxV2()`; backend untouched; second Playwright smoke `?ux=v2` covers the new surface alongside the unchanged v1 default smoke) | (post-v13) |
| PR BF | Spokesperson Knowledge Tab Wiring (gated v2 slice tracked in SESSION_037; SpokespersonStudio now fetches `GET /api/campaigns` alongside characters and forwards per-character `linkedCampaigns` to each card; SpokespersonCard's Knowledge tab renders summary line + per-campaign rows with grounding labels (Prompt-grounded / Document-grounded / Document-grounded · mock / Failed), transcript counts, and last-fetched relative time; falls back to a friendly "No linked campaigns yet" state otherwise; backend untouched) | (post-v13) |
| PR BG | Spokesperson Appearances Tab Wiring (gated v2 slice tracked in SESSION_038; SpokespersonCard's Appearances tab lists each linked campaign with inferred mode badge — Cinematic / Spokesperson Ad / Dialogue Scene / Storyboard / Realtime / Mixed / Draft — based on populated output URLs / lists; last-touched relative time computed across transcript-history fetches + script edits + created_at; compact 5-label output-summary chip row per appearance; disabled "Open in gallery" affordance pending PR BJ–BL lane routing; empty state when no linked campaigns; backend untouched) | (post-v13) |
| PR BH | Mode-First Campaign Creation Modal (gated v2 slice tracked in SESSION_039; first slice that visibly diverges from v1 beyond Stage 1; new `CampaignModeModal.jsx` with three intent cards — 🎬 Cinematic Ad / 🎙️ Spokesperson Ad / 🎭 Dialogue Scene; "+ New Campaign" button in SpokespersonStudio header opens the modal; selection persists to `localStorage.adspark.activeMode` via `setActiveMode` and surfaces a "Selected mode" pill + "Mode selected. Lane-specific builder lands next." banner with dismiss link; backend untouched — Campaign payload doesn't accept a `metadata` field today; lane builders consume the persisted mode in PR BJ–BL) | (post-v13) |
| PR BI | Spokesperson Lane Scaffold (gated v2 slice tracked in SESSION_040; first lane in the trio — Cinematic / Dialogue lanes ship in PR BK / PR BL; new `frontend/src/components/lanes/SpokespersonLane.jsx` with 3-step Brief / Script / Render layout; mounts in SpokespersonStudio below the pill when `activeMode === "spokesperson"`; render buttons are disabled placeholders pending later wiring; receives active spokesperson + linked campaigns; friendly empty-state hint when neither set; backend untouched — uses existing campaign data already indexed in PR BF) | (post-v13) |
| PR BJ | Local Real-Mode Runtime Guard (runtime + docs slice tracked in SESSION_041; flips local-testing default from mock-mode to real-mode; new `scripts/start-local-real.sh` sources `.env` without overrides for manual / in-browser testing, `scripts/start-local-mock.sh` is the explicit mock-mode boot for Playwright smoke + CI, `scripts/stop-local.sh` kills both servers; CLAUDE.md hard-rules section rewritten — `RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock` inline overrides are now an anti-pattern; no frontend/backend code changes; frontend bundle unchanged) | (post-v13) |
| PR BK | Cinematic Lane Scaffold (gated v2 slice tracked in SESSION_042; second lane in the trio; new `frontend/src/components/lanes/CinematicLane.jsx` mirrors PR BI shape with 3-step Brief / Visual Source / Render layout + 3 disabled placeholder buttons mapping to Cinematic Video / Voiced Cinematic / Storyboard Commercial; mounts in SpokespersonStudio when `activeMode === "cinematic"`; fuchsia chrome to match the mode pill; pill copy now mode-specific — "Cinematic Ad lane open." for cinematic mode; smoke covers spokesperson → cinematic mode switch with assertion that previous lane unmounts; backend untouched) | (post-v13) |
| PR BL | Dialogue Lane Scaffold (gated v2 slice tracked in SESSION_043; third lane in the trio — completes the v2 mode lineup; new `frontend/src/components/lanes/DialogueLane.jsx` mirrors PR BI / PR BK shape with 3-step Brief / Cast / Lines & Stitch layout + 3 disabled placeholder buttons mapping to Generate Dialogue Lines / Stitch Dialogue Scene / Captioned Reels; mounts when `activeMode === "dialogue"`; sky chrome to match the mode pill; cast list derives from `dialogue_lines[*]` on the focused campaign; pill copy flips to "Dialogue Scene lane open."; smoke covers cinematic → dialogue mode switch; backend untouched) | (post-v13) |
| PR BM | Lane Selection Regression Pass (test-only slice tracked in SESSION_044; strengthens smoke against v1 default leaks of v2 testids, v2 surface absence of legacy "+ Create Character", and a third Playwright case `AdSpark Studio footer UX toggle round-trip` that clicks the footer link to flip v1 → v2 → v1 with reload assertions; no production code changes; no backend changes) | (post-v13) |
| PR BN | Wire V2 Spokesperson Lane Reels Action (gated v2 slice tracked in SESSION_045; first v2 lane action that fires real production behaviour — `POST /api/campaigns/{id}/spokesperson-ad/reels` — via `api.buildSpokespersonReels`; lane gates the button on `host_status === "ok"` AND `host_video_url` set; busy / error / success states surface inline with violet chrome to match v1 vocabulary; download link to cached reels when `spokesperson_reels_url` is set; no Runway calls — ffmpeg-only; Horizontal button stays disabled placeholder; Cinematic + Dialogue lanes untouched) | (post-v13) |
| PR BO | Wire V2 Cinematic Lane Voiced Cinematic Action (gated v2 slice tracked in SESSION_046; second wired v2 lane action — `POST /api/campaigns/{id}/commercial-with-voice` — via `api.buildCommercialWithVoice`; CinematicLane gates the button on `cached_video_url` set AND (`host_video_url` + `host_status === "ok"` OR a usable avatar exists), mirrors v1 `commercialBuildable` exactly; busy / error / success states surface inline with fuchsia chrome; download link to cached voiced commercial when `voiced_commercial_url` is set; no Runway calls — ffmpeg-only; Cinematic Video + Storyboard buttons stay disabled placeholders; Spokesperson + Dialogue lanes untouched beyond PR BN) | (post-v13) |
| PR BP | Wire V2 Real Runway Generation Buttons (gated v2 slice tracked in SESSION_047; wires 5 additional lane actions — Spokesperson Horizontal (real `avatar_videos`, burns credits, rose chrome + warning copy), Cinematic Storyboard Commercial (`stitchStoryboard`, ffmpeg-only, amber chrome), Dialogue Plan / Stitch / Captioned Reels (`planDialogue` + `stitchDialogue` + `buildDialogueSceneReels`, all ffmpeg or template-driven, sky chrome). Cinematic Video stays placeholder. Each new button carries `data-source-ready` + `data-busy` attrs; Horizontal also carries `data-burns-credits="true"`. Real-mode validation: one fresh real `avatar_videos` task `cf7e6067-…` on CEO Buzz / Brewster confirms the Horizontal wiring end-to-end — 1088×704, 18.25 s, 6.3 MB) | (post-v13) |
| PR BQ | V2 Lane Inline Brief Editing (gated v2 slice tracked in SESSION_048; new `POST /api/campaigns/{id}/brief` route patches `business / product / audience / tone` on the saved Campaign — only justified backend addition, route count 68 → **69**; new reusable `frontend/src/components/lanes/LaneBriefEditor.jsx` renders four editable form fields + Save / Cancel + busy/error/success states; mounted in Step 1 of all three lanes (SpokespersonLane / CinematicLane / DialogueLane); when no focused campaign, lane shows "Create or select a campaign to edit the brief." copy; SpokespersonStudio adds `handleUpdateBrief` that swaps the campaign in the local slice + bubbles `onCharactersChanged`; no Runway calls; no v1 changes; no generated media touched) | (post-v13) |
| PR BR | V2 Appearances Click-Through to Campaign Gallery (gated v2 slice tracked in SESSION_049; the previously-disabled "Open in gallery →" affordance on each Appearances row now bubbles up `onOpenCampaign(campaignId)` through SpokespersonStudio → App.jsx → CampaignGallery; CampaignCard accepts new `isOpenedFromV2` + `onClearOpen` props that scroll the matching saved card into view + flash a pink highlight ring for ~2 s; SpokespersonStudio renders a "Opened campaign in gallery: {label}" emerald banner that auto-clears after 2.5 s; no backend changes; route count unchanged at 69; pink chrome on the v2 button mirrors the studio's accent vocabulary) | (post-v13) |
| PR BS | V2 Appearances Click-Through Tab Hints (gated v2 slice tracked in SESSION_050; extends PR BR by passing the inferred mode through the click chain so App.jsx can resolve a target tab inside the saved CampaignCard; new `_tabFromInferredMode` helper maps Spokesperson Ad → character, Cinematic / Storyboard → visuals, Dialogue Scene → dialogue, Realtime → realtime, Mixed / Draft → overview; new `openCampaignTab` state threaded through CampaignGallery → CampaignCard; the existing v2 effect now flips `setActiveTab(targetTab)` alongside the scroll + highlight; banner copy now reads "Opened campaign in gallery: {label} · {mode} tab"; CampaignCard outer `<li>` carries `data-active-tab` for smoke + future tooling; no backend changes; route count still 69) | (post-v13) |
| PR BT | Wire V2 Cinematic Video Async Action (gated v2 slice tracked in SESSION_051; closes the last v2 lane render placeholder — Cinematic Video now fires real Runway `image_to_video` via the existing `api.startRunway` (POST `/api/runway/generate`) + `api.pollRunway` (GET `/api/runway/task/{id}`) helpers; SpokespersonStudio adds `handleGenerateCinematicVideo(id, onProgress)` that mirrors v1 `App.handleGenerateVideo` exactly — same 5 s ± 800 ms jitter, 60-attempt 5-min cap, terminal SUCCEEDED / FAILED / CANCELED handling; no infinite loops (cap-on-attempts guarantees termination); CinematicLane wires the button with rose chrome + `data-burns-credits="true"` + `data-source-ready` (gated on `runway_prompt` being truthy on the focused campaign) + `data-busy`; status row surfaces start phase, polling progress percentage, errors, and a download link to the fresh output URL when SUCCEEDED; output URL is **not persisted to the campaign** (would require a new backend route — kept out of scope per brief); smoke asserts the button has `data-burns-credits="true"`, `data-render-target="cinematic-video"`, follows fixture readiness disjunctions; no v1 changes; no backend changes; route count still 69) | (post-v13) |
| PR BU | Persist V2 Cinematic Video Result to Campaign (gated v2 slice tracked in SESSION_052; closes the "session-only" gap PR BT left open — fresh outputs now survive reloads. New `POST /api/campaigns/{id}/cinematic-video` route reuses `VideoCache.fetch` + `update_cache_fields` (the same plumbing v1 `POST /api/campaigns` uses at create time) to download the Runway URL, overwrite `data/videos/{id}.mp4`, and flip `cached_video_url → /api/campaigns/{id}/video`. Smallest possible field-specific endpoint; no new storage helpers; no new model fields. Route count 69 → **70**. Failure modes: 404 (campaign not found), 422 (URL min/max length), 502 (download / content-type / size-cap failure — campaign's `cache_status` / `cache_error` persisted in tandem). New `api.persistCinematicVideo(id, url)` helper. SpokespersonStudio's `handleGenerateCinematicVideo` now chains the persist call after polling SUCCEEDED + emits `'persisting'` / `'persisted'` / `'persist-failed'` progress phases; updates the local campaigns slice in place + bubbles `onCharactersChanged` so the v1 gallery refreshes alongside if open. CinematicLane prefers the persisted `cached_video_url` for the link (always when set) and only falls back to a session URL when persist 502s; new `data-persisted` button attr; status copy now reads "saving to campaign…" / "saved to campaign" / "saved (persist failed — session URL only)". Probes confirmed: 404, 422, 502 on broken upstream, and happy path persists + survives `GET /api/campaigns` reload. No v1 changes; no automatic real Runway calls fired this session.) | (post-v13) |
| PR CB | Spokesperson Library Polish + Create Spokesperson CTA (frontend slice tracked in SESSION_055; turns the bare `/` Spokesperson Library into a real product home. New `<CreateSpokespersonModal>` opens via the primary `+ Create Spokesperson` button — 4-field form (name + template + voice_preset + optional subject) that calls the existing `POST /api/characters` + auto-fires `POST /api/characters/{id}/generate-portrait` so the new tile renders with a face. SpokespersonStudio header rewritten: heading `Spokesperson Studio` → `Spokesperson Library` (now an `<h1>` with `text-2xl`), the "preview UX" pill is removed (PR CA graduated v2 to default), tagline pinned to brief copy ("Create persistent AI spokespeople that star in ads, hold conversations, and carry campaign memory."), new 4-chip `library-stats-row` (spokespeople / linked campaigns / cached outputs / transcript entries — counts derive from the local characters + campaigns slices), primary `+ Create Spokesperson` CTA alongside the now-secondary `+ New Campaign`. SpokespersonCard tiles get a new at-a-glance chip strip above the tab strip: voice-state pill (preset / cloned / applied / drift / failed) + linked-campaign count + outputs count. `summariseKnowledge()` extended with `outputCount`. Smoke v2 case extended: heading text, tagline copy, all four stats chips with numeric `data-count`, primary CTA presence + open/cancel round-trip on the modal, all four modal form fields visible. No backend changes. Build 448.47 KB / 122.98 KB gzip (+9.59 KB / +2.00 KB vs PR CA — modal + stats row + tile chips). v1 default load unchanged; /legacy heading + create-character + footer-less behavior preserved.) | (post-v13) |
| PR CA | App Shell + Router + Spokesperson Library as Home (frontend architecture refactor tracked in SESSION_054; flips the homepage from the legacy 4-stage wizard to the Spokesperson Library — the v2 surface graduates to default with no flag required. New `react-router-dom@^7` dep introduces three routes: `/` (Library), `/legacy` (the verbatim v1 wizard + gallery, frozen), `/legacy/*` (alias to /legacy for emergency deep-links). New `<AppShell>` (persistent across navigations) + `<TopBar>` (logo, tiny health pill, "Legacy UI ↗" link / "← Library" return CTA when on /legacy) + `<Library>` (thin wrapper around SpokespersonStudio with active-spokesperson localStorage glue). Old App.jsx body cloned verbatim into `<LegacyApp>` minus the `isUxV2()` ternary + the footer UX toggle (no more "Try preview UX" / "Use classic UX" — top-bar Legacy link replaces it). One-shot localStorage migration: `adspark.ux === "v1"` redirects to /legacy once + clears the key; `?ux=v1` query param does the same; `?ux=v2` is stripped from the URL. SpokespersonStudio now threads `null` to SpokespersonCard's `onOpenCampaign` when its parent (Library) doesn't provide one, so the v2 Appearances "Open in gallery →" affordance reads its disabled placeholder state on `/` (PR BR/BS click-through preserved on /legacy; PR CB will land the workspace Campaigns tab as the new target). All 70 backend routes intact; all generation pipelines untouched; all gitignored media (videos / portraits / voice MP3s / host clips) reachable unchanged via existing URL fields on Campaign / Character. Smoke restructured: Test 1 hits /legacy (the wizard), Test 2 hits / (the Library) + asserts wizard surfaces are absent + asserts top-bar / health pill / Legacy link present, Test 3 exercises the top-bar Legacy round-trip. Build 438.88 KB / 120.98 KB gzip (+39.20 KB / +13.47 KB vs PR BU — primarily react-router-dom + AppShell/TopBar/Library scaffolding). No real Runway calls fired this session.) | (post-v13) |

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
