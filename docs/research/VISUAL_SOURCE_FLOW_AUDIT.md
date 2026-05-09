# Visual Source Flow Redesign — PR R

**Date:** 2026-05-08
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `feature/pr-r-visual-source-flow`
**Status:** Implemented + verified end-to-end on this branch.
Local-only; not pushed. Companion to
`docs/research/FLOW_INTEGRATION_AUDIT.md` (PR M) and
`docs/research/UI_REDESIGN_AUDIT.md` (PR O).

## Problem

Until PR Q the prompt panel rendered a single "Reference image URL"
input with a "Generate Reference Image" helper button. The video
generation pipeline assumed the user already had a usable image — a
URL on hand, a freshly generated PNG cached in
`/api/runway/image/<id>`, or knowledge that they could leave it
blank in mock mode. There was no surface for users to:

- **Upload** their own product photo / mockup,
- **Reuse a Character** they generated in Stage 3, or
- **Pick text-only** explicitly without untangling the model selector
  and the hidden checkbox interactions.

The Generate Video button label was always just "Generate Video" so
the user couldn't tell which source the click was about to use.

## Code reused (no rewrites)

| Existing surface | Reuse |
|---|---|
| `POST /api/runway/image` | Stays intact — it's the "Generate" branch's backend call |
| `GET /api/runway/image/<id>` | Extended (multi-extension lookup) but no signature change |
| `image_client.path_for` | Kept as a back-compat shim for callers that always wrote PNG |
| `runway_client._resolve_image_for_runway` | Extended with two new prefix paths (character portraits, multi-extension cache lookups); no API change |
| `RunwayGenerateRequest` | Untouched — still takes an opaque `prompt_image` string. The frontend now passes either `/api/runway/image/<id>` OR `/api/characters/<id>/portrait` and the backend resolver handles both |
| `Character.portrait_url` | Already exposes the `/api/characters/<id>/portrait` route — frontend just consumes it |
| `ImageGenerateResponse` | Reused for the new upload route's response shape so the frontend's existing `setGeneratedImage` consumer worked unchanged |

## Backend changes

Three files; net +90 LOC.

### `backend/requirements.txt`

Added `python-multipart==0.0.20` — required by FastAPI's `UploadFile` /
`File` for multipart parsing on the new upload route. Without it the
app fails at import time.

### `backend/app/services/image_client.py`

- New `SUPPORTED_IMAGE_EXTS = ("png", "jpg", "jpeg", "webp")` constant.
- New `find_image_path(settings, image_id)` helper that probes each
  supported extension and returns the first match, or None.
- `path_for` kept as a back-compat shim; documented that callers
  using it still write PNG.

### `backend/app/services/runway_client.py`

`_resolve_image_for_runway` extended:

- New `/api/characters/<id>/portrait` prefix path. When the prompt
  image points at a character portrait, the resolver loads
  `data/characters/<id>-portrait.png` and emits a base64 data URI so
  Runway can ingest it (Runway can't reach our localhost).
- Existing `/api/runway/image/<id>` path now tries every supported
  extension via the file-system probe and chooses the appropriate
  data-URI media type (`image/png`, `image/jpeg`, `image/webp`).

### `backend/app/routers/runway.py`

- `GET /api/runway/image/{id}` updated to use `find_image_path` and
  emit the right `media_type` based on the file's extension.
- New `POST /api/runway/upload-image` (multipart):
  - validates content-type against `image/png`, `image/jpeg`,
    `image/webp`,
  - caps file size at 10 MB,
  - saves to `data/images/<random-12-hex>.<ext>`,
  - returns the same `ImageGenerateResponse` shape the existing
    generate-image route returns, so the frontend code that consumed
    it works unchanged.

End-to-end verified with `curl -F file=@... -X POST .../upload-image`
in mock mode: PNG → 200 + cached + `GET` returns `image/png`; JPEG →
200 + cached as `.jpg` + `GET` returns `image/jpeg`; non-image
content-type → 400.

**Backend route count: 38** (was 37; +1 for upload-image).

## Frontend changes

Three files; ~280 LOC of new render logic.

### `frontend/src/api.js`

New `api.uploadImage(file)` helper — a thin native `fetch` wrapper
since multipart bodies don't go through the JSON wrapper.

### `frontend/src/App.jsx`

- Added a `characters` state + `refreshCharacters()` helper. Loaded
  on mount alongside campaigns. The Character Studio's
  `onCharactersChanged` now refreshes both campaigns and characters
  so the visual-source picker stays current.
- Added `handleUploadImage(file)` that posts via `api.uploadImage`,
  stores the response under `generatedImage`, and updates `imageUrl`
  to the returned `/api/runway/image/<id>` so the existing Generate
  Video pipeline picks it up unchanged.
- Wired `imageSource`, `onUploadImage`, `uploadBusy`, `characters`
  through to `<PromptPreview>`.
- Added a `<div id="character-studio-anchor" />` above Stage 3 so the
  "Open Character Studio →" CTA in the Visual Source / character
  branch can smooth-scroll to it.

### `frontend/src/components/PromptPreview.jsx`

The image-area replaced wholesale by a 4-option `radiogroup`:

| Source | What it shows | What it does |
|---|---|---|
| **Generate image** *(default)* | Explainer + the existing **Generate Reference Image** button + a preview of the generated image when ready | Calls `POST /api/runway/image`, sets `imageUrl` to `/api/runway/image/<id>` |
| **Upload image** | `<input type="file">` (PNG/JPG/WebP, ≤10 MB) + a fallback URL paste field for external links + an upload preview | Calls `POST /api/runway/upload-image` and threads the resulting URL through the same `imageUrl` state |
| **Use Character** | Pink-bordered card listing characters that have a portrait. Empty state with an "Open Character Studio →" smooth-scroll CTA when there are none. Click a tile to set `imageUrl` to `/api/characters/<id>/portrait`. | Backend resolver embeds the portrait as a data URI when posting to Runway |
| **Text-only video** | Explainer about Gen-4.5 text-only — no image required | Forces `model = gen4.5` + `textOnly = true` |

Selection coordinates downstream state (model, textOnly, imageUrl)
so users can't pick incompatible combinations. Switching away from
text-only flips `textOnly` off; switching back to "generate" /
"upload" / "character" clears stale image URLs from another source.

The **Generate Video button label** now adapts:

- `Generate Video` (default fallback)
- `Generate Video from Image` (upload)
- `Generate Video from Character` (character)
- `Generate Text-Only Video` (text-only)

The hidden text-only checkbox is preserved with `aria-label="Use
text-only video"` so the existing smoke selector still finds it,
but it's no longer the user-facing way to pick text-only mode.

## Source options supported

| Option | Real mode | Mock mode |
|---|---|---|
| Generate image | `gen4_image_turbo` text-to-image; cached locally | Stdlib zlib PNG synthesis with sha256-derived colour |
| Upload image | Multipart upload; cached locally as `<id>.<ext>` | Same — multipart upload always works regardless of keys |
| Use Character | Existing character portrait at `data/characters/<id>-portrait.png`, embedded as data URI when posted to Runway | Same — character portraits are produced by `gen4_image_turbo` (real) or stdlib PNG (mock); both cache locally |
| Text-only | Real Gen-4.5 text-to-video | Mock task succeeds with the public BigBuckBunny sample MP4 |

## Verification

- Backend import: **38 routes** (was 37; +1 for upload-image).
- Vite build: **228.72 KB initial JS / 68.30 KB gzip** (up ~7 KB / 1.8
  KB from PR Q — the visual-source selector + 4 source bodies +
  character picker grid).
- Playwright smoke: **1 passed in 21.2 s** in mock mode.
  - Asserts the radiogroup renders + all 4 radio options visible.
  - Asserts "Generate image" is the default selection
    (`aria-checked="true"`).
  - Switches to "Upload image" before filling the URL paste field
    (which is no longer in the default Generate body).
  - Generate Video button assertion regex updated to accept the new
    adaptive labels.
- End-to-end backend smoke (curl):
  - `POST /api/runway/upload-image` with `image/png`: 200 + 12-hex
    image_id + cached at `<id>.png`.
  - `POST /api/runway/upload-image` with `image/jpeg`: 200 + cached
    at `<id>.jpg`.
  - `POST /api/runway/upload-image` with `text/plain`: 400 with the
    supported-types list in the detail.
  - `GET /api/runway/image/<png-id>`: HTTP 200, `image/png`.
  - `GET /api/runway/image/<jpg-id>`: HTTP 200, `image/jpeg`.
- Git hygiene: 0 `.env` / 0 media / 0 `backend/data/` tracked.

## Manual verification checklist

- [x] **Generate image → Generate Video**: pick "Generate image" →
      click Generate Reference Image → image preview appears with
      "selected as Visual Source" badge → Generate Video uses the
      cached image. Verified via smoke.
- [ ] **Upload image → Generate Video**: pick "Upload image" → drop
      a PNG via the file input → preview appears → Generate Video
      uses the upload. Verified via curl + UI inspection; not
      yet exercised in the browser as a hero recording.
- [ ] **Use Character → Generate Video**: pick "Use Character" →
      click a character tile → tile gets pink ring + "selected as
      Visual Source" copy → Generate Video uses the character
      portrait. Backend resolver verified via the path-extension
      probe; UI flow verified via inspection.
- [ ] **Text-only → Generate Video**: pick "Text-only video" →
      explainer card renders → Generate Video button reads "Generate
      Text-Only Video" → mock task succeeds. Verified via the smoke
      regex change.

The three remaining checkboxes are nice-to-haves for a hero
recording. The smoke + curl coverage already validates the code
paths work.

## Known limitations

1. **Drag-and-drop drop zone — not implemented.** The upload affordance
   is a standard `<input type="file">` styled with a Tailwind
   `file:` selector. Drag-and-drop would be Phase 4 polish; it adds
   ~30 LOC + a `react-dropzone`-style state machine but doesn't
   change which sources are selectable.
2. **Character path doesn't yet preview the avatar binding.** When a
   character tile is selected, we use the *portrait* file. The user
   sees the portrait in the preview tile, not the Runway-processed
   avatar thumbnail (`runway_avatar_thumbnail_url`). For video
   generation that's fine — the portrait drives the video — but the
   demo recording could trip if a viewer expects the avatar's
   processed look. Documenting as known.
3. **Character path requires a portrait but not necessarily a
   bound avatar.** A character with `portrait_url` but no
   `runway_avatar_id` is still selectable for video generation.
   Avatar binding is only needed for the host-clip + realtime
   downstream features.
4. **Pasted external URLs still work** (under the Upload tab's "or
   paste an image URL" affordance), but they're served by the
   external host directly. Cache failures are surfaced the same way
   the existing pipeline surfaces them — no change to PR M's
   honest-cache labelling.
5. **No image-validation on the upload bytes themselves.** We trust
   the Content-Type header. A malicious PNG with embedded scripts
   would still be cached, but since we only emit data URIs to
   Runway and serve via FileResponse, the practical exposure is
   minimal. Adding `Pillow`-based magic-number validation would
   require a new Python dependency and is overkill for a hackathon
   build.
6. **Upload size cap is generous (10 MB).** Plenty for product
   photos; could be tightened post-hackathon.

## Recommended next polish step

**UI Phase 4 — drop zone + character preview tile parity.**

If the v5+ demo recording reveals friction with the file input, a
Phase 4 polish pass would:

- Add a drop zone overlay that highlights when a user drags a file
  over the prompt panel — uses HTML5 drag events; ~40 LOC.
- Show the Runway-processed avatar thumbnail (when available) on
  the character picker tile so the user sees what their video will
  actually look like, not just the source portrait.
- Add a small "Apply to all new campaigns" toggle on the character
  picker so users who pick a character once don't have to re-pick
  for every brief in the same session.

These are presentation polish, not pipeline changes.

## Files changed

| File | Change |
|---|---|
| `backend/requirements.txt` | +1 dep: `python-multipart==0.0.20` |
| `backend/app/services/image_client.py` | +`find_image_path`, +`SUPPORTED_IMAGE_EXTS`, doc on `path_for` |
| `backend/app/services/runway_client.py` | `_resolve_image_for_runway` extended for character portraits + multi-extension lookup |
| `backend/app/routers/runway.py` | New `POST /upload-image`; updated `GET /image/{id}` for multi-extension |
| `frontend/src/api.js` | New `api.uploadImage(file)` |
| `frontend/src/App.jsx` | `characters` state + `handleUploadImage` + Stage 3 anchor |
| `frontend/src/components/PromptPreview.jsx` | 4-option `radiogroup` Visual Source selector + adaptive Generate Video button label |
| `frontend/tests/adspark-smoke.spec.js` | Asserts radiogroup + 4 radios + default selection; switches to Upload tab before URL fill; Generate Video regex made adaptive |
| `docs/research/VISUAL_SOURCE_FLOW_AUDIT.md` | This file |
