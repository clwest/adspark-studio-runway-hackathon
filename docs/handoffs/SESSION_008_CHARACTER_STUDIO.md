# SESSION 008 — Character Studio V1

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Closes the loop on:** SESSION_007 (PR H/I + Avatar Picker)
**Branch:** `feature/pr-k-character-studio-v1`

## Goal

Phase K — turn the existing Runway primitives (`gen4_image_turbo` +
`/v1/avatars` + Avatar Picker + realtime broker) into a first-class
**Character** resource that lives outside any single campaign and
can be reused across host clips, realtime sessions, and future
character-driven campaigns.

Locked design in
`docs/research/CHARACTER_STUDIO_SPIKE.md` §§4-9.

## What was done

### Backend (~700 LOC)

- `models.py` — new `Character`, `CharacterCreate`, `CharacterList`
  Pydantic models. `Campaign` gains optional `character_id` +
  `generated_character_prompt` fields, both backward-compatible.
- `services/character_store.py` (new) — JSON-file store at
  `backend/data/characters.json`, threading.Lock-guarded, atomic
  writes, lazy file creation. Mirrors `CampaignStore` shape +
  helpers for portrait/thumbnail file paths.
- `services/character_studio_client.py` (new) — two phases:
  - `generate_portrait(character, path, settings, ...)` — calls
    `POST /v1/text_to_image` with model `gen4_image_turbo`, ratio
    `1280:720`, a portrait-shaped prompt assembled from one of four
    locked templates (mascot / founder / coach / local_guide), and
    a flat-charcoal seed reference (Runway requires ≥1).
  - `create_avatar(character, path, settings, ...)` — reads cached
    portrait, embeds as data URI (≤5 MB cap), POSTs to
    `/v1/avatars`, polls to READY (~30-45 s).
  - Mock mode: stdlib zlib PNG → cached portrait; synthetic mock
    avatar id reusing the portrait as the thumbnail.
  - Result dataclasses (`PortraitResult`, `AvatarBindingResult`)
    never raise — routers handle the persistence + 4xx/5xx mapping.
- `routers/characters.py` (new) — 7 V1 routes:
    - `GET    /api/characters`
    - `POST   /api/characters`
    - `GET    /api/characters/{id}`
    - `POST   /api/characters/{id}/generate-portrait`
    - `POST   /api/characters/{id}/create-avatar`
    - `GET    /api/characters/{id}/portrait` (FileResponse)
    - `DELETE /api/characters/{id}` (local delete only — does NOT
      call Runway DELETE)
- `routers/campaigns.py` — `POST /api/campaigns/{id}/attach-character`
  with `{character_id}` body (null to detach). Verifies the
  character exists before persisting the attach.
- `services/storage.update_character_attachment(campaign_id, character_id)`.
- `services/character_host_client.active_avatar_id(campaign, settings)`
  + `active_avatar_status(campaign, settings)` — new resolution
  order:
    `character.runway_avatar_id  >  selected_avatar_id  >  host_avatar_id`
  Lazy-imports `CharacterStore` to avoid circular dependency. Both
  `_generate_real` (host clip) and `realtime_avatar_client.create_session`
  pass `settings` so character lookup happens.
- `app/main.py` registers the new `characters_router`.

**36 routes total now** (28 → 36 with the 7 character routes + 1
attach-character).

### Frontend (~500 LOC)

- `src/components/CharacterStudio.jsx` (new) — top-level panel:
  library grid, expandable inline create form (name, template,
  subject, style, voice preset, personality), auto-runs portrait
  generation immediately after create so the user sees something.
  Per-character action buttons surface in `CharacterCard`.
- `src/components/CharacterCard.jsx` (new) — single tile component
  used both in the studio library and the per-campaign attach
  picker. Renders portrait → name → template/voice → status pills →
  context-aware action row (Generate Portrait / Create Avatar /
  Use Character / Detach / delete).
- `src/api.js` — 6 new helpers: `listCharacters`,
  `createCharacter`, `generateCharacterPortrait`,
  `createCharacterAvatar`, `deleteCharacter`, `attachCharacter`.
- `src/components/CampaignGallery.jsx` — Brand Spokesperson section
  rewires:
  - When a character is attached: pink `Attached Character` block
    with portrait + name + template/voice/status + Detach link.
    The Avatar Picker, Create Custom flow, and existing
    avatar-ready info display all hide.
  - When no character is attached: new "Attach Character"
    affordance + lazy-loaded library grid (`CharacterCard` in
    compact mode); user picks a character to attach. Avatar Picker
    + Create Custom flow remain available below.
  - `avatarReady` derives from
    `characterAvatarReady || hasSelection || customReady` — all
    three paths can unlock Host Clip, Audio Pack, Realtime.
- `src/App.jsx` — renders `<CharacterStudio>` between RunwayPanel
  and CampaignGallery.

### Tests

- Playwright smoke (mock-mode end-to-end) asserts Character Studio
  panel + "+ Create Character" button render. Existing PR A-I
  assertions unchanged.

## Verification

### Mock-mode end-to-end (curl)

| Step | Result |
|---|---|
| `POST /api/characters` (mascot template) | 200, character id assigned |
| `POST /api/characters/{id}/generate-portrait` | 200, `portrait_source: mock`, 1.5 KB stdlib PNG, 512×512 8-bit RGB |
| `GET /api/characters/{id}/portrait` | 200, `content-type: image/png` |
| `POST /api/characters/{id}/create-avatar` | 200, `runway_avatar_id: mock_char_avatar_…`, `status: mock` |
| `POST /api/campaigns/{id}/attach-character` | 200, `character_id` persisted |
| `POST /api/campaigns/{id}/host-video` | 200, `host_status: ok`, character avatar wins resolution |
| Detach | 200, `character_id: null` |
| Unknown character on attach | 404 |
| Unsupported template on create | 422 (Pydantic) |
| Unknown character GET | 404 |
| Create-avatar before generate-portrait | 409 |
| Local delete cleans portrait file + JSON entry | confirmed |

### Real hero-run

Brewster the Bear, mascot template, voice `max`:

| Step | Duration | Result |
|---|---|---|
| Portrait generation | 14 s | `gen4_image_turbo`, ratio 1280:720, 605 KB PNG cached locally |
| Avatar creation + processing | 34 s | `runway_avatar_id f00b39e2-e8b5-4a8a-91d5-eca4ab57c4a8`, `status: ready`, processed thumbnail URL populated |
| Attach to campaign `de3f19094b79` | <1 s | character_id persisted |
| Picker `GET /api/runway/avatars` | <1 s | Brewster appears at top alongside other curated avatars |
| Detach + cleanup | <1 s | clean |
| Backend log secret scan | — | zero `rwk_` / `stk_` literals |

Total spend: ~5 credits + ~50 s wall-clock per character — matches
spike estimate.

### Build / test

- Backend import: 36 routes registered cleanly.
- Vite production build: 40 modules, **~203 KB initial JS / ~62 KB
  gzip** (up from 190/58 — character UI added ~13 KB).
- Playwright smoke: 1 passed in ~21.4 s. Asserts the new Character
  Studio panel + button.

### Git hygiene

- `git ls-files | grep -E '\.(env|mp4|png|jpg|jpeg|wav|mp3)$|/data/'`
  → empty.
- `backend/data/characters/` and `characters.json` gitignored via
  the existing `data/` rule.
- No `unified-donkey-betz` runtime imports introduced.
- No real Runway API keys / session keys / portrait bytes
  committed.

## Files changed (12 files, ~1200 lines)

- `backend/app/models.py`
- `backend/app/main.py`
- `backend/app/services/character_store.py` (new)
- `backend/app/services/character_studio_client.py` (new)
- `backend/app/services/character_host_client.py`
- `backend/app/services/realtime_avatar_client.py`
- `backend/app/services/storage.py`
- `backend/app/routers/characters.py` (new)
- `backend/app/routers/campaigns.py`
- `frontend/src/api.js`
- `frontend/src/components/CharacterStudio.jsx` (new)
- `frontend/src/components/CharacterCard.jsx` (new)
- `frontend/src/components/CampaignGallery.jsx`
- `frontend/src/App.jsx`
- `frontend/tests/adspark-smoke.spec.js`

## Architecture summary

```
Browser (CharacterStudio panel)            FastAPI                    Runway
─────────────────────────────              ───────                    ──────
  + Create Character          ───►  POST /api/characters
                                         create record in characters.json
                              ◄────  Character record (no portrait)

  Generate Portrait (auto-fired)
                              ───►  POST /api/characters/{id}/generate-portrait
                                         build prompt from template
                                         POST /v1/text_to_image     ────►
                                         poll task to SUCCEEDED
                                         download → backend/data/characters/<id>-portrait.png
                              ◄────  Character record (with portrait_url)

  Create Runway Avatar        ───►  POST /api/characters/{id}/create-avatar
                                         read cached portrait → data URI
                                         POST /v1/avatars            ────►
                                         poll to READY
                              ◄────  Character record (with runway_avatar_id, thumbnail)

(Now visible in Avatar Picker via the existing GET /v1/avatars listing.)

  Attach to Campaign          ───►  POST /api/campaigns/{id}/attach-character
                                         persist character_id on campaign
                              ◄────  Campaign record

  Click Present Campaign      ───►  POST /api/campaigns/{id}/host-video
                                         active_avatar_id resolves:
                                            character.runway_avatar_id
                                              > selected_avatar_id
                                              > host_avatar_id
                                         POST /v1/avatar_videos      ────►
                                            avatar={type:custom, avatarId:<character avatar>}
                                         poll, download MP4, cache locally
                              ◄────  Updated Campaign with host_video_url

  Click Start Conversation    ───►  POST /api/campaigns/{id}/spokesperson-session
                                         active_avatar_id same resolution
                                         POST /v1/realtime_sessions  ────►
                                            avatar={type:custom, avatarId:<character avatar>}
                                         poll READY, return sessionKey
                              ◄────  {session_id, session_key, expires_at, avatar_id}

  <AvatarCall sessionKey={...}>  ──────────────────────────────────► WebRTC handshake
                                                                       (live avatar conversation)
```

## Known limitations

1. **Direct TTS still gated** (deferred since Phase H). Brand Voice
   + dub pipeline remains the multilingual delivery path.
2. **Per-character voice preset is permanent on the Runway avatar.**
   Changing the voice requires re-running create-avatar (Runway
   doesn't expose PATCH for avatar voice). The frontend doesn't
   warn about this yet — K.5 polish.
3. **No personality editor in V1.** The personality field is
   captured at create time but not editable afterwards. K.5 adds
   PATCH support.
4. **Each `create-avatar` produces a fresh Runway avatar resource.**
   Frequent recreations accumulate on the account. K.5's
   `replace-avatar` route should DELETE the old one first.
5. **No "use this campaign's reference image as the character
   portrait" affordance yet.** The user has to type the subject +
   style themselves. A small affordance ("Create Character from
   this Campaign") on the gallery card is K.5 territory.
6. **Mock thumbnail = mock portrait.** When a character is attached
   in mock mode, the avatar thumbnail is just the cached stdlib
   PNG. That's sufficient for UI verification but doesn't preview
   what the real Runway-processed thumbnail would look like.

## Merge recommendation

**GO** on merging Phase K into `main`. Strictly additive — every
existing flow keeps working unchanged when no character is
attached. Mock + real both verified end-to-end. Backend + frontend
build clean. Playwright passes.

Recommended commands when ready:

```bash
git checkout main
git merge --ff-only feature/pr-k-character-studio-v1
git tag -a hackathon-submission-v5 -m "AdSpark Studio — v4 + Character Studio V1"
git push origin main
git push origin feature/pr-k-character-studio-v1
git push origin hackathon-submission-v5
```

The existing `hackathon-submission-v4` tag stays at `89918c3` as
the canonical pre-Character-Studio product baseline.

## What NOT to build next without explicit approval

- K.5 polish: PATCH character (rename, change voice, edit
  personality), `replace-avatar` route (DELETE old + create new),
  "Create Character from this Campaign" gallery affordance.
- Phase L: character-driven campaign generation — start a campaign
  pre-attached to a character; use the character image as the
  reference image for video generation.
- Phase M: character pack export/import + marketplace.
- Auth, multi-user, public deploy.
- Audio mixing, smart-framing, webcam toggle on realtime.

## Reference docs

- `docs/research/CHARACTER_STUDIO_SPIKE.md` — locked V1 design.
- `docs/research/RUNWAY_API_CAPABILITY_MAP.md` — endpoint
  reference + Phase H/I findings.
- `docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` — original avatar
  schema probe.
- `docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` —
  realtime schema probe.
- `docs/handoffs/SESSION_007_REALTIME_AND_PICKER.md` — previous
  session.
