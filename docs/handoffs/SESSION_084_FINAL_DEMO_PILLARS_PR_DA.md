# SESSION 084 — PR DA Final Demo Pillars (Conversation + Dialogue)

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR DA Demo Pillars patch in flight on
top of `2510562` `fix: multi-ad reviewable spokesperson
campaigns (PR DA)`; commit + push pending after this
handoff lands. Note: same PR CR-style label collision —
two slices both tagged "PR DA" in working memory; the
multi-ad commit was the first DA, this one is the
second / "Demo Pillars" DA. Treat them as `PR DA` and
`PR DA(2)` in the commit history.)

**Why this slice ran:** Final-day demo prep. The
spokesperson workspace had three demo-critical surfaces
in different states of readiness:

1. **Spokesperson Ad** — works after the previous PR
   DA (multi-ad reviewable campaigns).
2. **Conversation** — the `<RealtimeSpokesperson>`
   component existed (lazy-loaded `@runwayml/avatars-
   react`, real WebRTC against `/v1/realtime_sessions`)
   but was only mounted in `/legacy CampaignGallery`.
   The v2 Conversations tab was a `<TabComingSoon>`
   placeholder.
3. **Dialogue Scene** — the lane could Plan + Stitch +
   Reels but had no per-line text/character editor or
   per-line render button. Operators had to drop into
   `/legacy` to render the per-line `avatar_videos`
   clips before the v2 lane could stitch them.

PR DA (Demo Pillars) closes pillars 2 + 3 by exposing
existing backend routes through new in-lane UI. No new
backend routes; no new model fields.

## What works for each pillar

### Pillar 1 — Spokesperson Ad ✅

End-to-end demo path remains intact post-PR DA
(multi-ad selection):

- Pick spokesperson → workspace.
- Campaigns tab → click any campaign row (or
  `+ New Campaign` for blank slate).
- Step 1 brief saves via `<LaneBriefEditor>` (or
  `<LaneBriefCreator>` for new).
- Step 2 script saves inline via `<Step2Script>`
  textarea (≤300 chars).
- Step 3 `Render new Spokesperson Ad` fires
  `/api/campaigns/{id}/host-video` — append-only
  history per PR CY, prior renders preserved on disk.
- Outputs tab shows the full append-only gallery.

No fix needed for Pillar 1.

### Pillar 2 — Conversation ✅ (real WebRTC, gated when avatar/campaign missing)

New `<ConversationsTab>` component inside
`SpokespersonWorkspace.jsx` mounts the existing
`<RealtimeSpokesperson>` against the operator's
selected campaign:

- **Real WebRTC realtime** when `RUNWAY_API_KEY` is set
  + the spokesperson has a ready Runway avatar
  (`runway_avatar_status in {ready, mock}`).
  `<RealtimeSpokesperson>` POSTs `/v1/realtime_sessions`
  via the existing `api.startSpokespersonSession`
  broker (PR I), mounts `@runwayml/avatars-react`
  `<AvatarCall>`, runs a 5-min countdown, ends cleanly
  on disconnect.
- **Gated state** when (a) no avatar is bound
  (`gateReason = "No Runway avatar bound yet…"`), (b)
  status isn't ready (`gateReason = "Runway avatar
  status is "<status>"…"`), or (c) no campaign is
  selected (`gateReason = "No campaign selected.
  Pick or create one…"`). Each state surfaces an
  amber banner with operator-readable next steps.
- **Empty state** when no campaign is selected and the
  avatar is fine: a primary `Go to Campaigns →` CTA
  jumps the operator to the Campaigns tab to pick or
  create.
- **No fakery** — nothing pretends to be live when the
  underlying realtime broker would 503.

Header copy: "Talk to <name> live via Runway's
realtime avatar. The avatar is briefed on the selected
campaign — ask it about the product, audience, or
pitch and hear it respond in character. *Real WebRTC
when RUNWAY_API_KEY is set; mock-mode shows the gated
state.*"

### Pillar 3 — Dialogue Scene ✅ (real avatar_videos render, in-lane)

New `<DialogueLinesEditor>` + `<DialogueLineRow>`
subcomponents inside `DialogueLane.jsx`:

- Mounts between the Plan and Stitch buttons whenever
  `lineCount > 0`. Each line gets:
  - **Beat label** (Hook / Beat / Closer from the
    backend plan).
  - **Text textarea**, ≤300 chars (matches Runway's
    `avatar_videos` speech cap), with a `N/300`
    counter.
  - **Speaker dropdown** populated from
    `availableCharacters` filtered to those with a
    ready Runway avatar (`runway_avatar_id` set +
    `runway_avatar_status in {ready, mock}`).
    Mismatch → backend's `/dialogue/save-line` 409s
    with a clear error.
  - **Status pill** (`idle` / `pending` / `running` /
    `ok` / `failed`) — emerald/amber/rose tones.
  - **`Save line`** button → POSTs
    `/api/campaigns/{id}/dialogue/line/{line_id}` (no
    Runway credits). Resets that line's status to
    `idle` server-side so the operator must Generate
    again after editing.
  - **`Generate line`** button (rose chrome — burns
    Runway credits) → POSTs `/dialogue/generate-line/
    {line_id}`. Disabled until the line is saved with
    both text + speaker.
  - **`preview ↗`** download link when the line has
    `status === 'ok'` + a `video_url`.
- The Stitch button's disabled-reason copy now
  reads `${ok}/${total} lines ready — click Generate
  per line below to render the rest before
  stitching.` (was: "render the rest in the legacy
  wizard before stitching.")
- Lane header copy: "Plan, edit lines, render each
  line, and stitch the scene — all inline. Real
  Runway credits per line; ffmpeg-only stitch +
  reels." (was: "per-line renders run in the legacy
  wizard until inline rendering lands.")

Mock-mode end-to-end probe confirmed Donny / Riggs /
Miles round-trip:
- Plan → 3 lines created.
- Save line × 3 (text + character_id) → all save with
  speaker name resolved + status reset to `idle`.
- Generate line × 3 → all flip to `status=ok` with
  `video_url=/api/campaigns/{id}/dialogue/line/{line_id}`.
- Stitch → `dialogue_scene_status=ok`,
  `dialogue_scene_video_url=/api/campaigns/{id}/dialogue-scene`.
  No legacy round-trip required.

## What was broken (before this slice)

- Conversations tab in v2: dead `<TabComingSoon>`
  placeholder; operators couldn't talk to the
  spokesperson without flipping to `/legacy`.
- Dialogue Scene in v2: no per-line text/character
  editor, no per-line render button. Stitch was
  permanently gated unless the operator ran
  `/api/campaigns/{id}/dialogue/generate-line/{id}` ×
  N via the legacy wizard or curl. Spec UX
  ("multiple spokespeople saying lines in a stitched
  scene") was unreachable from the v2 surface.

## Files changed

```
 frontend/src/components/CampaignLanes.jsx         |  20 +
 frontend/src/components/SpokespersonWorkspace.jsx | 139 ++++++++-
 frontend/src/components/lanes/DialogueLane.jsx    | 317 ++++++++++++++++++++-
 00-START-NEXT-SESSION.md                          | (head pointer)
 docs/INVENTORY.md                                 | (PR DA Demo Pillars block)
 docs/handoffs/SESSION_084_FINAL_DEMO_PILLARS_PR_DA.md (new)
```

No backend changes. Backend route count unchanged at
**74**. Cinematic lane untouched (out of scope).

## Routes reused (no new endpoints)

- `POST /api/realtime/spokesperson/{campaign_id}` — existing PR I broker.
- `POST /api/campaigns/{id}/dialogue/plan` — existing PR AF.
- `POST /api/campaigns/{id}/dialogue/line/{line_id}` — existing PR AF (save line).
- `POST /api/campaigns/{id}/dialogue/generate-line/{line_id}` — existing PR AF (render line).
- `POST /api/campaigns/{id}/dialogue/stitch` — existing PR AF.
- `POST /api/campaigns/{id}/dialogue-scene/reels` — existing PR AG.

Frontend `api.js` wrappers: all already existed (PR AF
shipped them; v2 lane just didn't expose them in UI).

## Conversation: real / mock / text / realtime?

**Real WebRTC realtime.** Uses Runway's
`/v1/realtime_sessions` via the PR I broker
(`api.startSpokespersonSession`), mounts the official
`@runwayml/avatars-react` `<AvatarCall>` SDK
component, runs a 5-min countdown, ends cleanly on
disconnect. The component lazy-loads the SDK so a
package init failure doesn't tank the workspace.

**Not text-only.** No fallback text chat surface — if
realtime is unavailable (no avatar / no campaign /
broker 503), the gated state surfaces operator-
readable copy explaining the next step.

## Dialogue Scene: real / mock?

**Real `avatar_videos` render** when
`RUNWAY_API_KEY` is set. Each `Generate line` click
fires one `/v1/avatar_videos` task targeted at the
selected speaker's `runway_avatar_id`. Stitch is
ffmpeg-local (no Runway credits). Mock mode produces
deterministic placeholder MP4s per line via the
existing PR AF mock pipeline.

## Verification

| Check | Result |
|---|---|
| Backend route count | **74** (unchanged) |
| Backend pytest | **20/20 passed (~0.89 s)** — no test changes |
| `vite build` | 514.01 KB initial / 138.64 KB gzip + 561.97 KB lazy chunk (+8.09 KB / +1.65 KB vs prior PR DA — `<ConversationsTab>` + `<DialogueLinesEditor>` + `<DialogueLineRow>` + the API wiring). The lazy chunk (`@runwayml/avatars-react`) is unchanged. |
| Mock smoke | **3/3 passed (~30.0 s)** — Test 1 26.5 s, Test 2 2.1 s, Test 3 795 ms. |
| **Mock probe — Dialogue Scene end-to-end** | ✅ Donny / Riggs / Miles round-trip: Plan → save 3 lines (text + character_id) → generate 3 line MP4s (`status=ok`, `video_url` set) → Stitch (`dialogue_scene_status=ok`, `dialogue_scene_video_url` set). No `/legacy` round-trip required. |
| Hygiene scan | empty. |
| Drift guard | `✅ context-kit anchors look recent.` |
| Real-mode restart | `runway_mock=false` · `vite http=200`. |
| Real Runway calls fired | **0** — pillars 2 + 3 verified via mock pipeline; the operator must explicitly approve real-mode credit burns for the demo run. |

## Manual walkthrough

1. **Spokesperson Ad (Pillar 1)** — open Donny → Campaigns
   tab → pick a campaign or `+ New Campaign` → fill
   brief → save script → `Render new Spokesperson Ad`.
   Outputs tab shows every prior render.
2. **Conversation (Pillar 2)** — open Donny → Conversations
   tab. If avatar is ready and a campaign is selected,
   the `<RealtimeSpokesperson>` mount appears with a
   `Start Conversation` button. Click → mic permission
   prompt → live WebRTC session with the brand-aware
   avatar; ends at the 5-min countdown or on click.
3. **Dialogue Scene (Pillar 3)** — open Donny →
   Campaigns tab → `+ New Campaign` → pick **🎭
   Dialogue Scene** mode. Step 1: fill brief.
   Step 3: click `Plan Dialogue Lines` → 3 lines
   appear. For each line: edit text (use the
   demo-suggested copy below), pick speaker from the
   dropdown, click `Save line`, then `Generate line`.
   Once all 3 lines are `status=ok`, click
   `Stitch Dialogue Scene` → preview the stitched
   MP4. Optional: `Build Captioned Reels` for the
   720×1280 vertical export.

## Suggested demo scene lines (from the brief)

1. Donny: *"We were supposed to make one ad. Then
   Chris gave us a workspace, campaigns, memory, and
   a deadline."*
2. Riggs: *"Technically, context-kit kept the AI
   builders from wandering into the woods. Mostly."*
3. Miles: *"The result is a persistent AI spokesperson
   system: characters that learn the brand, create
   campaigns, and show up again."*
4. (4th line in the brief — ≤3-line demo per the
   `dialogue_lines` plan length, so trim to the
   shortest 3 that land for a 12–25 s scene.)

## Remaining demo risks

- **First conversation requires mic permission.** Make
  sure the operator clicks "Allow" when the browser
  prompts.
- **Dialogue Scene needs avatars on every speaker.**
  The dropdown filters to `runway_avatar_status in
  {ready, mock}`; if a spokesperson has no avatar,
  they don't appear. Operator fix: open that
  spokesperson → Identity tab → Create Avatar.
- **Per-line generation burns credits.** Three lines
  = three `/v1/avatar_videos` tasks ≈ $0.05–$0.10
  each, depending on duration. Demo cost ≈ $0.30 for
  one full scene. Cancellation mid-render is best-
  effort (the backend keeps polling but the lane
  shows the latest server state).
- **Stitch / reels don't append to PR CY's `outputs[]`.**
  Only `host-video` and `spokesperson-ad/reels`
  routes append history records. Dialogue stitch
  still uses the single-value
  `dialogue_scene_video_url` field, so the Outputs
  gallery's legacy fallback handles them as one card
  per campaign. Out of scope for today; rebuild
  appends would require extending PR CY's hooks to
  the dialogue routes.
- **Conversations tab uses the selected campaign's
  brand context.** If the operator switches campaigns
  mid-conversation, the live session already
  in-flight stays bound to the campaign it was
  created against (Runway broker-side). They have to
  end + start to swap context.
- **No transcript replay UI in v2 yet.** Backend
  `/realtime-transcript` route exists; the legacy
  CampaignGallery has the replay card. v2
  Conversations tab doesn't surface transcript
  history yet — out of scope for the demo path
  (which is "talk live, hear it back in voice").

## Server status (final)

Real-mode booted via `bash scripts/start-local-real.sh`
per the memory rule.

```
backend: http://localhost:8000 · runway_mock=false · image_gen_mock=false
vite:    http://localhost:5173 · http=200
```
