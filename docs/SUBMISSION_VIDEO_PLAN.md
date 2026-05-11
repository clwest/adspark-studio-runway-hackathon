# Character OS — Submission Video Plan

7-step demo flow for the Runway hackathon submission video. Total
runtime target: **~90–120 seconds** (the same target the
`docs/DEMO_CHECKLIST.md` pre-record pass uses).

The submission should feel like:

> One person used AI to create a team of persistent AI spokespeople,
> and that team helped build and explain the hackathon product.

The team is small but distinct:

- **Donny Sparks** — creative campaign lead / product hype
- **Riggs Rally** — chaotic builder / dev workflow / context-kit explainer
- **Miles Monroe** — business strategist / value proposition
- *(Optional)* a brand-new spokesperson created **live** during the recording — proof that the platform can produce any brand character on demand

Before recording, run the idempotent seeder once so the three
spokespeople have demo-ready knowledge sources, campaigns, and ad
variants:

```bash
python scripts/seed-submission-demo-content.py
```

Seeded content (per PR DN):

| Spokesperson | Knowledge source | Campaign | Ad variant |
|---|---|---|---|
| Donny Sparks | Creative Campaign Builder | Character OS Creates Reusable AI Ads | Submission · Reusable AI Ads |
| Riggs Rally | Hackathon Build Process | How We Built Character OS | Submission · Build Story |
| Miles Monroe | Business Value of Persistent Spokespeople | Why Businesses Need Persistent Spokespeople | Submission · Business Value |

Re-running the script after the seed is safe — it skips anything
that already exists by title / business name.

---

## Recording flow (in order)

### 1. Open with a six-line Dialogue Scene

- Open any spokesperson's workspace → **Campaigns** tab → 🎭
  Dialogue Scene campaign → Step 3.
- Click **Load Hackathon Office Scene** (PR DH amber preset, PR DL
  six-line copy: Donny → Riggs → Miles, twice through).
- If the lane already shows 3 lines from an earlier session, click
  **Add 3 more lines** (PR DM amber button) to grow to 6 without
  destroying prior renders.
- Render each line × 6 → **Stitch Final Scene**.
- Play the stitched MP4 from the **Videos** tab at the top of the
  recording.

This is the cold open. It tells the audience immediately that the
spokespeople are real characters who can speak together.

### 2. Show Donny's spokesperson ad (creative angle)

- Switch to **Donny Sparks** workspace → **Campaigns** → click the
  "Character OS Creates Reusable AI Ads" campaign row.
- Step 2 already has the **Submission · Reusable AI Ads** variant
  (seeded by PR DN). Step 3 → **Render new Spokesperson Ad**.
- Switch to **Videos** tab → play the resulting card.

Talking point under the playback: *"Donny is the creative angle —
he speaks about Character OS as a campaign builder."*

### 3. Show Riggs's spokesperson ad (build story / context-kit)

- Switch to **Riggs Rally** workspace → **Campaigns** → "How We
  Built Character OS" → Render Spokesperson Ad → Videos tab → play.

Talking point: *"Riggs explains the build process — context-kit is
how we kept many AI coding sessions aligned, not Character OS's
runtime memory."* (This is the PR DF/DG/DH guardrail framing.)

### 4. Show Miles's spokesperson ad (business value)

- Switch to **Miles Monroe** workspace → **Campaigns** → "Why
  Businesses Need Persistent Spokespeople" → Render Spokesperson
  Ad → Videos tab → play.

Talking point: *"Miles is the business strategy voice — companies
need consistent representatives, not random AI content."*

### 5. Create a new spokesperson live

Proves the platform produces any brand character on demand. Keep
this fast — the cinematic of "the team grew right in front of you"
is the point.

- Library tile grid → `+ Create Spokesperson`.
- Pick a template (mascot is fastest), give the character a name +
  one-line subject + one-line style.
- Click **Generate Portrait** → wait ~25s for `gen4_image`.
- Click **Create Avatar** → wait for status to flip to `ready`.

Optional but high-impact: cast the new character into a single-line
dialogue scene with Donny / Riggs / Miles right after, render that
one line, show it side-by-side with the team scene from step 1.

### 6. Ask one realtime question

Two options — pick whichever fits the runtime budget:

**6a. One short realtime question to each spokesperson.**
For each of Donny / Riggs / Miles:
- Open their workspace → **Conversations** primary tab → **Start
  Conversation**.
- Ask their one question:
  - Donny: *"Why does my brand need a persistent AI spokesperson?"*
  - Riggs: *"What did you actually build during the hackathon?"*
  - Miles: *"Should a small business hire a creative agency or use
    Character OS?"*
- End conversation. Quick.

**6b. One grounded self-demo question to Donny (faster).**
- Open Donny's `How Character OS Was Built` campaign (PR DD/DE/DF
  set this up with the curated grounding document `47de9efd-...`).
- Conversations primary tab → Start Conversation.
- Ask: *"Are Character OS and context-kit the same thing?"*
- Wait for the canonical "No. Character OS is the hackathon product.
  context-kit is the separate AI context-management package used to
  coordinate the build." reply.
- End conversation.

Option 6b is the safer demo — one question, one canonical answer,
no risk of fumbled mic prompts.

### 7. End on the Videos tab showing saved media + Conversations history

- Switch to **Videos** tab → with the seeded campaigns + scenes
  + spokesperson ads rendered during the recording, this tab should
  show a healthy grid of cards: Dialogue Scene, Spokesperson Ad ×
  3, plus any reels exports.
- Click the **Conversations** sub-tab (PR DK) → the realtime
  transcripts from step 6 appear as cards with cast names + first
  few turns visible.
- Pan over both views briefly. The point: *"Everything we made
  during this demo is saved here, attached to the right
  spokesperson, ready to ship into a real campaign."*

---

## Camera + audio sanity

Use `docs/DEMO_CHECKLIST.md` Section 0 (pre-flight) right before
hitting record:

- `bash scripts/start-local-real.sh` — confirm `runway_mock=false`.
- Headphones plugged in, background noise muted.
- Browser focused on `http://localhost:5173/`.
- Donny / Riggs / Miles all show `avatar · ready` in the workspace
  header pill.
- DemoReadinessPanel (PR DA / DB top-of-workspace) reads `✅ 6/6`
  for each of the three.

If any of these are red, fix before rolling tape.

---

## Known risks during recording

| Risk | Mitigation |
|---|---|
| Runway avatar_videos flake (`INTERNAL.BAD_OUTPUT`) | Re-render the failing line. PR CR auto-retries `INTERNAL.*` once. |
| Realtime stalls / avatar pauses mid-reply | End + restart the conversation. Mic feedback was the historical cause; headphones-required. |
| 5-minute realtime cap | Keep step 6 tight — under a minute per spokesperson. |
| Dialogue stitch takes longer than expected | Pre-render the 6 lines + stitch once before recording so step 1 only needs the playback, not the render. |
| New spokesperson portrait failure during step 5 | Pre-stage a backup character (already-ready) you can swap to. |
| `gen4_image` upstream flake on the new spokesperson | If portrait fails, "Try safer prompt" amber button (PR CS) usually clears it. |

---

## Hand-off after recording

If we re-record the next day:

- Existing dialogue scenes + spokesperson ads stay in the Videos
  tab (PR CY / PR DJ append-only history).
- Conversations from the recording stay in the Conversations sub-
  tab (PR DK + PR AJ transcript persistence).
- Re-running `scripts/seed-submission-demo-content.py` is safe —
  it's idempotent and will only report what already exists.
- If we want to swap in a different cast for the dialogue scene,
  use the **Add N more lines** flow (PR DM) instead of **Reset
  scene lines** — preserves any rendered MP4s.
