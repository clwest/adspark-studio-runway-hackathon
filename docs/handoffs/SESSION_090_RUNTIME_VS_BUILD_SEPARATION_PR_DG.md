# SESSION 090 — PR DG Runtime vs Build-Tool Separation

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `08cc590` (`fix: separate Character OS
runtime behavior from context-kit build tooling (PR DF)`). PR DG
patch in flight on top; commit + push pending operator approval
after this handoff lands.

**Why this slice ran:** PR DF tightened the curated grounding doc's
language but the deeper PR DG audit (this session) found that the
*runtime* contamination was not coming from the grounding document
at all — it was coming from (a) the campaign's brief fields
(`product` literally read *"Context-kit demo grounding for the
realtime spokesperson"*), (b) a Riggs dialogue preset line that
mentioned context-kit in a Character OS demo video, and (c) a
broker hardcoded paragraph that misframed any attached document as
a "brand brief carrying product / audience / hook / caption / CTA".
PR DG audits and fixes the contamination *outside* the grounding
document itself.

## Audit findings — every context-kit-shaped hit, classified

Grep across 12 suspect terms (`context-kit`, `context kit`,
`context_kit`, `maintain context`, `memory protocol`, `continuity`,
`AI memory`, `project memory`, `filter`, `grounding`, `runtime
memory`, `spokesperson memory`) over the entire repo. 89 files
matched. Classification:

### 🟢 CATEGORY 1 — Developer / build tooling (preserved verbatim)

- `CLAUDE.md` — context-kit rules + drift guard discipline
- `scripts/check-context-kit-drift.sh` — drift script
- `scripts/upload-context-kit-demo-grounding.py` — curated narrative
  generator (script filename intentionally references the tool)
- `00-START-NEXT-SESSION.md`, `docs/INVENTORY.md` — context-kit anchors
- `docs/OPERATOR_USAGE_MAP.md:1798-1815` — drift-guard documentation
- All 80+ `docs/handoffs/SESSION_*.md` files — historical record

### 🟡 CATEGORY 2 + 5 — Product / runtime / UI copy (REWRITTEN)

#### 2a. `frontend/src/components/lanes/DialogueLane.jsx:610`

The Riggs slot-1 line in `HACKATHON_DEMO_LINES` previously read:

> *"Context-kit kept the AI builders from wandering into the woods.
> Mostly."*

This line would be spoken by the Riggs avatar in the Character OS
hackathon demo video — putting context-kit as a character mention
in *product output*. Even though the line is technically correct
about context-kit's purpose, the demo audience hears it inside a
Character OS demo reel and conflates.

**Rewrite:**

> *"Many AI coding sessions, one coherent build. Mostly. The dev
> tooling kept us aligned across PRs."*

Preserves the build-process narrative thread between Donny's
slot-0 line and Miles's slot-2 line without namedropping
context-kit in the spokesperson's spoken output.

#### 2b. `docs/DEMO_CHECKLIST.md` §1 (Riggs knowledge source)

Operator guidance previously said:

> *Riggs has at least one source (e.g. "Context-kit discipline"
> describing the runtime-anchors rules).*

This tells the operator to paste context-kit material *into*
Character OS's Knowledge tab — wrong because Knowledge sources are
a Character OS product feature, and pasting context-kit material
there blurs the line between build tool and product memory.

**Rewrite:** Suggested title becomes "Build-process notes" with an
explicit inline warning that the Knowledge tab is **Character OS
*product* memory** and context-kit does not belong in product
copy.

#### 2c. `docs/DEMO_CHECKLIST.md` §6 (self-demo brief template)

Previously prescribed:

```
Business: How Character OS Was Built
Product: Context-kit demo grounding for the realtime spokesperson
```

The broker injects `business` + `product` verbatim into the
spokesperson's system prompt (`realtime_avatar_client.py:253`) and
into the opening-line fallback (`:295`). With `product` set as
above, the avatar literally said *"I'm here to talk about [...]
Context-kit demo grounding for the realtime spokesperson"* — a
self-conflating opener no grounding document could overcome.

**Rewrite:**

```
Business: Character OS
Product: AI spokesperson platform built for the Runway hackathon
```

Plus a "why these exact fields" callout explaining the
broker's injection points with file:line citations so a future
operator doesn't accidentally re-introduce the same contamination.

### 🔴 CATEGORY 3 — Realtime prompt stack (BROKER SOFTENED + LIVE CAMPAIGN FIXED)

#### 3a. Broker `_grounded_personality` framing (code fix)

`backend/app/services/realtime_avatar_client.py:160-204`. The
original hardcoded paragraph injected into the personality string
when documentIds is set:

```
"An attached campaign brief document carries the product, "
"audience, hook, caption, CTA, and saved commercial script. "
"Ground every answer in that document. ..."
```

True for PR AI structured-route documents. **False** for PR DD
raw-route documents (the Character OS self-demo build-story doc).
The model is told the doc is shape A; the doc is actually shape B;
the model reconciles by injecting priors.

**Rewrite (neutral framing):**

```
"An attached document carries the facts you should ground "
"every answer in. Defer to its contents and cite section "
"names when helpful. Stay concise, warm, and honest. "
"Redirect politely if asked something the document does not "
"cover."
```

Works for both PR AI brand-brief uploads and PR DD raw-Markdown
uploads.

#### 3b. Live campaign data fix on `d00dc42fe5cb`

Two backend POSTs (zero Runway calls):

1. `POST /api/campaigns/d00dc42fe5cb/brief` —
   `business: "Character OS"`, `product: "AI spokesperson platform
   built for the Runway hackathon"`.
2. `POST /api/campaigns/d00dc42fe5cb/script` —
   `script: "Hi, I'm Donny Sparks. Ask me about Character OS — the
   AI spokesperson platform — or how it got built."`

The PR DF grounding document (`runway_document_id`
`47de9efd-c0b1-4405-a6bb-df72ee0bf257`) remains attached and
active. Only the campaign brief fields + the commercial_script were
mutated.

### 🟢 CATEGORY 4 — Self-demo grounding doc (TIGHTENED IN PLACE)

`scripts/upload-context-kit-demo-grounding.py` was already correctly
scoped by PR DE + PR DF. PR DG adds two tightening passes:

1. **Preamble framing paragraph** — explicit "this is the **build
   story / development process**, not Character OS's runtime memory"
   clarifier so the avatar treats Sections 2-3 as historical context
   and Section 4 as product reality.
2. **Section 3 lead** — opens with the two verbatim approved
   phrasings from the brief:
   > *"context-kit coordinated AI coding sessions during
   > development. It is the build tool. It is not part of the
   > product. context-kit helped the builders avoid drift across
   > PRs and handoffs."*

Document length 10,742 → **11,469 chars**. Still well under the 40k
cap.

## Final realtime prompt stack (for `d00dc42fe5cb` after PR DG)

Reported per the brief's "Need Exact Answer" section. Order is the
broker's assembly order (`realtime_avatar_client.py:308 create_session`).

| Source | Persistent? | Runtime-built? | From grounding? | From character? |
|---|---|---|---|---|
| `model: "gwm1_avatars"` | const | — | — | — |
| `avatar.avatarId: ff535a54-...` | persistent (campaign field) | — | — | (character.runway_avatar_id) |
| `personality` — grounded slim version | runtime | ✅ each session | — | character.name + template + voice_preset + personality |
| `personality` content: `"You are Donny Sparks, the brand mascot for Character OS. Tone: Honest, technical, brief. Speak in your felix voice. Personality cue: <Donny's clean character.personality>. An attached document carries the facts you should ground every answer in..."` | — | ✅ | — | ✅ |
| `startScript: "Hi, I'm Donny Sparks."` (first sentence of campaign.commercial_script) | persistent | ✅ trim per session | — | — |
| `documentIds: ["47de9efd-c0b1-4405-a6bb-df72ee0bf257"]` | persistent (campaign field) | — | ✅ PR DF curated doc | — |

**Zero context-kit conflation in any layer.** Grep proof below.

## Forbidden phrasing grep — after fix

Across the entire repo, excluding handoff docs (which intentionally
quote forbidden phrasings as documentation of what was forbidden):

```
"context-kit powers"               → 0 hits
"context-kit helps avatars"        → 0 hits
"context-kit is Character OS memory" → 0 hits
"context-kit filters the spokesperson" → 0 hits
"context-kit is the runtime brain"   → 0 hits
```

The pytest-only hits in `backend/tests/test_create_avatar_mock.py`
are inverted assertions (assert phrase NOT in content) — expected
and not contamination.

## Files changed

```
 frontend/src/components/lanes/DialogueLane.jsx                | Riggs dialogue line rewrite
 docs/DEMO_CHECKLIST.md                                        | §1 Riggs source + §6 brief template
 backend/app/services/realtime_avatar_client.py                | _grounded_personality softening
 scripts/upload-context-kit-demo-grounding.py                  | preamble framing + section 3 lead
 backend/tests/test_create_avatar_mock.py                      | +60 (2 new PR DG tests)
 00-START-NEXT-SESSION.md                                      | (head pointer)
 docs/INVENTORY.md                                             | (PR DG block)
 docs/handoffs/SESSION_090_RUNTIME_VS_BUILD_SEPARATION_PR_DG.md | new
```

**Plus one live data mutation on the running backend** (no commit
artefact — campaigns.json is gitignored):

- `campaigns.json:d00dc42fe5cb.business` "How Character OS Was Built" → "Character OS"
- `campaigns.json:d00dc42fe5cb.product` "Context-kit demo grounding for the realtime spokesperson" → "AI spokesperson platform built for the Runway hackathon"
- `campaigns.json:d00dc42fe5cb.commercial_script` `""` → `"Hi, I'm Donny Sparks. Ask me about Character OS — the AI spokesperson platform — or how it got built."`

**Untouched:**

- `/legacy` (per brief)
- Runway broker behaviour (only the prose inside `_grounded_personality`)
- All routes — count still **76**
- All models, all storage helpers
- Realtime broker control flow / session lifecycle
- The PR DF grounding document on `d00dc42fe5cb` (still id
  `47de9efd-...`, still active)
- 80+ handoff docs + CLAUDE.md + drift script (preserved as
  build tooling)
- Character `knowledge_sources` (verified not injected into broker)

## Verification

| Check | Result |
|---|---|
| Backend pytest | **36/36 passed (~1.28s)** — 32 prior + 2 PR DF + 2 PR DG |
| Backend route count | **76** (unchanged) |
| Frontend `vite build` | **clean** — 527.44 KB initial / 142.06 KB gzip + 561.97 KB lazy chunk |
| Script `--dry-run` | 7 section headings, **11,469 chars**, distinction line lands, preview clean |
| Forbidden phrasing grep | **0 hits** across .py/.jsx/.md (excluding handoff docs) |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real Runway calls fired | **0** — per brief |

## What was intentionally preserved

- All `docs/handoffs/SESSION_*.md` files — historical record. They
  document what was done at each session, including PRs that
  intentionally introduced or refined context-kit references. Even
  the PR DF handoff that documents the *forbidden phrasings list*
  is preserved verbatim, since deleting that documentation would
  make a future audit harder.
- The script filename `upload-context-kit-demo-grounding.py` — it
  is the canonical accessor for the self-demo grounding flow, and
  the name correctly describes the *upload mechanism* (uses
  context-kit-style discipline to keep the doc fresh against repo
  state).
- `CLAUDE.md`'s "Context-kit drift guard" section — that's the
  build rule and stays.
- All 48 occurrences of context-kit inside
  `scripts/upload-context-kit-demo-grounding.py` — they are inside
  the curated narrative *about* context-kit, properly framed in
  Sections 2-6 with explicit non-conflation rules. The PR DF + PR
  DG tightening passes make these mentions safe.

## Remaining risks

1. **Model hallucination overlap.** Even with the prompt stack
   fully cleaned, the Runway gwm-1 avatar model has training-corpus
   priors about "context protocol" / "memory layer" / "MCP-shaped"
   tools. When the user asks an ambiguous question
   ("what's your memory?"), the model could still reach for those
   priors. Mitigation: the grounding doc explicitly names Character
   OS's own memory features (grounding documents + knowledge
   sources) so the model has a concrete alternative to reach for.
2. **Operator could re-introduce contamination.** If a future
   operator creates a new self-demo campaign with `product:
   "context-kit thing"`, the same contamination returns. DEMO
   CHECKLIST §6 now has a "why these exact fields" callout citing
   `realtime_avatar_client.py:253` and `:295` to deter that.
3. **Avatar resource personality drift.** `GET /v1/avatars/<donny>`
   currently shows clean personality + `documentIds: []`. If a
   future PR re-enables the PR AI structured-route avatar PATCH
   path against Donny's avatar, stale documentIds could
   accumulate. Not currently a risk — only the PR AI structured
   route PATCHes, and only the PR DD raw route is being used for
   self-demo grounding.
4. **Live campaign data isn't versioned.** The brief + script
   mutations on `d00dc42fe5cb` are persisted only in `campaigns.json`
   (gitignored). If `backend/data/` is ever wiped and re-seeded
   from `scripts/seed-demo-campaigns.py`, the contamination
   reappears unless the seed script is also updated. Seed-script
   audit deferred — out of scope for PR DG.

## Operator next step (manual realtime probe)

Open `http://localhost:5173/` → Donny Sparks → "Character OS" tile
(was "How Character OS Was Built") → **Conversations** tab →
**Start Conversation**.

Probe with:

- *"What is your product?"* — avatar should say "Character OS, the
  AI spokesperson platform built for the Runway hackathon" or
  similar. Should NOT mention context-kit.
- *"Where does your memory come from?"* — avatar should name
  campaign grounding documents + character knowledge sources.
  Should NOT mention context-kit.
- *"How was Character OS built?"* — NOW context-kit can come up,
  but only via the curated grounding doc's Section 3 framing
  ("context-kit coordinated AI coding sessions during
  development").
- *"Are Character OS and context-kit the same thing?"* — clear
  "No" with the canonical distinction.

## Server status (final)

```
backend: http://localhost:8000 · pid 39805 · runway_mock=false
vite:    http://localhost:5173 · pid 39841 · http=200
```

Broker code change in `realtime_avatar_client.py` requires a
backend restart to load. Operator runs
`bash scripts/start-local-real.sh` after the PR DG push.
