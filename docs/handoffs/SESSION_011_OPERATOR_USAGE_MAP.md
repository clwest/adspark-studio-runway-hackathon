# SESSION 011 — Operator Usage Map (Context-Kit Refresh)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Closes the loop on:** SESSION_010 (Longer Video Prep), and ten
shipped feature PRs since (PR Z storyboard → PR AF dialogue).
**Branch:** `main` (docs-only commit)

## Goal

Refresh the context-kit anchors (`00-START-NEXT-SESSION.md`,
`docs/WHAT_IT_IS.md`, `docs/INVENTORY.md`) so a fresh Claude Code
session or human operator can pick up at `ec446e4` (PR AF) and
immediately understand:

1. The current state of the product (three-mode architecture +
   Storyboard + Dialogue + campaign-aware realtime).
2. How each surface works end-to-end via the new
   `docs/OPERATOR_USAGE_MAP.md`.
3. Which next phase to scope without burning credits or breaking
   demo-safe defaults.

This is **docs-only** work. No product code, no Runway calls, no
new generated media.

## Where things stand

- `main` at `ec446e4` synced with `origin/main`. Working tree clean.
- Latest tag: **`hackathon-submission-v13`** at `ec446e4` (PR AF
  Multi-Character Dialogue Scene Builder).
- Tag roster on origin: `hackathon-submission`, `v2`, `v3`, `v4`,
  `v5`, `v6`, `v8`, `v9`, `v10`, `v11`, `v12`, `v13` (`v7` was
  deliberately skipped — the next manual hero recording is still
  pending; recommend re-recording before tagging `v14` or
  `v14-docs`).
- Backend: 57 application routes. Imports clean.
- Frontend production build: 290.87 KB initial JS / 82.95 KB gzip
  + 561.97 KB lazy `@runwayml/avatars-react` chunk.
- Mock-mode Playwright smoke: `1 passed (~23 s)` — verified during
  this session.
- Git hygiene: `.env` ignored, `backend/data/` ignored, no
  committed media, no leaked secrets in tracked docs.
- Stale local feature branches: 22 (`feature/pr-a-…` through
  `feature/pr-x-…`) all merged into main; pruning is out of scope
  but safe whenever the user wants.

## Current product thesis

AdSpark is **AI Campaign + Character + Dialogue Studio** — a
single brief produces a complete cinematic ad package, plus
reusable AI brand characters, plus a multi-character dialogue
scene builder for Office-style branded skits and recurring social
content.

The headline architecture is **three sibling ad modes** sharing one
campaign brief + one character library + one Commercial Script:

| Mode | Visual primitive | Lip sync | When |
|---|---|---|---|
| **Cinematic Commercial** | Runway `image_to_video` (silent) + ffmpeg audio mux | ❌ | B-roll, atmosphere, product shots |
| **Spokesperson Ad** | Runway `avatar_videos` | ✅ | Mascot / founder talking-head ads |
| **Dialogue Scene** | Sequential `avatar_videos` per line + ffmpeg concat | ✅ per line | Multi-character skits, fake podcasts, founder ↔ mascot reactions |

Storyboard Commercial Builder sits inside the Cinematic family —
three image-to-video shots stitched into a longer (~15 s) silent or
voiced cut.

## Current feature stack (PR-by-PR, since v6)

| PR | Title | Notes | Tag |
|---|---|---|---|
| PR R | Visual Source flow | Generate / Upload / Use Character / Text-only radios | (between v6 and v8) |
| PR S | Commercial with Voice | ffmpeg loop + host audio mux | |
| PR T | Structured Runway Prompt Builder | "A realistic …" template, one-character / one-action rule | |
| PR U | Spokesperson-first flow | Stage 1 = Spokesperson | |
| PR V | Editable Portrait Prompt | Character Studio | |
| PR W | Character visual-source bugfix | Use Character correctly passes portrait | |
| PR X | Auto-voiced commercial | Auto-creates host clip when missing | |
| PR Y | Newest-saved focus | Card highlight + scroll | |
| PR Z | Storyboard Commercial Builder | 3 shots, ffmpeg concat | |
| PR Z2 | Silent vs voiced UX | Final Voiced Cinematic Ad copy | |
| PR AA | Voice preview + script-first | Commercial Script editor | **v8** |
| PR AB | Spokesperson Ad mode | `/spokesperson-ad` alias | **v9** |
| PR AC | Creative director controls | Editable storyboard shots + script-aware planner | **v10** |
| PR AC follow-up | Move script into PromptPreview | Form maxLength + error scroll | **v10** |
| PR AD | Cinematic vs Spokesperson UX | "Pick your ad mode" picker, identity-drift helper | **v11** |
| PR AE | Realtime campaign context injection | personality + startScript on `/realtime_sessions` | **v12** |
| PR AF | Multi-Character Dialogue Scene Builder | New Dialogue tab, sequential `avatar_videos` + ffmpeg concat | **v13** |

## Route count + endpoints

**57 application routes.** Full inventory in
`docs/INVENTORY.md`. New since v6:

- `/api/campaigns/{id}/script` (PR AA)
- `/api/campaigns/{id}/spokesperson-ad` (POST + GET, PR AB)
- `/api/campaigns/{id}/commercial-with-voice` (POST + GET, PR S/X)
- `/api/campaigns/{id}/storyboard/*` (5 routes, PR Z + PR AC)
- `/api/campaigns/{id}/storyboard/voiced` + `storyboard-voiced-video` (PR Z)
- `/api/campaigns/{id}/dialogue/*` (6 routes, PR AF)

## Major data + cache locations

```
backend/data/
├── campaigns.json          # PR A — all campaign records (per-feature fields layered in)
├── characters.json         # PR K — Character Studio store
├── images/                 # PR A — generated reference images
├── videos/                 # PR A — saved campaign videos (silent visual cuts)
├── finished/               # PR B — Pack outputs + voiced commercials + stitched storyboard + voiced storyboard + stitched dialogue scene
├── host/                   # PR F — Avatar Host Clips / Spokesperson Ads
├── audio/                  # PR H — Brand Voice previews + per-language dubs
├── characters/             # PR K — character portrait PNGs
├── storyboard/             # PR Z — per-shot cached MP4s
└── dialogue/               # PR AF — per-line cached MP4s
```

`backend/.gitignore: data/` keeps every generated artefact out of
version control.

## Mock vs real behaviour

Detail in `docs/WHAT_IT_IS.md` §"Mock vs Real". Headline:

- Mock mode runs end-to-end with **no Runway key**. Every async
  surface short-circuits to a deterministic local response (stdlib
  PNG for images, in-memory task store with public sample MP4 for
  generic video, ffmpeg `lavfi` placeholders for host clip /
  storyboard shots / dialogue lines, stitched outputs use real
  ffmpeg over mock inputs).
- Real mode hits 11+ Runway endpoints today (text_to_image,
  image_to_video, text_to_video, tasks, avatars CRUD,
  avatar_videos, voices, voice_dubbing, realtime_sessions create +
  poll + consume + delete, organization).
- The Mode banner readiness chip surfaces all four states (`demo
  mode` / `demo ready · concepts mocked` / `demo ready · all live`
  / `backend down`).

## Demo-safe flows (current)

The full set of demo paths now lives in
`docs/OPERATOR_USAGE_MAP.md` Section 12. Headline grid:

| Path | Mode | Time | Spend | Best for |
|---|---|---|---|---|
| **A** Mock walkthrough | mock | 60–90 s | 0 credits | Safest demo, no key |
| **B** Spokesperson Ad | real | ~3–4 min | ~10–15 credits | Mascot / founder lip-sync demo |
| **C** Cinematic Commercial | real | ~5–7 min | ~25–35 credits | B-roll / atmosphere demo |
| **D** Storyboard Commercial | real | ~6–10 min | ~30–45 credits | Longer multi-shot ad |
| **E** Dialogue Scene | real | ~6–8 min | ~30–45 credits (3 chars × 3 lines) | Office-style skit demo |
| **F** Realtime campaign-aware | real | ~3 min live | ~30–60 credits/session | Talk to Brewster about CEO Buzz |

Real-mode demos require the user to pre-create at least one
Character with a ready Runway avatar (Brewster the Raccoon, Piper
Voltage, etc.). All five real paths converge through the saved
campaign card; mode picker on Overview chooses the entry point.

## Current limitations (don't claim what we don't have)

| Claim users may expect | Truth | Mitigation |
|---|---|---|
| "Avatars will lip-sync the Cinematic visual" | False — `image_to_video` is silent and not synced | PR AB / AD UX makes this explicit; helper copy on Visuals + identity-drift warning on Use Character |
| "Realtime spokesperson knows everything about the brand" | True since PR AE — broker injects business / product / audience / hook / caption / CTA / commercial_script as personality + startScript | But there's no RAG document attached, so deep catalogue questions still drift |
| "Dialogue scene shows characters talking to each other" | False — characters are filmed in isolation per line | Acceptable for skit-style content; reaction-shot polish on the deferred list |
| "Storyboard scenes have audio" | False — silent by default; voiced storyboard pass mixes host audio over the loop | Documented in the Storyboard subsection copy |
| "Avatar voices can be previewed before binding" | False — no documented endpoint exposes preset preview MP3s | PR AA ships curated descriptions instead |
| "Dialogue scene exports as Reels/TikTok vertical" | False — output is 1088×704 horizontal | Vertical export is Tier-1 future polish |
| "Conversation transcripts are saved" | False — `/v1/avatar_conversations` is documented but unwired | Tier-1 candidate |

## Do-not-build-next guardrails

- **Multi-avatar realtime.** Runway doesn't expose simultaneous
  multi-character sessions. The async Dialogue Scene Builder
  covers this format for V1. Revisit only if Runway exposes
  parallel sessions or if we take on the LiveKit Agents
  multi-day build.
- **Direct text-to-speech narration** (`/v1/text_to_speech`).
  Gated. The Spokesperson Ad covers narration cleanly already.
- **Avatar marketplace / preset library exposure.** Runway's
  preset characters aren't API-listable; mock presets cover the
  picker UX. Don't try to scrape or hardcode preset UUIDs.
- **Stability.ai or any non-Runway provider.** Out of scope.
- **Public auth / multi-user / hosted deploy.** Lock the next
  product pillar before introducing user accounts.
- **Server-side `/v1/uploads`.** Public URL + data URI cover
  current paths.

## Recommended next phases (pick one before product code)

Tier-ordered against the avatar deep-review roadmap
(`docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md` §12):

### Tier 1 — small additions, high content lift
1. **Vertical / Reels export** — second ffmpeg pass that pads
   1088×704 → 720×1280 with brand background. Solves the social
   gap for Spokesperson + Dialogue. ~80 LOC backend + simple UI.
2. **Caption overlays for Dialogue Scene** — burn-in subtitles via
   `subtitles=` filter. Per-line text is already saved. ~50 LOC.
3. **Avatar `documentIds` for grounded realtime** —
   `POST /v1/documents` with the campaign brief + FAQ;
   `PATCH /v1/avatars/{id}` to attach. Avatar can answer brand
   questions from grounded text. ~80 LOC.
4. **Conversation transcript retrieval** —
   `GET /v1/avatar_conversations/{id}` for a "replay your
   spokesperson chat" UX. Pairs with the existing 5-min cap.

### Tier 2 — bigger UX builds
5. **Custom voice cloning UX** — `POST /v1/voices`
   `from.type=audio` so a brand can clone the founder's voice
   from a 30 s sample.
6. **Reaction shots between dialogue lines** — 1 s cutaways of the
   next speaker reacting before they speak. Doubles credit cost
   per scene; big content-quality lift.
7. **Episode templates** — pre-baked dialogue scene structures
   (founder vs accounting, mascot reacts to user reviews, fake
   podcast cold open).
8. **Avatar PATCH** — rename / swap voice / swap personality on an
   existing Avatar without minting a new Runway resource.

### Tier 3 — out of scope today, listed for completeness
9. Multi-character realtime (Runway-side feature gap).
10. Tool calling in realtime (avatar navigates the AdSpark UI).
11. LiveKit Agents path (custom STT/LLM/TTS, Avatar as visual layer).
12. Video meeting bot (Avatar joins Zoom / Meet / Teams).

## Verification (this session)

| Check | Result |
|---|---|
| `git status` | clean on `main` at `ec446e4` |
| `git log -20` | PR AF at HEAD; v13 tag at HEAD; v12 / v11 / v10 / v9 / v8 / v6 visible in history |
| `git rev-list origin/main...main` | 0 ahead / 0 behind |
| Backend import | `app.routes` reports 57 routes; imports clean |
| Frontend build | `vite build` → 290.87 KB initial / 82.95 KB gzip + 561.97 KB lazy chunk |
| Playwright smoke | `1 passed (~23 s)` mock-mode end-to-end |
| `.env` not tracked | confirmed |
| `backend/data/` not tracked | confirmed |
| Secret scan in docs | empty (no `rwk_` / `sk-` / sessionKey JWT patterns in tracked docs) |

## What was done this session

- Verified repo + runtime state (Step 1).
- Refreshed `00-START-NEXT-SESSION.md` for `ec446e4`.
- Refreshed `docs/WHAT_IT_IS.md` with the three-mode architecture
  + Storyboard + Dialogue + campaign-aware realtime + every cache
  location.
- Refreshed `docs/INVENTORY.md`: route count → 57, full PR R → AF
  feature stack, every endpoint, mock-vs-real grid for every
  surface, current limitations, ad mode architecture table.
- Wrote this handoff (`SESSION_011_OPERATOR_USAGE_MAP.md`).
- Wrote `docs/OPERATOR_USAGE_MAP.md` — twelve-section end-to-end
  usage guide covering every surface + six demo paths.

## What was NOT done

- No product code touched.
- No real Runway calls.
- No new tag (next manual hero recording earns a `v14` /
  `v14-docs` after this docs commit lands).
- No deep dive into any of the Tier-1 next-phase candidates —
  those are next-session work behind explicit scope approval.
