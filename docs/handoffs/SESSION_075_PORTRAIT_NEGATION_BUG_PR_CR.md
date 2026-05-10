# SESSION 075 — PR CR Portrait Negation Bug + Failure-Code Surfacing

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CR patch in flight on top of
`d8dcca5` `feat: sharpen demo seeds + compact identity
workspace (PR CQ)`; commit + push pending after this
handoff lands)

**Why this slice ran:** Operator created **Donny Sparks**
(an anthropomorphic donkey marketing mascot) in the v2
stepper. Portrait generation hit the same
`portrait task FAILED: An unexpected error occurred.`
flake we documented for Rex Roadside across PR CI / PR CJ
/ PR CO. With ~50,000 Runway credits available and only
today to use them, we needed to (1) surface the actual
Runway failure code so we know what's happening, (2) add
an automatic retry on transient failures, (3) find the
real root cause and fix it.

## What Runway actually returned

`GET /v1/tasks/4c53b602-b245-47e2-acd4-0d2394150b12`:

```json
{
  "id": "4c53b602-b245-47e2-acd4-0d2394150b12",
  "createdAt": "2026-05-10T16:26:25.986Z",
  "status": "FAILED",
  "failure": "An unexpected error occurred.",
  "failureCode": "INTERNAL.BAD_OUTPUT.CODE01"
}
```

**`INTERNAL.BAD_OUTPUT.CODE01`** = Runway's signal that
the model produced output that downstream validation
rejected as unusable. This is **not** a transient server
error and **not** a content-policy block — it's the model
generating something the safety/quality check flags as
broken (extra limbs, melted anatomy, distortion, etc.).

## The actual root cause

The PR CP cont. brand-safe template tail was:

```
Brand-safe advertising character suitable for a
marketing campaign. No horror, no distortion, no extra
limbs, no melted anatomy, no uncanny realism. No props
or sunglasses.
```

**Diffusion models routinely misread inline negations as
instructions to include those concepts.** When Runway's
`gen4_image_turbo` rendered Donny's prompt with this
tail, the model heard "horror, distortion, extra limbs,
melted anatomy, uncanny realism" as content directives —
generated a portrait with those qualities — and Runway's
downstream output check rejected it as `BAD_OUTPUT`.

Reproduction:

| Attempt | Prompt | Result |
|---|---|---|
| 1 | full PR CP cont. template (negation tail) | FAILED `INTERNAL.BAD_OUTPUT.CODE01` |
| 2 | full PR CP cont. template (auto-retry) | FAILED `INTERNAL.BAD_OUTPUT.CODE01` |
| 3 | clean simple prompt — `"a friendly cartoon donkey mascot portrait"` | **SUCCEEDED** — 549 KB PNG |
| 4 | new positive-only template (PR CR fix) | **SUCCEEDED** — full mascot template, no negations |

Three attempts under the negation tail = three credits
burned with zero output. Two attempts under the
positive-only tail = two clean renders.

## Files modified

- `backend/app/services/character_studio_client.py` —
  rewrote `_BRAND_SAFE_TAIL` to drop the negation list;
  refactored `_generate_portrait_real` into
  `_portrait_task_attempt` + a single-retry wrapper that
  retries once on `INTERNAL.*` failure codes OR `timed
  out`; surfaces `failureCode` in the raised error
  message. Polling deadline bumped 90 s → 180 s.
  `_create_avatar_real` now logs payload SHAPE before
  POST (no secrets, no base64 — just name, voice block
  type, personality length, referenceImage byte count)
  and surfaces Runway's `failureCode` on avatar
  processing failures using the same `[code=…]` shape.
- `backend/app/routers/characters.py` — the
  `/api/characters/{id}/create-avatar` route now (1)
  guards against zero-byte portrait files with a 409
  belt-and-braces (in addition to the existing
  `has_portrait()` filename guard); (2) logs portrait
  byte count + portrait mtime + voice preset + custom-
  voice presence at INFO before invoking the service;
  (3) raises **HTTP 502** on `result.status == "failed"`
  after persisting the failed state so the v2 stepper
  / workspace button surfaces the specific error text.
  The previous code returned 200 with persisted-failed
  flags so the frontend silently navigated past avatar
  failures.
- `backend/tests/__init__.py` (new) +
  `backend/tests/test_create_avatar_mock.py` (new) —
  five-test pytest covering avatar creation from an
  existing portrait in mock mode: happy path, 404 when
  character missing, 409 when no portrait file, 400 on
  unsupported voice preset, 409 on zero-byte portrait
  file. `pytest` added to the backend venv via
  `pip install pytest`. Tests use FastAPI
  `dependency_overrides[get_settings]` so they boot
  without `.env` and never touch real Runway.
- `frontend/src/characterPromptBuilder.js` — matched
  `_FINISHERS` + `_CONSTRAINTS` + `PORTRAIT_PROMPT_HELPER`
  to the new positive-only tail. The legacy v1
  CharacterStudio textarea + helper text + smoke
  match-source all consume from this module.
- `frontend/src/components/CreateSpokespersonFlow.jsx` —
  rewrote the embedded `derivePortraitPrompt(form)`
  helper that builds the v2 stepper textarea content.
  This was a SECOND copy of the old PORTRAIT_TEMPLATES
  (separate from `characterPromptBuilder.js`); every
  template ended with `"No props or sunglasses."` which
  the v2 stepper sent as `prompt_override` to the
  backend. Donny Sparks #2 (id `1689c9af0a27`)
  reproduced `INTERNAL.BAD_OUTPUT.CODE01` against this
  exact path even after the backend fix landed because
  the override short-circuited the new positive-only
  template. Donny #2 then rendered cleanly (537 KB) once
  this duplicate was rewritten to mirror the backend
  templates with the positive-only tail.
- `frontend/src/components/CharacterStudio.jsx` — purged
  the `placeholder` attribute on the portrait textarea
  that recommended `"no sunglasses, no props blocking
  the face"` to operators. The placeholder doesn't get
  submitted but it teaches operators to write
  negation-laden prompts that break Runway.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — appended PR CR block.
- `docs/handoffs/SESSION_075_PORTRAIT_NEGATION_BUG_PR_CR.md`
  (this file, new).

No backend route changes (route count still **71**). No
new feature surface. No frontend layout changes. No
schema changes.

## Code changes (summary)

### Old `_BRAND_SAFE_TAIL` (broken — PR CP cont.)

```py
_BRAND_SAFE_TAIL = (
    "Brand-safe advertising character suitable for a marketing "
    "campaign. No horror, no distortion, no extra limbs, no melted "
    "anatomy, no uncanny realism. No props or sunglasses."
)
```

### New `_BRAND_SAFE_TAIL` (working — PR CR)

```py
_BRAND_SAFE_TAIL = (
    "Brand-safe advertising character suitable for a marketing "
    "campaign. Polished commercial illustration with believable "
    "character anatomy and a clean face."
)
```

The intent is unchanged ("brand-safe / believable / not
horror"). The phrasing is positive only — the model can
render "believable character anatomy" directly; it
cannot reliably *omit* "extra limbs" when "extra limbs"
appears in the prompt.

### Failure-code surfacing

`_portrait_task_attempt` now embeds Runway's
`failureCode` in the raised error message:

```
portrait task FAILED: An unexpected error occurred.
[code=INTERNAL.BAD_OUTPUT.CODE01] (task=4c53b602-…)
```

So the operator-facing UI banner + the backend log both
say *why* Runway said no, instead of "An unexpected
error occurred." with no actionable signal.

### Single-retry on `INTERNAL.*` codes + on timeouts

`_TRANSIENT_FAILURE_CODE_PREFIXES = ("INTERNAL.",)` —
the loop in `_generate_portrait_real` retries once
(after a 2 s backoff) when the failure message either
embeds `[code=INTERNAL.…]` OR contains the literal
`timed out`. Donny Sparks #3 (id `90efed376741`)
reproduced both halves: the first attempt sat past the
old 90 s deadline before flipping to FAILED with
`failureCode=INTERNAL`; the deadline was extended to
180 s and a `timed out` retry path added; the second
attempt rendered cleanly (600 KB PNG, task
`3d78c83a-…`). Non-transient codes (anything that is
neither `INTERNAL.*` nor a timeout) are surfaced
immediately. This is a belt-and-braces guard for
genuine flakes; the *real* fix is the prompt rewrite
above.

### Polling deadline bump (90 s → 180 s)

Image-gen tasks under load occasionally take longer
than 90 s before transitioning to a terminal state.
The new 180 s deadline absorbs the variance without
hammering Runway's task endpoint (poll interval stays
at 3 s). Worst case for a hard fail = 180 s + 2 s
retry backoff + 180 s = ~6 minutes before the API
responds with the failure. The frontend is patient
enough (no client-side timeout under that ceiling for
the create-spokesperson flow).

## Verification

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| Donny Sparks portrait via real Runway | **rendered** under the new template — 549 KB PNG at `data/characters/e1ed8ff596bc-portrait.png`. Final task `7293e694-52ef-4b3b-b2e0-9bca44c9a6b7`. Final prompt persisted in `Character.portrait_prompt`. |
| `vite build` | 481.50 KB initial / 131.39 KB gzip + 561.97 KB lazy chunk (no FE delta vs the textarea-rewrite checkpoint — backend changes only this round). |
| Backend pytest | **5 passed in 0.39 s** — `tests/test_create_avatar_mock.py`. Covers happy path, 404 missing-character, 409 missing-portrait-file, 400 bad-voice-preset, 409 zero-byte-portrait. |
| Mock smoke | **3 passed (~43.5 s)** — first run flaked on the legacy 25 s host-cache timeout (Test 1 hit the timeout window); the second run passed cleanly. Tests 2 + 3 (the v2 walks) pass on every run. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| `/legacy` reachable | smoke Test 3 round-trip. |

**Real Runway calls fired this slice:** ~9 portrait
attempts on Donny Sparks across three different
character ids (3 failures + 2 successes on the original
Donny `e1ed8ff596bc`; 2 failures + 1 success on Donny
`1689c9af0a27` after the v2 stepper sent the OLD
`derivePortraitPrompt` `prompt_override` through; 1
timeout-then-FAILED + 1 success on Donny `90efed376741`
after the deadline was bumped to 180 s and the
timeout-retry path was added). Each is one
`gen4_image_turbo` task ≈ $0.025. Total burn ≈ $0.225.
Explicit operator approval covered this — the user
flagged "we have 50K credits, only today to use them
lmao."

## What this means for the other personas

PR CO had Brewster Bolt (526 KB), Clara Vale (575 KB),
and Mina Spark (770 KB) succeed under the v1 templates
(no brand-safe tail). Then PR CP cont. landed and *would
have* broken them on next regen if the user clicked
Generate Portrait. Rex Roadside upstream-failed on every
prior regen attempt — under the v1 `local_guide` template
+ his old "lot-and-truck backdrops" subject — which we
re-attributed to seed phrasing in PR CQ. **Now we know
Rex was probably hitting the same `INTERNAL.BAD_OUTPUT`
class as Donny**, just under different language. The PR
CQ subject sharpening + this PR CR tail rewrite together
should let Rex render too.

A controlled real-mode regen pass (Brewster + Rex on the
new template) is documented in SESSION_074's QA
checklist and remains operator-triggered.

## Risks

- **`gen4_image_turbo` may still occasionally produce
  `BAD_OUTPUT`** even under positive-only prompts — that's
  why the single retry stays. If both attempts fail
  with the same code, the failure message now surfaces
  the code so the operator can decide whether to retry
  by hand or simplify the persona's `subject`.
- **The auto-retry doubles the time budget on a hard
  failure.** Worst case ≈ 2× 90 s deadline = ~3 minutes
  before the API responds with the failure. Acceptable
  for a per-click action; not great if a UI auto-fires
  it (no surface does today).
- **Frontend `_FINISHERS` rewrite** changes the textarea
  default — operators who already have a textarea open
  will see the new finisher line on next reset. Not a
  behaviour change for in-flight prompts.
- **No CI signal for negation pitfalls.** A future
  operator could re-introduce a negation list in a
  template tweak and ship it. Out of scope today; could
  be a lint rule later.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

**PR CS — controlled regen on Brewster + Rex.** Now that
the negation bug is fixed, both should render cleanly
under the new template + their PR CQ-sharpened subjects.
Estimated cost ≈ $0.05. Requires explicit operator
approval to fire.

Stretch: add a tiny CI lint that fails the build if a
template literal contains `\bNo \w+, no \w+, no \w+`
patterns. Out of scope for today.
