# SESSION 080 — PR CW Clean Portrait Prompt Composer

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CW patch in flight on top of
`71e72b2` `fix: align portrait body with SDK contract —
drop seed for gen4_image (PR CV)`; commit + push
pending after this handoff lands)

**Why this slice ran:** PR CR/CS portrait prompts
concatenated identity + style chips + wardrobe + a
brand-safe tail directly into per-template f-strings.
The result drifted into noisy redundancy:

> "A polished commercial mascot portrait of an
> anthropomorphic mascot spokesperson — an anthropomorphic
> donkey marketing mascot with expressive eyes, confident
> posture, and a friendly commercial smile. stylized,
> editorial, studio light, muted palette; premium modern
> tech-startup hoodie with subtle creative-agency
> styling, indiana jones style hat. Head-and-shoulders
> framing, expressive friendly face, soft warm smile.
> Simple solid mid-grey background. Soft three-point
> studio lighting. High-quality 3D character design.
> Brand-safe advertising character suitable for a
> marketing campaign. Polished commercial illustration
> with believable character anatomy and a clean face."
> — ~720 chars, double-anchored, raw chip dump.

PR CW replaces those f-strings with a small,
deterministic composer that produces clean,
generation-friendly prompts.

## Output shape

```
"Polished {anchor} portrait of {subject}[ wearing {wardrobe}]. "
"{expression cue}. "
"[{aesthetic sentence}.] "
"Head-and-shoulders composition on a clean neutral background. "
"Professional advertising character design. "
"[Soft studio lighting.]"
```

**Anchor word** comes from the operator's chips by
priority: `editorial` → `cinematic` → `stylized` →
fallback `commercial`. The anchor chip is then excluded
from the aesthetic sentence so it doesn't appear twice.

**Aesthetic sentence** picks one phrase per category
(design / color / light) from the remaining chips and
folds them into one readable line:

> "Stylized commercial brand-character design with
> muted colors and soft studio lighting."

**Wardrobe** parses the post-`;` portion of the `style`
string and joins items naturally — `"dark hoodie,
backwards hat"` → `"a dark hoodie and backwards hat"`.

**Tail** lighting line is omitted when a `light`-
category chip already wove "soft studio lighting" /
"natural soft lighting" / "cinematic lighting" into the
aesthetic sentence — avoids duplicate "Soft studio
lighting." appearing twice.

## Style chip → phrase map

| chip | category | phrase |
|---|---|---|
| `stylized` | design | stylized commercial brand-character design |
| `editorial` | design | editorial advertising aesthetic |
| `plush mascot` | design | plush mascot character design |
| `muted palette` | color | muted colors |
| `bright palette` | color | bright friendly colors |
| `vibrant palette` | color | vibrant colors |
| `studio light` | light | soft studio lighting |
| `natural light` | light | natural soft lighting |
| `cinematic` | light | cinematic lighting |

Free-form chips not in the map are silently dropped —
that's intentional. Operators who want bespoke phrasing
should use the textarea, which still POSTs as
`prompt_override` and short-circuits the composer.

## Before / after

### Before (PR CR/CS — donkey mascot, 720 chars)

```
A polished commercial mascot portrait of an anthropomorphic
mascot spokesperson — an anthropomorphic donkey marketing
mascot with expressive eyes, confident posture, and a
friendly commercial smile. stylized, editorial, studio light,
muted palette; premium modern tech-startup hoodie with subtle
creative-agency styling, indiana jones style hat.
Head-and-shoulders framing, expressive friendly face, soft
warm smile. Simple solid mid-grey background. Soft
three-point studio lighting. High-quality 3D character
design. Brand-safe advertising character suitable for a
marketing campaign. Polished commercial illustration with
believable character anatomy and a clean face.
```

### After (PR CW — same character record, 290 chars)

```
Polished editorial portrait of an anthropomorphic donkey
marketing mascot. Calm confident expression. Stylized
commercial brand-character design with muted colors.
Head-and-shoulders composition on a clean neutral background.
Professional advertising character design. Soft studio
lighting.
```

### After (PR CW — user-spec fox example, 364 chars)

Input:
- archetype: `mascot`
- subject: `an anthropomorphic fox business spokesperson with polished studio styling`
- style chips: `stylized, editorial, studio light, muted palette`
- wardrobe: `dark hoodie, backwards hat`

Output (matches user-documented expected verbatim):

```
Polished editorial portrait of an anthropomorphic fox business
spokesperson with polished studio styling wearing a dark hoodie
and backwards hat. Calm confident expression. Stylized
commercial brand-character design with muted colors and soft
studio lighting. Head-and-shoulders composition on a clean
neutral background. Professional advertising character design.
```

## Files changed

- `backend/app/services/character_studio_client.py` —
  replaced `PORTRAIT_TEMPLATES` (the per-template
  f-strings) + `_BRAND_SAFE_TAIL` + the in-line
  `build_prompt` body with `_compose_clean_prompt`
  + helper functions (`_ensure_article`,
  `_format_wardrobe`, `_parse_style`,
  `_compose_aesthetic`). `PORTRAIT_TEMPLATES` is now
  the per-template **expression cue** dict (keys still
  serve the router's template-validation `if template
  not in PORTRAIT_TEMPLATES` check). `_SAFE_RETRY_TEMPLATES`
  preserved unchanged.
- `frontend/src/characterPromptBuilder.js` —
  rewrote `buildCharacterPortraitPrompt` to a JS port
  of `_compose_clean_prompt` byte-for-byte. Both
  surfaces now produce the same string for the same
  inputs. `PORTRAIT_PROMPT_HELPER` updated to match.
- `frontend/src/components/CreateSpokespersonFlow.jsx`
  — removed the embedded `derivePortraitPrompt` copy
  (was a third hand-rolled template surface that
  drifted independently of the others). Now delegates
  to the shared `buildCharacterPortraitPrompt`.
- `backend/tests/test_create_avatar_mock.py` — added
  six PR CW tests (`test_clean_prompt_mascot_donkey`,
  `test_clean_prompt_fox_mascot_with_wardrobe`,
  `test_clean_prompt_founder_no_wardrobe_no_chips`,
  `test_clean_prompt_no_duplicated_anthropomorphic`,
  `test_clean_prompt_under_hard_cap`,
  `test_clean_prompt_prompt_override_still_wins`).
  Renamed the PR CR `test_default_path_still_includes_style`
  to `test_default_path_maps_style_chips` and updated
  it to assert the new mapped phrasing ("muted colors"
  in prompt, "muted palette" raw NOT in prompt).
- `frontend/tests/adspark-smoke.spec.js` — updated the
  v1 CharacterStudio textarea-prefix regex from `/^A
  front-facing head-and-shoulders portrait/i` to
  `/^Polished (commercial|editorial|cinematic|stylized)
  portrait of /i` so the smoke tracks the composer's
  new output shape.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — appended PR CW block.
- `docs/handoffs/SESSION_080_CLEAN_PROMPT_COMPOSER_PR_CW.md`
  (this file, new).

No new feature surface. No backend route changes.
Backend route count unchanged at **71**.

## Verification

| Check | Result |
|---|---|
| Backend route count | **71** (unchanged) |
| Backend pytest | **13/13 passed (~0.44 s)** — 7 pre-existing + 6 new PR CW tests |
| `vite build` | 490.66 KB initial / 133.30 KB gzip + 561.97 KB lazy chunk (-0.48 KB / -0.09 KB vs PR CV — composer is shorter than the duplicated f-strings it replaces). |
| Mock smoke | **3 passed (~27.7 s)** — Test 1 25.8 s, Test 2 629 ms, Test 3 708 ms. Smoke regex updated to match the new composer prefix. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| Real Runway calls fired | **0** — composer changes verified deterministically; no real generations needed. |

## Backend / frontend parity check

Cross-checked three inputs against both surfaces:

| Input | Backend output (chars) | Frontend output (chars) | Match |
|---|---|---|---|
| Fox mascot (user spec) | 364 | 364 | ✅ identical |
| Donkey mascot, no wardrobe | 290 | 290 | ✅ identical |
| Founder default + editorial | 250 | 250 | ✅ identical |

## Risks

- **Free-form chips silently dropped.** Anything not
  in the chip map (e.g. operator types `experimental`
  or `noir`) gets parsed as a chip then dropped from
  the prompt. Documented behavior, but the operator
  textarea is still the escape hatch for unmapped
  styles. If we want to surface dropped chips as a
  warning, that's a future PR.
- **Anchor priority is small.** Three chips
  (`editorial`, `cinematic`, `stylized`) win the
  headline. Adding more is a one-line tuple update —
  but order matters because the first-match wins.
- **300–500 char target met on typical inputs.** The
  user-spec fox example lands at 364 chars; the
  donkey-only example at 290; the founder-defaults
  example at 250. Hard cap of 700 enforced via
  slice-truncation as a final safety.
- **Smoke regex is permissive.** It allows any of the
  four anchors. If the operator's seed character has
  no priority chip, the prompt falls back to
  `Polished commercial portrait of …` — also matched.
- **`prompt_override` still works.** Operator-typed
  text in the textarea POSTs verbatim and short-
  circuits the composer (capped at 1000 chars in the
  router).

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

PR CV's recommended PR CW (explicit `imageProcessing:
"optimize"` on avatar create) is still pending — it's
unrelated to portrait prompt composition. Could be
folded into the next slice or deferred until avatar
quality becomes a focus.
