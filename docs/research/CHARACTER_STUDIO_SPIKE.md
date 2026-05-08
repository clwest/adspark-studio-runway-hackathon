# Character Studio Spike

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-k-character-studio-spike`
**Status:** RESEARCH ONLY — one short live probe, no product code,
no media committed. Recommends a Phase K V1 build to follow.

> **2026-05-08 update — Phase K V1 shipped.** This research document
> remains the locked design reference; the V1 implementation tracks
> §§4–9 exactly. Real-mode hero-run on `Brewster the Bear` (mascot,
> voice `max`) confirmed the full pipeline:
> portrait `gen4_image_turbo` (14 s) → `/v1/avatars` (34 s, READY,
> avatar id `f00b39e2-e8b5-4a8a-91d5-eca4ab57c4a8`) → attach to
> campaign → Avatar Host Clip uses character avatar via the
> `character > selected > host` resolution chain.
>
> Tagged on origin as `hackathon-submission-v5` (`0cddb96`).
> See `docs/handoffs/SESSION_008_CHARACTER_STUDIO.md` and
> `docs/handoffs/SESSION_009_CHARACTER_STUDIO_FINAL.md` for the
> implementation + docs-refresh handoffs.

> Two prior research notes are direct prerequisites:
> `RUNWAY_CHARACTER_HOST_SPIKE.md` (PR F avatar create + avatar_videos
> schema), `RUNWAY_API_CAPABILITY_MAP.md` Appendix D (Phase H/I locked
> findings).  This document builds on both — it does not re-cover their
> ground.

---

## 1. Executive Summary

**Build it. The Donk manual proof + this session's targeted probe
both confirm the entire AI-character-to-Runway-Avatar pipeline works
without a human in the loop.** AdSpark already has every primitive
on hand (`gen4_image_turbo` for portrait synthesis, `/v1/avatars` for
identity creation, the Avatar Picker for reuse, the realtime broker
for live conversation). What's missing is a **first-class
"Character" record** that's separate from any single campaign and
can be reused across campaigns, host clips, and realtime sessions.

**Safest V1 (Phase K)**: a `Characters` resource living in the same
local JSON store as campaigns. Three routes:
`POST /api/characters/generate-portrait`,
`POST /api/characters/{id}/create-avatar`,
`POST /api/campaigns/{id}/attach-character`. New
`backend/data/characters/` cache directory (gitignored). New
`Character Studio` panel in the frontend; campaign cards gain an
"Attach Character" affordance that wires the picker selection to
the character. **No new external dependencies.**

**Biggest risk**: prompt-template drift. Stylised mascot images are
a small target — too cartoony and Runway's avatar processor rejects
them; too photoreal and they look uncanny in motion. The **prompt
template is the load-bearing piece of this feature**; we lock four
or five known-good shapes (Donk-style mascot, raccoon-barista-style
mascot, real-photo founder, etc.) and let the user choose, rather
than pretending arbitrary prompts will work.

**Why this matters commercially**: today AdSpark sells "AI ads with
a spokesperson per campaign." Character Studio shifts the framing
to **"AI ads + reusable brand characters."** Characters become the
durable IP — they outlive any single campaign, can be ported across
multiple ads, can be marketed standalone, can become the basis of a
character-pack marketplace later. That is the difference between an
ad-generation tool (commodity, ~$30/mo) and a brand-asset platform
(durable, $99–499/mo).

---

## 2. Manual Proof (Donk)

The user manually generated a stylised donkey-poker character image
("Donk"), uploaded/created it as a Runway Avatar via the Runway
dashboard, and confirmed the resulting avatar:

- has `status: READY` in `GET /v1/avatars`
- has a `processedImageUri` thumbnail
- voice preset `Max` (assigned in the dashboard)
- is selectable from AdSpark's Avatar Picker without any code
  change — the picker reads `GET /v1/avatars` directly, so any
  account-side avatar appears automatically

**Implication**: stylised, non-human, non-photoreal characters
**do** pass Runway's avatar processor.  The "must contain a
recognisable face" rule is generous — animal mascots, illustrated
characters, and brand mascots qualify as long as the face/eyes/mouth
are visible and front-facing. This validates the entire Character
Studio thesis: AdSpark can generate a brand mascot, turn it into a
Runway Avatar, and reuse it across the existing host-clip + realtime
pipeline.

No image of Donk is committed — the cached avatar id is the
record-keeping; the Runway-side `processedImageUri` is the visual.

---

## 3. Runway Avatar Requirements (probe-confirmed)

### Existing knowledge (from PR F V2 + PR I+ probes)

- `POST /v1/avatars` body shape:
  ```jsonc
  {
    "name": "...",
    "referenceImage": "<URL or data: URI>",
    "voice": { "type": "runway-live-preset", "presetId": "<lowercase>" },
    "personality": "..."
  }
  ```
- 30 universal voice presets (validator-dumped, see PR F V2 spike).
- `referenceImage` accepts URL or data URI — strict size limits
  (≤5 MB data URI, ≤16 MB URL fetch — reuses the assets/inputs cap).
- Avatar processing PROCESSING → READY in ~30–45 s.
- Failure mode: `status: "FAILED"` with no detail when the image
  doesn't have a recognisable face. Examples we hit:
  - Flat charcoal placeholder PNG → FAILED
  - Coffee-shop scene without people → FAILED
  - Faceless landscape → FAILED

### New probe (this session, ~5 credits, full pipeline)

A targeted end-to-end run was executed to confirm the
`gen4_image_turbo` → `/v1/avatars` happy path **inside AdSpark**
(i.e. no human-in-the-loop image curation):

1. **Portrait generation** via `POST /v1/text_to_image`
   - model: `gen4_image_turbo`
   - ratio: `1280:720`
   - prompt:
     > "Studio portrait of a friendly raccoon barista mascot.
     > Front-facing, head-and-shoulders crop. Expressive eyes, soft
     > warm smile. Simple solid mid-grey background. Soft three-point
     > studio lighting. Photorealistic stylised plush texture.
     > Centered composition. No props or sunglasses."
   - SUCCEEDED in ~12 s. Output URL on `dnznrvs05pmza.cloudfront.net`.

2. **Avatar creation** via `POST /v1/avatars` with the generated
   image as `referenceImage`
   - voice preset: `ruby`
   - personality: short coffee-mascot description
   - PROCESSING → READY in ~35 s
   - `processedImageUri` populated

3. **Result avatar id**: `171089eb-1118-4632-b218-2dba88d31349`
   (now visible in the AdSpark Avatar Picker; can be cleaned up
   later via `DELETE /v1/avatars/{id}` once Phase K UI exists).

**Confirms**:

- `gen4_image_turbo` *can* produce face-bearing portraits when
  prompted correctly.
- The output image (a presigned CloudFront URL) can be passed
  **directly** as `referenceImage` to `/v1/avatars` — no need to
  download + re-upload.
- Stylised non-human mascots pass the face check when the prompt
  enforces front-facing, eyes, and mouth visibility.
- **Total spend per character: ~5 credits + 30–45 s wall-clock.**

### Failure modes (probe + prior session findings)

| Image trait | Avatar processing |
|---|---|
| Faceless scene (e.g. coffee shop interior) | ✗ FAILED ("no recognisable face") |
| Flat colour PNG | ✗ FAILED |
| Front-facing photo of a person | ✓ READY |
| Side-profile or back-of-head | ⚠ untested but expected to fail |
| Stylised mascot with visible face/eyes (Donk, raccoon barista) | ✓ READY |
| Sunglasses covering eyes | ⚠ untested (intentionally avoided in V1 prompt template) |
| Multiple people in frame | ⚠ untested (could pick wrong face) |
| Full-body | ⚠ untested (likely processes head crop only) |

### Cost / time expectations

| Operation | Wall-clock | Credits |
|---|---|---|
| `gen4_image_turbo` portrait | ~10–15 s | ~3 |
| `/v1/avatars` create + processing | ~30–45 s | ~2 (per probe — billing model unclear) |
| Total per character | **~50 s** | **~5** |

A typical user creating 3 brand characters on signup spends ~15
credits + ~3 minutes total. Acceptable onboarding cost.

---

## 4. Proposed Data Model

### `Character` (new resource)

Stored in `backend/data/characters.json` mirroring the campaign-store
pattern. Single-process JSON, threading.Lock-guarded.

```python
class Character(BaseModel):
    id: str                              # 12-char uuid hex
    slug: str                            # lowercase-hyphen, derived from name
    name: str                            # human-readable display name
    personality: Optional[str] = None    # text prompt for avatar/realtime persona
    voice_preset: str = "vincent"        # one of 30 SUPPORTED_VOICE_PRESETS
    catchphrases: list[str] = []         # short brand catchphrase pool

    # Portrait — local cache lives at backend/data/characters/<id>-portrait.png
    portrait_url: Optional[str] = None   # /api/characters/{id}/portrait local route
    portrait_source: Literal["generated", "uploaded", "stock"] = "stock"
    portrait_prompt: Optional[str] = None  # archived for debugging / re-gen

    # Runway avatar binding
    runway_avatar_id: Optional[str] = None
    runway_avatar_status: Optional[Literal["pending", "ready", "failed", "mock"]] = None
    runway_avatar_thumbnail_url: Optional[str] = None  # processedImageUri
    runway_avatar_error: Optional[str] = None

    # Provenance
    source_campaign_id: Optional[str] = None  # if created from a campaign's flow
    mock_mode: Optional[bool] = None
    metadata: dict = {}                  # forward-compat

    created_at: datetime
    updated_at: datetime
```

### `Campaign` additions

```python
character_id: Optional[str] = None        # foreign key into characters.json
generated_character_prompt: Optional[str] = None  # cached prompt used to generate
```

`selected_avatar_id` is left in place as a **fallback** for campaigns
that picked an avatar directly. Resolution order for downstream
features (Avatar Host Clip, Realtime Spokesperson):

```
character.runway_avatar_id  >  selected_avatar_id  >  host_avatar_id
```

This way, attaching a character is a one-click upgrade — the
character's avatar takes over without breaking existing references.

### Cache directories

```
backend/data/
  characters/
    <id>-portrait.png         (generated portrait, gitignored)
    <id>-avatar-thumb.jpg     (cached Runway processedImageUri, gitignored)
```

`backend/.gitignore` already covers `data/` so no new ignore rules
needed.

---

## 5. Proposed API Routes

### Phase K V1 (ship these now)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/characters` | List all characters with curated safe view |
| `POST` | `/api/characters` | Create a Character record (no portrait yet) — `{name, personality?, voice_preset?, catchphrases?}` |
| `POST` | `/api/characters/{id}/generate-portrait` | Generate portrait via `gen4_image_turbo` using a prompt template; cache locally |
| `POST` | `/api/characters/{id}/create-avatar` | Bind to Runway via `POST /v1/avatars` with the cached portrait |
| `GET`  | `/api/characters/{id}/portrait` | Stream the cached portrait PNG |
| `POST` | `/api/campaigns/{id}/attach-character` | Set `character_id` on a campaign |
| `DELETE` | `/api/characters/{id}` | Local delete; optionally `?cascade=runway` to also `DELETE /v1/avatars/{id}` |

### Phase K.5 (after V1 stabilises)

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/characters/{id}` | Update name / personality / voice_preset / catchphrases |
| `POST` | `/api/characters/{id}/regenerate-portrait` | Re-run portrait gen with a different prompt |
| `POST` | `/api/characters/{id}/replace-avatar` | DELETE old avatar + recreate with current portrait |

### Phase L (later — character-driven campaigns)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/characters/{id}/avatar-video` | Direct host clip without going through a campaign |
| `POST` | `/api/characters/{id}/realtime-session` | Direct realtime conversation without going through a campaign |
| `POST` | `/api/campaigns?character_id=...` | Pre-attach character at campaign creation |

### Phase M (post-MVP)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/characters/import` | Accept a portrait upload (no portrait gen step) |
| `GET`  | `/api/characters/{id}/export` | Bundle character + cached assets as a zip |
| `POST` | `/api/characters/{id}/share` | Marketplace publish (post-MVP, requires auth) |

---

## 6. Proposed Frontend UX

### V1 — new Character Studio panel

A new top-level surface at `/characters` (or rendered inline above
the saved-campaigns gallery if we keep AdSpark single-page). Three
states:

**Empty state** (no characters yet):
```
┌─ Character Studio ───────────────────────────────────────────────┐
│ Build a reusable AI brand character. Generate the portrait,      │
│ create a Runway Avatar, then reuse the same character across     │
│ multiple campaigns and host clips.                               │
│                                                                  │
│ [Create your first character]                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Library state** (1+ characters):
```
┌─ Character Studio ───────────────────  [+ Create Character] ────┐
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                            │
│  │ <thumb> │ │ <thumb> │ │ <thumb> │                            │
│  │ Donk    │ │ Raccoon │ │ Founder │                            │
│  │ Max     │ │ Ruby    │ │ Vincent │                            │
│  │ [Use]   │ │ [Use]   │ │ [Use]   │                            │
│  └─────────┘ └─────────┘ └─────────┘                            │
└──────────────────────────────────────────────────────────────────┘
```

**Create flow** (modal or inline):
```
1. Name your character          [_______________]
2. Personality (optional)       [_______________]
3. Voice preset                 [vincent ▾]   (30 options)
4. Portrait template            [Mascot ▾]    (Mascot / Founder /
                                               Coach / Local guide /
                                               Custom prompt)
5. [Generate Portrait]          → ~12 s, inline preview
6. [Create Runway Avatar]       → ~35 s, status pill + thumbnail
7. [Save Character]             → record persisted, picker updates
```

### Campaign card integration

The existing Brand Spokesperson section gains a fourth entry above
the Avatar Picker:

```
┌─ Brand Spokesperson · Runway Avatar  [selected · ready] ─────────┐
│                                                                  │
│ ── Use Character                                                 │
│   Currently attached: <thumb> Donk · Max voice                   │
│   [Change Character]    [Detach]                                 │
│                                                                  │
│ ── Choose Existing Runway Avatar                                 │
│   (existing 4-up picker grid, only shown if no character is      │
│    attached — character takes precedence)                        │
│                                                                  │
│ ── Or Create Custom Brand Spokesperson                           │
│   (existing per-campaign create flow, only when no character     │
│    + no picker selection)                                        │
└──────────────────────────────────────────────────────────────────┘
```

Empty state ("no character attached") includes a small affordance:

> Create a reusable Character from this campaign's reference image.
> [Create Character from this Campaign →]

That click reuses the campaign's existing reference image as the
character portrait, skipping the separate portrait-gen step. The
character then appears in Character Studio for reuse on future
campaigns.

---

## 7. Prompting Strategy

The single load-bearing piece of Phase K. Generic
"generate a portrait of X" prompts produce inconsistent output that
fails Runway's face check. We lock four named templates the user
picks from, plus one "Custom prompt" escape hatch.

### Hard rules baked into every template

```
- Front-facing, head-and-shoulders crop only
- Eyes visible (open, alert)
- Mouth visible (closed-mouth or soft-smile, not laughing)
- Clean solid-colour background (mid-grey, off-white, or muted)
- Soft three-point studio lighting
- Centered composition
- No props, no sunglasses, no hats covering forehead
- Single subject only
- 3:4 or 16:9 framing (we use 1280:720 for predictable face crop)
```

### Templates

```python
PORTRAIT_TEMPLATES = {
    "mascot": (
        "Studio portrait of {subject}. {style}. "
        "Front-facing, head-and-shoulders crop. Expressive eyes, "
        "soft warm smile. Simple solid mid-grey background. Soft "
        "three-point studio lighting. Centered composition. No "
        "props or sunglasses."
    ),
    "founder": (
        "Friendly studio portrait of {subject}, head-and-shoulders. "
        "Direct eye contact. Soft natural smile. Clean off-white "
        "background. Warm soft lighting. Photorealistic. Modern "
        "founder aesthetic. No props or sunglasses."
    ),
    "coach": (
        "Energetic studio portrait of {subject}. Head-and-shoulders. "
        "Confident posture, bright expression, open mouth mid-speech. "
        "Solid muted-blue background. Crisp directional lighting. "
        "Athletic-coach aesthetic. No props or sunglasses."
    ),
    "local_guide": (
        "Warm portrait of {subject} in a small-business setting. "
        "Head-and-shoulders, front-facing. Welcoming smile. "
        "Soft-blurred neutral background suggesting indoors. "
        "Natural daylight. Approachable neighborly aesthetic. "
        "No props or sunglasses."
    ),
}
```

`{subject}` and `{style}` are user-supplied. For mascots the
critical user input is `subject = "a friendly raccoon barista
mascot"` and `style = "Photorealistic stylised plush texture"` —
the rest of the prompt does the heavy lifting. The Donk probe
demonstrates this works.

### Validation

Phase K does **not** ship a face-detection precheck. The Runway
processor is the source of truth — if it returns FAILED, the UI
surfaces the failure and offers a "Re-generate portrait" button
that re-runs `gen4_image_turbo` with a slightly varied seed. K.5
can add ffmpeg-based face detection if false-rejection rates are
high.

---

## 8. Mock Strategy

`runway_mock=True` should produce a complete Character Studio UX
without a single Runway call:

| Surface | Mock behaviour |
|---|---|
| `POST /api/characters/{id}/generate-portrait` | stdlib zlib PNG with deterministic colour from `sha256(prompt)` — same primitive used by `image_client._generate_mock` |
| `POST /api/characters/{id}/create-avatar` | synthetic READY avatar id + same stdlib PNG as the avatar thumbnail |
| `GET /api/characters/{id}/portrait` | streams the cached mock PNG |
| Character library list | shows whatever the user creates locally; survives reload |
| Avatar Picker integration | character's `runway_avatar_id` shows up in the picker because mock characters write to the same `selected_avatar_id`-resolution chain |
| Realtime | already returns 503 in mock mode — characters don't change that |

**No new mock infrastructure needed** beyond what PR F + PR H
shipped. Phase K mock = "stdlib PNG everywhere it would be a
generated image."

---

## 9. Implementation Plan

### Phase K — Character Studio V1

**Goal**: ship the Character resource + portrait gen + avatar bind +
campaign attach flow. No personality editor yet, no character-driven
campaign generation.

**Backend changes**:

- New `services/character_store.py` — JSON-file character store
  mirroring `storage.CampaignStore` shape; uses
  `backend/data/characters.json`.
- New `services/character_studio_client.py` —
  `generate_portrait(character, settings, template, subject,
  style)` and `create_avatar(character, settings)` with mock
  fallbacks. Reuses primitives from `image_client.py` and
  `character_host_client.py` — adds no new external dependencies.
- New `routers/characters.py` — 7 routes from §5 V1.
- `routers/campaigns.py` — add `POST /api/campaigns/{id}/attach-character`
  + extend `Campaign` model with `character_id`.
- `services/character_host_client.active_avatar_id` — resolution
  order updated to prefer `character.runway_avatar_id` when a
  campaign has an attached character.
- `services/realtime_avatar_client.create_session` — same.
- `models.py` — `Character` Pydantic schema.

**Frontend changes**:

- New `src/components/CharacterStudio.jsx` — library grid + create
  flow (probably a modal initially; can move to a dedicated tab in
  K.5).
- New `src/components/CharacterCard.jsx` — single character tile
  used in the library + campaign attach picker.
- New helpers in `src/api.js`: `listCharacters`,
  `createCharacter`, `generateCharacterPortrait`,
  `createCharacterAvatar`, `attachCharacter`.
- `src/components/CampaignGallery.jsx` — "Use Character" subsection
  above the Avatar Picker; "Selected Character" pill replaces
  "Selected Runway Avatar" pill when a character is attached.
- `src/App.jsx` — render `CharacterStudio` above the saved-campaigns
  gallery (still single-page; tab nav only if K.5 adds it).

**Mock strategy**: stdlib zlib PNG everywhere.

**Verification**:

- Mock end-to-end via curl: create → generate-portrait →
  create-avatar → attach-character → present-campaign uses the
  character's avatar.
- Real hero-run: one character end-to-end on a fresh campaign;
  ffprobe the resulting host clip to confirm it uses the new
  character's face/voice.
- Playwright smoke: assert Character Studio panel renders + Create
  button visible.

**Estimated risk**: low. Strictly additive to PR-A-through-I+
surfaces. Existing campaign flow keeps working when no character is
attached. ~1–1.5 days of focused work (~600 LOC backend + ~400 LOC
frontend).

### Phase K.5 — polish

- **Personality editor** — text area for the `personality` field;
  stored per-character; passed through to avatar create + realtime
  session.
- **Voice preset picker** — dropdown of all 30 voice presets with a
  preview button (uses `/v1/voices/preview`).
- **Character library thumbnails** — cache the
  `processedImageUri` locally so the grid renders without
  re-fetching CloudFront URLs that may expire.

### Phase L — character-driven campaigns

- **Pre-attach character at campaign creation** — start a new
  campaign already bound to a character. The campaign's reference
  image generation + video generation can use the character as a
  visual anchor.
- **Direct avatar-video and realtime-session routes** that don't
  require a campaign — `POST /api/characters/{id}/avatar-video`
  with a free-form script.

### Phase M — character pack marketplace

- **Export** — bundle character + cached assets + JSON manifest as
  a zip the user can download or share.
- **Import** — accept an exported zip on a new account.
- Marketplace + shared character library (requires auth, payments,
  and a shared store — out of hackathon scope).

---

## 10. Risks / No-Go Areas

### Hard "do not do in V1"

- **No auth / database rewrite.** Local JSON storage stays. A real
  multi-user Character Studio is a Phase M concern.
- **No marketplace yet.** Export/import in Phase M; sharing is
  Phase M+1.
- **No public upload hosting.** Portraits are either generated by
  AdSpark or pasted as a URL. File-upload UI is post-Phase-K.
- **No automatic repeated avatar creation that spends credits.**
  Each `create-avatar` is an explicit user click. The
  `regenerate-portrait` route can fire `gen4_image_turbo`
  automatically (cheap), but `create-avatar` always requires a
  click.
- **No claims about AI-generated character likeness.** The UI
  copy stays neutral ("Reusable AI brand character") and never
  claims a character resembles a real person — even when the user
  asks for "founder" portraits, those are AI-generated likenesses,
  not the user's actual face.
- **No replacing the existing campaign flow.** Character Studio is
  strictly additive; campaigns without a character keep working
  exactly as today.
- **No coupling to `unified-donkey-betz`.** Same hard rule across
  every PR.

### Soft cautions

- **Prompt drift**: if Runway tunes `gen4_image_turbo` differently
  in the future, our prompt templates may produce face-rejection
  failures. Worth running the probe again before Phase K ships.
- **Character ID space pollution**: every `create-avatar` creates a
  new Runway resource. Without DELETE-on-replace, a frequently
  re-tuning user could accumulate dozens of orphan avatars on their
  account. Phase K.5's `replace-avatar` route should DELETE the old
  one.
- **Voice preset assignment is permanent on the avatar.** Changing
  a character's voice preset post-create requires recreating the
  avatar (Runway doesn't expose a PATCH for voice on avatars per
  PR F probe). The personality editor docs should warn about this.

---

## 11. Recommendation

> **GO on Phase K V1 immediately after this spike commits.**

**Why now**:

1. The Donk manual proof + the raccoon-barista probe both confirm
   the pipeline works. No technical unknowns remain.
2. Every primitive (`gen4_image_turbo`, `/v1/avatars`, picker
   selection, host-clip + realtime gating) already exists. Phase K
   is structural plumbing + UX, not new external integrations.
3. The commercial framing shift ("AI ad generator" → "AI character
   studio") meaningfully changes the product story for the recorded
   demo. It justifies the v4 → v5 tag bump.
4. Cost is bounded: ~600 + ~400 LOC, ~1–1.5 days of focused work,
   no new dependencies.
5. Mock-mode story remains intact — Playwright keeps passing
   without touching Runway.

**Why not**:

The only "don't ship" argument is "we already have the picker, so
characters are slight overkill." Counter: the picker + per-campaign
custom-create flow forces every user to re-create avatars per
campaign or hand-curate via the Runway dashboard (which is what we
just had to do for Donk). Character Studio makes that workflow
**part of the product** rather than a manual side-trip.

### Exact next implementation prompt

If approving Phase K next, the prompt to give a future session is:

> **AdSpark Studio — Phase K: Character Studio V1.** Build on
> `main` at `7505223`. Branch:
> `feature/pr-k-character-studio-v1`. Implement the locked design
> in `docs/research/CHARACTER_STUDIO_SPIKE.md` §§4–9. Specifically:
>
> - Add `Character` Pydantic model + `services/character_store.py`
>   (JSON-file store at `backend/data/characters.json`,
>   threading.Lock-guarded, mirrors `CampaignStore`).
> - Add `services/character_studio_client.py` with
>   `generate_portrait()` and `create_avatar()` reusing
>   `image_client._generate_real` + `character_host_client`
>   primitives. Mock fallbacks via the existing stdlib zlib PNG
>   helper.
> - Add `routers/characters.py` with the 7 V1 routes from §5 plus
>   `GET /api/characters/{id}/portrait` (FileResponse).
> - Add `POST /api/campaigns/{id}/attach-character` to
>   `routers/campaigns.py`. Extend `Campaign` with `character_id`
>   (Optional[str]).
> - Update `character_host_client.active_avatar_id()` and
>   `realtime_avatar_client.create_session()` resolution order
>   so character.runway_avatar_id wins.
> - Frontend: new `CharacterStudio.jsx` panel above the
>   saved-campaigns gallery (single-page, no tab nav yet). New
>   `CharacterCard.jsx` tile component. Update `CampaignGallery.jsx`
>   Brand Spokesperson section to surface "Use Character" before
>   the Avatar Picker grid.
> - Use the four prompt templates from §7 verbatim. Hard-coded
>   subject + style fields in V1; no prompt escape hatch yet
>   (defer to K.5 if requested).
> - Mock strategy from §8: stdlib zlib PNG everywhere a generated
>   image would appear.
> - Verification: mock end-to-end via curl, Playwright smoke
>   asserts the new panel + Create button render, one real
>   hero-run creating a fresh character + binding to a fresh
>   campaign + recording a host clip with the new character. ~5
>   credits per character; tag a `hackathon-submission-v5` only
>   after the manual real verification passes.
> - Hard guardrails from §10 V1 list. No auth, no marketplace, no
>   uploads, no `unified-donkey-betz` runtime references.
>
> Existing PR-A-through-I+ flows must remain unchanged when no
> character is attached. Single feature commit if clean. Holds
> off main merge until user approval.

For Phase K.5 / L / M the same shape applies — see §9 for endpoint
lists, backend/frontend diffs, and verification scope.

---

## Appendix A — Probe artifacts

This spike's one live probe spent ~5 credits and left two
new resources on the Runway account:

| Resource | Id | Status | Notes |
|---|---|---|---|
| `text_to_image` task | `068c01a2-bfa8-415a-8650-3e22183cd023` | SUCCEEDED | Prompt + output URL recorded above |
| `/v1/avatars` | `171089eb-1118-4632-b218-2dba88d31349` | READY | Visible in the Avatar Picker as "Character Studio Probe — Raccoon Barista". Voice preset `ruby`. |

The probe avatar can be cleaned up via `DELETE /v1/avatars/171089eb-1118-4632-b218-2dba88d31349`
once Phase K ships its own delete affordance, or sooner via direct
API call. Leaving it in place for now serves as a free fifth
distinct entry in the picker for the demo recording.

No image bytes are committed. No `RUNWAY_API_KEY` literals in this
document.

---

## Appendix B — Sources

- Probe transcripts in this session.
- `docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md` (PR F V2).
- `docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md` (PR I).
- `docs/research/RUNWAY_API_CAPABILITY_MAP.md` Appendices C + D
  (PR H + I + Avatar Picker).
- The user's Donk manual creation in the Runway dashboard.

No `unified-donkey-betz` runtime references introduced.
