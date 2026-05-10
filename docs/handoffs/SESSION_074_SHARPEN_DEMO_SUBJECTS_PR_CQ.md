# SESSION 074 — PR CQ Sharpen Demo Seed Subjects + Tiny Prompt Audit Surface

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CQ patch in flight on top of
`58a73f2` `feat: harden portrait prompts and audit
mascot quality (PR CP cont.)`; commit + push pending
after this handoff lands)

**Why this slice ran:** PR CP cont. hardened the
`PORTRAIT_TEMPLATES` with brand-safe / anti-uncanny tail
+ "anthropomorphic mascot spokesperson" anchor for the
mascot template. The remaining lever for the
"portraits look rough" P1 was the per-persona seed
`subject` text — PR CG seeds describe roles, not
creatures. This slice rewrites the four canonical demo
seed subjects into concrete visual descriptions, plus
adds a tiny operator-readable disclosure showing the
exact prompt last sent to `gen4_image_turbo`.

## Endpoint inventory

PR CQ adds **no new routes**. Backend route count
remains **71**. Backend untouched at the route layer;
the only backend change is the seed fixture data.

## Files modified

- `scripts/seed-demo-spokespeople.py` — sharpened
  `subject` strings on all four canonical demo
  spokespeople; switched Rex Roadside's template from
  `local_guide` → `mascot` to match his new
  anthropomorphic-bison concept.
- `frontend/src/components/SpokespersonWorkspace.jsx` —
  inline `<details>` block in the Identity tab shows
  `character.portrait_prompt` when set; testids
  `spokesperson-workspace-portrait-prompt` +
  `spokesperson-workspace-portrait-prompt-text` +
  `spokesperson-workspace-portrait-prompt-empty`. Plus
  the Identity tab is now a responsive 2-col grid
  (`md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]`)
  so the embedded `<CharacterCard>` is capped at
  320px wide on desktop instead of dominating the
  workspace at the full container width — the previous
  `aspect-square w-full` portrait was rendering as a
  giant square at workspace width on desktop. On
  mobile the grid collapses to one column and the card
  centres at `max-w-[320px] mx-auto`. testid
  `spokesperson-workspace-identity-grid`.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — appended PR CQ block to the
  PR CP narrative.
- `docs/handoffs/SESSION_074_SHARPEN_DEMO_SUBJECTS_PR_CQ.md`
  (this file, new).

No backend route changes. No JSON data committed. No
generated media committed. **No real Runway calls
fired.**

## Updated seed subjects (`scripts/seed-demo-spokespeople.py`)

| Persona | Template (new) | Subject (new) |
|---|---|---|
| Brewster Bolt | `mascot` *(unchanged)* | `an anthropomorphic raccoon mascot spokesperson with a confident grin, energetic posture, and friendly commercial expression` |
| Clara Vale | `founder` *(unchanged)* | `a polished local business spokesperson with a warm confident smile, professional but approachable presence` |
| Rex Roadside | **`mascot`** *(was `local_guide`)* | `a rugged but friendly anthropomorphic bison truck-dealership spokesperson, broad shoulders, warm grin, clean commercial mascot design` |
| Mina Spark | `coach` *(unchanged)* | `a bright energetic creative agency spokesperson with a friendly confident expression and polished studio presence` |

**Style strings, personality, catchphrases, voice
preset, metadata role / use_case** preserved untouched
on every persona. Only `subject` (and Rex's `template`)
moved.

### Why Rex's template flipped

The PR CP cont. mascot template now opens with
"A polished commercial mascot portrait of an
anthropomorphic mascot spokesperson — {subject}." Rex
is now an anthropomorphic bison; the `mascot` template
matches the concept. The previous `local_guide` template
("A polished commercial spokesperson portrait of
{subject} in a small-business setting") would still
render but the small-business framing fights the
mascot-creature concept and was the same template Rex
used through PR CI / PR CJ / PR CO — every regen
upstream-failed in those slices, so flipping the
template is the conservative move.

### Sample rendered prompts

End-to-end prompt strings (build_prompt output) after
this slice for each persona:

```
=== Brewster Bolt (mascot) ===
A polished commercial mascot portrait of an
anthropomorphic mascot spokesperson — an
anthropomorphic raccoon mascot spokesperson with a
confident grin, energetic posture, and friendly
commercial expression. vibrant, saturated colour
palette; clean modern animation; expressive close-ups;
punchy silhouette. Head-and-shoulders framing,
expressive friendly face, soft warm smile. Simple solid
mid-grey background. Soft three-point studio lighting.
High-quality 3D character design. Brand-safe
advertising character suitable for a marketing
campaign. No horror, no distortion, no extra limbs, no
melted anatomy, no uncanny realism. No props or
sunglasses.
```

```
=== Rex Roadside (mascot) ===
A polished commercial mascot portrait of an
anthropomorphic mascot spokesperson — a rugged but
friendly anthropomorphic bison truck-dealership
spokesperson, broad shoulders, warm grin, clean
commercial mascot design. natural daylight; truck and
lot environments; honest mid-shots; weather-worn
texture without looking gritty. Head-and-shoulders
framing, expressive friendly face, soft warm smile.
Simple solid mid-grey background. Soft three-point
studio lighting. High-quality 3D character design.
Brand-safe advertising character suitable for a
marketing campaign. No horror, no distortion, no extra
limbs, no melted anatomy, no uncanny realism. No props
or sunglasses.
```

(Clara + Mina render through the founder + coach
templates respectively — see same probe in the verify
section.)

## Tiny prompt preview surface

A new inline `<details>` element renders inside the
Identity tab below the embedded `<CharacterCard>`. It
displays `character.portrait_prompt` (the resolved
prompt the backend persisted on the last successful
`POST /api/characters/{id}/generate-portrait`).

- Hidden by default — only the disclosure label
  ("Last portrait prompt sent to gen4_image_turbo (N
  chars)") is visible.
- Click expands to show the full prompt as a
  `whitespace-pre-wrap` `<pre>`.
- Renders **nothing** when the field is empty (fresh
  spokesperson pre-portrait), so it adds no clutter for
  freshly created characters.
- testids: `spokesperson-workspace-portrait-prompt` (the
  `<details>`), `spokesperson-workspace-portrait-prompt-text`
  (the `<pre>`).
- No copy button, no fetch, no editor, no API. Pure
  read of the existing record field.

This is the smallest possible operator-readable audit
surface — it answers "what did Runway actually see for
this portrait?" without expanding any feature surface.

### What did NOT change

- Endpoint routing (`POST /api/characters/{id}/generate-portrait`
  → `gen4_image_turbo` via `/v1/text_to_image`).
- `prompt_override` semantics (operator typing into the
  textarea still goes verbatim, capped 1000 chars).
- `Character` model fields — `portrait_prompt` was
  already there from PR K.
- DangerZone delete affordance.
- Avatar create payload (`/v1/avatars`).
- Smoke spec — no new assertions; the new disclosure
  renders only after a portrait exists, which the smoke
  doesn't trigger.
- Demo campaign fixtures (`scripts/seed-demo-campaigns.py`).
- `relink-orphan-demo-campaigns.py` script.

## Controlled real-mode QA checklist

**Do not run unless explicitly approved by Chris.**
Estimated cost ≈ $0.10 in image credits (4 portraits ×
~$0.025). Real Runway calls fire on every step that
isn't read-only.

### Pre-flight

- [ ] Confirm real-mode boot: `bash scripts/start-local-real.sh`
- [ ] Health probe shows `runway_mock=false` ·
      `image_gen_mock=false`.
- [ ] Open `http://localhost:5173/` and verify the four
      demo personas are present.
- [ ] Re-run `python scripts/seed-demo-spokespeople.py`
      to push the new sharpened subjects + Rex's
      `mascot` template into `backend/data/characters.json`.
      The seeder is idempotent and only patches the
      seed-defined columns; voice clones / avatars /
      existing portraits are untouched.

### Portrait regeneration

- [ ] Open Brewster Bolt's workspace at
      `/spokespeople/<brewster-bolt-id>`.
- [ ] Click `Generate Portrait` in the embedded
      CharacterCard. Expect a 30–60 s render.
- [ ] On success, expand the new
      `Last portrait prompt sent to gen4_image_turbo`
      disclosure. Verify the prompt opens with
      "A polished commercial mascot portrait of an
      anthropomorphic mascot spokesperson — an
      anthropomorphic raccoon mascot spokesperson with
      a confident grin…".
- [ ] Visually verify the portrait is a raccoon
      head-and-shoulders, not a humanoid silhouette.
- [ ] Repeat for Rex Roadside (expect a bison). This
      is the historically-flaky persona — Rex
      upstream-failed every regen in PR CI / PR CJ /
      PR CO under the `local_guide` template.
- [ ] (Optional) Repeat for Clara Vale + Mina Spark.
      They were already producing serviceable
      portraits in PR CO, so regen is cosmetic
      polish only.

### Avatar wiring

- [ ] In Brewster's workspace, click `Create Avatar`
      after the portrait succeeds.
- [ ] Confirm the avatar `referenceImage` payload uses
      the freshly-regenerated portrait
      (`backend/data/characters/<id>-portrait.png` —
      `mtime` should match the new portrait).
- [ ] Confirm `runway_avatar_status` flips to `ready`
      on the Character record (UI pill chip on the
      workspace header).

### Workspace + gallery propagation

- [ ] Reload `/spokespeople/<id>` after each successful
      portrait — confirm the workspace header portrait
      thumbnail updates.
- [ ] Reload `/` (homepage Library) — confirm the tile
      shows the new portrait.
- [ ] If the persona has linked campaigns with cached
      outputs, navigate to the Outputs tab and confirm
      no broken videos (the gallery binds on
      `character_id`, so renamed records don't orphan
      cached outputs).

### Audit trail

- [ ] After each portrait success, expand the
      `Last portrait prompt sent to gen4_image_turbo`
      disclosure in the workspace Identity tab. The
      length pill (`N chars`) should land in the
      ~700–900 char range.
- [ ] Compare to the pre-PR-CP cached portrait in
      `backend/data/characters/<id>-portrait.png.bak`
      if one exists from PR CO. If you keep both,
      capture before/after side-by-side for the
      handoff.
- [ ] Note any persona where the mascot still looks
      humanoid — that's a signal the seed `subject`
      needs further tightening (or
      `template == "mascot"` flag is missing on a
      persona that should carry it).

### Failure rollback

- [ ] If Rex Roadside upstream-fails again under the
      new `mascot` template + bison subject, the
      `subject` may need further simplification (drop
      "truck-dealership" and rely on the persona role
      narrative) — captured as a follow-up risk, not a
      revert.
- [ ] If any persona renders an uncanny / distorted
      portrait, the `_BRAND_SAFE_TAIL` tail can be
      strengthened in PR CR. Don't manually edit the
      cached PNG.

## Verification (this slice)

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| Backend `build_prompt` probe | renders all 4 personas through the new templates as shown above. |
| `vite build` | 481.30 KB initial / 131.30 KB gzip + 561.97 KB lazy chunk (+0.75 KB initial / +0.16 KB gzip vs the prompt-audit-only build — the responsive grid + empty-state hint). |
| Mock backend health | `runway_mock=true` after `bash scripts/start-local-mock.sh`. |
| Playwright mock smoke | **3 passed (~49.6 s)** — Test 1 (@ /legacy) 46.6 s, Test 2 (@ /) 1.8 s, Test 3 (top-bar round-trip) 652 ms. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | uvicorn + vite up, `runway_mock=false`, `vite http=200`. |
| `/legacy` reachable | top-bar round-trip exercised in smoke Test 3. |
| Real Runway calls fired | **0** — per "no automated real-mode generation runs" rule. The QA checklist above remains unexecuted pending operator approval. |

## Manual QA notes (frontend behaviour)

The `<details>` audit surface degrades gracefully:

- New persona, no portrait yet: nothing rendered.
- After portrait success: chip-row label appears with
  the prompt char count; click expands.
- After portrait failure: `Character.portrait_prompt`
  is **still set** (the backend stores the prompt even
  on `failed` results so the operator can see what
  Runway saw). So if Rex upstream-fails again, the
  audit row still surfaces the prompt that produced
  the failure — useful for tightening.

## Risks

- **Rex template flip is a content change.** Operators
  who manually toggled Rex's template back to
  `local_guide` (unlikely, but possible) will see it
  bounce back to `mascot` next time
  `seed-demo-spokespeople.py` runs. The seeder is
  idempotent on the seed columns; the template column
  is one of those columns. No way to flag "leave my
  manual edit alone" beyond changing the persona name
  away from "Rex Roadside".
- **Subject overlap with template anchor.** Brewster's
  rendered prompt now reads "anthropomorphic mascot
  spokesperson — an anthropomorphic raccoon mascot
  spokesperson…" which double-anchors. Runway tolerates
  it but the second "mascot spokesperson" is
  redundant. Could be tightened in a follow-up — `gen4`
  attention models like the redundancy more than they
  hate it, but it's not free.
- **Audit `<details>` is read-only.** No copy button,
  no clipboard. If operators need to grab the prompt to
  paste elsewhere, they have to manually select the
  `<pre>` text. Intentional per "do not build a big
  prompt editor system" — promote to a copy button if
  the demo workflow needs it.
- **No real Runway validation yet.** The new template +
  subject combo has only been verified through the
  prompt-builder probe + mock smoke. The first real
  generation will confirm whether `gen4_image_turbo`
  produces a believable raccoon / bison given the new
  prompts. The QA checklist above is the smallest
  possible validation lap (~$0.10).

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

**PR CR (controlled real-mode regen)** — execute the
QA checklist above with explicit operator approval.
Capture before/after portrait pairs in the next
handoff. Estimated cost ≈ $0.10. Skip if the demo
schedule doesn't allow burning credits today.

**Stretch** — if Brewster's "double anthropomorphic
mascot" phrasing creates ambiguous output, tighten his
seed `subject` to drop the trailing "mascot
spokesperson" so the template's anchor carries the
weight: `"an anthropomorphic raccoon with a confident
grin, energetic posture, and friendly commercial
expression"`.
