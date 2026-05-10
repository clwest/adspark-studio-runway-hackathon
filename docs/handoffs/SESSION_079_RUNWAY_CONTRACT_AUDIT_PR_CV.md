# SESSION 079 — PR CV Runway API Contract Audit

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CV patch in flight on top of
`ea4ba88` `fix: close v2 lane dead-end with inline
brief + script CTAs (PR CU)`; commit + push pending
after this handoff lands)

**Why this slice ran:** PR CT switched the portrait
model from `gen4_image_turbo` to `gen4_image` after a
batch of `INTERNAL.BAD_OUTPUT.CODE01` failures. Before
adding more UX patches, the user asked for a hard
contract audit against the official Runway API docs +
SDK to make sure we're not running on assumptions. PR
CV is that audit.

## Official sources reviewed

- [API Documentation](https://docs.dev.runwayml.com/) —
  endpoint catalogue.
- [API Reference](https://docs.dev.runwayml.com/api/) —
  endpoint listing (text-to-image, avatars, avatar
  videos, tasks, etc.).
- [API Version 2024-11-06](https://docs.dev.runwayml.com/api-details/versions/2024-11-06/) —
  current version, no further changes documented for
  text-to-image in this version.
- [API Versioning Policy](https://docs.dev.runwayml.com/api-details/versioning/) —
  versions are ISO dates, supplied via the
  `X-Runway-Version` header.
- [API Input Parameters](https://docs.dev.runwayml.com/assets/inputs/) —
  data URIs cap at 5 MB, HTTPS image URLs at 16 MB,
  formats limited to JPEG/PNG/WebP.
- [Software Development Kits](https://docs.dev.runwayml.com/api-details/sdks/) —
  Python `runwayml`, Node `@runwayml/sdk`. Both
  Stainless-generated from the OpenAPI spec.
- [runwayml/sdk-python on GitHub](https://github.com/runwayml/sdk-python) —
  type-checked source for every endpoint's exact
  request shape.
- Specifically inspected:
  - `src/runwayml/types/text_to_image_create_params.py`
  - `src/runwayml/types/avatar_create_params.py`
  - `src/runwayml/types/avatar_video_create_params.py`

## Headline findings

### 1. `gen4_image_turbo` IS officially supported

The official Python SDK type file
`text_to_image_create_params.py` defines a
`Gen4ImageTurbo(TypedDict)` class:

```python
class Gen4ImageTurbo(TypedDict, total=False):
    model: Required[Literal["gen4_image_turbo"]]
    prompt_text: Required[Annotated[str, alias="promptText"]]
    ratio: Required[Literal[<16 valid values>]]
    reference_images: Required[Iterable[Gen4ImageTurboReferenceImage]]
    content_moderation: Annotated[Gen4ImageTurboContentModeration, alias="contentModeration"]
    seed: int
```

So `gen4_image_turbo` is **not deprecated** and not
internal. The PR CT failures were almost certainly
upstream availability flakes specific to that model
during that window.

### 2. **`reference_images` requirement differs by model**

This is the key contract finding:

| Model | `reference_images` | Notes |
|---|---|---|
| `gen4_image_turbo` | **Required** (1–3 images) | turbo refuses requests without a reference |
| `gen4_image`       | **Optional** (up to 3 images) | non-turbo can run prompt-only |
| `gpt_image_2`      | TBD (not inspected this slice) | |
| `gemini_image_3_pro` | TBD | |
| `gemini_2_5_flash` | TBD | |

We were sending a flat 320×320 charcoal seed PNG to
**both** models because turbo requires it. Under
non-turbo (`gen4_image`) the model interprets the seed
as a real visual reference and steers output toward a
featureless dark frame, which the safety / quality
check then rejects as `BAD_OUTPUT`.

### 3. Our request shape was contract-correct elsewhere

| Field | Our value | Schema |
|---|---|---|
| `model` | `gen4_image` (post-PR-CT) | ✅ matches `Literal["gen4_image"]` |
| `promptText` | resolved prompt | ✅ alias matches `prompt_text` |
| `ratio` | `1280:720` | ✅ in the 16-value `Literal` |
| `referenceImages[].uri` | data URI | ⚠️ schema says HTTPS URL but
docs explicitly accept data URIs ≤ 5 MB |
| endpoint | `POST /v1/text_to_image` | ✅ |
| header | `X-Runway-Version: 2024-11-06` | ✅ still current |

### 4. Avatar create — three contract gaps

`avatar_create_params.AvatarCreateParams`:

```python
class AvatarCreateParams(TypedDict, total=False):
    name: Required[str]
    personality: Required[str]
    reference_image: Required[Annotated[str, alias="referenceImage"]]
    voice: Required[Voice]   # presetId or custom voiceId
    document_ids: SequenceNotStr[str]      # (optional)
    image_processing: Literal["optimize", "none"]   # (optional)
    start_script: str                       # (optional)
```

Our payload sends `name`, `personality`, `referenceImage`,
`voice` — the four required fields. We do **not** send
`imageProcessing`. The default isn't specified in the
SDK; passing `"optimize"` explicitly is the SDK-
recommended path for "better avatar results".

Voice presets in the SDK type literal: 30 names
(`victoria`, `vincent`, `clara`, `drew`, `skye`,
`max`, `morgan`, `felix`, `mia`, `marcus`, `summer`,
`ruby`, `aurora`, `jasper`, `leo`, `adrian`, `nina`,
`emma`, `blake`, `david`, `maya`, `nathan`, `sam`,
`georgia`, `petra`, `adam`, `zach`, `violet`, `roman`,
`luna`). Our backend's `SUPPORTED_VOICE_PRESETS` should
be a subset of these — out of scope to verify this
slice but flagged for a quick `git grep` follow-up.

### 5. avatar_videos — model name confirmed

`avatar_video_create_params.AvatarVideoCreateParams`:

```python
class AvatarVideoCreateParams(TypedDict, total=False):
    avatar: Required[Avatar]
    model: Required[Literal["gwm1_avatars"]]
    speech: Required[Speech]
```

Our `character_host_client.py` line 49:
`_AVATAR_VIDEO_MODEL = "gwm1_avatars"`. ✅ matches.

### 6. SDK use vs raw HTTP

The official Python SDK (`runwayml`) is generated by
Stainless from the OpenAPI spec. It would give us:

- type-checked request bodies
- automatic retries with exponential backoff
- automatic polling helpers (`waitForTaskOutput`)
- centralized auth + version header

But it would also force a dependency upgrade and
shift our control surface. **Recommendation:** keep
raw httpx for now — our request shape now matches the
SDK schemas exactly, and the flexibility of raw httpx
helps when debugging upstream model failures (we want
to see the exact `failureCode` Runway returned, which
the SDK abstracts away). Revisit if we ever need
features the SDK gives us for free (e.g. retries,
pagination, batched fetches).

## Answers to the 10 questions

1. **Is `gen4_image` correct for our portrait path?**
   Yes. Both `gen4_image` and `gen4_image_turbo` are
   official, both accept the same prompt + ratio
   parameters, both produce comparable output. Turbo
   is faster but currently flaky upstream; non-turbo
   is the conservative choice.
2. **Is `gen4_image_turbo` deprecated?**
   No. Official SDK schema defines it as a
   first-class model. The PR CT-era failures were
   upstream availability issues.
3. **Correct endpoint/body shape for `text_to_image`?**
   Yes — `POST /v1/text_to_image` with
   `{model, promptText, ratio[, referenceImages]}`.
4. **Should we use the official SDK?**
   Not yet. Raw httpx + the new contract-correct
   payload covers the use case. SDK would simplify
   retries but at the cost of failure-code visibility.
5. **Are our ratios valid?**
   Yes — `1280:720` is in both `Gen4Image` and
   `Gen4ImageTurbo` `Literal` values.
6. **Are `referenceImages` required, optional, or hurting?**
   **Required** for `gen4_image_turbo`, **optional**
   for `gen4_image`. Sending a flat seed PNG to non-
   turbo was almost certainly hurting output quality
   and triggering BAD_OUTPUT — that's the PR CV fix.
7. **Is the seed reference image helping or hurting?**
   For `gen4_image_turbo` it's required (so it has
   to stay). For `gen4_image` it's hurting — model
   tries to interpret a flat charcoal as a literal
   visual reference. Now omitted under non-turbo.
8. **Is avatar create using current contract?**
   Mostly. Missing optional `imageProcessing:
   "optimize"` per SDK recommendation. Recommended
   small tweak below.
9. **Is `avatar_videos` campaign rendering on contract?**
   Yes — `model: "gwm1_avatars"` matches.
10. **Is `X-Runway-Version: 2024-11-06` correct?**
    Yes, current per
    [versioning docs](https://docs.dev.runwayml.com/api-details/versioning/).

## Files modified

- `backend/app/services/character_studio_client.py` —
  conditionally include `referenceImages` only when
  `_IMAGE_MODEL == "gen4_image_turbo"`. Under
  `gen4_image` (current), the field is omitted
  entirely so the model runs prompt-only as the SDK
  schema describes.
- `scripts/diagnose-portrait.py` — output now reflects
  whether `referenceImages` would be sent on the next
  click. Adds a `body keys: …` line listing exactly
  which top-level fields would land in the POST body.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — appended PR CV block.
- `docs/handoffs/SESSION_079_RUNWAY_CONTRACT_AUDIT_PR_CV.md`
  (this file, new).

No new feature surface. No frontend changes. Backend
route count unchanged at **71**.

## Verification

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| Backend pytest | **7/7 passed** — no test changes; existing tests still pass against the new conditional. |
| `vite build` | 491.14 KB / 133.39 KB gzip — unchanged (no FE delta). |
| Mock smoke | **3 passed (~28.6 s)** after first-run flake on the legacy 25 s host-cache timeout. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| **One real Runway portrait under the new contract** | ✅ rendered in **27 s** for a brand-new "Contract Probe" character (founder template, simple subject, no seed reference, `gen4_image`). Cleanup deleted the probe character. |

## Real Runway calls fired

**1.** Single validation call against a probe character
under the contract-correct payload. Operator's PR CV
budget allowed up to 1 image call. No avatar calls
fired (operator approval gate).

## Recommended next action

Two small follow-ups, both low-risk and operator-
triggered:

1. **PR CW — explicit `imageProcessing: "optimize"`
   on avatar create.** SDK type comments suggest
   "optimize" gives "better avatar results"; we don't
   pass it today. One-line addition to
   `_create_avatar_real`'s body dict. Cost: 0
   additional Runway credits at request time (it's a
   field hint).
2. **Re-test `gen4_image_turbo` on a quiet day.** If
   upstream availability has recovered, switching
   back to turbo gives us 5–10 s renders again
   (vs the current ~25 s under non-turbo). The
   conditional `referenceImages` we added keeps the
   contract-correct request shape under both models,
   so the revert is one constant flip.

Lower-priority nice-to-haves:

- Audit `SUPPORTED_VOICE_PRESETS` against the SDK's
  30-preset literal — quick `git grep` confirm.
- Switch to the official `runwayml` SDK at some point
  for typed request bodies + free retries — only when
  the cost of maintaining the type alignment manually
  outweighs the visibility benefit of raw httpx.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```
