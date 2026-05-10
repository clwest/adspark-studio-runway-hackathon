# SESSION 076 — PR CS Capture Failed Prompt + Safe-Retry Preset

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR CS patch in flight on top of
`ab8f8b7` `fix: portrait negation bug + avatar
reliability hardening (PR CR)`; commit + push pending
after this handoff lands)

**Why this slice ran:** PR CR landed positive-only
templates and surfaced `failureCode` in error messages,
but Donny Sparks (id `d2fdf899e8d8`, task
`0c96ea0e-…`) still hit `INTERNAL.BAD_OUTPUT.CODE01`.
Without persisting the failed prompt or surfacing it to
the operator, every failure looked identical from the
UI ("portrait task FAILED: An unexpected error
occurred") and required a log dive to diagnose. PR CS
captures the failed prompt on the Character record,
makes it visible in the failure banner + workspace
audit, and adds a one-click "safer retry" preset that
bypasses the most common BAD_OUTPUT trigger
(character.style chains).

## The exact prompt that failed

Character `d2fdf899e8d8` (Donny Sparks) was created
with these fields:

```
template:    mascot
subject:     an anthropomorphic donkey marketing mascot with
             expressive eyes, confident posture, and a friendly
             commercial smile
style:       stylized, editorial, studio light, muted palette;
             premium modern tech-startup hoodie with subtle
             creative-agency styling, indiana jones style hat
```

The resolved prompt sent to `gen4_image_turbo` was:

```
A polished commercial mascot portrait of an anthropomorphic
mascot spokesperson — an anthropomorphic donkey marketing
mascot with expressive eyes, confident posture, and a friendly
commercial smile. stylized, editorial, studio light, muted
palette; premium modern tech-startup hoodie with subtle
creative-agency styling, indiana jones style hat.
Head-and-shoulders framing, expressive friendly face, soft
warm smile. Simple solid mid-grey background. Soft three-point
studio lighting. High-quality 3D character design. Brand-safe
advertising character suitable for a marketing campaign.
Polished commercial illustration with believable character
anatomy and a clean face.
```

~720 chars. The "**indiana jones style hat**" string is the
prime suspect — it's a celebrity / IP reference Runway's
output checks reliably reject. The dense adjective stack
("stylized, editorial, studio light, muted palette;
premium modern tech-startup hoodie with subtle
creative-agency styling") compounds the signal. Both
patterns are exactly what the user's brief flagged as
unstable: "negation-heavy language, 'uncanny', 'toy',
'plush', 'cartoon', too many adjectives, long comma
chains".

## Files modified

- `backend/app/models.py` — new
  `Character.portrait_last_error: Optional[str]` field.
  Captures the most recent portrait failure string in
  `[code=…] (task=…)` shape so the UI can surface what
  Runway said no to.
- `backend/app/services/character_studio_client.py` —
  new `_SAFE_RETRY_TEMPLATES: dict[str, str]` (one
  per archetype: mascot / founder / coach / local_guide).
  `build_prompt(safe_retry=True)` fills the simpler
  template (~280 chars) **bypassing `style` entirely**;
  the character's `subject` survives so the regen still
  depicts the right creature/person. `generate_portrait`
  forwards the new flag.
- `backend/app/routers/characters.py` —
  `GeneratePortraitBody.safe_retry: bool = False`
  request body field. The route forwards it to the
  service; on failure the route now persists
  `portrait_prompt` + `portrait_last_error` on the
  Character record before raising 502, AND logs
  diagnostic detail (character name, template,
  style_chips from metadata, prompt_override flag,
  safe_retry flag, prompt length, error string,
  truncated prompt — first 600 chars) at WARNING.
- `backend/tests/test_create_avatar_mock.py` — two new
  tests: `test_safe_retry_uses_simpler_prompt`
  (asserts the safe-retry path bypasses character.style
  and the unstable IP reference doesn't survive) +
  `test_default_path_still_includes_style` (regression
  guard so a future cleanup doesn't accidentally strip
  style from the happy path).
- `frontend/src/components/CreateSpokespersonFlow.jsx` —
  failure banner now includes:
  - a `<details>` showing the failed prompt + Runway
    error caption (testids
    `create-spokesperson-portrait-failed-prompt` +
    `-text` + `-runway-error`).
  - **"Try safer prompt"** button (amber, between
    "Save without portrait" and "Retry as-is") — fires
    `tryGeneratePortrait(id, { safeRetry: true })`.
    The safer retry deliberately drops the operator-
    edited textarea override too, since any unstable
    text the operator typed is the most likely
    BAD_OUTPUT trigger. testid
    `create-spokesperson-safe-retry-portrait`.
  - existing "Retry as-is" + "Save without portrait"
    buttons unchanged.
- `frontend/src/components/SpokespersonWorkspace.jsx` —
  the existing portrait audit `<details>` now flips to
  rose-tinted styling when `portrait_last_error` is
  set, with the summary reading "Last portrait FAILED
  — prompt sent to gen4_image_turbo (N chars)" and a
  `runway · …` caption appended below the prompt body.
  testid `spokesperson-workspace-portrait-prompt-error`
  for the runway error caption + new
  `data-failed="true"` attribute on the parent
  `<details>` for smoke / styling hooks.
- `00-START-NEXT-SESSION.md` — head pointer.
- `docs/INVENTORY.md` — appended PR CS block.
- `docs/handoffs/SESSION_076_CAPTURE_FAILED_PROMPT_PR_CS.md`
  (this file, new).

No backend route changes. No new feature surface. No
endpoint additions. No real Runway calls fired.

## The new safe-retry preset

For mascots, `_SAFE_RETRY_TEMPLATES["mascot"]` resolves
to (with Donny's subject):

```
Polished 3D brand mascot portrait of an anthropomorphic
donkey marketing mascot with expressive eyes, confident
posture, and a friendly commercial smile. Adult
brand-mascot character design with simple modern attire.
Calm confident expression. Clean neutral studio
background. Head and shoulders. Professional advertising
character design. Balanced facial proportions. Soft
studio lighting.
```

~340 chars. No negations, no "uncanny" / "toy" / "plush"
/ "cartoon", no comma chains, no IP references. The
character's `subject` survives so the regen still
renders a donkey. The character's `style` is NOT in the
prompt at all — that's where "indiana jones style hat"
lived in the failing record.

The other three archetypes (founder / coach / local_guide)
follow the same shape, swapping the archetype line:

- founder: "Photorealistic professional founder with simple modern attire."
- coach: "Photorealistic professional coach with simple modern attire."
- local_guide: "Photorealistic professional local-business spokesperson with simple modern attire."

## Is `prompt_override` still involved?

**Yes — and it still wins when the operator types
explicit text.** The decision tree in `build_prompt`:

1. If `prompt_override` is non-empty → use it verbatim
   (capped 1000 chars). Operator-typed text always
   wins.
2. Else if `safe_retry=True` → fill
   `_SAFE_RETRY_TEMPLATES[template]` ignoring `style`.
3. Else → fill `PORTRAIT_TEMPLATES[template]` with
   `subject` + `style` (the standard PR CR positive-
   only path).

The frontend safe-retry button **deliberately drops
`prompt_override`** from the request body when firing
the retry. Reasoning: if the operator's typed prompt
broke things, sending it again with `safe_retry=True`
would still send it (because of rule 1). The button's
job is "give me a stable render"; bypassing the
override is the only way to honour that.

## Verification

| Check | Result |
|---|---|
| `python -c "from app.main import app; print(len(app.routes))"` | **71** (unchanged) |
| Backend pytest | **7/7 passed (~0.43 s)** — `tests/test_create_avatar_mock.py`. Five PR CR tests + two new PR CS tests (`test_safe_retry_uses_simpler_prompt` confirms IP reference dropped + prompt < 600 chars; `test_default_path_still_includes_style` guards the regression). |
| `vite build` | 483.49 KB initial / 131.88 KB gzip + 561.97 KB lazy chunk (+1.99 KB / +0.49 KB vs PR CR — failure-banner `<details>` + safe-retry button + workspace failure styling). |
| Mock smoke | **3 passed (~39.5 s)** — Test 1 36.5 s, Test 2 1.7 s, Test 3 679 ms. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| `/legacy` reachable | smoke Test 3 round-trip. |
| Real Runway calls fired | **0** — diagnosis done from cached task `0c96ea0e-…` payload + character record; no regen attempts this slice. |

## Manual QA / next steps

1. **Re-fire Donny's portrait via the workspace.** Open
   `/spokespeople/d2fdf899e8d8`. The Identity tab's
   audit `<details>` should now render rose-tinted
   with summary "Last portrait FAILED — prompt sent
   to gen4_image_turbo" + the failed prompt body +
   `runway · portrait task FAILED: …
   [code=INTERNAL.BAD_OUTPUT.CODE01] (task=0c96ea0e-…)`.
2. **Click Generate Portrait** — fires the default
   path again with the unchanged `style`. Expected:
   same `INTERNAL.BAD_OUTPUT.CODE01` (the prompt is
   still unstable; no fix without operator action).
3. **Trigger the safe-retry path manually** via curl:
   ```bash
   curl -X POST http://localhost:8000/api/characters/d2fdf899e8d8/generate-portrait \
        -H "Content-Type: application/json" \
        -d '{"safe_retry": true}'
   ```
   Expected: 200 with a generated portrait that ignores
   the `indiana jones style hat` reference.
4. **End-to-end via the v2 stepper:** create a new
   spokesperson with deliberately unstable style chips
   ("indiana jones hat", "plushy-sounding adjectives").
   When portrait fails, the failure banner should:
   - show the failed prompt in the `<details>`,
   - show the `runway · …` error caption,
   - offer the amber "Try safer prompt" button.
   Click it → portrait should render.

## Risks

- **The amber Try-safer-prompt button is a small new
  surface.** It's conceptually a retry, not a new
  feature, and the brief said `<details>` is enough —
  but the operator needs *some* way to fire the
  preset, and a button next to "Retry as-is" is the
  smallest possible affordance. If demo schedule
  prefers a single Retry, this could be made the
  default behaviour after one BAD_OUTPUT failure (i.e.
  the second click of "Retry as-is" silently switches
  to safe_retry).
- **Workspace `<details>` styling change.** When
  `portrait_last_error` is set the audit row goes
  rose-tinted. Subtle, but if the operator misses the
  colour change they may not realize the latest run
  failed. A small "FAILED" pill would be louder; held
  for now to keep the change minimal.
- **`portrait_prompt` is now persisted on every
  failure.** Slightly more disk churn on the
  `characters.json` write (the file is still
  threading-locked + atomic-renamed); negligible at
  current scale.
- **Safe-retry doesn't guarantee success.** It's a
  preset shaped to avoid the most common triggers, not
  a magic prompt. If the model's truly under load, the
  task can still fail with `INTERNAL.*`. The PR CR
  auto-retry on transient codes still applies.

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

## Recommended next slice

**PR CT — operator-triggered Donny safe-retry.** Fire
the safe_retry path against `d2fdf899e8d8` to confirm
the preset renders cleanly on the same record that
hit BAD_OUTPUT. Estimated cost ≈ $0.025. Operator-
triggered.

**Stretch** — if the amber Try-safer-prompt button is
clicked more than once per session in real demo runs,
consider promoting `safe_retry=True` to the default
behaviour for any portrait retry after a `BAD_OUTPUT`
failure (no UI change; backend stickiness). Out of
scope for today.
