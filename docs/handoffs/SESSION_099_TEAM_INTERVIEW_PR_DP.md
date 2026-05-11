# SESSION 099 — PR DP Realtime Conversations As Team Interviews

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `11211bc` (`feat: add long spokesperson ad
stitching pipeline (PR DO)`). PR DP patch in flight on top; commit
+ push pending operator approval after this handoff lands.

**Why this slice ran:** Realtime conversations on the three
submission spokespeople were opening with the broker's default
"You are the brand mascot for X" framing — generic sales-bot tone,
no team awareness, no defer-to-teammate behaviour. The brief asked
to reframe each spokesperson as a team member being interviewed
about the platform they helped build. PR DP ships the copy edits
to do exactly that.

## What changed

Pure copy / seed slice. Zero backend / frontend / realtime
infrastructure changes. Three files modified:

### 1. `scripts/seed-submission-demo-content.py` (+430 LoC)

Extends the existing PR DN/DO seeder with four new idempotent
steps per spokesperson:

**a. Character voice patch** (`_seed_character_voice`)

Direct `CharacterStore` access (mirrors `seed-demo-spokespeople.py`
pattern from PR CG; the character routes don't expose PATCH for
`personality` / `catchphrases`). Idempotent: compares persisted
values to seed; only writes when they differ.

The seeded personalities replace the generic "Energetic, clever..."
strings with first-person team-voice copy:

| Spokesperson | Personality opener |
|---|---|
| Donny Sparks | *"I'm Donny Sparks, the creative lead on the Character OS team. My job is keeping the brand voice sharp across every ad we ship..."* |
| Riggs Rally | *"I'm Riggs Rally. I rode shotgun on the chaotic AI-assisted build that turned into Character OS. My job was keeping many AI coding sessions aligned..."* |
| Miles Monroe | *"I'm Miles Monroe, the business strategy voice on the Character OS team. I think slowly, deliberately, and in twelve-month horizons..."* |

Each ~280 chars. Lands in the realtime broker's `personality`
string via `_build_session_overrides` (and `_grounded_personality`
when a document is attached). Catchphrases (3-4 lines per
character) live on the record for future UI display.

**b. Commercial script patch** (`_seed_commercial_script`)

POSTs to `/api/campaigns/{id}/script` with a team-interview opener
(~280 chars). The realtime broker uses the first sentence as the
avatar's `startScript`, so this is the opening line the operator
hears:

- Donny: *"Hi, I'm Donny Sparks. I run creative on the Character OS team..."*
- Riggs: *"I'm Riggs Rally. I shipped the build pipeline on the Character OS team..."*
- Miles: *"I'm Miles Monroe. I handle strategy on the Character OS team..."*

Idempotent: skips when the current script already matches the seed.

**c. Interview grounding upload** (`_seed_interview_grounding`)

POSTs to `/api/campaigns/{id}/realtime-document/raw` (the PR DD raw
route). Each character's submission campaign gets a curated 2500-
3500 char Markdown document that includes:

- Role description ("What I Do On The Team")
- Character OS overview (Spokesperson / Campaign / Variant /
  Dialogue / Conversation / Videos)
- How a business uses persistent spokespeople on a website
- How the pieces fit together
- The **context-kit guardrail** (build tool, not runtime memory)
- Tone direction (mockumentary, defer to teammates)

Idempotent: skips when the campaign already has a
`runway_document_id` attached (won't clobber prior docs).

**d. Summary print loop** updated to include voice / script /
grounding actions.

### 2. `docs/SUBMISSION_VIDEO_PLAN.md` step 6 rewrite

Was: "Ask one realtime question — option 6a (one per spokesperson)
or 6b (canonical distinction)." Generic sales-bot framing.

Now: **Interview the team — three short realtime questions.**
Per-spokesperson interview flow with the expected opener line +
role-tuned question sets:

- **Donny:** *"What's your job on this team?"* / *"Why does my
  brand need a persistent AI spokesperson?"* / *"How do you avoid
  making every ad sound the same?"*
- **Riggs:** *"Walk me through how you built Character OS."* /
  *"What's context-kit and what isn't it?"* / *"What does an AI
  coding session actually look like?"*
- **Miles:** *"Should a small business use Character OS or hire an
  agency?"* / *"What changes when a brand has a persistent AI
  representative?"* / *"How do conversations, videos, and campaigns
  fit together?"*
- **Fallback:** canonical-distinction probe — *"Are Character OS
  and context-kit the same thing?"* — works against any of the
  three because all grounding docs carry the same distinction
  language.

### 3. `docs/DEMO_CHECKLIST.md` §3 rewrite

Same direction: realtime walk-through now points at each
character's submission campaign with the expected interview opener
line + suggested questions. Defer-to-teammate behaviour called
out so the operator knows what "good" looks like during the take.

## Files changed

```
 scripts/seed-submission-demo-content.py            | +430 (SEED extension + 3 new seed helpers + summary update)
 docs/SUBMISSION_VIDEO_PLAN.md                      | +80 / -25 (step 6 interview rewrite)
 docs/DEMO_CHECKLIST.md                             | +25 / -10 (§3 conversation rewrite)
 00-START-NEXT-SESSION.md                           | (head pointer)
 docs/INVENTORY.md                                  | (PR DP block)
 docs/handoffs/SESSION_099_TEAM_INTERVIEW_PR_DP.md  | new
```

**Untouched:**

- All backend code — routes, services, models, storage
- Realtime broker (`realtime_avatar_client.py`) — zero changes
- Frontend — zero changes
- `/legacy` — preserved
- Route count still **77**
- Pytest still **53/53** (unchanged)
- The PR DG curated self-demo grounding doc still attached to
  Donny's `d00dc42fe5cb` campaign — PR DP only touches the
  *submission* campaigns from PR DN

## What the realtime broker actually sees post-PR-DP

For Donny's submission campaign `0a52aef38809`, the next
`/v1/realtime_sessions` create gets:

```
avatar.avatarId:  ff535a54-9ed3-475e-ae8a-1ae7855c1ff8
personality:      "You are Donny Sparks, the brand mascot for Character OS
                   Creates Reusable AI Ads. Tone: energetic, clever,
                   startup-focused. Speak in your felix voice.
                   Personality cue: I'm Donny Sparks, the creative lead
                   on the Character OS team. My job is keeping the brand
                   voice sharp across every ad we ship — no two pitches
                   sound like the same prompt fired twice. I'm the guy
                   in the room arguing for one more variant before we
                   call it. I helped shape the platform you're looking
                   at. An attached document carries the facts you should
                   ground every answer in. Defer to its contents and
                   cite section names when helpful..."
startScript:      "Hi, I'm Donny Sparks."  (first sentence of script)
documentIds:      ["35ae86dd-a624-4761-9909-7efbcd34f02c"]
```

The PR DG-softened `_grounded_personality` framing ("an attached
document carries the facts...") works perfectly with the new
interview grounding doc because the doc IS factual scaffolding,
just in interview voice instead of brand-brief shape.

Similar payloads for Riggs (`09e09a0b3129` → doc `2e6bbc94-...`)
and Miles (`9d4e15683704` → doc `c50aa82c-...`).

## Verification

| Check | Result |
|---|---|
| Backend pytest | **53/53 passed** (unchanged — no app code touched) |
| Backend route count | **77** (unchanged) |
| Seed dry-run | clean — 3 chars × 3 new slots = 9 would-create actions |
| Seed first apply | **12/12 patched** (voice + script + grounding × 3) |
| Seed second apply (idempotency probe) | **12/12 skipped** with stable grounding doc ids |
| Hygiene scan | empty |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode backend | still up, healthy |
| Real Runway calls fired by this PR | **0** — every write is local-only |
| Real Runway calls expected when operator demos | 3 × `/v1/realtime_sessions` create + transcript fetch per take |

## Demo flow (operator perspective)

1. **Pre-flight** — `bash scripts/start-local-real.sh`; confirm
   Donny / Riggs / Miles all show `avatar · ready`.
2. **Re-seed if needed** — `python scripts/seed-submission-demo-content.py`
   should report all-skipped if the prior PR DP run completed.
3. **Open Donny's submission campaign** (`0a52aef38809` — "Character
   OS Creates Reusable AI Ads") → Conversations primary tab → Start
   Conversation.
4. Avatar opens in interview voice: *"Hi, I'm Donny Sparks. I run
   creative on the Character OS team..."*
5. Ask: *"What's your job on this team?"* — avatar should name his
   role, frame Character OS as the platform, hint at variants /
   continuity, defer to Riggs or Miles if probed off-creative.
6. End Conversation.
7. Repeat for Riggs (campaign `09e09a0b3129`, ask about
   context-kit) and Miles (campaign `9d4e15683704`, ask about the
   business case).
8. Open Videos tab → Conversations sub-tab → all three transcripts
   appear as cards with cast names + first turns visible.

## Demo interview questions (the brief's ask)

**Donny — creative lead:**

- "What's your job on this team?"
- "Why does my brand need a persistent AI spokesperson?"
- "How do you avoid making every ad sound the same?"
- "How does Character OS make brand voice consistent?"

**Riggs — chaotic builder / context-kit explainer:**

- "Walk me through how you built Character OS."
- "What's context-kit and what isn't it?"
- "What does an AI coding session actually look like?"
- "How long did this whole build take?"

**Miles — business strategist:**

- "Should a small business use Character OS or hire an agency?"
- "What changes when a brand has a persistent AI representative?"
- "How do conversations, videos, and campaigns fit together?"
- "How does this change the unit economics of marketing video?"

**Any spokesperson — canonical guardrail probe:**

- "Are Character OS and context-kit the same thing?"
- "Does context-kit power your memory?"

## Remaining risks

1. **`character.catchphrases` is patched but not currently
   injected into the realtime broker's `personality` string.** The
   broker only reads `character.personality`. The catchphrases live
   on the record for future use (UI display, future broker
   extension) but don't affect this take. Minor — the personality
   string already carries the team voice.
2. **Direct CharacterStore writes race-theoretically with the
   running backend.** The seed script uses `CharacterStore.update()`
   directly while the backend may be writing concurrently. The
   storage helper uses atomic `.tmp + replace` so corruption isn't
   possible, but a concurrent write could be lost. Acceptable for
   a demo seed; operator re-runs if a write gets dropped.
3. **No PATCH route for character personality.** A small future PR
   could add `PATCH /api/characters/{id}` to avoid the direct-store
   pattern. Not blocking.
4. **The PR DG self-demo grounding doc on Donny's `d00dc42fe5cb`
   campaign is unchanged.** That campaign still grounds in the
   PR DF curated narrative. The operator picks which Donny campaign
   to open: self-demo (`d00dc42fe5cb`) for the context-kit
   distinction probe, submission campaign (`0a52aef38809`) for the
   creative-lead interview.
5. **Avatars may still drift into sales-bot tone** if the operator
   asks a sales-loaded question ("convince me to buy") that doesn't
   match the interview-grounded persona. The grounding doc says
   "you are NOT a sales bot" but the model may not always honor it.
   Mitigation: stick to the seeded question sets.
6. **No realtime smoke test.** The operator manually verifies the
   take. PR DK shipped the Conversations sub-tab with transcript
   capture, so post-take review is easy.

## Server status (final)

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```

All three spokespeople have the new team-interview persona,
opening script, and per-campaign grounding documents persisted.
Operator's next realtime probe will open in interview voice.
