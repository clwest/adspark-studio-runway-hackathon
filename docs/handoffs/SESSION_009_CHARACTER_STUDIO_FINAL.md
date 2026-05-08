# SESSION 009 — Character Studio Final (Docs Refresh for v5)

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Closes the loop on:** SESSION_008 (PR K — Character Studio V1
implementation)
**Branch:** `feature/pr-l-character-studio-docs`

## Goal

Phase L — refresh every submission and demo document to make
Character Studio the headline of the AdSpark story. AdSpark is no
longer just "an AI ad generator"; it is "**AI Campaign + Character
Studio**" — the user generates a reusable brand character, binds it
to a Runway Avatar, and attaches that character to every downstream
campaign, host clip, audio pack, and realtime session.

This is **docs-only** work. No product code, no new Runway calls, no
generated media, no dependency changes.

## What was done

### Documents updated

| File | Change |
|---|---|
| `README.md` | Headline reframes AdSpark as "AI Campaign + Character Studio." Mermaid pipeline now shows the character branch (`gen4_image_turbo` portrait → `/v1/avatars` → attach → resolution chain). New **Character Studio** section ahead of the Brand Spokesperson section explains the create + attach flow + commercial framing. Endpoint table grows from 28 → 36 routes. Project layout includes `character_store.py`, `character_studio_client.py`, `routers/characters.py`, `CharacterStudio.jsx`, `CharacterCard.jsx`. New cache-layout subsection lists all `backend/data/` directories. Tag table now five rows; **`hackathon-submission-v5`** at `0cddb96` is canonical. |
| `SUBMISSION.md` | One-line pitch reframes around reusable brand characters. New **why this matters** paragraph captures the commercial differentiator: "A business that runs through AdSpark doesn't just leave with one ad. It leaves with a reusable AI mascot or founder spokesperson." Per-campaign generation list adds Reusable Brand Character at the top. Runway endpoint table adds Character portrait + Character → Runway Avatar rows. Differentiators reordered with reusable characters as #1; resolution chain documented as #5. Demo-script summary now points at Path F (Character Studio Full Demo). Verification section adds the Brewster real hero-run with avatar id `f00b39e2-e8b5-4a8a-91d5-eca4ab57c4a8`. PR list extended through K and L; tags table extended; **v5 declared canonical.** |
| `DEMO_SCRIPT.md` | New **Path F — Character Studio Full Demo** (~4–5 min, real credits). Pre-flight covers off-camera character creation. Recording flow walks through Brewster + ad pipeline + Attach Character + host clip + brand voice + dub + realtime. Pass criteria, optional raccoon-coffee mascot B-roll, fallbacks, anti-patterns, and "what Path F demonstrates" close the section. |
| `00-START-NEXT-SESSION.md` | Rewritten for v5. State at `0cddb96` + tag through v5. v5 feature stack has Character Studio entry. Run + smoke + Path F demo instructions. K.5 / L / M wishlist documented under "what NOT to build next." Reference docs list all five session handoffs. |
| `docs/WHAT_IT_IS.md` | Reframes AdSpark as AI Campaign + Character Studio. Per-campaign generation list adds Reusable Brand Character. Storage section adds `characters.json` + `data/characters/`. Mock-vs-real table adds Character portrait + Character → Runway Avatar rows. |
| `docs/INVENTORY.md` | Snapshot updated to v5. Backend table adds `character_studio_client.py`, `character_store.py`, `routers/characters.py`. `models.py` row notes `Character`, `CharacterCreate`, `CharacterList`, and the `character_id` + `generated_character_prompt` campaign fields. `character_host_client` row notes the new `active_avatar_id(campaign, settings)` resolution chain. Frontend table adds `CharacterStudio.jsx`, `CharacterCard.jsx`, the App.jsx mount, and the new api.js helpers. CampaignGallery row covers the attach picker + Attached Character display + the `avatarReady` derivation. Endpoint dump now 36 routes including 7 character routes + attach-character. New "Avatar resolution chain" subsection documents the order. Out-of-scope list extends with K.5 / L / M Character Studio roadmap. |
| `docs/research/CHARACTER_STUDIO_SPIKE.md` | Header gets a small "2026-05-08 update — Phase K V1 shipped" callout pointing at the Brewster verification + the v5 tag. Body remains the locked design reference; no §§4–9 changes. |
| `docs/handoffs/SESSION_009_CHARACTER_STUDIO_FINAL.md` | New (this file). |

### Data model summary (unchanged from PR K, restated for handoff)

```python
Character(
  id, slug, name,
  template: Literal["mascot","founder","coach","local_guide"],
  subject, style, personality,
  catchphrases: list[str],
  voice_preset,                       # 30 universal Runway presets
  portrait_url,                       # /api/characters/{id}/portrait when local
  portrait_source,                    # gen4_image_turbo | mock
  portrait_prompt,
  runway_avatar_id,                   # populated after create-avatar
  runway_avatar_status,               # ready | mock | failed | pending | None
  runway_avatar_thumbnail_url,
  runway_avatar_error,
  source_campaign_id,
  mock_mode,
  metadata,
  created_at, updated_at,
)
Campaign(..., character_id?, generated_character_prompt?)
```

### API routes (PR K, restated for handoff)

```
GET    /api/characters
POST   /api/characters
GET    /api/characters/{id}
POST   /api/characters/{id}/generate-portrait
POST   /api/characters/{id}/create-avatar
GET    /api/characters/{id}/portrait
DELETE /api/characters/{id}
POST   /api/campaigns/{id}/attach-character
```

### Frontend UX (PR K, restated for handoff)

- `CharacterStudio.jsx` panel above the gallery: header + `+ Create
  Character`, inline create form, library grid of `CharacterCard`.
- `CharacterCard.jsx`: portrait → name → template/voice → status pill
  → context-aware actions (Generate Portrait / Create Avatar / Use
  Character / Detach / delete). `compact` mode for inline picker.
- `CampaignGallery.jsx` Brand Spokesperson section: when a character
  is attached, a pink-bordered Attached Character block replaces the
  Avatar Picker + Create Custom flows. When no character is attached,
  an Attach Character affordance lazy-loads the character library and
  exposes the inline picker.

## Brewster real-mode verification (carried forward from SESSION_008
for the v5 record)

| Step | Duration | Result |
|---|---|---|
| `POST /api/characters` (mascot template, voice `max`) | <1 s | character record created |
| `POST .../generate-portrait` (`gen4_image_turbo`, 1280:720) | 14 s | 605 KB PNG cached at `backend/data/characters/<id>-portrait.png` |
| `POST .../create-avatar` (data URI ≤5 MB → `/v1/avatars` → poll READY) | 34 s | `runway_avatar_id f00b39e2-e8b5-4a8a-91d5-eca4ab57c4a8`, status `ready`, processed thumbnail URL populated |
| `GET /api/runway/avatars` | <1 s | Brewster surfaces alongside the account's existing avatars |
| `POST /api/campaigns/de3f19094b79/attach-character` | <1 s | character_id persisted on the campaign |
| `POST /api/campaigns/de3f19094b79/host-video` | ~10 s | Avatar Host Clip records via Brewster's avatar id (resolution chain wins; verified in backend logs) |
| Detach + local delete | <1 s | clean; Runway-side avatar persists for reuse from picker |
| Backend log secret scan | — | zero `rwk_` / `stk_` / `sessionKey` literals |

Total real-mode spend: ~5 credits + ~50 s wall-clock per character.

## Verification (PR L, this session)

- `git status`: clean before commit (only the docs files modified).
- Backend import check: `python -c "from app.main import app;
  print(len(app.routes))"` → **36** routes registered.
- Frontend production build: clean, ~203 KB initial JS / ~62 KB gzip
  (unchanged from PR K — docs-only).
- Playwright smoke (mock mode): **1 passed in ~21 s.** Asserts the
  Character Studio panel + `+ Create Character` button render.
- Git hygiene scan:
  - `git ls-files | grep -E '\.(env|mp4|png|jpg|jpeg|wav|mp3)$|/data/'`
    → empty.
  - `git ls-files | grep -E '\.env$'` → empty.
  - No `rwk_`, `stk_`, `sk-`, `sessionKey` literals introduced in
    docs.
  - No "v4 is canonical" wording remains without v5 context — every
    surviving v4 reference is followed by a v5 callout, or the
    sentence has been rewritten to say "the full feature stack at
    v4 lives at `hackathon-submission-v4`. For the character-driven
    flow, see Path F below (`hackathon-submission-v5`)."

## Files changed (8 docs)

- `README.md`
- `SUBMISSION.md`
- `DEMO_SCRIPT.md`
- `00-START-NEXT-SESSION.md`
- `docs/WHAT_IT_IS.md`
- `docs/INVENTORY.md`
- `docs/research/CHARACTER_STUDIO_SPIKE.md` (small "shipped" callout)
- `docs/handoffs/SESSION_009_CHARACTER_STUDIO_FINAL.md` (new)

## Current tags on origin

| Tag | Commit | Story |
|---|---|---|
| `hackathon-submission` | `7ed949e` | Pre-avatar baseline. Concept → Image → Video → Campaign Pack. |
| `hackathon-submission-v2` | `e6ca02b` | Adds Brand Spokesperson Avatar + Avatar Host Clip. |
| `hackathon-submission-v3` | `515701f` | Adds Brand Voice + 29-language Multilingual Dubs. |
| `hackathon-submission-v4` | `89918c3` | Adds Realtime Brand Spokesperson + Avatar Picker. |
| **`hackathon-submission-v5`** | **`0cddb96`** | **Canonical full submission.** Adds Character Studio V1. |

PR L (this docs refresh) does not bump the tag — `hackathon-submission-v5`
already points at the implementation commit. The PR-L docs commit
exists separately on the branch and is not tagged.

## Known limitations (PR K, still applicable)

1. **Direct TTS still gated** (deferred since Phase H). Brand Voice
   + dub pipeline remains the multilingual delivery path.
2. **Per-character voice preset is permanent on the Runway avatar.**
   Changing the voice requires re-running `create-avatar` (Runway
   doesn't expose PATCH for avatar voice). The frontend doesn't
   warn about this yet — K.5 polish.
3. **No personality editor in V1.** The personality field is captured
   at create time but not editable afterwards. K.5 adds PATCH
   support.
4. **Each `create-avatar` produces a fresh Runway avatar resource.**
   Frequent recreations accumulate on the account. K.5's
   `replace-avatar` route should DELETE the old one first.
5. **No "use this campaign's reference image as the character
   portrait" affordance yet.** The user has to type the subject +
   style themselves. A small affordance ("Create Character from this
   Campaign") on the gallery card is K.5 territory.
6. **Mock thumbnail = mock portrait.** When a character is attached
   in mock mode, the avatar thumbnail is just the cached stdlib PNG.
   Sufficient for UI verification but doesn't preview the real
   Runway-processed thumbnail.
7. **Local DELETE doesn't cascade to Runway.** Deleting a Character
   locally cleans the portrait + JSON entry but the account-side
   Runway avatar persists. Intentional V1 behaviour — the avatar is
   still reachable from the Avatar Picker.
8. **Single-process JSON file storage.** Fine for a hackathon; not a
   production substrate.

## Next recommended phases

### K.5 — polish (small, additive)

- `PATCH /api/characters/{id}` for rename / personality / catchphrase
  edits.
- `POST /api/characters/{id}/replace-avatar` — DELETE the old Runway
  avatar then create a new one (handles voice change cleanly).
- "Create Character from this Campaign" affordance on the gallery
  card (uses the campaign's `reference_image_url` as the portrait
  source).
- Voice-change warning copy in the create form ("Changing voice
  later requires regenerating the avatar — ~$0.10 of credit").

### Phase L — character-driven campaign generation

Pre-attach a character to a new campaign at form-submit time. Use the
character portrait as the reference image for video generation
(`/v1/image_to_video` with the character portrait as `prompt_image`).
The resulting ad clip features the character directly, not just the
spokesperson voiceover.

This unifies the "ad" and "host clip" surfaces — the ad itself
becomes a character-driven piece. Effort estimate: ~1 day; main risk
is the character portrait dimensions (1280:720) needing reframing for
9:16 / 1:1 video aspects.

### Phase M — character pack export/import + marketplace

JSON + portrait export so users can share characters across machines
or sell character packs. Import skips the portrait + avatar
generation steps. Future commercial play: a marketplace where
designers post characters and brands license them.

## Do-not-build guardrails

- **No K.5 polish without scope confirmation.** The user pre-approved
  K, not K.5.
- **No Phase L work without a research spike first.** Character +
  campaign reference image interaction has unknowns
  (face-detection rules for non-portrait aspect ratios; whether
  `gen4_turbo` will animate stylised mascots cleanly).
- **No Phase M work in the hackathon timeframe.** Out of scope.
- **No auto-regenerate / auto-replace on voice change.** Voice change
  cost must be a user-acknowledged click (real Runway credits).
- **No public character sharing.** V1 is single-machine, single-account.
- **No Runway DELETE cascading on local delete.** V1 keeps avatars
  reachable from the picker after a Character record is deleted.
- **No `/v1/text_to_speech` work.** The discriminator is gated; Brand
  Voice + dub covers multilingual delivery.
- **No webcam toggle on realtime.** Mic-only V1 stays.

## Reference docs

- `README.md` — quickstart, Mermaid pipeline through Character
  Studio, endpoint table (36 routes).
- `SUBMISSION.md` — judge-facing pitch with v5 framing + Brewster
  hero-run.
- `DEMO_SCRIPT.md` — six paths (A/B/C/D/E + **F = Character
  Studio Full Demo**, the v5 headline).
- `docs/WHAT_IT_IS.md`, `docs/INVENTORY.md` — refreshed in PR L.
- `docs/research/CHARACTER_STUDIO_SPIKE.md` — locked V1 design
  + shipped callout.
- `docs/research/RUNWAY_API_CAPABILITY_MAP.md` — capability map.
- `docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` — PR F avatar
  schema probe.
- `docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` — PR I
  realtime schema probe.
- `docs/handoffs/SESSION_007_REALTIME_AND_PICKER.md` — PR H/I/J arc.
- `docs/handoffs/SESSION_008_CHARACTER_STUDIO.md` — PR K
  implementation handoff.
