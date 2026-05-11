# SESSION 098 — PR DO Long Spokesperson Ad Pipeline

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `a37073d` (`feat: seed submission demo content
(PR DN)`). PR DO patch in flight on top; commit + push pending
operator approval after this handoff lands.

**Why this slice ran:** Operator question after PR DN landed —
"why are spokesperson ads ~14s? we have 50k Runway credits, can
they be 30-45s instead?" Audit confirmed the 300-char `speech.text`
cap is Runway's, not ours; one `avatar_videos` call → one 10-15s
MP4. Path A (use Dialogue Scene as a single-speaker monologue) was
the no-code workaround. Path B — package the chunk-render-stitch
pipeline as a first-class spokesperson workflow — is what PR DO
ships.

## What changed

### Backend service — `long_ad_service.py` (new ~390 LoC)

`backend/app/services/long_ad_service.py`. Stdlib + httpx; mirrors
the dialogue_service shape but stays scoped to single-speaker
long-form ads.

**Public surface:**

- `chunk_script(script, max_chars=280) -> list[str]` — sentence-
  boundary-greedy chunking with a fallback ladder:
  1. Greedy pack of sentences while length ≤ max_chars.
  2. Single sentence > max_chars → split at `,`/`;` clause
     boundaries.
  3. Single clause still oversize → split at word boundaries.
  4. Single word still oversize → hard-cut at max_chars.
  Returns empty list for blank/whitespace input.
- `estimate_runtime(chunks) -> float` — `total_chars / 15 cps`,
  rounded to one decimal.
- `generate_long_ad(*, avatar_id, script, campaign_id, output_id,
  settings) -> LongAdResult` — orchestrator. Walks chunks, fires
  one `avatar_videos` per chunk (real or lavfi placeholder in mock
  mode), writes each MP4 to `data/long_ad/{campaign_id}-{output_id}-chunk-{NN}.mp4`.
- `stitch_chunks(chunk_paths, target, ...) -> (ok, error)` —
  ffmpeg filter_complex concat (audio preserved) with per-input
  normalize to 1088×704@30fps. Mirrors `VideoFinisher.build_dialogue_scene`
  shape but writes to caller-supplied target (key UX difference:
  per-output filenames instead of a canonical-only path).
- `cleanup_chunks(chunk_paths)` — best-effort delete; called by
  the route post-stitch so `data/long_ad/` doesn't accumulate
  orphan files. Stitched final lives forever under
  `data/finished/`.

Caps in the module:
- `_CHUNK_MAX_CHARS = 280` (20-char buffer under Runway's 300 gate)
- `_LONG_SCRIPT_MAX_CHARS = 1500` (operator-facing cap; ~60-100s of
  audio at 15 cps)
- `_CHARS_PER_SECOND = 15.0` (conservative; real audio sits
  closer to 15-18 cps depending on voice preset)
- `_POLL_DEADLINE_S = 360.0` (per-chunk avatar_videos poll cap)
- `_MAX_CHUNK_BYTES = 50 * 1024 * 1024`

### Backend route — `POST /api/campaigns/{id}/long-spokesperson-ad`

`campaigns.py` (route count **76 → 77**). New
`LongSpokespersonAdBody` Pydantic with `script: str (1-1500)` +
optional `variant_id: str`.

Flow:

1. Validate campaign exists.
2. Validate `active_avatar_id` is set + `active_avatar_status in
   {ready, mock}` (409 otherwise).
3. If `variant_id` provided: validate variant exists on campaign,
   capture `variant_title`, and write-through-persist the submitted
   script onto `variant.long_script` so re-renders pre-populate.
4. `_new_output_id()` → `long_ad_service.generate_long_ad(...)` →
   per-chunk MP4s on disk.
5. `long_ad_service.stitch_chunks(chunks, target=data/finished/{cid}-long-{oid}.mp4)`.
6. `long_ad_service.cleanup_chunks(chunks)` — delete per-chunk
   files.
7. `_append_output_record(kind="long_spokesperson_ad", chunk_count,
   duration_estimate, variant_id, variant_title, ...)`.
8. Return updated Campaign with the new OutputRecord at the head
   of `outputs[]`.

Failure paths return 502 with cleanup of partial chunks.

### Models

- `OutputKind` adds `"long_spokesperson_ad"`.
- `OutputRecord` adds three optional fields:
  `chunk_count: Optional[int]`, `duration_estimate: Optional[float]`,
  `stitched_from_output_ids: Optional[list[str]]`. All default
  `None`; existing records and non-long-ad kinds stay clean.
- `AdVariant.long_script: Optional[str] = Field(default=None,
  max_length=1500)` — sticky in the upsert route (None preserves,
  empty clears).
- `AdVariantCreate` body gains the same `long_script` field with
  None default for sticky semantics.
- `get_campaign_output` route's kind→cache_dir map gains
  `long_spokesperson_ad` → `data/finished/`.

### Frontend — Render Long Ad button + textarea

`SpokespersonLane.jsx` Step 3 gets a sibling button next to the
existing "Render new Spokesperson Ad":

- **Collapsed state:** rose-bordered button labeled "Render Long
  Ad", chip says "click to expand" / "{N} clips · ~{X}s" when a
  script is present.
- **Expanded state:** click opens an inline editor panel:
  - 6-row textarea, `maxLength=1500`, mono font, focus:rose
  - Char counter `{N}/1500`
  - Live estimate: `{chunks} clip(s) · estimated {runtime}s
    runtime` (computed JS-side: `Math.ceil(len / 280)` chunks,
    `Math.round(len / 15)` seconds). testid
    `spokesperson-lane-long-ad-estimate`.
  - Inline error slot
  - Linked-variant footnote when `selectedVariantId` is set:
    "Linked to variant {title} — on render the script is saved as
    the variant's long_script so a future re-render pre-populates."
- **Render:** button click → POSTs to the new route via
  `onGenerateLongSpokesperson(campaignId, {script, variantId})`
  threaded through `CampaignLanes.handleGenerateLongSpokespersonAd`
  → `api.generateLongSpokespersonAd(...)`.
- **Auto-sync:** `useEffect([selectedVariantId, selectedVariant?.long_script])`
  refreshes the textarea content when the operator switches
  variants — discards in-progress edits so stale text never
  carries across.

testids: `spokesperson-lane-long-ad`,
`spokesperson-lane-long-ad-editor`,
`spokesperson-lane-long-ad-textarea`,
`spokesperson-lane-long-ad-estimate`,
`spokesperson-lane-long-ad-error`.

### Frontend — OutputsGallery card

`OutputsGallery.jsx`:

- `KIND_META["long_spokesperson_ad"]`: label "Long Spokesperson
  Ad", horizontal orientation, description "Multi-chunk talking-
  avatar ad stitched into one MP4."
- `buildCardsForCampaign` plumbs `chunk_count` + `duration_estimate`
  from the OutputRecord onto the card.
- `<OutputCard>` renders a new sub-line below the variant
  affordance: rose mono text, "N clips · ~Xs runtime". testid
  `output-card-long-ad-meta`.

### Seed extension

`scripts/seed-submission-demo-content.py` extended with one
`long_script` per spokesperson:

| Spokesperson | long_script focus | Length |
|---|---|---|
| Donny Sparks | Creative angle — reusable AI ads, persistent spokespeople | ~950 chars |
| Riggs Rally | Build story — context-kit/Character OS distinction explicit | ~1100 chars |
| Miles Monroe | Business value — unit-economics case for brand continuity | ~1200 chars |

Idempotency: existing variants get `long_script` patched in only
when missing (operator edits never clobbered). Live run against
the running backend successfully patched all three demo variants
(`c46edda30a3a`, `6f9523c88828`, `4bd361ca989a`); second run
reports 9/9 skipped, idempotency proven.

## Pytests (nine new)

| Test | What it pins |
|---|---|
| `test_chunk_script_simple_sentences` | 2-sentence input → 1 chunk |
| `test_chunk_script_packs_sentences_greedily` | Multi-sentence packs greedy, every chunk ≤280 |
| `test_chunk_script_clause_fallback_for_oversize_sentence` | Single oversized sentence falls back to clause split |
| `test_chunk_script_word_fallback_when_no_clause_breaks` | Run-on with no punctuation falls back to word boundary |
| `test_chunk_script_returns_empty_for_blank` | Empty/whitespace input → `[]` |
| `test_estimate_runtime` | `chars / 15 cps`, `[]` returns 0.0 |
| `test_long_spokesperson_ad_end_to_end` | Full pipeline: variant → POST → chunks + stitch + OutputRecord + file servable via /output/{id} + chunks cleaned up |
| `test_long_spokesperson_ad_rejects_oversize_script` | 1501-char script → 422 from Pydantic |
| `test_long_spokesperson_ad_persists_long_script_to_variant` | Write-through: variant_id submission lands as `variant.long_script` |

Pytest **53/53** (44 prior + 9 new PR DO).

## Files changed

```
 backend/app/services/long_ad_service.py            | new (~390 LoC)
 backend/app/models.py                              | +30 (OutputKind + OutputRecord + AdVariant)
 backend/app/routers/campaigns.py                   | +140 (route + body model + import + kind→dir map + _append kwargs)
 backend/tests/test_create_avatar_mock.py           | +180 (9 new tests)
 frontend/src/api.js                                | +12 (api.generateLongSpokespersonAd)
 frontend/src/components/CampaignLanes.jsx          | +15 (handler + prop pass-through)
 frontend/src/components/OutputsGallery.jsx         | +35 (KIND_META + card meta sub-line + plumb)
 frontend/src/components/lanes/SpokespersonLane.jsx | +135 (state + button + textarea + estimate)
 scripts/seed-submission-demo-content.py            | +110 (long_script per spokesperson + patch logic)
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR DO block)
 docs/handoffs/SESSION_098_LONG_SPOKESPERSON_AD_PR_DO.md | new
```

**Untouched:**

- Standard `POST /spokesperson-ad` flow (PR AB) — unchanged
- Existing dialogue scene flow + per-line render + stitch
- `/legacy` — preserved
- Realtime broker, character store, knowledge sources, campaigns
  list UI
- `VideoFinisher.build_dialogue_scene` — left in place; long-ad
  uses its own `stitch_chunks` so dialogue's canonical-filename
  semantics don't bleed into long-ad's per-output-filename
  semantics

## Verification

| Check | Result |
|---|---|
| Backend pytest | **53/53 passed** (~7.9s) — 44 prior + 9 new PR DO |
| Backend route count | **76 → 77** (new `/long-spokesperson-ad`) |
| `vite build` | **549.63 KB / 147.42 KB gzip** (+4.93 KB / +1.05 KB) |
| Mock smoke (Playwright) | **3/3 passed** (~34s) |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | backend pid up, `runway_mock=false`, vite http=200 |
| Real Runway calls fired by this PR | **0** — render is operator-triggered |
| Donny / Riggs / Miles seeded `long_script` | persisted on the live backend (idempotency proven via second run) |

## How to demo on the live backend

1. Open Donny → Campaigns → "Character OS Creates Reusable AI Ads"
   → variant "Submission · Reusable AI Ads" (the PR DN-seeded one,
   now with PR DO long_script).
2. Step 3 → click **Render Long Ad**. The button expands into a
   panel showing the pre-populated long_script (~950 chars, "4
   clips · estimated 64s runtime").
3. Click the button again (now red/active) to fire the render.
   Backend renders 4 avatar_videos chunks (~10-15s each), stitches,
   serves the final MP4. Total wall time: ~2-3 minutes for 4
   chunks in serial.
4. Videos tab → new `Long Spokesperson Ad` card with the
   "4 clips · ~64s runtime" sub-line, variant title, playable
   inline.

Cost per long ad at the operator's seeded 950-1200 char scripts:
~4 chunks × ~$0.05-$0.10 per chunk ≈ **$0.20-$0.40 per long ad**.
Comfortably under the 50k-credit budget.

## Remaining UX gaps

1. **No live per-chunk progress display.** Render is serial; the
   UI shows "Rendering long ad (~N chunks)…" but doesn't update
   "rendering chunk 2/4 → 3/4 → stitching" in real time. Would
   need either SSE or a polling endpoint. Out of scope for v1;
   the operator sees one busy state for ~2-3 minutes.
2. **Hardcoded `LONG_SCRIPT_MAX = 1500` + `LONG_CHUNK_TARGET =
   280` in the lane.** Must stay in sync with backend constants in
   `long_ad_service`. Comment inline calls this out.
3. **No "Re-render with same script" affordance.** The textarea
   is the source of truth; re-rendering means clicking the button
   again, which re-uploads the same script. Acceptable for v1.
4. **Mock-mode chunks are 4s each.** Real-mode chunks vary 8-15s
   per avatar_videos render. The frontend estimate uses 15 cps
   (real-mode-tuned); mock-mode stitched output runs shorter than
   the estimate. Not breakage; just an estimation skew when the
   operator demos in mock mode.
5. **Per-chunk MP4s deleted post-stitch.** If a future audit /
   re-render flow wants chunk-level access, the chunks would need
   to be preserved. `stitched_from_output_ids` field on
   OutputRecord is reserved for this; today the list stays empty.
6. **`/legacy` doesn't expose long ads.** Per the project rule.
   v2 lane is the canonical surface.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

Long-ad route + service loaded in the running backend. Donny /
Riggs / Miles workspaces all have their PR DO seeded long_scripts
pre-populated and ready to render.
