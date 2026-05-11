# Character OS — Hackathon Submission Description

*~2500 words, drafted 2026-05-11 for the Runway hackathon submission form. Tone: technical but human. Edit freely before submitting.*

---

## The pitch in one sentence

Character OS is **persistent AI spokesperson infrastructure** — brands create reusable AI characters that remember every conversation, star in multiple ad formats, take voice commands to make their own videos, and hand off to each other mid-call. Built in one hackathon weekend by one founder and an AI coding agent.

## What it actually is

Most AI video tools are one-shot generators. You write a prompt, you get a video, you start over for the next one. Character OS inverts that. The thing you create first is a **spokesperson** — a named character with a portrait, a Runway avatar binding, a cloned voice, a personality, and a knowledge base. You then run *campaigns* through that spokesperson. Every ad you make is starring the same persistent character, voice, and visual identity. Run ten campaigns for ten products and you have ten ads with one consistent brand face — not ten unrelated generations.

That alone would be a decent demo. What makes it a platform is what we layered on top.

## The headline capability: the agentic loop

Open a campaign, click into Conversations, and you're in a live WebRTC realtime call with your spokesperson. Mic on, webcam off, Zoom-style overlay. The avatar opens with a warm `"Hey, welcome back — what are we working on today?"` if you've spoken before, or a campaign-aware intro if it's your first time.

Now say:

> *"Make me a long ad explaining Character OS to the Runway API judges. Walk me through what's happening as you do it."*

The avatar acknowledges out loud. Behind the scenes, it invokes a tool over the WebRTC `client_event` channel. The browser dispatcher receives the invocation, kicks off a request to the local LLM (Ollama, `llama3:latest`) for a multi-beat spoken script grounded in the campaign brief, the operator's free-form prompt, and any attached memory documents. ~8 seconds later the script is back. The dispatcher then calls the backend's long-ad render pipeline: chunk the script at sentence boundaries, fire a Runway `avatar_videos` task per chunk in parallel, poll each to completion, stitch the resulting MP4s with ffmpeg.

While that's happening, the avatar narrates the stages — *"Llama's drafting now,"* *"I've got the script, I'm rendering with my own voice,"* *"this'll take a couple minutes, hang tight"* — using stage-specific toasts the dispatcher fires after each tool step. ~3 minutes wall clock from voice command to a playable MP4 landing in the Videos tab, which auto-opens so the operator watches it arrive.

That whole loop — voice in, video out, narrated wait — is the headline. **You talk to your spokesperson, your spokesperson makes the ad, you watch it land.**

The realtime tool catalog has nine entries. Five cover the four ad shapes (short verbatim, short auto-write, long verbatim, long auto-write) plus a UI navigate. Two are memory-aware (recall prior conversations, persist the current one). One is knowledge recall against the operator-curated brand notes. One is character-to-character handoff. The avatar's LLM picks the right tool based on operator intent — a verbatim script triggers `render_spokesperson_ad`, a high-level brief triggers `auto_write_and_render_ad`, "save what we just talked about" triggers `attach_memory_to_campaign`, "I want to talk to Riggs" triggers `handoff_to_character`.

## Local-first infrastructure

Two of the three creative engines run **on the operator's laptop**:

- **The LLM** runs through Ollama via the OpenAI-compatible endpoint. No cloud API key. Set `LLM_PROVIDER=ollama` in `.env`, point at any pulled model (`llama3:latest` by default), and the platform's concept generator, ad-script auto-writer, and transcript summarizer all run locally. The top-bar shows a 🦙 chip with the active model. We verified end-to-end with `llama3:latest` on the operator's M-series MacBook: ~7s for a short-ad script, ~8s for a long-ad multi-beat draft, ~3s for a transcript summary.

- **Post-production polish** runs through DaVinci Resolve Studio's Python scripting API. Operator builds a Resolve template once (color grade, transitions, Fusion title placeholders, music bed). The `🎬 Polish in DaVinci Resolve` button in the Videos tab drops the cached Spokesperson Ad MP4 into the operator's template via Resolve's API, swaps the placeholder clip and title text programmatically, renders via the H.264 Master preset, and lands the polished cut alongside the unpolished one. Two-click pipeline from raw avatar render to broadcast-quality final.

Only video generation leaves the laptop — Runway's `/v1/avatar_videos`, `/v1/realtime_sessions`, `/v1/voices`, `/v1/documents`. Everything else (LLM, post, storage, memory, orchestration) runs on the operator's machine. That gives the operator control over cost (no OpenAI bill), latency (no round-trip to a cloud LLM), and privacy (transcripts and brand notes never leave their box).

## Cross-session memory

The persistent-spokesperson pitch falls apart if the spokesperson forgets you between sessions. So we built memory.

`backend/app/services/memory/` is a **pluggable** architecture — three abstract base classes and one orchestrator. `MemoryStore` is the persistence layer. `MemorySource` is anything that produces memory entries (operator notes, transcript summaries, external feeds). `MemoryComposer` is the body assembler that packs entries into a Runway document body under a 40K-character budget. `MemoryOrchestrator` wires them together.

Phase 1 (shipped) uses `JsonMemoryStore` — one file per character at `data/memory/character-{id}.json`. Two sources are live: `OperatorNoteSource` mirrors the brand notes operators paste into the Knowledge tab; `TranscriptMemorySource` summarizes past realtime conversations into a ~280-char memory note via Llama. Composition is `RecencyWeightedComposer` — Markdown body, sections per source type, newest first, bounded by budget.

Phase 2 (also shipped this hackathon) is the plumbing: 5 backend routes (list / ingest / delete / compose / attach), a Memory tab on the Spokesperson Workspace with a budget bar and per-entry filtering, an auto-ingest hook that fires after every `POST /realtime-transcript`, and two memory-aware realtime tools so the avatar can voice-command the loop. Saying *"save what we just talked about"* triggers a four-step chain — fetch transcript → ingest into store → compose Markdown body → publish as a Runway document → attach to the campaign. The next session on that campaign reads the document as RAG via `documentIds`, and the avatar's LLM has the prior conversation as context.

Phase 3 (post-submission) is the upgrade path: swap `JsonMemoryStore` for `PgVectorMemoryStore` — same interface, same entries, just Postgres + pgvector underneath. Add `QueryWeightedComposer` for semantic ranking instead of pure recency. The architecture is one new class away from production-scale RAG.

This part matters for the demo: when you ask Donny *"do you remember what we talked about?"*, the platform really does look up the saved memory entries and Donny references them. When you say *"save this conversation"*, the next session genuinely remembers. The memory loop isn't a mock — it runs on every realtime session you have.

## Three ad modes, one spokesperson

A campaign produces up to three sibling outputs from the same brief, surfaced as side-by-side mode cards on the Campaign Overview:

- **Spokesperson Ad** — Runway `avatar_videos`, the avatar IS the visual, lip-synced speech. Founder explainers, mascot ads, talking-head campaigns. The short mode renders in ~30-45s; the long mode chunks at sentence boundaries and stitches with ffmpeg, scaling to 60+ second multi-beat narratives in ~2-4 minutes.

- **Dialogue Scene** — sequential `avatar_videos` per line, two or more characters, ffmpeg concat. Office-style skits, founder-mascot reactions, fake podcasts, multi-character explainer reels. Each line preserves the speaker's voice and avatar identity. Six lines is the default; the seeded "Office Banter" campaign demonstrates Donny, Riggs, and Miles trading lines in a single stitched scene.

- **Cinematic Commercial** — Runway `image_to_video` or `text_to_video` for the visuals (silent), avatar host-clip audio muxed via ffmpeg, no lip sync (visual is unrelated to mouth movement). Best for atmosphere, b-roll, product shots. The Storyboard Builder is a fourth output inside this family — three image-to-video shots stitched into a ~15s longer cut.

Each mode produces a final MP4 alongside vertical (720×1280) reels exports for social. All outputs are cached on the campaign record. The Videos tab shows every render as a tile with download + DaVinci-polish actions.

## Character-to-character handoff

The realtime catalog has a `handoff_to_character` tool. Mid-call, the operator can say *"hand me off to Riggs Rally"* and the avatar acknowledges out loud (*"On it, handing you to Riggs now"*), invokes the tool with the target name as an argument, and the platform navigates the operator's browser to the target spokesperson's workspace, opens a fresh conversation on their most recent campaign, and auto-starts the realtime session. Total latency ~2 seconds plus Runway session-create time. The handing-off avatar can also voluntarily delegate — *"actually, fitness coaching is Riggs's beat, let me bring him in"* — based on a personality cue that tells it when another spokesperson is better suited.

Validation is strict: the target must exist, must have a `ready` Runway avatar, and must own at least one campaign. Every failure mode emits a specific toast so the operator can fix the precondition (attach a campaign, finish the avatar create, etc.) and retry. The whole flow is implemented in three pieces — a tool entry in the realtime catalog, a frontend dispatcher case that resolves names by substring match against the character list, and a URL-param-driven autostart in the workspace that fires after the navigation lands.

## What we built it on

**Backend** is FastAPI + Pydantic v2. 84 application routes, dependency-injected `CampaignStore` / `CharacterStore` / `Settings`, threading-locked JSON storage with one file per record kind. The realtime broker, `realtime_avatar_client.py`, owns the `/v1/realtime_sessions` create + poll + delete lifecycle, the personality + startScript override composition, the documentIds RAG attachment, and the 9-tool catalog. Runway is reached via `httpx.Client` with a tiered fallback strategy: if a session-create 400s with the experimental tools field, the broker retries without tools; if it 400s with documentIds, retries without; if it still 400s with the personality override, retries with the bare base body. Campaign context survives even when Runway rejects an experimental field, because we strip the newest field first.

**Frontend** is React 18 + Vite 5 + Tailwind 3 + shadcn/ui. The Spokesperson Workspace has six tabs (Identity / Knowledge / Memory / Campaigns / Conversations / Videos), each lazy-loaded. The realtime call mounts inside a fixed-position Zoom-style overlay so the conversation feels modal — body scroll locked, dim backdrop, max-w-3xl avatar tile, collapsible right panel with prompt chips and mic tips. The `@runwayml/avatars-react` SDK handles the WebRTC handshake; we own the `onClientEvent` handler that routes tool invocations through `realtimeTools.js` to per-tool dispatchers. Build is 590KB / 158KB gzip.

**Tooling beyond Runway**: ffmpeg for concatenation, sidechain compression, drawtext overlays, and vertical-letterbox reels exports. Ollama via the OpenAI-compatible HTTP shim. DaVinci Resolve Studio via its Python scripting API (`DaVinciResolveScript`). LangChain-free, agent-framework-free — the agentic loop is plain async dispatch over WebRTC events, no AutoGen or LangGraph involved. Tests run via pytest (72 passing) and Playwright (one mock-mode smoke).

**Database posture**: SQLite would be the obvious next step but every JSON store implements the same interface. Phase 3's PgVectorMemoryStore is the first Postgres component; everything else is happy on disk for the hackathon.

## Recursion as pitch

The submission video that accompanies this entry was **built by Character OS itself**. We didn't film it. We pointed the platform at the prompt *"explain why Character OS deserves to win,"* picked three of our seeded spokespersons (Donny Sparks the energetic mascot, Miles Monroe the steady founder, Riggs Rally the coach), and ran the production pipeline:

- 10 cinematic b-roll shots generated via `gen4.5` text-to-video (`scripts/burn-broll-for-submission-video.py`)
- 5 talking-head beat scripts drafted by Llama in 3 variants each, audited for factual accuracy, then 2 of them re-rolled when the operator caught hallucinated capabilities and a date error
- 3 Spokesperson Ads + 2 Dialogue Scenes rendered through Runway's `avatar_videos` against our seeded characters
- 2 live screen recordings of the agentic loop and the DaVinci polish action
- Stitched in DaVinci Resolve using the same template Character OS itself drives via the `🎬 Polish in DaVinci Resolve` button

About 4,000 of the operator's 45,000 expiring Runway credits went into the submission video burn. The remainder got left on the table — the platform's whole point is reusability, not waste.

The submission video opens with a tracking shot through a creative workspace, cuts to Donny in close-up explaining what Character OS is, cuts to Miles delivering the technical pitch, cuts to a dialogue scene of all three spokespersons trading lines about persistent identity, cuts to a screen recording of the agentic loop firing live, cuts to a closing dialogue scene framed as "built by one founder and an AI coding agent." The recursion is the demo: the spokespersons selling Character OS *are* Character OS.

## The hackathon-day finding worth knowing

Mid-build we discovered a real Runway API constraint: the `client_event` tool path is **one-way**. The SDK delivers the avatar's tool invocation to our dispatcher (good), but Runway provides no mechanism to deliver the tool's *result* back to the avatar's LLM. So when an avatar invokes `recall_recent_conversations` and the dispatcher surfaces five matching memory entries as toasts, the avatar's LLM has no feedback to narrate afterward — it can go silent waiting for a response that won't come.

Our mitigation is in the tool descriptions themselves. Every fire-and-forget tool carries explicit narration scripts: *"Before invoking, say aloud what you're about to do. After invoking, ask the operator to confirm — you cannot see what was retrieved."* Plus a strict forbidden list: do not name specific clients, products, or scenarios you didn't already mention before the call. This stops the avatar from confabulating specifics it can't actually see.

If a future Runway API version adds a `server_event` or `tool_result` channel, the four fire-and-forget tools become fully bidirectional and the mitigation becomes optional. The architecture is ready for it — the dispatcher just doesn't have a return path to plug into yet.

## What's parked, intentionally

A few things we built, validated, and chose not to ship for the submission:

- **`speech.type=audio` single-pass long-ad rendering** — we have a probe script that confirms Runway accepts 42-second-plus external audio with negligible drift, and `build_avatar_video_body`'s audio branch is wired. Shipping it needs an external TTS source (OpenAI tts-1-hd or ElevenLabs) and a per-Character `tts_voice` field. Parked because the chunk-and-stitch long-ad pipeline already works end-to-end and `speech.type=audio` is a strictly additive upgrade.

- **Voice clone preview audition via `/v1/voices/preview`** — confirmed to be ElevenLabs voice-design shim for crafting custom voices from scratch, not a generic text-to-speech endpoint. We use Runway's preset voices for the seeded spokespersons and operator-uploaded audio samples for cloning, which covers the demo cleanly.

- **PgVectorMemoryStore** — Phase 3 of the memory architecture. The interface is in place; the implementation is one new class. Not strictly needed for a hackathon-scale demo and the JsonMemoryStore exercises every code path that matters.

## The team

One founder (Chris). One AI coding agent (Claude Opus 4.7 with the 1M-token context window). 104 sessions of pair-coding over one hackathon weekend. 145+ PRs landed, ranging from "fix singular framing in the portrait composer so we stop generating two raccoons" to "ship the cross-session memory foundation as a pluggable architecture so future pgvector is a one-class swap." Every commit message is in the git log; every architectural decision has a session handoff doc under `docs/handoffs/` explaining what changed and why.

## Why we think it should win

Not because it's the prettiest demo. Because it's the *most architecturally honest* take on what AI ads should look like once they're more than a one-shot generation gimmick. **Brands aren't made of one video. They're made of one identity across many videos.** Character OS treats the identity as the persistent unit — the character, their voice, their memory of past conversations, their visual binding to a Runway avatar — and treats videos as outputs of that identity. Run it for a week and your spokesperson has dozens of campaigns under their belt and remembers every one of them.

And it does that on top of an API surface that's brand-new enough that we discovered a real one-way-tool-calling constraint mid-build and shipped a clean mitigation for it in the same session — exactly the kind of platform thinking the persistent-spokesperson pitch needs to scale.

Ship it.
