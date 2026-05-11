# AdSpark Studio — Submission-Day Demo Checklist

Final-day operator checklist for recording the submission video.
Run through this in order; each item is testable from the v2 UI.

---

## 0. Pre-flight (do once)

- [ ] `bash scripts/start-local-real.sh` — confirms
      `runway_mock=false` + `image_gen_mock=false` in the health
      JSON. Browser console clean.
- [ ] Hardware: headphones plugged in. Background noise muted.
      Mic permission ready to allow.
- [ ] Browser tab focused on `http://localhost:5173/`.
- [ ] At least three spokespeople saved in the library with
      portraits + ready Runway avatars:
      - Donny (or Donny Sparks)
      - Riggs
      - Miles

If any of the three is missing, create it via the homepage
`+ Create Spokesperson` button. Confirm each one's workspace
shows `avatar · ready` (or `mock`) in the header pill.

---

## 1. Knowledge (per spokesperson)

Open each demo spokesperson → **Knowledge** tab.

- [ ] Donny has at least one saved knowledge source (e.g. "AdSpark
      brand voice notes" — punchy, fast-talking, hype copy).
- [ ] Riggs has at least one source (e.g. "Build-process notes" —
      a Character OS knowledge source describing how the team
      shipped features across many AI coding sessions. **Do not
      paste context-kit specifics in here** — knowledge sources are
      Character OS *product* memory; context-kit is a separate
      dev-time tool that does not belong in product copy).
- [ ] Miles has at least one source (e.g. "Persistent-spokesperson
      product narrative" — characters that learn the brand).

The lane Step 2 disclosure in the Campaigns tab will show
`N knowledge sources available — open for reference` when this is
populated.

---

## 2. Spokesperson Ad (Pillar 1)

Open Donny → **Campaigns** tab.

- [ ] At least one campaign appears in the list. If not, click
      `+ New Campaign` → pick **🎙️ Spokesperson Ad** → fill
      `Business`, `Product`, `Audience`, `Tone` → **Save brief**.
- [ ] Click the campaign's row → the active-state banner reads
      `Editing: <business>`.
- [ ] Step 2 has a saved script (or click `+ Save script` and type
      a ≤300-char line).
- [ ] Click **Render new Spokesperson Ad** → wait for the
      `avatar_videos` task to finish (~30–60 s).
- [ ] After success, Step 3's saved-renders disclosure shows
      `N saved render(s) for this campaign`.
- [ ] Switch to the **Outputs** tab → the new render appears as
      a `Spokesperson Ad` card with the script preview + open
      link.

---

## 3. Conversation (Pillar 2)

PR DP reframed Conversations as **team interviews** — Donny is the
creative lead, Riggs is the chaotic builder, Miles is the
strategist. Each one has a tuned grounding doc on their submission
campaign + a team-interview personality.

Stay on Donny → open the **Character OS Creates Reusable AI Ads**
campaign → **Conversations** tab.

- [ ] The pre-call checklist is visible. Read the bullets once.
- [ ] Click **Start Conversation** → **Allow** on the mic prompt.
- [ ] Donny opens with: *"Hi, I'm Donny Sparks. I run creative on
      the Character OS team. Ask me how a brand keeps a consistent
      voice across ten campaigns..."*
- [ ] Ask one interview question:
      - *"What's your job on this team?"*
      - *"Why does my brand need a persistent AI spokesperson?"*
      - *"How do you avoid making every ad sound the same?"*
- [ ] Donny answers in-character within ~2s of silence. He should
      defer to Riggs (technical) or Miles (business) when the
      question drifts off-creative.
- [ ] **End Conversation** → panel returns to idle.

Repeat for Riggs (campaign: *How We Built Character OS*, ask
*"What's context-kit and what isn't it?"*) and Miles (campaign:
*Why Businesses Need Persistent Spokespeople*, ask *"Should a
small business use Character OS or hire an agency?"*).

If any avatar stalls: end + retry. Mic feedback was the historical
cause — headphones-required.

---

## 4. Dialogue Scene (Pillar 3)

Stay in Donny's workspace → Campaigns tab → `+ New Campaign` →
pick **🎭 Dialogue Scene**.

- [ ] Fill a minimal brief (`Business: Hackathon Demo`,
      `Product: AdSpark Studio`) → **Save brief**.
- [ ] Step 3 → click **Plan Dialogue Lines** → 3 lines appear.
- [ ] Click **Load hackathon demo lines** in the amber preset
      box. Status flips to `Loaded. Now click Generate line on
      each row.` All three rows show the demo copy + assigned
      speakers.
- [ ] For each line (Donny / Riggs / Miles): click **Generate
      line**. Wait for the status pill to flip to `ok`. Each
      line costs one `avatar_videos` task ≈ $0.05–$0.10.
- [ ] Once all three lines are `ok`, click **Stitch Dialogue
      Scene**. Status pill: `cached`.
- [ ] Switch to **Outputs** tab → the dialogue scene MP4 appears
      with `Dialogue Scene` label.

Optional: click **Rebuild captions from saved video** for the
720×1280 reels export (ffmpeg-only, no extra credits).

---

## 5. Submission Video

Record the workspace:

1. Library tile of Donny/Riggs/Miles.
2. Donny workspace → Identity tab → portrait visible.
3. Knowledge tab → at least one source.
4. Campaigns tab → click an existing rendered campaign → Step 3
   saved-renders disclosure expanded.
5. Outputs tab → multiple cards visible.
6. Conversations tab → click Start → say one line → click End.
7. Campaigns tab → Dialogue Scene → click Load hackathon demo
   lines + (if already rendered) **Stitch Dialogue Scene** →
   Outputs tab → play the stitched MP4.

Target length: 90–120 seconds.

---

## Live readiness panel

The spokesperson workspace also surfaces a small live readiness
disclosure (testid
`spokesperson-workspace-demo-readiness`) at the top of the
Identity tab that auto-derives most of this checklist from the
character record + linked campaigns. Click to expand any time
during the run-up.

---

## 6. Character OS Self-Demo (optional bonus pillar, PR DD + PR DE)

Lets a spokesperson explain what Character OS is, what context-kit
is, and how the two relate — without conflating them. Useful for the
"what is this project" portion of a long-form walkthrough.

The grounding document is a **curated 6-section narrative** authored
in `scripts/upload-context-kit-demo-grounding.py` (PR DE replaced
PR DD's raw-doc dump). Updating the prose requires editing the
script's `SECTIONS` list, not the repo docs.

Setup once:

- [ ] Open any spokesperson with a ready avatar (Donny Sparks is the
      canonical choice) → **Campaigns** tab → `+ New Campaign` →
      **🎙️ Spokesperson Ad**.
- [ ] Fill a minimal brief — `Business: Character OS`,
      `Product: AI spokesperson platform built for the Runway hackathon`,
      `Audience: Hackathon judges + future maintainers`,
      `Tone: Honest, technical, brief`. Save brief.

  **Why these exact fields:** the realtime broker injects
  `business` + `product` verbatim into the spokesperson's
  system prompt (`backend/app/services/realtime_avatar_client.py:253`)
  and into the opening line fallback (`:295`). Putting context-kit
  in `product` would prime the avatar to self-describe as a
  context-kit tool — exactly the conflation the grounding doc
  works to prevent. Keep these brief fields about **Character OS
  the product**; let the grounding document carry the build-story
  context.
- [ ] Note the campaign id from the URL or the campaigns list row.
- [ ] In a terminal:

  ```bash
  python scripts/upload-context-kit-demo-grounding.py \
      --campaign-id <id> --dry-run     # section headings + 1000-char preview
  python scripts/upload-context-kit-demo-grounding.py \
      --campaign-id <id>               # POST (one /v1/documents credit in real mode)
  ```

  Expected output ends with `runway_document_status: ready` (real
  mode) or `mock` (mock mode) + a `runway_document_id`.

Run the demo:

- [ ] Stay on the dedicated campaign → **Conversations** tab →
      **Start Conversation**.

Suggested questions (avatar should answer cleanly without conflation):

- [ ] **"What is Character OS?"**
      Expected answer: *Character OS is the AI spokesperson platform
      — the hackathon product where brands create reusable AI
      characters that star in ads and hold live conversations.*

- [ ] **"What is context-kit?"**
      Expected answer: *context-kit is the separate AI
      context-management package that helps AI coding sessions stay
      oriented as a codebase grows — anchor files + drift guard.*

- [ ] **"How did context-kit help build this?"**
      Expected answer: *context-kit let many short AI coding sessions
      accumulate into one coherent product by keeping every session
      aligned with the current state of the codebase.*

- [ ] **"Are Character OS and context-kit the same thing?"**
      Expected answer: ***No.** Character OS is the hackathon
      product. context-kit is the separate context-management tool
      used to help build it.*

If the avatar fuses the two ("Character OS is a context-kit for
ads", "context-kit is how the spokesperson works"), the grounding is
not landing — end the session, re-run the upload script, restart the
conversation.

To refresh after product or build-tool reality changes, edit the
`SECTIONS` list in `scripts/upload-context-kit-demo-grounding.py`
and re-run the script — each upload replaces the campaign's
grounding document.

---

## Known demo-day risks

- **Real Runway flakes** — `gen4_image` occasionally
  `INTERNAL.BAD_OUTPUT`. Mitigations: PR CR's auto-retry on
  `INTERNAL.*` codes + the operator-triggered "Try safer
  prompt" button on portrait failures.
- **Mic feedback** — open speakers loop the avatar's voice
  back into the mic. Headphones-required.
- **5-minute session cap** — Runway hard-limits realtime to
  5 minutes per session. End + restart for a longer demo
  pass.
- **Per-line dialogue cost** — 3 lines × ~$0.05–$0.10 ≈
  $0.30 per full scene render. Practice the stitch once;
  re-render only if a line failed.
- **Dialogue stitch outputs[] gap** — Dialogue scene MP4s
  aren't appended to PR CY's `Campaign.outputs` history yet
  (only spokesperson_ad + reels are). Outputs gallery legacy
  fallback handles them as one card per campaign. Stitch a
  fresh scene only if the prior one was wrong.
