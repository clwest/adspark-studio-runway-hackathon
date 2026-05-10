# SESSION 072 — PR CP Restore Delete Spokesperson + Audit Portrait/Avatar Endpoints

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CP patch in flight on top of
`b0d4bf2` `feat: repair demo data + portraits + stats
accuracy (PR CO)`; commit + push pending after this
handoff lands)

**Why this slice ran:** the PR CO portraits looked rough
on at least one persona, the operator had no
discoverable Delete affordance in the v2 workspace
(only a tiny 9-px `delete` link buried in the legacy
CharacterCard footer), and there was confusion about
whether `generate-portrait` and `create-avatar` were
firing the right Runway endpoints. PR CP gives the
operator delete control + a clear copy distinction
between still portraits and Runway avatars, then
audits the underlying endpoints so future polish slices
have a clean reference.

## Endpoint inventory

PR CP adds **no new routes**. Backend route count remains
**71**. Frontend-only slice + a docs audit.

## Part 1 — Restore Delete Spokesperson

### Problem

After PR CM stripped the homepage tile down to a single
browse-to-open surface, every per-character action moved
inside the workspace at `/spokespeople/:id`. The
embedded `<CharacterCard>` in the Identity tab still
carries a tiny `delete` link in its action footer
(rendered at `text-[9px] text-zinc-500`) — but at
9-pixel zinc-on-black it's effectively invisible.
SESSION 070 manual QA flagged the lack of a
discoverable Delete as a P1 polish item; users
couldn't confidently clean up demo records before
re-running fixtures.

### Solution

New `<DangerZone>` section in the Identity tab below
the embedded `<CharacterCard>`. Two-step UX:

1. Initial state: a rose-themed card titled **"Danger
   zone"** with explanation copy and a primary
   **`Delete spokesperson`** button (testid
   `spokesperson-workspace-delete`).
2. Click → the button is replaced by an inline
   confirmation block (testid
   `spokesperson-workspace-delete-confirm`):
   - copy: "Type `<spokesperson name>` to confirm. (N
     linked campaigns will be unlinked.)" — count
     scoped to live linked campaigns only, mirroring
     PR CO's filter.
   - text input (testid
     `spokesperson-workspace-delete-name-input`) where
     the operator types the exact name.
   - **`Delete`** button (testid
     `spokesperson-workspace-delete-confirm-button`)
     that stays disabled (`data-armed="false"`) until
     the typed text matches the spokesperson name
     exactly. While busy, label flips to "Deleting…".
   - **`Cancel`** button (testid
     `spokesperson-workspace-delete-cancel`) collapses
     the zone back to the initial state without
     touching anything.
3. Confirm fires the existing
   `SpokespersonWorkspace.handleDelete(c)` (PR CC) which:
   - `window.confirm(...)` (kept as a final safety net;
     the typed-name guard is the discoverable layer)
   - `await api.deleteCharacter(c.id)` →
     `DELETE /api/characters/{id}` (existing route)
   - `navigate('/', { replace: true })` on success
   - inline error banner via `friendlyError(...)` on
     failure (no navigation, no double-fire)

### Explicit copy

The danger-zone explanation reads:

> Delete this spokesperson record. Linked campaigns
> stay in place but become unlinked (orphaned) — you
> can re-link them via a fresh spokesperson with the
> same name. Generated portraits / avatars / voice
> clones on Runway are **not** removed by this action
> — clean those up via the Runway dashboard if needed.

This sets correct expectations:

- **Local delete only.** The Character record + its
  per-character `data/characters/{id}-portrait.png` are
  removed by `CharacterStore.delete`.
- **Campaigns survive.** Campaigns hold a
  `character_id` foreign key but `Campaign` rows are
  not cascade-deleted. After delete, the campaign rows
  with the now-dead character_id become orphaned —
  exactly the failure mode that produced PR CO's
  recovery script. The danger-zone copy warns about
  this and the linked-campaign count is shown.
- **Runway avatar + voice clones survive.** No
  outbound Runway API call fires. Operator must clean
  up via Runway's own dashboard if they care.

### What did NOT change

- The legacy CharacterCard `delete` footer link is
  preserved untouched (it's still used by
  `/legacy/CharacterStudio` and any v1 surface).
- The actual delete API call + `handleDelete`
  navigation pattern (PR CC).
- No bulk-delete affordance on the homepage tiles —
  per the brief's "Workspace delete is enough."
- Backend untouched; route count stays at **71**.

### Smoke coverage

Added in `tests/adspark-smoke.spec.js` Test 2 (`@ /`)
right after the Identity-tab visibility assertion. The
smoke walks the danger-zone state machine **without
deleting** the canonical Brewster Bolt fixture:

```js
const dangerZone = page.getByTestId('spokesperson-workspace-danger-zone')
await expect(dangerZone).toBeVisible()
const deleteBtn = page.getByTestId('spokesperson-workspace-delete')
await expect(deleteBtn).toBeVisible()
await deleteBtn.click()
await expect(page.getByTestId('spokesperson-workspace-delete-confirm')).toBeVisible()
const confirmBtn = page.getByTestId('spokesperson-workspace-delete-confirm-button')
await expect(confirmBtn).toHaveAttribute('data-armed', 'false')
await expect(confirmBtn).toBeDisabled()
await page.getByTestId('spokesperson-workspace-delete-name-input').fill('something else entirely')
await expect(confirmBtn).toHaveAttribute('data-armed', 'false')   // mismatch keeps it disarmed
await page.getByTestId('spokesperson-workspace-delete-cancel').click()
await expect(page.getByTestId('spokesperson-workspace-delete-confirm')).toHaveCount(0)
await expect(page.getByTestId('spokesperson-workspace-delete')).toBeVisible()
```

The brief asked specifically that automated tests must
not delete canonical fixtures. The smoke types a
mismatched name and cancels; the confirm button never
arms; nothing is sent to the API.

## Part 2 — Portrait vs Avatar endpoint audit

This is the audit deliverable. **No code paths
changed**; if the audit recommends a refactor, that's
the next slice.

### Frontend → backend → Runway call chain

#### `Generate Portrait`

| Layer | What |
|---|---|
| Frontend handler | `SpokespersonWorkspace.handleGeneratePortrait(c)` (and the legacy `CharacterStudio` path) |
| Frontend helper | `api.generateCharacterPortrait(id, body?)` — `frontend/src/api.js` |
| Backend route | `POST /api/characters/{character_id}/generate-portrait` (`backend/app/routers/characters.py:233`) |
| Body model | `GeneratePortraitBody` — optional `template`, `subject`, `style`, `prompt_override` |
| Service | `character_studio_client.generate_portrait(character, portrait_path, settings, **opts)` (`backend/app/services/character_studio_client.py:283`) |
| **Runway endpoint** | `POST {RUNWAY_API_BASE}/v1/text_to_image` |
| **Runway model** | `gen4_image_turbo` (constant at `_IMAGE_MODEL`) |
| Polling | `GET /v1/tasks/{task_id}` until SUCCEEDED / FAILED / CANCELED, 90 s deadline, 3 s gap |
| Storage | downloaded image streamed atomically to `backend/data/characters/{id}-portrait.png`; size capped at 16 MB |

**Outbound payload to `gen4_image_turbo`** (real-mode):

```json
{
  "model": "gen4_image_turbo",
  "promptText": "<resolved portrait prompt>",
  "ratio": "1280:720",
  "referenceImages": [
    {"uri": "data:image/png;base64,<320×320 charcoal seed>", "tag": "seed"}
  ]
}
```

**Prompt resolution** (`build_prompt`):

- if `prompt_override` is supplied → used verbatim.
  This is the path PR CK's CreateSpokespersonFlow Step 2
  uses (it sends the operator-edited textarea via
  `prompt_override`).
- otherwise → fills the locked
  `PORTRAIT_TEMPLATES[template]` Python f-string with
  `{subject}` + `{style}`. `subject` defaults to
  `character.subject`; `style` to `character.style`.
- Templates exist for all four supported archetypes
  (`mascot` / `founder` / `coach` / `local_guide`) and
  all four bake in the same shape directives — head-and-
  shoulders crop, expressive eyes, soft lighting, neutral
  background, "no props or sunglasses" — so each archetype
  gives Runway a consistent face-checked output.

**Why the seed reference image?** `gen4_image_turbo`
schema requires `referenceImages` to be a non-empty
array. A flat 320×320 charcoal PNG is enough to satisfy
the schema while keeping the prompt as the dominant
signal. Identical trick to the PR T `image_client`
storyboard generator.

#### `Create Avatar`

| Layer | What |
|---|---|
| Frontend handler | `SpokespersonWorkspace.handleCreateAvatar(c)` |
| Frontend helper | `api.createCharacterAvatar(id, body?)` |
| Backend route | `POST /api/characters/{character_id}/create-avatar` |
| Service | `character_studio_client.create_avatar(character, portrait_path, settings, **opts)` (`character_studio_client.py:407`) |
| **Runway endpoint** | `POST {RUNWAY_API_BASE}/v1/avatars` |
| **Runway model** | n/a — `/v1/avatars` is the avatar-creation primitive itself, not a model alias. |
| Polling | `GET /v1/avatars/{avatar_id}` until status `READY` / `FAILED`, 180 s deadline, 5 s gap |
| Storage | persists `host_avatar_id` + `host_avatar_status="ready"` + `host_avatar_thumbnail` (the Runway-processed thumbnail URL or a fallback to the portrait data URI) |

**Outbound payload to `/v1/avatars`** (real-mode):

```json
{
  "name": "<character.name>",
  "referenceImage": "data:image/png;base64,<the ENTIRE portrait PNG, base64>",
  "voice": {
    "type": "runway-live-preset",
    "presetId": "<character.voice_preset>"
  },
  "personality": "<character.personality or default>"
}
```

PR AN added the alternate `voice.type === "custom"`
binding when a Character has a `custom_voice_id` set
(from the in-app voice clone path).

**The portrait IS consumed.** `_portrait_to_data_uri`
reads the cached portrait from
`backend/data/characters/{id}-portrait.png` and inlines
it base64-encoded as `referenceImage`. So:

- portrait quality directly bounds avatar quality
- regenerating the portrait does NOT auto-rebuild the
  avatar — operator must click `Create Avatar` again
- if the portrait file is missing,
  `create_avatar` short-circuits with status `failed`
  + error "portrait must exist before avatar
  creation". Real-mode **never** lets the operator skip
  the portrait step.

### Audit verdict — are the endpoints right?

**Yes. Both endpoints are correctly chosen.**

- **`gen4_image_turbo` for stills.** This is Runway's
  current text-to-image model. It supports
  photorealistic + stylised + anthropomorphic / animal
  prompts (Brewster the Raccoon → READY in ~50 s in the
  PR K spike; Brewster Bolt + Clara Vale + Mina Spark all
  succeeded in PR CO). The model accepts ratio
  `1280:720`, which we use for predictable
  head-and-shoulders crops on Runway's side. There is no
  better still-image generator on Runway's API today
  for this use case.
- **`/v1/avatars` for talking-head identities.** This is
  the canonical avatar-creation primitive. The avatar
  id it returns flows directly into
  `avatar_videos` (PR BP Spokesperson Ad) and the
  realtime `avatar_runtime` SDK. There is no alternate
  route.

The two endpoints model **two distinct concepts** and
they're correctly orthogonal:

| Concept | Route | Drives |
|---|---|---|
| Still face / "the headshot" | `gen4_image_turbo` via `/v1/text_to_image` | Library tile portrait, workspace header portrait, the avatar's `referenceImage` |
| Talking-head identity | `/v1/avatars` | Spokesperson Ad (`avatar_videos`), realtime conversations (`avatar_runtime`), processed thumbnail |

### Why do PR CO portraits look rough then?

The endpoint is correct. The **prompt content** is the
weak link. Two specific issues, both in the seed
fixtures (not the code):

1. **`subject` field is ad-copy, not a visual subject.**
   PR CG seeds Brewster Bolt with subject text:
   ```
   "high-energy brand mascot — kinetic, animated,
    playful shape with bold accent colours. Built for
    fast-cut social ads and reels."
   ```
   That fills the template's `{subject}` slot, so the
   final prompt to `gen4_image_turbo` reads:
   > Studio portrait of high-energy brand mascot —
   > kinetic, animated, playful shape with bold accent
   > colours. Built for fast-cut social ads and reels.
   > vibrant, saturated colour palette …

   `gen4_image_turbo` reads "kinetic", "animated",
   "shape" — abstract direction, no concrete creature
   or pose. Result: the model improvises a humanoid
   silhouette instead of the raccoon-mascot the
   operator expects.

2. **Brewster Bolt's `species` is implied, never
   stated.** Nothing in the seed says "raccoon" —
   that's only encoded in the persona description the
   user wrote when they pictured the character.
   `gen4_image_turbo` has no way to infer.

3. **Rex Roadside upstream-fails consistently.** Same
   `portrait task FAILED: An unexpected error occurred.`
   pattern across PR CI / PR CJ / PR CO. The model is
   correct; the prompt-or-seed combination is the
   issue. The seed `subject`:
   ```
   "dealership / automotive sales spokesperson —
    rugged, approachable, casual flannel-or-polo,
    lot-and-truck backdrops, weather-worn but cared-for
    look."
   ```
   is dense with "lot", "truck", "backdrops", "look" —
   collapsing into prompt soup that Runway's safety or
   model layer rejects.

### Recommended next slice (NOT this one)

**PR CQ — Tighten PR CG seed fixtures + sharpen
PORTRAIT_TEMPLATES.** Two surgical edits:

1. **`scripts/seed-demo-spokespeople.py`** — rewrite
   the `subject` field on each demo persona to a
   concrete visual subject:
   - Brewster Bolt: `"an anthropomorphic raccoon mascot, mid-stride, confident grin, punk-energy streetwear in bold accent colours"`
   - Clara Vale: `"polished founder Clara Vale, mid-30s, neutral blazer, modern office backdrop, direct trustworthy gaze"`
   - Rex Roadside: `"automotive salesperson Rex Roadside, mid-40s, casual flannel, leaning on a Ford F-150 tailgate, warm afternoon light"`
   - Mina Spark: `"creator-style social host Mina Spark, mid-20s, casual streetwear, expressive smile, warm desaturated palette"`

   Plus optionally a `species` field on the seed (the
   `Character` model already supports `metadata` so this
   is non-breaking) so the prompt builder can prepend
   "An anthropomorphic {species}" reliably.

2. **`backend/app/services/character_studio_client.py`
   PORTRAIT_TEMPLATES**: add an explicit subject anchor
   at the start of each template:
   ```py
   "mascot": (
       "Photorealistic studio portrait of a {subject}. "
       "{style}. ..."
   )
   ```
   so `{subject}` lands in the noun position rather than
   getting buried mid-sentence.

3. Run the same 4 portraits via the existing
   `POST /api/characters/{id}/generate-portrait`
   route; confirm 4/4 succeed (or note Rex Roadside as
   a known flake if it fails again). ~5 portraits ×
   ~$0.025 = ~$0.125 in image credits.

PR CQ is **prompt-engineering**, not endpoint
refactoring. We do NOT need to switch Runway models.

## Part 3 — UI clarity

The brief asked us to verify the Identity tab makes the
distinction clear between "Portrait image" (still
visual identity) and "Runway avatar" (talking/realtime
identity).

### Existing copy (preserved)

- Workspace header pills: `avatar · ready` / `avatar ·
  not created` / `avatar · mock` / `avatar · failed` /
  `avatar · pending`. Already speaks the right
  vocabulary.
- Embedded `<CharacterCard>` action labels: `Generate
  Portrait`, `Create Avatar`, `Apply Voice`, `Refresh
  Avatar Voice`, `Refresh Voice Preview`, `Clone Voice`.
  Already distinct.
- Library tile chip strip after PR CM: `voice · {state}
  · {preset}` — the voice-state pill mirrors the avatar
  pill colour code so operators learn the link.

### New copy (PR CP)

The Identity tab section caption was rewritten to
explicitly disambiguate:

```
Identity. Portrait image = the still face used
everywhere (tile + avatar reference). Runway avatar =
the talking/lip-sync identity that drives Spokesperson
Ads and realtime conversations.
```

The two key terms are bolded. The previous caption
referenced PR CC / PR CD as dev jargon and did not
explain what any of it meant.

## Verification

| Check | Result |
|---|---|
| Mock backend booted (smoke) | `bash scripts/start-local-mock.sh`; `runway_mock=true` |
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| `vite build` | 479.72 KB initial / 130.93 KB gzip + 561.97 KB lazy chunk (+3.25 KB initial / +0.65 KB gzip vs PR CO — the new `<DangerZone>` component + smoke testid attrs + clarity caption rewrite) |
| Playwright mock smoke | `3 passed (28.6 s)` — Test 1 (@ /legacy) 25.2 s, Test 2 (@ /) 1.9 s, Test 3 (top-bar round-trip) 712 ms |
| Hygiene scan | empty (no PNG / video committed) |
| Drift guard | `context-kit anchors look recent.` |

**No real Runway calls fired this session.** The
endpoint audit was code-reading + payload inspection
only.

## Files modified this session

- `frontend/src/components/SpokespersonWorkspace.jsx` —
  Identity tab structure (added wrapper + caption
  rewrite + DangerZone mount); new `<DangerZone>`
  component (~115 lines); imports `useState` was
  already present.
- `frontend/tests/adspark-smoke.spec.js` — danger-zone
  walk in Test 2 right after the Identity-tab
  assertion. Smoke does not delete canonical fixtures.
- `docs/INVENTORY.md` — PR CP row + intro re-narration
  + DangerZone testids list.
- `docs/OPERATOR_USAGE_MAP.md` — last-updated stamp.
- `00-START-NEXT-SESSION.md` — head-of-file pointer +
  foundation list + implemented section + build size.
- `docs/handoffs/SESSION_072_DELETE_SPOKESPERSON_AND_ENDPOINT_AUDIT.md`
  (this file, new).

No backend changes. No JSON data committed. No
generated media committed.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

**PR CQ — Sharpen Seed Fixture Subjects + Portrait
Templates** (above). Pure prompt-engineering, ~30 min
of edits + ~$0.125 in image regenerations to confirm
the demo portraits look right. After PR CQ closes the
"portraits look bad" P1, the remaining demo work is
purely the polish list from SESSION 070 (lane button
textContent, h1 whitespace, knowledge/conversations
mini-CTAs).
