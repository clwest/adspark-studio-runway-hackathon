# AdSpark Studio — Inventory

Snapshot of what is real, mocked, and key-dependent as of the
context-kit refresh after **PR DM — Extend Dialogue Scene Without
Losing Existing Lines**. PR DL bumped the default to 6 but the
plan route was still destructive (wipe + reseed), so campaigns
that had a 3-line scene planned before PR DL couldn't grow without
losing existing work. PR DM adds an opt-in **extend** mode: new
`dialogue_service.extend_lines` walks existing lines, preserves
each byte-for-byte (text, speaker, status, video_url etc.) and
appends idle lines to reach `_DEFAULT_LINE_COUNT`. Cast for the
new lines reuses operator's existing character choices first then
supplements from the ready pool up to 3-member cap; speaker
rotation continues from where existing lines left off. Idempotent
when already at default. New `DialoguePlanBody` Pydantic with
`mode: Literal["reset", "extend"] = "reset"` — no body /
`mode="reset"` keeps the destructive behaviour for backward
compat, `mode="extend"` routes to the new helper. Frontend
`DialogueLane.jsx` adds a hardcoded `DEFAULT_LINE_COUNT = 6` +
`canExtend` gating + a sibling amber "Add N more lines" button
that renders next to "Reset scene lines" when `0 < lineCount < 6`.
Reset button tooltip rewrote to call out destructive semantics.
`api.js` `planDialogue(campaignId, mode='reset')` extended;
`CampaignLanes.handlePlanDialogue` threads mode through. Three
new pytests pin the contract: extend-at-default is no-op, extend-
from-3 preserves all 3 originals + video_url, reset stays
destructive. Pytest **44/44**. Mock smoke 3/3. Vite build 544.70
KB initial / 146.37 KB gzip. Backend route count still **76**.
Zero Runway calls fired.
Earlier: PR DL — Dialogue Scene Default Bumped to 6 Lines. `dialogue_service._DEFAULT_LINE_COUNT` was 3 with
labels `Hook / Beat / Closer` and an A/B/A speaker rotation. PR DL
bumps to **6** with labels `Hook / Setup / Beat 1 / Beat 2 / Twist
/ Closer` and a cast-of-up-to-3 rotation that cycles
`cast[i % len(cast)]` across the lines — A/B/C/A/B/C with three
ready characters, A/B/A/B/A/B with two, monologue with one. Module-
level `assert` locks the constant + labels tuple in lockstep so a
future bump touches one anchor. `_default_line_text` extended with
fallback prose for Setup / Beat 1 / Beat 2 / Twist so a freshly-
planned scene still seeds 6 readable lines. `HACKATHON_DEMO_LINES`
in `DialogueLane.jsx` extended to 6 entries (user-spec Donny →
Riggs → Miles, twice through). Demo preset banner copy updated.
Stitch disabled-reason already dynamic via `lineCount` so it shows
`(N/6 rendered)` automatically. Existing PR DJ pytests rewired to
read `_DEFAULT_LINE_COUNT` from the module instead of hard-coding
3; two new pytests pin the 6-line + 3-speaker rotation contract.
Pytest **41/41**. Mock dialogue probe confirmed 6 lines with
A/B/C/A/B/C rotation end-to-end. Vite build 543.46 KB initial /
145.98 KB gzip. Backend route count still **76**. Zero Runway calls
fired.
Earlier: PR DK — Conversations Sub-Tab. Pure
UI organization pass; zero backend changes; reuses PR AJ
transcript persistence on every Campaign. The Videos tab (renamed
from Outputs in PR DJ) now wraps a new `<VideosTab>` with a two-
pill sub-tab toggle: **Videos** (existing `<OutputsGallery>`) and
**Conversations** (new `<ConversationsHistory>`). Each pill
carries a count chip — Videos counts every output (history +
legacy single-field fallback); Conversations counts campaigns with
saved `realtime_transcript_turns`. ConversationsHistory renders
one card per campaign with campaign + spokesperson name, fetched-
at relative time, mock badge when applicable, inline preview of up
to 4 turns (avatar pink / user sky), "+N more turns" disclosure,
Copy Markdown + Download TXT buttons (reuses PR AL
`transcriptExport.js` helpers), "+N prior fetches" chip when the
audit-trail history has more than the current entry. Sub-tab
state is local React state (defaults to Videos). Existing tab id
(`outputs`) and section testid (`spokesperson-workspace-outputs`)
preserved so no Playwright test breaks; new testids
`videos-tab`, `videos-tab-subtabs`, `videos-tab-subtab-videos`,
`videos-tab-subtab-conversations`, `conversations-history`,
`conversation-card`, `conversation-turn-preview`,
`conversation-copy-markdown`, `conversation-download-txt`,
`conversations-empty`. Vite build 543.11 KB initial / 145.83 KB
gzip. Mock smoke 3/3. Pytest 39/39. Backend route count still
**76**. Zero Runway calls fired.
Earlier: PR DJ — Persistent Creative Workspaces. Three-part slice: (1) dialogue stitch + dialogue-
scene reels routes now mirror PR CY's append-only pattern —
generate per-output id, copy canonical file to per-output
historical filename in `data/finished/`, append `OutputRecord`
with `kind="dialogue_scene"` / `"dialogue_scene_reels"`. Reels
record carries `parent_output_id` linking back to the most-recent
dialogue_scene. New `OutputRecord.cast_names: list[str]` +
`OutputRecord.line_count: int` (both Optional, default None)
capture scene metadata; dedup helper
`_dialogue_metadata_for_campaign` keeps cast in line-appearance
order. (2) OutputsGallery renders a new `cast: Donny, Riggs, Miles
· 3 lines` sub-line on each dialogue card (sky-300 mono, new
testid `output-card-dialogue-meta`). KIND_META already covered
both dialogue kinds; PR DJ just plumbs through the metadata
fields. (3) "Outputs" → "Videos" rename in the
SpokespersonWorkspace tab label + OutputsGallery two `<h2>`s +
empty-state copy + 2 SpokespersonLane "Outputs tab" prose refs.
Tab `id` (`outputs`) and all testids unchanged. SpokespersonWorkspace
campaigns-list `N× saved` chip count widened from spokesperson_ad-
only to all primary video kinds (spokesperson_ad + dialogue_scene
+ cinematic_video; reels excluded as derived). Three new pytests
pin the dialogue-output contract end-to-end in mock mode (plan →
save lines → render each → stitch → assert OutputRecord with cast
+ line count + parent linkage). PART 2 (persistent campaigns
list) was already shipped by PR DA + PR DI; PR DJ just sharpened
the count chip. Pytest **39/39**. Vite build 534.93 KB initial /
144.22 KB gzip. Mock smoke 3/3. Backend route count still **76**.
Zero Runway calls fired.
Earlier: PR DI — Campaign Context One-Time Setup. UX-only slice across all three v2 campaign lanes
(Spokesperson Ad / Cinematic / Dialogue). Step 1 was always an
editable 4-field brief form that kept inviting re-edits even after
save — made every campaign feel mutable and the lane feel like a
repeated form. PR DI introduces a three-state Step 1: (a) no
campaign → inline create CTA; (b) campaign exists, not editing →
compact read-only **Campaign Summary** card (business / product
preview / audience preview / tone + counts row scoped per lane) +
an explicit `Edit Campaign` button; (c) campaign exists, operator
clicked Edit → existing brief editor with a `← Done editing
(discard unsaved)` exit affordance below it. Step 1 label flips
between "Campaign Setup" (creating/editing) and "Campaign
Summary" (collapsed). Auto-exits edit mode on focused-campaign
change + on successful Save. New
`frontend/src/components/lanes/Step1CampaignPanel.jsx` encapsulates
the three-state logic + internal `<CampaignSummary>` sub-component.
All three lanes drop in one component instead of repeating the
conditional. Counts scoped per lane: Spokesperson surfaces
`ad_variants` count + spokesperson_ad-kind outputs; Cinematic
surfaces total outputs; Dialogue surfaces dialogue line count.
Zero backend changes; existing testids preserved
(`{prefix}-lane-step-brief`); new testids for summary card +
counts + done-editing affordance. Vite build 534.23 KB initial /
144.03 KB gzip (+2.72 KB / +0.73 KB). Mock smoke **3/3**. Pytest
36/36. Backend route count still **76**. Zero Runway calls fired.
Donny's `d00dc42fe5cb` self-demo campaign preserved across the
mock-smoke cycle.
Earlier: PR DH — Direct-a-Scene Dialogue Lane.
UX-only slice on `frontend/src/components/lanes/DialogueLane.jsx`.
The lane mental model went from "fill a form, click procedural
buttons" to "pick cast → write scene → render each actor → stitch
the final scene". New `<CastPicker>` (interactive 8-card grid for
Step 2) replaces the read-only inferred-cast list; new
`<ScriptPreview>` (screenplay-style ordered preview) lands in Step 3
above the lines editor so the operator can read the scene before
burning a Runway credit per Render Line click. Procedural labels
renamed throughout — "Plan Dialogue Lines" → "Create Scene Lines",
"Stitch Dialogue Scene" → "Stitch Final Scene", "Build Captioned
Reels" → "Export Captioned Reel", "Generate line" → "Render Line".
Inline ⚠ 1 credit chip next to each Render Line button (was only in
hover tooltip). Hackathon demo preset renamed to "Hackathon Office
Scene" with refreshed copy; Miles line aligned to the PR DH spec
("The result is Character OS: persistent AI spokespeople..."). Lane
header subtitle rewrote to lead with "Pick a cast, write the
scene..." Backend untouched — `dialogue_service._DEFAULT_LINE_COUNT`
stays 3 (Hook/Beat/Closer); the PR DH brief's optional 4th Donny
closer line preserved as an inline file comment for a future
follow-up. Vite build 531.51 KB initial / 143.30 KB gzip (+4.07 KB /
+1.24 KB from the two new components). Mock smoke **3/3 passed**.
Backend pytest 36/36. Backend route count still **76**. Zero Runway
calls fired. Donny's `d00dc42fe5cb` self-demo campaign state (PR DG
brief + commercial_script + PR DF doc id `47de9efd-...`) preserved
through the mock-smoke cycle.
Earlier: PR DG — Separate context-kit From Character OS
Runtime/Product Copy. Full repo audit + classification
of every context-kit mention across backend, frontend, scripts, and
docs (89 files surfaced; 80+ preserved as build-tooling /
historical-record). Three customer-facing surfaces were rewritten:
(1) the Riggs hackathon dialogue preset line in
`frontend/src/components/lanes/DialogueLane.jsx` — was *"Context-kit
kept the AI builders from wandering into the woods. Mostly."* and
would have been spoken by the Riggs avatar in a Character OS demo
video, putting context-kit in product output; rewritten to *"Many AI
coding sessions, one coherent build. Mostly. The dev tooling kept us
aligned across PRs."* (2) `docs/DEMO_CHECKLIST.md` §1 suggested
knowledge source for Riggs called "Context-kit discipline" — rewrote
to "Build-process notes" with explicit warning that Knowledge tab is
Character OS *product* memory and context-kit does not belong in
product copy. (3) `docs/DEMO_CHECKLIST.md` §6 default campaign brief
template had `Product: Context-kit demo grounding for the realtime
spokesperson` — rewrote to `Business: Character OS` + `Product: AI
spokesperson platform built for the Runway hackathon` with a "why
these exact fields" callout explaining the broker injects business +
product verbatim into the system prompt and opening line. Live
campaign data fix on `d00dc42fe5cb` via `POST
/api/campaigns/{id}/brief` and `POST /api/campaigns/{id}/script` to
match the corrected demo checklist values (zero Runway calls).
Broker `_grounded_personality()` softened: the original hardcoded
"An attached campaign brief document carries the product / audience
/ hook / caption / CTA / saved commercial script" was true for PR AI
structured-route docs and false for PR DD raw-route docs (Character
OS self-demo build-story document); rewrote to a neutral *"An
attached document carries the facts you should ground every answer
in. Defer to its contents and cite section names when helpful."*
that works for both upload shapes without misframing.
`scripts/upload-context-kit-demo-grounding.py` preamble got a new
"Framing for this document specifically" paragraph that explicitly
positions the doc as **build story / development process** rather
than runtime product memory; Section 3 lead now opens with the two
verbatim approved phrasings ("context-kit coordinated AI coding
sessions during development" + "context-kit helped the builders
avoid drift across PRs and handoffs"). Two new pytests pin the PR
DG forbidden + approved phrasing lists from the brief. Cross-repo
grep after fixes: **zero hits** for any of the five forbidden
phrasings across non-handoff customer-facing files. Document grew
11,260 → **11,469 chars**. Pytest **36/36**. Frontend build clean
(527.44 KB / 142.06 KB gzip). Backend route count still **76**. No
Runway calls fired.
Earlier: PR DF — Tighten Grounding Language.
PR DE landed a structurally clean curated narrative, but a real demo
of the grounded avatar on Donny's `d00dc42fe5cb` campaign surfaced a
softer conflation: the spokesperson described context-kit as if it
helped *the avatar* maintain context at runtime. The LLM bait was
the ambiguous word "session" — context-kit talks about "AI coding
sessions" and the avatar generalized to "this conversation." PR DF
closes the ambiguity. Preamble adds three new hard rules: (a) do not
describe context-kit as the avatar's memory system / memory layer /
runtime power source; (b) name the IDE-side assistants explicitly
(Claude Code / Cursor / Copilot) so "session" is pinned to
build-time; (c) when asked how the spokesperson knows things,
explain campaign grounding documents + character knowledge sources
*separately* from context-kit. Two new canonical lines added:
*"context-kit is a memory protocol for AI coding sessions, not the
memory system for Character OS spokespeople."* and *"context-kit
does not make the avatars remember conversations. It helped the AI
builders stay aligned while developing the project."* Section 2
leads with a disambiguation paragraph; Section 6 gains three new
Q&A pairs ("Does context-kit power the spokespeople's memory?" / 
"How do you know things about Character OS?" / "So what *is*
context-kit then, in one line?") carrying the "context-kit is how
the project was built, not what the product is" answer style.
Document length 8,103 → **10,742 chars** (still way under cap). Two
new pytests pin forbidden phrasings absent + required PR DF
distinctions present (whitespace-normalized substring check defends
against Markdown line wrap at column 72). Pytest **34/34**. No
backend / route / broker / model changes; backend route count still
**76**.
Earlier: PR DE — Curated Self-Demo Grounding.
PR DD shipped the raw attach route + an uploader that file-dumped
`docs/WHAT_IT_IS.md` + START head + INVENTORY head + the latest 2
handoffs verbatim into the realtime grounding slot. The dump
blended **Character OS** (the hackathon product) and **context-kit**
(the separate AI context-management package used to coordinate the
build) until they sounded like the same thing. PR DE rewrites
`scripts/upload-context-kit-demo-grounding.py`'s `build_payload()`
into a hand-curated 6-section narrative authored inline in the
script's `SECTIONS` list — (1) What Character OS Is, (2) What
context-kit Is, (3) How context-kit Helped Build Character OS,
(4) What Character OS Can Do Today, (5) Demo Talking Points,
(6) What Not To Conflate — plus a preamble that loads the
spokesperson with explicit guardrails and the canonical
distinction line on a single unbroken Markdown blockquote: *"Character
OS is the hackathon product. context-kit is the separate AI
context-management package used to coordinate the build."* Section
6 carries seven canonical Q&A pairs covering the four required demo
questions. Helpers `_read`, `_head_only`, `_recent_handoffs` removed;
no runtime file reads. Document length dropped from ~40k chars
(capped) to **8,103 chars** — way under cap, deliberately tight.
Dry-run now prints section headings + char count + canonical
distinction line + first 1000-char preview. Four new pytests pin the
curated structure via `importlib.util.spec_from_file_location`
loading. `docs/DEMO_CHECKLIST.md` Section 6 rewrote with the
"Character OS Self-Demo" naming + the four canonical questions with
expected answers. No backend / model / storage / broker changes;
backend route count still **76**.
Earlier: PR DD — Context-Kit Realtime Grounding.
PR AI introduced `POST /api/campaigns/{id}/realtime-document` which
runs the campaign record through `build_campaign_brief_markdown` —
that shape (Audience / Tone / Selected concept / Commercial script /
Character / Behaviour) doesn't fit documentation prose. PR DD adds a
sibling raw route, `POST /api/campaigns/{id}/realtime-document/raw`,
that accepts `{name, content}` already-composed Markdown and pipes
straight through the same `runway_create_document` (40k-char trim) +
`update_realtime_document_fields` path. Reuses the existing
`Campaign.runway_document_*` fields the broker already reads, so no
broker / model / storage changes are required. Avatar PATCH from PR AI
is intentionally NOT applied — context-kit grounding stays per-session
to avoid leaking project docs across campaigns sharing an avatar. New
`scripts/upload-context-kit-demo-grounding.py` concatenates curated
context-kit files (`docs/WHAT_IT_IS.md` full + head sections of
`00-START-NEXT-SESSION.md` and `docs/INVENTORY.md` + the latest 2
numbered handoffs by mtime) with `## File: <path>` section headers,
trims to 40k chars, and POSTs to the raw route via stdlib
`urllib.request`. `--dry-run` flag prints the manifest + final size +
500-char preview without firing HTTP. Four new pytests + a new
"Context-Kit Self-Demo" section in `docs/DEMO_CHECKLIST.md` covering
the "How was this project built?" demo flow. Backend route count
**75 → 76**.
Earlier: PR DC — Ad Variants.
Pre-PR-DC, `Campaign.commercial_script` was a single mutable
string — every script edit overwrote it, so multiple takes
against the same brief required brand-new campaigns. PR DC
separates **stable Campaign context** (business / product /
audience / tone) from **mutable Ad Variants** (title + script).
New `Campaign.ad_variants: list[AdVariant]` field; each entry
carries `id`, `title`, `script`, `created_at`, `updated_at`.
New `POST /api/campaigns/{id}/ad-variant` upsert route — pass
`id` to update in place, omit to create. Backend route count
**74 → 75**. `OutputRecord` extended with optional
`variant_id` + `variant_title`; the host-video route honours
`HostVideoBody.variant_id` by reading the variant's script as
the spoken text and stamping both fields on the appended
OutputRecord. The spokesperson-ad alias passes variant_id
through to the underlying host-video pipeline. Lane Step 2
rewrites into `<Step2AdVariants>`: variant chip-row, per-variant
inline title + script editor, `+ New Ad` button, no-variants
empty state with both `+ New Ad (blank)` and "Convert legacy
script to Ad 1" CTAs (legacy `commercial_script` stays
readable until converted). Step 3 saved-renders disclosure
scopes to the selected variant via `data-scope` and shows the
variant title on each row. Outputs gallery cards show the
variant title (pink) above the script preview when captured.
Mock probe round-tripped two variants × two renders with
correct linkage; Campaign B opens blank; re-opening A
preserves both variants + both outputs. Four new pytests
(`test_ad_variant_create_and_update`,
`test_ad_variant_404_when_campaign_missing`,
`test_ad_variant_validation`,
`test_host_video_captures_variant_id`). Backend route count
now **75**.
Earlier: PR DB — Demo Stabilization.
Submission-video recording is the next thing; PR DB adds three
operator-facing guard rails on top of the PR DA Demo Pillars
wiring. New `<ConversationPreCallChecklist>` (testid
`spokesperson-workspace-conversations-precall`) mounts a
collapsible `<details>` block above `<RealtimeSpokesperson>`
with headphones / noise / wait-for-avatar / end-and-retry
guidance — mic feedback was making the avatar pause mid-reply
in manual testing and the `@runwayml/avatars-react` SDK doesn't
expose a mute toggle, so operator-side guidance is the
cleanest lever. New `<DialogueDemoPreset>` (testid
`dialogue-lane-demo-preset`) above `<DialogueLinesEditor>` in
the Dialogue Scene lane — one-click loads the three
submission-video lines (Donny / Riggs / Miles hackathon
office-montage copy) + auto-assigns speakers via first-name
match against ready-avatar characters. Idempotent (`Reload`
when already loaded, skips no-op rows so `ok` status doesn't
reset). Disabled-reason names missing speakers when
ineligible. Operator still clicks Generate line per row to
burn `avatar_videos` credits. New `<DemoReadinessPanel>`
(testid `spokesperson-workspace-demo-readiness`) above the
workspace tab content — auto-derives six per-spokesperson
checklist items (portrait / avatar / knowledge / campaign /
script / rendered ad) from the loaded slice; summary reads
`✅ 6/6` or `🟡 4/6 for <name>`. Authoritative pre-record
checklist lives in `docs/DEMO_CHECKLIST.md` (~5 KB) covering
all three pillars + submission-video recording pass + known
demo-day risks. Backend route count still **74**.
Earlier: PR DA Demo Pillars — Conversation + Dialogue Scene
readiness. Final-day demo prep wired three
demo-critical surfaces in the v2 spokesperson workspace:
**Pillar 1 (Spokesperson Ad)** already worked post the
multi-ad PR DA — verified end-to-end. **Pillar 2 (Conversation)**
mounts the existing `<RealtimeSpokesperson>` (lazy-loaded
`@runwayml/avatars-react` `<AvatarCall>` against
`/v1/realtime_sessions` via the PR I broker) inside a new
`<ConversationsTab>` using the operator's selected campaign
for brand context. Real WebRTC realtime when
`RUNWAY_API_KEY` is set; gated states with operator-readable
next-step copy when no avatar bound, avatar not ready, or no
campaign selected. **Pillar 3 (Dialogue Scene)** closes the
per-line gap that used to require dropping into `/legacy` to
render lines before the v2 stitch button could fire. New
`<DialogueLinesEditor>` + `<DialogueLineRow>` subcomponents
inside `DialogueLane.jsx` give each planned line a text
textarea (≤300 chars), a speaker dropdown filtered to
characters with `runway_avatar_status in {ready, mock}`, a
status pill, `Save line` (POSTs `/dialogue/line/{line_id}`),
and `Generate line` (POSTs `/dialogue/generate-line/{line_id}`,
fires real `avatar_videos`). Mock probe round-tripped Donny /
Riggs / Miles end-to-end: Plan → save 3 lines → generate 3
MP4s → Stitch. Lane subtitle + stitch disabled-reason copy
refreshed to point at the in-lane editor instead of the
legacy wizard. Backend untouched at the route layer (route
count still **74**); no new endpoints — just exposed existing
PR I + PR AF routes through new in-lane UI.
Earlier: The lane used to silently target
"most recent" via internal `focused = sorted[0]`; clicking
`+ New Campaign` left the prior campaign's brief + script
bleeding through into `<LaneBriefEditor>` instead of mounting
the empty `<LaneBriefCreator>`. Workspace now lifts two pieces
of state — `selectedCampaignId` + `creatingNewCampaign` —
threaded through `<CampaignLanes>` into `<SpokespersonLane>`.
The lane reads `focusedCampaign` from props with zero internal
sorting. Workspace campaigns list rows are now clickable with
an active pink ring + `active` pill, an `N× saved` chip showing
per-campaign render count, an emerald `rendered` / zinc `draft`
pill, and an `edit →` affordance. New active-state banner
inside the lane flips pink ("✏️ New campaign") when creating
or emerald ("Editing: <business>") when editing existing. Step
3 mounts a saved-renders `<details>` scoped to the selected
campaign. After `<LaneBriefCreator>` save, the new campaign
auto-selects. Cancel-new-campaign auto-recovers to newest.
Header copy: "Pick a campaign below, or create a new one. The
lane edits the selected campaign." (was "Each lane below
targets the most-recent campaign."). Mock probe confirmed two
campaigns isolated at the data layer. Backend route count
still **74**. Cinematic / Dialogue lanes untouched (scope was
Spokesperson Ad only).
Earlier: PR CY — Append-Only Output History.
Spokesperson Ad re-renders used to overwrite the prior MP4
(canonical filename `data/host/{id}.mp4` plus single-value
`host_video_url` URL), so the Outputs gallery only ever showed
the latest take. New `Campaign.outputs: list[OutputRecord]`
field captures every successful render with its `kind`
(`spokesperson_ad` / `spokesperson_reels` / etc.), `video_url`
(pointing at the new generic `/api/campaigns/{id}/output/{output_id}`
route), `cache_filename`, optional `script` (for spokesperson_ad
takes), `task_id`, `mock_mode`, and `parent_output_id` (links
derived reels back to the source ad). Per-output cache filenames
preserve historical MP4s on disk while the canonical `<id>.mp4`
keeps backward-compat for legacy single-field URL consumers.
Backend route count **73 → 74**. Hooks wired into the existing
`POST /host-video` and `POST /spokesperson-ad/reels` success
paths (additive only, no schema break). OutputsGallery rewritten
to walk `campaign.outputs` newest-first; falls back to the legacy
`host_video_url`/etc. single-value reads for pre-PR-CY campaigns
without a migration. Cards now distinguish multiple renders via
a script preview, relative-time stamp, and `derived from
<parent kind>` line on reels. Lane Step 3 UX copy refreshed:
button label flips from "Regenerate Real Spokesperson Ad" to
"Render new Spokesperson Ad" with a "previous render saved"
chip and the warning copy now reads "Re-rendering creates a new
billable video. Prior renders are preserved in the Outputs tab."
Three new pytests pin the contract (`test_host_video_appends_output_history`,
`test_output_route_404s_for_unknown_id`,
`test_output_route_404s_for_unknown_campaign`).
Earlier: The Knowledge tab in the spokesperson workspace was the
last `<TabComingSoon>` placeholder before the demo. New
`<KnowledgePanel>` provides the operator-facing surface:
`+ Add Knowledge Source` CTA → inline form (title +
source-type select + content textarea, ≤8000 chars) →
saved-source list with delete + short preview +
`saved · available to campaigns` status pill. Manual paste
only — no embeddings, no RAG. New
`Character.knowledge_sources: list[KnowledgeSource]` field;
new `POST /api/characters/{id}/knowledge` and
`DELETE /api/characters/{id}/knowledge/{source_id}` routes
(both return the updated Character so the workspace's local
slice stays in sync without re-fetching). Backend route
count **71 → 73**. The Spokesperson lane Step 2 · Script
card mounts a small `<details>` reference disclosure when
the active spokesperson has at least one saved source —
shows up to 5 (title + 200-char preview) inline above the
script CTA so operators can read brand notes / product
details / FAQs while typing the script. No auto-injection.
Four new pytests
(`test_knowledge_source_round_trip`,
`test_knowledge_source_404_when_character_missing`,
`test_knowledge_source_404_when_source_missing`,
`test_knowledge_source_validation`) pin the contract.
Earlier: Replaced the PR CR/CS per-template f-strings (which
produced ~720-char "polished commercial mascot portrait of an
anthropomorphic mascot spokesperson — anthropomorphic donkey…"
double-anchored output with raw chip dumps + repeated lighting
phrases) with a deterministic composer: `Polished {anchor}
portrait of {subject}[ wearing {wardrobe}]. {expression cue}.
[{aesthetic sentence}.] Head-and-shoulders composition on a
clean neutral background. Professional advertising character
design. [Soft studio lighting.]`. Anchor word picks from
operator's chips by priority (editorial > cinematic > stylized
> fallback "commercial"). Aesthetic sentence picks one phrase
per category (design / color / light) and folds them into a
single readable line ("Stylized commercial brand-character
design with muted colors and soft studio lighting."). Wardrobe
text after a `;` parses naturally
("dark hoodie, backwards hat" → "a dark hoodie and backwards
hat"). User-spec fox mascot example lands at 364 chars and
matches documented expected verbatim. Backend
`_compose_clean_prompt` + frontend
`buildCharacterPortraitPrompt` + the embedded
`CreateSpokespersonFlow.derivePortraitPrompt` all delegate to
the shared composer — three drift surfaces collapsed into one.
Six new pytests pin the contract; the legacy v1 smoke regex
updated to match the new prefix. `prompt_override` and
`safe_retry` paths unchanged — operator-typed text still
short-circuits the composer. Backend route count still **71**.
Earlier: Reviewed the official Runway docs at
`docs.dev.runwayml.com` and the Stainless-generated Python
SDK source (`runwayml/sdk-python`) end-to-end. Confirmed
`gen4_image_turbo` is officially supported (not deprecated
— the PR CT-era failures were upstream availability flakes
specific to that window). The headline contract finding:
**`reference_images` is REQUIRED for `gen4_image_turbo`
but OPTIONAL for `gen4_image`**. We were sending a flat
320×320 charcoal seed PNG under both models because turbo
required it; under `gen4_image` the model interprets the
seed as a literal visual reference and steers output
toward a featureless dark frame, which triggers the
safety / quality reject loop. Now conditionally included:
under `gen4_image_turbo` the seed stays; under `gen4_image`
the body sends just `{model, promptText, ratio}` matching
the SDK's `Gen4Image` TypedDict exactly. One real Runway
validation call rendered a clean founder portrait in 27s
under the contract-correct payload. Avatar create contract
matches in 4/5 fields — missing optional `imageProcessing:
"optimize"` flagged as a one-line PR CW follow-up.
avatar_videos `model: "gwm1_avatars"` confirmed correct.
`X-Runway-Version: 2024-11-06` still current. Diagnostic
script (`scripts/diagnose-portrait.py`) updated to print
exact body keys + whether referenceImages would be sent.
Backend route count still **71**. Earlier: The v2 workspace's "Spokesperson Ad" lane (and
the sibling Cinematic / Dialogue lanes) used to mount a
3-step scaffold whose Step 1 read "Create or select a
campaign to edit the brief." with no button — operators had
to round-trip to `/legacy` to author a brief. New
`<LaneBriefCreator>` component provides an inline
`+ Create campaign brief` CTA → Business* / Product /
Audience / Tone form → Save POSTs a minimal valid
`CampaignCreate` + `attach-character` to the active
spokesperson. Wired into all three lanes. **Spokesperson
lane Step 2** also got an inline `+ Save script` CTA →
textarea (≤300 chars) → Save POSTs
`/api/campaigns/{id}/script` (existing PR AA route); the
preview / Edit cycle stays inline. **Step 3 disabled-state
chips** rewrote the cryptic "no avatar" / "no source"
language to operator-readable "requires avatar" /
"requires video" / "requires brief"; tooltips point at
the next step instead of internal field names. Backend
route count still **71** — every new call uses an existing
JSON-only route. End-to-end mock probe round-tripped
create-character → save-campaign → attach-character →
save-script cleanly. Earlier: PR CP cont. through PR CS
spent hours prompt-tuning under the assumption that
`INTERNAL.BAD_OUTPUT.CODE01` failures were prompt content
issues. The user requested a proper regression audit and the
audit found **the model itself was broken on Runway's side**.
Direct probes bypassing all of our code with a clean human-
founder prompt + our exact payload shape returned
`INTERNAL.BAD_OUTPUT.CODE01` at every aspect ratio
(1280:720, 720:1280, 1024:1024) under `gen4_image_turbo`,
while the same call under **`gen4_image` (non-turbo)
SUCCEEDED** with an output URL. The fix is one line:
`_IMAGE_MODEL = "gen4_image"` in
`backend/app/services/character_studio_client.py`. Donny
`23b969f1288b` then rendered cleanly on the first attempt
(447 KB) under the same prompt that had been failing
repeatedly under turbo. PR CR / PR CS prompt work was
correct — the positive-only templates + safe_retry preset
both apply cleanly to `gen4_image`. New
`scripts/diagnose-portrait.py` (executable) prints the
resolved prompt, request shape (no secrets, no base64),
persisted state, last error, and on-disk portrait file
size without firing a real Runway call. Backend route
count still **71**. Earlier: Donny Sparks `d2fdf899e8d8`
reproduced `INTERNAL.BAD_OUTPUT.CODE01` against a `style`
field containing "indiana jones style hat" + dense adjective
chains — IP reference + chip-stack overload. New
`Character.portrait_last_error` field captures the failure
text; the `/api/characters/{id}/generate-portrait` route now
persists `portrait_prompt` + `portrait_last_error` on failure
(previously lost) and logs the resolved prompt + character
name + style_chips + flags at WARNING for diagnosis. New
`_SAFE_RETRY_TEMPLATES` (one per archetype) + `safe_retry:
bool` request-body field fill a ~280-char preset that
**bypasses `character.style` entirely** — the field where
unstable concepts accumulate. The character's `subject`
survives so the regen still depicts the right
creature/person. The CreateSpokespersonFlow failure banner
gets a `<details>` showing the failed prompt + Runway
`runway · …` caption + an amber **"Try safer prompt"** button
that fires `safe_retry=true` (deliberately drops the
operator-typed `prompt_override` too). The workspace Identity
audit `<details>` flips to rose styling with a `runway · …`
caption when `portrait_last_error` is set. Two new pytests
(`test_safe_retry_uses_simpler_prompt` +
`test_default_path_still_includes_style`) pin the contract.
Backend route count still **71**. Earlier: Donny Sparks (an anthropomorphic
donkey marketing mascot) reproduced
`INTERNAL.BAD_OUTPUT.CODE01` against the PR CP cont.
brand-safe tail's negation list ("No horror, no
distortion, no extra limbs, no melted anatomy, no
uncanny realism") because diffusion models routinely
misread inline negations as content directives. The
new `_BRAND_SAFE_TAIL` is positive-only — "Polished
commercial illustration with believable character
anatomy and a clean face" — and Donny renders cleanly
under it (549 KB PNG, real Runway). Frontend
`_FINISHERS` matched. The portrait service now also
surfaces Runway's `failureCode` in raised errors
(format: `[code=INTERNAL.BAD_OUTPUT.CODE01]`) and
auto-retries once on `INTERNAL.*` codes OR `timed out`
after a 2 s backoff (belt-and-braces; the prompt
rewrite is the real fix). Polling deadline bumped 90 s
→ 180 s. **Avatar surface** also tightened: the
`/api/characters/{id}/create-avatar` route now logs
payload SHAPE (no secrets) at INFO before the POST,
guards zero-byte portrait files with a 409,
surfaces Runway's avatar `failureCode` via the same
`[code=…]` shape, and **raises HTTP 502** on
`result.status == "failed"` instead of returning 200
with persisted-failed flags (the previous code path
let the v2 stepper silently navigate past avatar
failures). Five-test mock-mode pytest at
`backend/tests/test_create_avatar_mock.py` pins the
contract (happy path + 404 / 409 / 400 / 409 zero-byte
guards). Backend route count still **71**. Earlier: New `<DangerZone>` section in the
`/spokespeople/:id` Identity tab gives operators a
discoverable, two-step delete affordance (the legacy
`<CharacterCard>` footer's tiny 9-px `delete` link was
never findable per SESSION 070 QA). Two-step UX:
click `Delete spokesperson` (testid
`spokesperson-workspace-delete`) → typed-name confirmation
input + armed `Delete` button (`data-armed="true"` only
when the typed text matches the spokesperson name
exactly) + Cancel that collapses the zone. Reuses the
existing `handleDelete` plumbing → `DELETE /api/characters/{id}`
→ navigate('/'). The Identity tab caption was rewritten
to explicitly disambiguate **Portrait image** (still
face, drives the tile + the avatar's reference) from
**Runway avatar** (talking/lip-sync identity that drives
Spokesperson Ads + realtime). Endpoint audit landed in
SESSION 072: `generate-portrait` correctly fires Runway's
`gen4_image_turbo` via `/v1/text_to_image` with a
charcoal seed reference + the resolved
PORTRAIT_TEMPLATES prompt (or the operator's
`prompt_override` from CreateSpokespersonFlow Step 2);
`create-avatar` correctly fires `/v1/avatars` with the
cached portrait inlined as `referenceImage` data URI +
voice binding. **Both endpoints are right.** The PR CO
rough-portrait observation is a prompt-content issue
(seed `subject` strings are ad-copy not visual
subjects), not an endpoint issue. **PR CP cont.**
hardens the four `PORTRAIT_TEMPLATES`: every template
now opens with a "polished commercial spokesperson
portrait" anchor, lands `{subject}` in the noun
position, and ends with a shared brand-safe / anti-
uncanny tail — "Brand-safe advertising character
suitable for a marketing campaign. No horror, no
distortion, no extra limbs, no melted anatomy, no
uncanny realism. No props or sunglasses." The mascot
template explicitly anchors on "an anthropomorphic
mascot spokesperson" so animal mascots like Brewster
Bolt the raccoon read as creatures even when the seed
`subject` is dense ad-copy. The frontend
`characterPromptBuilder._FINISHERS` mirrors the same
brand-safe / anti-uncanny cues so the editable textarea
in CreateSpokespersonFlow Step 2 + CharacterStudio
opens with the same safety language the auto-built
backend prompt enforces. `prompt_override` is
unchanged — when the operator types into the textarea
the backend still uses their text verbatim (capped
1000 chars). Recommended next slice (PR CQ) is now
just sharpening the seed fixture `subject` strings +
re-firing the 4 demo portraits to confirm the new
templates produce believable mascots. Backend
untouched at the route layer (route count still
**71**); no real Runway calls fired this slice.
**PR CQ** ships the sharpened seeds — Brewster Bolt's
`subject` becomes "an anthropomorphic raccoon mascot
spokesperson with a confident grin, energetic posture,
and friendly commercial expression"; Rex Roadside
becomes "a rugged but friendly anthropomorphic bison
truck-dealership spokesperson, broad shoulders, warm
grin, clean commercial mascot design" + his template
flips `local_guide` → `mascot` to match the new
anthropomorphic concept; Clara Vale + Mina Spark get
trimmed concrete subject strings (template unchanged).
Plus a tiny inline `<details>` block in the workspace
Identity tab — testid `spokesperson-workspace-portrait-prompt` —
shows the resolved `Character.portrait_prompt` (the
exact string sent to `gen4_image_turbo` on the last
successful generate). Empty-state hint
(`spokesperson-workspace-portrait-prompt-empty`)
renders pre-portrait; no editor, no copy button, no
API. The Identity tab is now a responsive 2-col grid
(`md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]`,
testid `spokesperson-workspace-identity-grid`) so the
embedded `<CharacterCard>` caps at 320px wide on
desktop with the prompt audit hosted in the right
column; the previous `aspect-square w-full` portrait
was rendering at full workspace width and dominating
the page. Mobile collapses to one column and centres
the card at `max-w-[320px] mx-auto`. The
seed-fixture rewrites + audit surface together close
the "what's this prompt actually saying to Runway?"
operator question. Real-mode QA checklist (regen
Brewster + Rex, confirm portrait_prompt persisted +
avatar references the regenerated portrait, capture
before/after notes) is documented in
`docs/handoffs/SESSION_074_SHARPEN_DEMO_SUBJECTS_PR_CQ.md`
and remains unexecuted pending operator approval. PR CO landed
immediately before: Three actions ran this slice:
(1) re-seeded the four canonical demo spokespeople (Brewster
Bolt / Clara Vale / Rex Roadside / Mina Spark) — only
Brewster Bolt was alive before; Clara / Rex / Mina were
re-created with stable name-keyed upserts. (2) New
`scripts/relink-orphan-demo-campaigns.py` walked
`campaigns.json` and relinked five orphaned demo campaigns
(CEO Buzz × 2, AdSpark Studio, Freedom Ford, Spark Social)
from their dead character ids back to the matching live
demo spokesperson ids — preserving every cached output URL.
Net effect: Brewster Bolt's CEO Buzz campaign with 4 cached
outputs reattaches to his workspace; the PR CN gallery
populates on first paint. (3) Real Runway portraits fired
for the 3 missing demo personas — Brewster (526 KB),
Clara (575 KB), Mina (770 KB) succeeded; Rex Roadside
failed Runway upstream again (`portrait task FAILED`)
exactly as in PR CI, kept as a record for the in-app
retry. Logged in `docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md`.
Frontend stats logic in `SpokespersonStudio.jsx` tightened
so `library-stat-linked-campaigns` / `library-stat-outputs`
/ `library-stat-transcripts` count only campaigns whose
`character_id` resolves to a record in the local
characters slice (closes SESSION 070's "stats overstate
what's reachable" P1). Backend untouched (route count
still **71**). PR CN landed
immediately before: The `/spokespeople/:id` Outputs tab no longer
ships a `<TabComingSoon>` placeholder — it now mounts a real
`<OutputsGallery>` that walks every linked campaign and
surfaces every cached output URL (Spokesperson Ad,
Cinematic Video, Voiced Cinematic, Storyboard, Voiced
Storyboard, Dialogue Scene, Captioned Reels, Captioned
Dialogue Reels) as inline `<video controls muted
preload="metadata">` previews + per-card status chip,
campaign label, orientation pill, and open/download link.
Empty state when the spokesperson has no linked campaigns
or those campaigns have no cached outputs yet. Newest
first by `campaign.created_at`. Frontend-only — no new
backend routes (route count still **71**), no autoplay,
no generation triggers. **Closes the third and final
SESSION 059 demo-readiness blocker** (after PR CF lane
copy and PR CM tile simplification). PR CM landed
immediately before: the homepage tile is now a true
browse → identify → open card: portrait (or "Portrait
pending" placeholder), name, persona pill, role one-liner,
summary chips (voice / linked / outputs / transcripts),
and a single primary `Open Spokesperson →` link. The
previous in-tile Identity / Knowledge / Appearances tab
strip + the embedded `<CharacterCard>` are gone — those
affordances now live exclusively inside the workspace at
`/spokespeople/:id`. Closes the
loop on Step 4's "Start a campaign" checkbox: the parent
SpokespersonStudio now navigates to `/spokespeople/{id}` after
the localStorage hint is set; the workspace mount effect reads
the hint, switches to Campaigns tab, opens the mode modal
in-place, and clears the key. End-to-end: check the box →
new tile lands → workspace opens → mode picker is already
showing. Backend untouched (route count still **71**). Builds on SESSION 065's audit + proposal:
the lightweight PR CB modal (4 fields) is replaced with a
4-step stepper (Identity / Visual Direction / Voice /
Generate) that captures every rich field the backend already
supports — `personality`, `style`, `portrait_prompt`, full
30 voice presets with detail copy, plus a metadata patch for
`audience_vibe` / `creation_flow` / `visual_style_chips` /
`speaking_energy`. Backend route count **70 → 71** (single
new route `POST /api/characters/{id}/metadata` to merge a
partial dict into the existing `Character.metadata` field;
no schema change). PR CJ portrait-failed retry/skip
preserved verbatim. Optional Step 4 checkboxes for **Bind a
Runway avatar** + **Start a campaign**; the latter writes a
localStorage hint that future workspace integration can
read. `/legacy` Create Character form unchanged. PR CJ stops the Create Spokesperson
modal from silently swallowing Runway portrait failures —
when generation fails, the modal now stays open in a
`portrait-failed` phase with a clear error message + Retry
portrait + Save without portrait buttons. Backend untouched;
verified end-to-end via Playwright route-intercept tests
(no real Runway credit consumed for the fix). Three of the four PR CG demo
spokespeople now have real Runway portraits persisted on
disk: Brewster Bolt (481 KB), Clara Vale (650 KB), Mina
Spark (711 KB). Rex Roadside's portrait failed Runway
upstream both attempts (`portrait task FAILED`) and remains
blank — operator can retry from the in-app `Generate
Portrait` button. Logged in
`docs/handoffs/SESSION_REAL_API_CREDIT_BURN.md` ·
SESSION 063 follow-up section.
Backend route count remains **70** (PR CH is fixture-only).
Library now seats **7 spokespeople** (PR CG: Brewster Bolt,
Clara Vale, Rex Roadside, Mina Spark + 3 pre-existing) and
**4 new demo campaigns** (PR CH: one per new spokesperson).
The four PR CH campaigns ship as drafts — brief / business /
product / audience / tone / runway_prompt / selected_concept
/ social_post / commercial_script all populated with
purposeful copy, but no cached outputs. Operators run
Generate inside the workspace lanes to fill those out per
Runway-burning click. Idempotent seeders:
`scripts/seed-demo-spokespeople.py` (PR CG) +
`scripts/seed-demo-campaigns.py` (PR CH). Lane scaffold
pills (`scaffold · PR BI/BK/BL`), the mode-modal "preview
UX" pill, every "lands next" + "classic UX" + "classic
gallery" reference in user-visible text, and stale Step-2
lane copy that pointed users to the legacy wizard for things
that work in-place have all been rewritten in product
language ("Build a spokesperson ad", "Create a cinematic
video", "Plan a dialogue scene", "Knowledge sources will
appear here", etc.). Smoke now carries a forbidden-jargon
regex check that walks `/`, the mode modal, and each lane
to enforce the cleanup. PR CF closed the **first** of the
SESSION 059 demo-readiness blockers; the remaining two
(library tile / workspace Identity duplication, real
Outputs gallery) are next slices. The frontend
preserves the three-route shape established by PR CA: `/`
mounts the **Spokesperson Library** (library-only after
PR CD), `/spokespeople/:id` mounts the **Spokesperson
Workspace** (PR CC + PR CE — Campaigns tab is now fully
implemented), and `/legacy` mounts the verbatim v1
four-stage wizard + saved-campaign gallery. PR CE extracts
a new self-contained `<CampaignLanes>` component that owns
the mode modal + active-mode pill + Spokesperson / Cinematic
/ Dialogue lane mounts + every lane handler (PR BN / BO /
BP / BQ / BT / BU). Workspace's `+ New Campaign` button now
flips the active tab to "campaigns" + opens the controlled
mode modal inside `<CampaignLanes>`; mode select stays at
`/spokespeople/{id}` (no more `/legacy` hand-off). The
Campaigns tab also renders a compact list of linked
campaigns above the lanes.
PR BR scrolls + highlights the matching CampaignCard; PR BS
extends the path so the card also lands on the **most
relevant tab** inferred from the Appearances row's mode pill
(Spokesperson Ad → character; Cinematic / Storyboard →
visuals; Dialogue Scene → dialogue; Realtime → realtime;
Mixed / Draft → overview). PR BT closed the last v2 lane
placeholder: the **Cinematic Video** button now fires real
Runway `image_to_video` (start + poll, 5 s ± 800 ms jitter,
60-attempt 5-min cap), mirroring v1 `App.handleGenerateVideo`
exactly. PR BU **persists** that output: after polling
SUCCEEDED, the studio handler POSTs the Runway URL to the new
`POST /api/campaigns/{id}/cinematic-video` route; backend
downloads via `VideoCache.fetch`, then flips
`cached_video_url → /api/campaigns/{id}/video` (same path the
existing gallery player already streams). Persisted state
survives reloads + appears unchanged in the v1 gallery.
PR BQ's inline brief editor still mounts at lane Step 1;
the action count from PR BP / BT now covers **every** lane
render target:
**Spokesperson Lane** Horizontal (real `avatar_videos`, burns
credits) + Captioned Reels (PR BN); **Cinematic Lane**
Cinematic Video (real `image_to_video`, burns credits — PR BT)
+ Voiced Cinematic (PR BO) + Storyboard Commercial
(`stitchStoryboard`, ffmpeg-only); **Dialogue Lane** Plan Lines
(`planDialogue`, no credits) + Stitch Scene (`stitchDialogue`,
ffmpeg) + Captioned Reels (`buildDialogueSceneReels`, ffmpeg).
Every credit-burning button carries `data-burns-credits="true"`
+ a rose-chrome warning + a "burns credits" caption. Real-mode validated: one
fresh `avatar_videos` task on CEO Buzz / Brewster (task
`cf7e6067-…`) confirms the Horizontal wiring end-to-end. **Real-mode credit-burn session preserved on disk:**
Brewster / CEO Buzz spokesperson MP4 (1088×704, 18.4 s, 6.1 MB),
captioned reels (720×1280), voiced cinematic mux (1280×720),
real Runway grounding doc — all gitignored, served from cached
files regardless of mock/real flags.

## Backend (`backend/`)

| Path | Status | Notes |
|---|---|---|
| `app/main.py` | real | FastAPI app, CORS, `/health`, router registration (incl. `characters_router`) |
| `app/config.py` | real | pydantic-settings; PR-A vars + PR-F `runway_host_voice_preset` / `runway_host_portrait_url` |
| `app/models.py` | real | Pydantic schemas — Campaign with all PR A → AF fields (Pack, Spokesperson, Audio Pack, Avatar Picker, **`character_id` + `generated_character_prompt`**, **`commercial_script` + `commercial_script_updated_at`**, **storyboard fields + `StoryboardShot`**, **dialogue fields + `DialogueLine`**) plus `Character` / `CharacterCreate` / `CharacterList` models. **PR BB** — adds `VoiceRepairHistoryEntry` (timestamp, action ∈ clone/apply/repair/refresh/verify, before_voice_id, after_voice_id, resolved_voice_id, drift_status, status, error, mock_mode) + `voice_repair_history: list[VoiceRepairHistoryEntry] = []` on Character, capped at the most recent 20 entries by the store. **PR BC** — adds `TranscriptHistoryEntry` (fetched_at, conversation_id, status ∈ ok/failed/mock/empty/no_session, turn_count, turns, mock_mode, error) + `realtime_transcript_history: list[TranscriptHistoryEntry] = []` on Campaign, capped at the most recent 20 entries by the store |
| `app/services/concept_service.py` | real + mock fallback | OpenAI `gpt-4o-mini` JSON-mode call; deterministic mock |
| `app/services/runway_client.py` | real + mock | `image_to_video` / `text_to_video` routing; `GENERATION_POLICY` validation |
| `app/services/image_client.py` | real + mock | `/v1/text_to_image` (`gen4_image_turbo`); seeded `referenceImages`; stdlib zlib PNG mock |
| `app/services/finisher_service.py` | real | Local ffmpeg Campaign Pack + **Voiced Cinematic Ad mux** (PR S/X `-stream_loop -1 -shortest`) + **Storyboard concat** (PR Z `concat=n=N:v=1:a=0`) + **Voiced Storyboard** (PR Z) + **Dialogue Scene concat** (PR AF `concat=n=N:v=1:a=1` audio-preserved) + **Reels export** (PR AG `scale=720:1280:force_original_aspect_ratio=decrease,pad=…` letterbox; synthesises a silent AAC track when the source has no audio so output stays h264 + AAC) + **Burned-in captions** (PR AH chained `drawtext=…enable='between(t,start,end)'` per segment, textwrap word-wrap, bottom-safe placement, `probe_duration` ffprobe helper) + **Contrast-aware caption styling** (PR AM — `caption_style` argument or auto-derived from backdrop; light backdrops swap to black-on-white box, dark/unset backdrops keep the PR AH white-on-black baseline) |
| `app/services/character_host_client.py` | real + mock | Phase 1 `/v1/avatars` + Phase 2 `/v1/avatar_videos`; image-source fallback chain; **`active_avatar_id(campaign, settings)` resolves character > selected > host**; **PR AA — uses `campaign.commercial_script` as `script_override` when no explicit override is supplied** |
| `app/services/avatar_listing_client.py` | real + mock | `GET /v1/avatars` curation; 4 hard-coded mock presets (PR I+) |
| `app/services/realtime_avatar_client.py` | real + mock | `/v1/realtime_sessions` broker — **PR AE injects campaign-aware `personality` + `startScript` overrides**, defensive 400-fallback retries the bare body, `_redact()` scrubs Bearer / sessionKey / JWT patterns from any logged upstream response. **PR AI** — when `campaign.runway_document_id` is set the body also carries `documentIds=[id]` and the personality is swapped for a leaner `_grounded_personality` (~20 % smaller); two-tier 400-fallback drops `documentIds` first, then drops `personality + startScript` if Runway still rejects. **PR AJ** — the broker's session id is captured by the route layer and persisted as `runway_conversation_id` for transcript retrieval (Runway's `sessionId == conversationId`) |
| `app/services/transcript_client.py` | real + mock | **PR AJ** — wraps `GET /v1/avatar_conversations/{id}` plus an empty-/missing-/non-2xx tolerant `_normalise_turns` that maps Runway's documented `transcript[]` shape into our `TranscriptTurn` model. Mock mode synthesises a deterministic 3-turn replay (avatar opener → user question → grounded answer) from the saved business / product / audience / hook / commercial_script + attached Character so the replay UX demos without keys |
| `app/services/color_utils.py` | real | **PR AK** — `normalize_brand_color` accepts `#RRGGBB` / `RRGGBB` / `0xRRGGBB` / `#RGB`, normalises to lowercase `#RRGGBB` for storage, returns `None` on unparseable input. `to_ffmpeg_color` wraps the value as `0xRRGGBB` for ffmpeg's `pad=…:color=…`, falling back to `DEFAULT_REELS_BACKDROP` (`0x0b1220`) when the input is missing or invalid. **PR AM** — adds `hex_to_rgb`, WCAG `relative_luminance`, `is_light_color` (>= 0.5 luminance threshold), and `caption_style_for_backdrop(value) -> {font_color, box_color, box_alpha, is_light_backdrop}`. The dark default style mirrors PR AH exactly (white text / black@0.6 box) so untouched callers see no rendering change |
| `app/services/documents_client.py` | real + mock | **PR AI** — thin wrapper around `POST /v1/documents` (`{name, content}` ≤ 40,000 chars, plain text + Markdown), `PATCH /v1/avatars/{id}` (`{documentIds: [...]}` best-effort), and `build_campaign_brief_markdown(campaign, character)` for the standard brand-brief shape. Mock mode returns deterministic `mock_doc_<sha256-of-name+content>` ids so smoke + offline demo flows can flip the grounding badge end-to-end without burning credits |
| `app/services/audio_client.py` | real + mock | `/v1/voices` text design + `/v1/voice_dubbing`; 29-language `SUPPORTED_DUB_LANGS`; ffmpeg lavfi mock MP3s |
| `app/services/voice_clone_client.py` | real + mock | **PR AN** — wraps `POST /v1/voices` with `from.type=audio` for custom voice cloning. `clone_voice_from_audio(name, audio_bytes, mime, settings)` returns a `VoiceCloneResult`; mock mode emits a deterministic `mock_voice_<sha256(name + bytes)[:16]>` so re-uploads of the same sample are idempotent and a fresh sample yields a new id. Caps audio at 15 MB (Runway docs say 10 MB) so an oversized sample fails with a friendly 413 before hitting the wire. Allowlist of `audio/mpeg`, `audio/wav`, `audio/m4a`, `audio/mp4`, `audio/aac`, `audio/webm`, `audio/ogg`. **PR AQ** — adds `apply_voice_to_avatar(avatar_id, voice_id, settings)` which `PATCH /v1/avatars/{id}` with `{voice: {type: "custom", voiceId: ...}}` so a freshly cloned voice swaps into an existing avatar without re-creating it. Mock-aware (mock id or runway_mock → returns `mock_patched`); never raises. **PR AR** — captures Runway's `previewUrl` from the READY poll response (with a tolerant `_extract_preview_url` helper that accepts `previewUrl` / `preview_url` / `preview`); surfaces it on `VoiceCloneResult.preview_url`. Adds `fetch_voice_preview(voice_id, settings)` for future refresh routes. **PR AS** — adds `fetch_avatar_voice(avatar_id, settings, *, expected_voice_id, avatar_is_mock)` running `GET /v1/avatars/{id}` to confirm the bind landed; returns an `AvatarVoiceState` (`verified` / `mock_verified` / `unverified` / `failed`) with resolved type / id / label fields. Tolerant `_extract_voice_block` (accepts `voice` / `voiceBlock` / `voice_block`) + `_resolve_voice_fields` (accepts `type` / `voiceType`, `voiceId` / `voice_id` / `id`, `name` / `label` / `presetId`) survive future Runway shape renames. **PR AT** — adds `compute_voice_drift_status(custom_voice_id, resolved_id, verify_status)` pure helper returning `match` / `drift` / `unknown`. Case-insensitive id comparison after whitespace strip; whitespace-only ids treated as missing. Used by both clone-voice + apply-voice routes via the shared `_verify_avatar_voice_after_patch` helper |
| `app/services/character_studio_client.py` | real + mock | **PR K** — `PORTRAIT_TEMPLATES` (4 locked: mascot, founder, coach, local_guide); `build_prompt()`; `generate_portrait()` calls `/v1/text_to_image`; `create_avatar()` reads cached portrait → data URI → `POST /v1/avatars` → poll READY. **PR AN** — when `character.custom_voice_id` is set, the avatar create body uses `voice: {type: "custom", voiceId: ...}` instead of the runway-live-preset binding |
| `app/services/character_store.py` | real | **PR K** — JSON-file Character store at `backend/data/characters.json`; threading.Lock; atomic writes. **PR BB** — adds `append_voice_history(character_id, entry, *, max_entries=VOICE_HISTORY_MAX=20)` for the audit-trail field; newest-first insertion + cap inside the same lock the rest of the store uses |
| `app/services/storyboard_service.py` | real + mock | **PR Z + PR AC** — script-aware `_split_script_beats` planner + per-shot `image_to_video` generation + ffmpeg lavfi mock; `_shot_prompt` weaves narrative cues from `campaign.commercial_script` |
| `app/services/dialogue_service.py` | real + mock | **PR AF** — `plan_lines` builds Hook/Beat/Closer with primary + secondary speaker selection from ready characters; `generate_line` wraps `avatar_videos` (real) + ffmpeg lavfi (mock) targeted at the line's speaker avatar |
| `app/services/storage.py` | real | JSON-file campaign store; threading.Lock; per-feature update helpers (cache / finish / host avatar / host video / brand voice / dub / selected avatar / **character attachment** / **commercial_script** / **storyboard plan + per-shot + stitch + voiced** / **dialogue plan + per-line + stitch** / **reels (PR AG, kind=spokesperson|dialogue_scene)** / **realtime document (PR AI)** / **runway_conversation_id + transcript turns (PR AJ)** / **brand_color (PR AK)**); also normalises the brand colour at create-time so an unparseable initial-save input falls back to `None` instead of 422-ing. **PR BC** — adds `TRANSCRIPT_HISTORY_MAX = 20` + `append_transcript_history(campaign_id, entry, *, max_entries=…)` returning the post-append Campaign so the route can include the freshly-added row in its response |
| `app/routers/concepts.py` | real | `POST /api/concepts` |
| `app/routers/runway.py` | real | All `/api/runway/*` routes including `provider-status`, `organization`, `avatars` (list), `image`, `generate`, `task`, `upload-image` |
| `app/routers/campaigns.py` | real | All `/api/campaigns/*` routes (50+ now — see endpoint list below) |
| `app/routers/characters.py` | real | **PR K** — 7 character routes. **PR BB** — clone-voice + apply-voice + refresh-avatar-voice each call `_append_voice_history_safe(...)` after their primary update so the audit trail mirrors operator actions; apply-voice gains an optional `ApplyVoiceBody { mode: "apply" \| "repair" }` so the PR AU repair button labels its entry correctly. History append is best-effort: an exception inside the wrapper is logged but never aborts the underlying flow |
| `requirements.txt` | real | fastapi, uvicorn, pydantic, pydantic-settings, httpx, openai, python-dotenv |
| `.env.example` | real | All PR-A → PR-I knobs documented |
| `data/campaigns.json` | real | Created lazily on first save |
| `data/characters.json` | real | **PR K** |
| `data/{images,videos,finished,host,audio,characters,storyboard,dialogue}/` | real | Per-feature local caches, all gitignored via `backend/.gitignore: data/` |

## Frontend (`frontend/`)

| Path | Status | Notes |
|---|---|---|
| `vite.config.js` | real | Proxies `/api` and `/health` → `http://localhost:8000` |
| `tailwind.config.js`, `postcss.config.js`, `index.html` | real | Tailwind wired |
| `package.json` | real | Adds `@runwayml/avatars-react ^0.15.0` for realtime |
| `src/api.js` | real | Thin fetch wrapper; helpers for every backend route incl. all PR Z/AC storyboard helpers, PR AA `saveCommercialScript`, PR AB `generateSpokespersonAd`, PR AF dialogue helpers (`planDialogue`, `saveDialogueLine`, `generateDialogueLine`, `stitchDialogue`) |
| `src/uxFlag.js` | real | **PR BD** — UX v2 feature flag. `getUxMode()` resolves precedence (URL `?ux=v1\|v2` > localStorage `adspark.ux` > default `v1`). `isUxV2()` convenience predicate, `setUxMode(mode)` mutator, `UX_MODES` + `UX_STORAGE_KEY` constants. SSR-safe (guards window/localStorage). Foundation for the spokesperson-first redesign — every v2 surface (PR BE+) gates its render at mount via this module. **PR BH** — adds `getActiveMode()`, `setActiveMode(mode)`, `clearActiveMode()` for the mode-first creation flow plus `CAMPAIGN_MODES` + `ACTIVE_MODE_KEY` constants. Mode is one of `"cinematic" \| "spokesperson" \| "dialogue"`; persisted as `localStorage.adspark.activeMode` |
| `src/uiHelpers.js` | real | **PR BD** — shared audit-row helpers extracted from CharacterCard.jsx so future spokesperson-first surfaces can reuse them: `formatHistoryTimestamp(iso, nowMs)` (compact relative-time bucket formatter, no `"Last checked "` prefix), `HISTORY_ACTION_PILLS` (frozen action→Tailwind class map), `historyStatusClass(status)`, `historyDriftClass(drift)`. Behaviour identical to the originals from PR BB; pure relocation slice |
| `src/components/SpokespersonStudio.jsx` | real | **PR BE/BF/BH/BI/BK/BL** — gated v2 Stage 1 surface. Reads `GET /api/characters` + `GET /api/campaigns`; indexes campaigns by `character_id`; renders heading + library grid + mode-first creation modal + per-mode lane (SpokespersonLane / CinematicLane / DialogueLane) below the active-mode pill. **PR BN** — adds `handleBuildSpokespersonReels(campaignId)` that calls `api.buildSpokespersonReels`, updates the local campaigns slice in place, and bubbles `onCharactersChanged`; threaded into SpokespersonLane via `onBuildReels`. **PR BO** — adds `handleBuildVoicedCinematic(campaignId)` mirroring the same shape; threaded into CinematicLane via `onBuildVoicedCinematic`. data-testid: `spokesperson-studio`, `spokesperson-studio-heading`, `spokesperson-empty-state`, `spokesperson-library`, `spokesperson-new-campaign`, `spokesperson-active-mode`, `spokesperson-active-mode-dismiss`; `data-ux-mode="v2"` on the wrapper, `data-mode="cinematic\|spokesperson\|dialogue"` on the active-mode pill |
| `src/components/CampaignModeModal.jsx` | real | **PR BH** — mode-first campaign creation modal (gated v2). Three-card picker: 🎬 Cinematic Ad / 🎙️ Spokesperson Ad / 🎭 Dialogue Scene. Each card carries summary + detail copy. Backdrop click + Escape key + close button all dismiss without persisting. `onSelect(mode)` fires when a card is clicked; parent (SpokespersonStudio) persists via `setActiveMode` and renders the pill. data-testid: `campaign-mode-modal`, `campaign-mode-modal-backdrop`, `campaign-mode-modal-close`, `campaign-mode-modal-cards`, `campaign-mode-card-{cinematic\|spokesperson\|dialogue}` |
| `src/components/lanes/SpokespersonLane.jsx` | real | **PR BI** — first v2 mode lane scaffold (gated; mounts when `activeMode === "spokesperson"`). 3-step layout: **Step 1 Brief** (campaign business / product preview or "no linked campaign" copy), **Step 2 Script** (commercial_script preview when set, else placeholder), **Step 3 Render**. Receives `activeSpokesperson` (Character object set via PR U "Use as Spokesperson") + `linkedCampaigns` (campaigns indexed by `character_id` upstream). Picks the most-recent linked campaign as the lane's "focused" record. Friendly empty-state hint when neither active spokesperson nor linked campaign exists. **PR BN** — Captioned Reels button now wired to `api.buildSpokespersonReels(focused.id)` via the new `onBuildReels` prop; gated on `focused.host_status === "ok"` + `focused.host_video_url` set; busy/error states surface inline; on cached reels renders a download link to `focused.spokesperson_reels_url`. Horizontal button stays a disabled placeholder pending follow-up wiring. data-testid: `spokesperson-lane`, `spokesperson-lane-step-brief`, `spokesperson-lane-step-script`, `spokesperson-lane-step-render`, `spokesperson-lane-horizontal`, `spokesperson-lane-reels`, `spokesperson-lane-reels-status`, `spokesperson-lane-reels-link`, `spokesperson-lane-empty-hint`. Reels button attrs: `data-render-target="reels"`, `data-source-ready="true\|false"`, `data-busy="true\|false"`, `data-has-output="true\|false"` |
| `src/components/SpokespersonCard.jsx` | real | **PR BE** — single tile for the v2 Spokesperson Library. Three-tab shell (`Identity` / `Knowledge` / `Appearances`); Identity is selected by default and renders the existing `CharacterCard` inline so every v1 affordance (clone / record / mic level / preview / patch / verify / drift / repair / refresh / freshness / voice history disclosure / action row) survives unchanged. data-testid: `spokesperson-card`, `spokesperson-tab-identity`, `spokesperson-tab-knowledge`, `spokesperson-tab-appearances`, `spokesperson-identity-tab`, `spokesperson-knowledge-tab`, `spokesperson-appearances-tab`. **PR BF** — Knowledge tab wires real campaign data: receives `linkedCampaigns`, renders a compact summary line + one row per linked campaign with grounding label / transcript count / last-fetched time. Empty state otherwise. Local helpers `formatKnowledgeTime`, `groundingLabel`, `campaignLabel`, `summariseKnowledge`. **PR BG** — Appearances tab now lists each linked campaign with an inferred mode badge (Cinematic / Spokesperson Ad / Dialogue Scene / Storyboard / Realtime / Mixed / Draft), last-touched relative time, and a 5-label output summary chip row. Disabled "Open in gallery →" affordance per row carries a tooltip noting click-through lands with PR BJ–BL lane routing. New helpers `inferCampaignMode`, `campaignLastTouched`, `campaignOutputSummary` + `MODE_PILL_CLASSES` colour map. data-testid: `spokesperson-knowledge-summary`, `spokesperson-knowledge-empty`, `spokesperson-knowledge-row`, `spokesperson-appearance-row`, `spokesperson-appearance-empty`, `spokesperson-appearance-mode`, `spokesperson-appearance-open` |
| `src/components/OutputsGallery.jsx` | real | **PR CN** — workspace Outputs tab gallery. Walks each `linkedCampaign` and emits one card per populated output URL across 8 fields: `host_video_url` / `cached_video_url` / `voiced_commercial_url` / `storyboard_video_url` / `storyboard_voiced_url` / `dialogue_scene_video_url` / `spokesperson_reels_url` (vertical) / `dialogue_scene_reels_url` (vertical). Each card embeds an inline `<video controls muted playsInline preload="metadata">` (first frame only — never autoplays, no automatic credit burn), labelled type + description + campaign id-prefix · business · product, status chip (ok/failed/unavailable/pending/mock — emerald/rose/amber/zinc tones), orientation pill (`Horizontal` vs `Vertical · Reels`; `aspect-video` vs `aspect-[9/16]` framing), and an `open / download ↗` link. Newest-first sort by `campaign.created_at`. Empty state when no linked campaigns or no cached outputs. data-testid: `outputs-gallery`, `outputs-empty`, `output-card`, `output-card-video`, `output-card-link`. Mounted by `<SpokespersonWorkspace>` Outputs tab, replacing the prior `<TabComingSoon>` placeholder |
| `src/settings.js` | real | localStorage persistence with safety clamps; `STORAGE_KEY = 'adspark.settings.v1'` |
| `src/errors.js` | real | `friendlyError(e, hint)` + `ERROR_HINTS` per call site |
| `src/scriptBuilder.js` | real | **PR AA + PR AC** — `buildCommercialScript({ campaign, character })` deterministic generator + 300-char cap |
| `src/voicePresets.js` | real | **PR AA** — curated descriptions for 12 featured voice presets + `describeVoicePreset()` fallback |
| `src/promptBuilder.js` | real | **PR T** — structured Runway video prompt builder |
| `src/characterPromptBuilder.js` | real | **PR V** — editable Portrait Prompt builder + helper text |
| `src/App.jsx` | real | Orchestrates form → concepts → image → video → save; loads + persists settings; **mounts CharacterStudio** at Stage 1 by default; **threads commercialScriptDraft + onCommercialScriptChange + onGenerateCommercialScript through PromptPreview** (PR AC follow-up); error banner has `role=alert` + auto-scroll-into-view (PR AC fix). **PR BD** — footer renders a small `<UxModeToggle />` that flips the v2 flag (writes localStorage + reloads); legacy default unchanged. **PR BE** — when `isUxV2()` returns true, Stage 1 swaps to `<SpokespersonStudio>` instead of `<CharacterStudio>`; both consume the same `onCharactersChanged / activeCharacterId / onSetActive` props so refresh wiring stays identical |
| `src/components/CampaignForm.jsx` | real | **PR AC fix** — per-field char counters + maxLength caps mirroring backend ConceptRequest validator |
| `src/components/ConceptCards.jsx` | real | 3 selectable cards, "recommended" badge |
| `src/components/PromptPreview.jsx` | real | **"Creative direction" panel** with two visually distinct sections: Section A Commercial Script editor (textarea, char counter, Generate Script, breadcrumb pill), Section B Runway Video Prompt textarea + selectors. PR AD identity-drift helper on the Use Character branch. |
| `src/components/RunwayPanel.jsx` | real | Status pill, progress bar, `<video>`, save button |
| `src/components/CampaignGallery.jsx` | real | The big one. Per-card render of: header + creative-director breadcrumb (Script → Storyboard → Video → Final Ad) + tab row (Overview, Visuals, Character, Voice, **Dialogue**, Realtime, Exports). Overview body owns the **3-card "Pick your ad mode" picker** (Cinematic / Spokesperson / Dialogue). Visuals body renders silent source video + Voiced Commercial section + Storyboard subsection + Voiced Storyboard. Character body renders Brand Spokesperson + Avatar Host Clip → **Spokesperson Ad** (PR AB rename). Voice body renders **Ad Mode primer card** + **Commercial Script editor** + Audio Pack. Dialogue body owns plan/edit/generate/stitch state machine. Exports body renders the per-output ledger including all stitched + voiced outputs. **PR BC** — Realtime body's Conversation transcript card gains a compact "Transcript history" disclosure under the existing fetched-at caption (newest first, default 5 visible, "Show all (N)" toggle expands to the 20-entry cap; status / turn-count / conversation-id / fetched-time row per entry). data-testid: `transcript-history`, `transcript-history-entry` |
| `src/components/AvatarPicker.jsx` | real | PR I+ — fetches `/api/runway/avatars`; 4-up grid; click → `POST /select-avatar` |
| `src/components/RealtimeSpokesperson.jsx` | real | PR I — lazy-loaded `<AvatarCall>` wrapper; **PR AE caption update** ("This avatar knows the campaign brief and saved script…") + chip tooltip + aria-label reframed as starter questions |
| `src/components/CharacterStudio.jsx` | real | **PR K + V + AA + BA** — top-level studio panel with editable Portrait Prompt textarea + voice preset dropdown with **PR AA description chip** + create form + character library + **PR BA** library-level "Refresh all voice statuses" button + compact `idle / refreshing X/Y / refreshed N skipped M failed K` status caption that reuses the per-character PR AV refresh-avatar-voice + PR AX refresh-voice-preview routes |
| `src/components/CharacterCard.jsx` | real | Single tile component reused in studio library and per-campaign attach picker. **PR BB** — adds a "Voice history" disclosure rendered at the bottom of the voice section using `formatHistoryTimestamp` / `HISTORY_ACTION_PILLS` / `historyStatusClass` / `historyDriftClass` helpers. Default 5 newest visible; "Show all (N)" link expands up to the 20-entry cap. data-testid: `custom-voice-history`, `custom-voice-history-entry`. **PR BD** — those four helpers were moved out to `frontend/src/uiHelpers.js`; CharacterCard now imports them so the upcoming spokesperson-first surfaces (PR BE+) can reuse the same audit-row vocabulary |
| `src/components/ModeBanner.jsx` | real | Readiness chip, per-provider pills, optional credits/cap chip |
| `tests/adspark-smoke.spec.js` | real | Playwright single-shot mock-mode end-to-end; covers PR A through PR AW (Stage-3 Commercial Script + breadcrumb, Storyboard subsection, Ad Mode picker w/ 3 cards, Spokesperson Ad rename, Dialogue tab + Plan button, all Exports rows + the captioned reels labels, Realtime grounding card + Conversation transcript card with **export button assertions: copy-markdown, download-txt, post-fetch enable + status banner**, brand colour control, Character custom-voice section + **MediaRecorder Start recording button** + **negative assertions for the PR AP preview audio + helper text in idle state** + **PR AS/AT/AU/AV/AW resilient assertions for resolved/drift/unverified pills, repair button, refresh button, and freshness label**) |
| `src/transcriptExport.js` | real | **PR AL** — pure helpers `buildTranscriptMarkdown`, `buildTranscriptText`, `transcriptFilename`, `copyToClipboard`, `downloadTextFile`. No backend round-trip — operates on the turns persisted by PR AJ on the Campaign payload. Markdown output uses bold-speaker syntax + the campaign / conversation-id / fetched-at preamble; text output is plain ASCII with `Speaker:` prefixes |

## Key-dependent behavior

| Env var | If missing | If set |
|---|---|---|
| `OPENAI_API_KEY` | Concepts come from `_mock_concepts()` | Calls `gpt-4o-mini` (override with `OPENAI_MODEL`) |
| `RUNWAY_API_KEY` | All Runway flows mocked: image (stdlib PNG), video (in-memory task), avatar create (synthetic READY), avatar list (4 mock presets), Spokesperson Ad (ffmpeg lavfi placeholder), brand voice (silent MP3), dub (silent MP3 per lang), character portrait (stdlib PNG), character avatar (synthetic READY), storyboard shots (ffmpeg lavfi placeholders), storyboard stitch (real ffmpeg over mock shots), dialogue lines (ffmpeg lavfi placeholders), dialogue stitch (real ffmpeg over mock lines), realtime (HTTP 503 with explanatory copy) | Real Runway end-to-end across all 11+ endpoints |

`RUNWAY_HOST_VOICE_PRESET` and `RUNWAY_HOST_PORTRAIT_URL` are
*optional* PR-F knobs — defaults are `vincent` and a curated
Unsplash portrait URL.

## Endpoints (69 application + FastAPI built-ins)

```
GET    /health
GET    /api/runway/provider-status
GET    /api/runway/organization
GET    /api/runway/avatars                                  (PR I+)
POST   /api/concepts
POST   /api/runway/image
GET    /api/runway/image/{image_id}
POST   /api/runway/upload-image                             (PR R)
POST   /api/runway/generate
GET    /api/runway/task/{task_id}
POST   /api/campaigns
GET    /api/campaigns
DELETE /api/campaigns/{id}                                  (PR N — local delete + cache cleanup; PR Z + PR AF cascade)
GET    /api/campaigns/{id}/video
POST   /api/campaigns/{id}/finish              (?format=landscape|reels|square)
GET    /api/campaigns/{id}/finished-video
GET    /api/campaigns/{id}/finished-video/{fmt}
POST   /api/campaigns/{id}/commercial-with-voice            (PR S + PR X — Final Voiced Cinematic Ad)
GET    /api/campaigns/{id}/commercial-with-voice
POST   /api/campaigns/{id}/storyboard/plan                  (PR Z)
POST   /api/campaigns/{id}/storyboard/generate-shot/{shot_id}
POST   /api/campaigns/{id}/storyboard/stitch
GET    /api/campaigns/{id}/storyboard-video
GET    /api/campaigns/{id}/storyboard/shot/{shot_id}
POST   /api/campaigns/{id}/storyboard/shot/{shot_id}/prompt (PR AC — editable shot prompts)
POST   /api/campaigns/{id}/storyboard/voiced
GET    /api/campaigns/{id}/storyboard-voiced-video
POST   /api/campaigns/{id}/dialogue/plan                    (PR AF)
POST   /api/campaigns/{id}/dialogue/line/{line_id}          (PR AF — edit text + speaker)
POST   /api/campaigns/{id}/dialogue/generate-line/{line_id} (PR AF)
POST   /api/campaigns/{id}/dialogue/stitch                  (PR AF)
GET    /api/campaigns/{id}/dialogue-scene                   (PR AF)
GET    /api/campaigns/{id}/dialogue/line/{line_id}          (PR AF)
POST   /api/campaigns/{id}/script                           (PR AA — Commercial Script)
POST   /api/campaigns/{id}/brief                            (PR BQ — inline brief editor: business/product/audience/tone)
POST   /api/campaigns/{id}/avatar                          (PR F — custom create)
POST   /api/campaigns/{id}/brand-color                     (PR AK — set/clear brand colour for reels backdrop)
POST   /api/campaigns/{id}/select-avatar                   (PR I+ — picker)
POST   /api/campaigns/{id}/attach-character                (PR K — null detaches)
POST   /api/campaigns/{id}/host-video                      (PR F)
POST   /api/campaigns/{id}/spokesperson-ad                 (PR AB — alias for /host-video)
POST   /api/campaigns/{id}/spokesperson-ad/reels           (PR AG — Vertical 720x1280 letterbox)
POST   /api/campaigns/{id}/dialogue-scene/reels            (PR AG — Vertical 720x1280 letterbox)
GET    /api/campaigns/{id}/host-video
GET    /api/campaigns/{id}/spokesperson-ad                 (PR AB — alias)
GET    /api/campaigns/{id}/spokesperson-ad/reels           (PR AG)
GET    /api/campaigns/{id}/dialogue-scene/reels            (PR AG)
POST   /api/campaigns/{id}/brand-voice                     (PR H)
POST   /api/campaigns/{id}/dub                             (PR H)
GET    /api/campaigns/{id}/audio/{kind}
POST   /api/campaigns/{id}/realtime-document               (PR AI — Avatar documentIds for grounded realtime)
POST   /api/campaigns/{id}/realtime-transcript             (PR AJ — fetch + persist conversation transcript)
POST   /api/campaigns/{id}/spokesperson-session            (PR I + PR AE + PR AI + PR AJ — campaign context injection + documentIds when grounded + captures session id as conversation id)
DELETE /api/campaigns/{id}/spokesperson-session/{session_id}
GET    /api/characters
POST   /api/characters
GET    /api/characters/{id}
POST   /api/characters/{id}/generate-portrait              (PR K + PR V)
POST   /api/characters/{id}/create-avatar                  (PR K + PR AN — uses custom_voice_id when set)
POST   /api/characters/{id}/clone-voice                    (PR AN + PR AQ — multipart audio upload → /v1/voices from.type=audio + auto-PATCH avatar voice when bound)
POST   /api/characters/{id}/apply-voice                    (PR AQ — manual retry for the avatar voice swap when the auto-PATCH after a clone failed)
POST   /api/characters/{id}/refresh-avatar-voice           (PR AV — read-only: GET /v1/avatars/{id} + drift recompute, no PATCH)
POST   /api/characters/{id}/refresh-voice-preview          (PR AX — re-fetch cloned voice previewUrl via GET /v1/voices/{voice_id})
GET    /api/characters/{id}/portrait
DELETE /api/characters/{id}
plus /openapi.json, /docs, /docs/oauth2-redirect, /redoc
```

## Avatar resolution chain (PR K, used by PR F / PR AB / PR I+ / PR AE / PR AF)

```
character.runway_avatar_id   ─ wins when a character is attached
  > selected_avatar_id        ─ wins when picker selection exists
    > host_avatar_id           ─ falls back to per-campaign custom avatar
```

`character_host_client.active_avatar_id(campaign, settings)` and
`active_avatar_status(campaign, settings)` implement this. Used by:
host-video / spokesperson-ad, realtime broker (with PR AE
campaign-context overrides), commercial-with-voice (when auto-host
is on), and the dialogue line generator (per-line, falls back to
the line's own `avatar_id`).

## Current ad mode architecture (PR AB / PR AD / PR AF)

| Mode | Visual | Audio | Lip sync | Output filename |
|---|---|---|---|---|
| Final Voiced Cinematic Ad | `image_to_video` (silent) + ffmpeg `-stream_loop -1` | host clip audio | ❌ | `data/finished/<id>-commercial-voice.mp4` |
| Storyboard Commercial | 3 × `image_to_video` ffmpeg-concat | silent | ❌ | `data/finished/<id>-storyboard.mp4` |
| Voiced Storyboard | storyboard visual + host audio (ffmpeg loop) | host clip audio | ❌ | `data/finished/<id>-storyboard-voice.mp4` |
| Spokesperson Ad | `avatar_videos` | spoken script | ✅ | `data/host/<id>.mp4` |
| Dialogue Scene Ad | N × `avatar_videos` ffmpeg-concat (audio preserved) | spoken per line | ✅ per line | `data/finished/<id>-dialogue-scene.mp4` |
| Spokesperson Ad — Captioned Reels (PR AG + AH) | ffmpeg pad/letterbox + drawtext caption from saved Commercial Script | host clip audio (preserved) | ✅ | `data/finished/<id>-spokesperson-reels.mp4` |
| Dialogue Scene Ad — Captioned Reels (PR AG + AH) | ffmpeg pad/letterbox + per-line drawtext segments timed via ffprobe of cached line clips | per-line speech (preserved) | ✅ per line | `data/finished/<id>-dialogue-scene-reels.mp4` |

## Feature stack since v6 (the recent arc)

| PR | Title | Tag |
|---|---|---|
| PR R | Visual Source flow (Generate / Upload / Use Character / Text-only) | (between v6 and v8) |
| PR S | Commercial with Voice (ffmpeg loop + host audio mux) | |
| PR T | Structured Runway Prompt Builder | |
| PR U | Spokesperson-first flow | |
| PR V | Editable Portrait Prompt | |
| PR W | Character visual-source bugfix | |
| PR X | Auto-voiced commercial | |
| PR Y | Newest-saved focus + card clarity | |
| PR Z | Storyboard Commercial Builder | |
| PR Z2 | Silent vs voiced final ad clarification | v8-pre |
| PR AA | Voice preview + script-first flow | **v8** |
| PR AB | Spokesperson Ad mode + alias routes | **v9** |
| PR AC | Creative director controls + script-aware planner | **v10** |
| PR AC follow-up | Move script into PromptPreview + form maxLength + error scroll | **v10** |
| PR AD | Cinematic vs Spokesperson UX (Ad Mode picker + identity-drift helper) | **v11** |
| PR AE | Realtime campaign context injection | **v12** |
| PR AF | Multi-Character Dialogue Scene Builder | **v13** |
| PR AG | Vertical / Reels Export Pipeline (Spokesperson + Dialogue → 720×1280 letterbox) | (post-v13) |
| PR AH | Burned-in Captions for Vertical Reels (drawtext from saved scripts; per-line timing for dialogue) | (post-v13) |
| PR AI | Avatar documentIds for Grounded Realtime (POST /v1/documents + per-session documentIds + best-effort PATCH /v1/avatars/{id}) | (post-v13) |
| PR AJ | Conversation Transcript Retrieval + Replay UX (GET /v1/avatar_conversations/{id} + structured TranscriptTurn persistence + Realtime-tab replay card) | (post-v13) |
| PR AK | Brand Colour Storage + Reels Styling Polish (compact card-header colour picker + ffmpeg pad colour wired into both reels routes) | (post-v13) |
| PR AL | Transcript Export / Share (frontend-only Copy Markdown + Download TXT on the PR AJ replay card; navigator.clipboard + Blob/object-URL with safe textarea fallback) | (post-v13) |
| PR AM | Caption Contrast Polish for Brand-Coloured Reels (WCAG luminance threshold flips drawtext fontcolor + boxcolor + alpha so captions stay readable on light brand backdrops) | (post-v13) |
| PR AN | Custom Voice Cloning Foundation (POST /v1/voices from.type=audio, multipart upload UI on the Character Studio library tile, persisted on Character, used at Avatar create time) | (post-v13) |
| PR AO | In-Browser Audio Recording for Custom Voice Cloning (frontend-only MediaRecorder capture → audio/webm Blob → reuses the PR AN clone route, with graceful fallback when MediaRecorder/microphone unavailable) | (post-v13) |
| PR AP | In-Card Voice Recording Playback Preview (frontend-only `<audio controls>` bound to URL.createObjectURL of the captured Blob, with full lifecycle revoke on discard / clone / unmount / next start) | (post-v13) |
| PR AQ | Avatar PATCH for Custom Voice Swap (auto-PATCH /v1/avatars/{id} with the cloned voice after every successful clone; manual retry route + UI pill on patch failure; mock_patched / pending_avatar / applied / failed state machine on Character) | (post-v13) |
| PR AR | Cloned Voice Preview Surface (capture Runway voice previewUrl during the PR AN clone poll; persist on Character; render inline `<audio controls>` in CharacterCard with a friendly fallback when the URL is missing or in mock mode) | (post-v13) |
| PR AS | Avatar Resource Introspection After Voice Patch (run GET /v1/avatars/{id} after every successful PR AQ PATCH; persist resolved voice block + verify status on Character; surface a third pill "Avatar using cloned voice" / "Avatar voice unverified" in CharacterCard) | (post-v13) |
| PR AT | Avatar Voice Drift Detection (compare cloned vs resolved voice id; persist match/drift/unknown; collapse PR AS pill into three operator-facing branches: match / drift / unverified) | (post-v13) |
| PR AU | Voice Drift Repair Action (frontend-only one-click "Repair voice drift" button on the PR AT mismatch branch; reuses POST /apply-voice for PATCH + verify + drift; rose pill flips to emerald on success) | (post-v13) |
| PR AV | Avatar Status Manual Refresh (read-only POST /refresh-avatar-voice route + Refresh avatar status button; reuses fetch_avatar_voice + compute_voice_drift_status without invoking PATCH; PR AQ patch fields preserved across refreshes) | (post-v13) |
| PR AW | Voice Verification Freshness Label (frontend-only relative-time formatter + inline "Last checked … ago / Not checked yet" caption beside the verify pill) | (post-v13) |
| PR AX | Refresh Missing Cloned Voice Preview (POST /refresh-voice-preview wires existing fetch_voice_preview helper to a Refresh preview button; preserves existing URL when fetch returns nothing) | (post-v13) |
| PR AY | Live Mic Level Meter for Voice Recording (frontend-only AnalyserNode hooked into the PR AO MediaStream; RAF-driven horizontal bar with direct DOM mutation; full lifecycle teardown on stop / discard / clone / unmount / error; graceful "Mic level unavailable" fallback) | (post-v13) |
| PR AZ | Voice Verification Auto-Tick Freshness Caption (frontend-only 60-s setInterval bumps a per-tile nowMs state so PR AW's caption advances buckets without polling; gated on caption visibility; cleanup on unmount + visibility change) | (post-v13) |
| PR BA | Character Library Refresh All (frontend-only library-level "Refresh all voice statuses" button on the Character Studio header; iterates the library and reuses the per-character PR AV refresh-avatar-voice + PR AX refresh-voice-preview routes; compact status caption reports refreshed/skipped/failed; one failure does not abort the loop) | (post-v13) |
| PR BB | Voice Repair History Audit Trail (`VoiceRepairHistoryEntry` model + `voice_repair_history: list[…]` on Character capped at 20 entries; appended from clone-voice / apply-voice / refresh-avatar-voice; apply-voice gains an optional `mode` body so the PR AU repair button is distinguishable from a plain apply; CharacterCard renders a compact "Voice history" disclosure with action / status / drift / time pills, default 5 newest, "Show all (N)" expand) | (post-v13) |
| PR BC | Per-Campaign Transcript History (`TranscriptHistoryEntry` model + `realtime_transcript_history: list[…]` on Campaign capped at 20 entries; every branch of `POST /realtime-transcript` appends a row including no_session / failed / empty / mock / ok; latest-fetch state preserved in the existing `realtime_transcript_*` fields so preview + Copy Markdown / Download TXT exports continue operating against the latest fetch; CampaignGallery transcript card adds a compact "Transcript history" disclosure with status / turn-count / conversation-id / fetched-time per row) | (post-v13) |
| PR BD | UX v2 Flag + Shared Helpers Extraction (foundation for the spokesperson-first redesign tracked in SESSION_035; new `frontend/src/uxFlag.js` resolves URL `?ux=…` → localStorage `adspark.ux` → default `v1`; new `frontend/src/uiHelpers.js` lifts `formatHistoryTimestamp` / `HISTORY_ACTION_PILLS` / `historyStatusClass` / `historyDriftClass` out of CharacterCard.jsx for reuse; tiny `<UxModeToggle />` footer link flips the flag and reloads; default UX unchanged) | (post-v13) |
| PR BE | SpokespersonStudio Scaffold Identity-Only (gated v2 Stage 1 surface tracked in SESSION_036; new `SpokespersonStudio.jsx` reads same `GET /api/characters` data; new `SpokespersonCard.jsx` wraps existing CharacterCard in a three-tab shell — Identity active, Knowledge + Appearances placeholders; App.jsx swaps mounts conditionally on `isUxV2()`; backend untouched; second Playwright smoke `?ux=v2` covers the new surface alongside the unchanged v1 default smoke) | (post-v13) |
| PR BF | Spokesperson Knowledge Tab Wiring (gated v2 slice tracked in SESSION_037; SpokespersonStudio now fetches `GET /api/campaigns` alongside characters and forwards per-character `linkedCampaigns` to each card; SpokespersonCard's Knowledge tab renders summary line + per-campaign rows with grounding labels (Prompt-grounded / Document-grounded / Document-grounded · mock / Failed), transcript counts, and last-fetched relative time; falls back to a friendly "No linked campaigns yet" state otherwise; backend untouched) | (post-v13) |
| PR BG | Spokesperson Appearances Tab Wiring (gated v2 slice tracked in SESSION_038; SpokespersonCard's Appearances tab lists each linked campaign with inferred mode badge — Cinematic / Spokesperson Ad / Dialogue Scene / Storyboard / Realtime / Mixed / Draft — based on populated output URLs / lists; last-touched relative time computed across transcript-history fetches + script edits + created_at; compact 5-label output-summary chip row per appearance; disabled "Open in gallery" affordance pending PR BJ–BL lane routing; empty state when no linked campaigns; backend untouched) | (post-v13) |
| PR BH | Mode-First Campaign Creation Modal (gated v2 slice tracked in SESSION_039; first slice that visibly diverges from v1 beyond Stage 1; new `CampaignModeModal.jsx` with three intent cards — 🎬 Cinematic Ad / 🎙️ Spokesperson Ad / 🎭 Dialogue Scene; "+ New Campaign" button in SpokespersonStudio header opens the modal; selection persists to `localStorage.adspark.activeMode` via `setActiveMode` and surfaces a "Selected mode" pill + "Mode selected. Lane-specific builder lands next." banner with dismiss link; backend untouched — Campaign payload doesn't accept a `metadata` field today; lane builders consume the persisted mode in PR BJ–BL) | (post-v13) |
| PR BI | Spokesperson Lane Scaffold (gated v2 slice tracked in SESSION_040; first lane in the trio — Cinematic / Dialogue lanes ship in PR BK / PR BL; new `frontend/src/components/lanes/SpokespersonLane.jsx` with 3-step Brief / Script / Render layout; mounts in SpokespersonStudio below the pill when `activeMode === "spokesperson"`; render buttons are disabled placeholders pending later wiring; receives active spokesperson + linked campaigns; friendly empty-state hint when neither set; backend untouched — uses existing campaign data already indexed in PR BF) | (post-v13) |
| PR BJ | Local Real-Mode Runtime Guard (runtime + docs slice tracked in SESSION_041; flips local-testing default from mock-mode to real-mode; new `scripts/start-local-real.sh` sources `.env` without overrides for manual / in-browser testing, `scripts/start-local-mock.sh` is the explicit mock-mode boot for Playwright smoke + CI, `scripts/stop-local.sh` kills both servers; CLAUDE.md hard-rules section rewritten — `RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock` inline overrides are now an anti-pattern; no frontend/backend code changes; frontend bundle unchanged) | (post-v13) |
| PR BK | Cinematic Lane Scaffold (gated v2 slice tracked in SESSION_042; second lane in the trio; new `frontend/src/components/lanes/CinematicLane.jsx` mirrors PR BI shape with 3-step Brief / Visual Source / Render layout + 3 disabled placeholder buttons mapping to Cinematic Video / Voiced Cinematic / Storyboard Commercial; mounts in SpokespersonStudio when `activeMode === "cinematic"`; fuchsia chrome to match the mode pill; pill copy now mode-specific — "Cinematic Ad lane open." for cinematic mode; smoke covers spokesperson → cinematic mode switch with assertion that previous lane unmounts; backend untouched) | (post-v13) |
| PR BL | Dialogue Lane Scaffold (gated v2 slice tracked in SESSION_043; third lane in the trio — completes the v2 mode lineup; new `frontend/src/components/lanes/DialogueLane.jsx` mirrors PR BI / PR BK shape with 3-step Brief / Cast / Lines & Stitch layout + 3 disabled placeholder buttons mapping to Generate Dialogue Lines / Stitch Dialogue Scene / Captioned Reels; mounts when `activeMode === "dialogue"`; sky chrome to match the mode pill; cast list derives from `dialogue_lines[*]` on the focused campaign; pill copy flips to "Dialogue Scene lane open."; smoke covers cinematic → dialogue mode switch; backend untouched) | (post-v13) |
| PR BM | Lane Selection Regression Pass (test-only slice tracked in SESSION_044; strengthens smoke against v1 default leaks of v2 testids, v2 surface absence of legacy "+ Create Character", and a third Playwright case `AdSpark Studio footer UX toggle round-trip` that clicks the footer link to flip v1 → v2 → v1 with reload assertions; no production code changes; no backend changes) | (post-v13) |
| PR BN | Wire V2 Spokesperson Lane Reels Action (gated v2 slice tracked in SESSION_045; first v2 lane action that fires real production behaviour — `POST /api/campaigns/{id}/spokesperson-ad/reels` — via `api.buildSpokespersonReels`; lane gates the button on `host_status === "ok"` AND `host_video_url` set; busy / error / success states surface inline with violet chrome to match v1 vocabulary; download link to cached reels when `spokesperson_reels_url` is set; no Runway calls — ffmpeg-only; Horizontal button stays disabled placeholder; Cinematic + Dialogue lanes untouched) | (post-v13) |
| PR BO | Wire V2 Cinematic Lane Voiced Cinematic Action (gated v2 slice tracked in SESSION_046; second wired v2 lane action — `POST /api/campaigns/{id}/commercial-with-voice` — via `api.buildCommercialWithVoice`; CinematicLane gates the button on `cached_video_url` set AND (`host_video_url` + `host_status === "ok"` OR a usable avatar exists), mirrors v1 `commercialBuildable` exactly; busy / error / success states surface inline with fuchsia chrome; download link to cached voiced commercial when `voiced_commercial_url` is set; no Runway calls — ffmpeg-only; Cinematic Video + Storyboard buttons stay disabled placeholders; Spokesperson + Dialogue lanes untouched beyond PR BN) | (post-v13) |
| PR BP | Wire V2 Real Runway Generation Buttons (gated v2 slice tracked in SESSION_047; wires 5 additional lane actions — Spokesperson Horizontal (real `avatar_videos`, burns credits, rose chrome + warning copy), Cinematic Storyboard Commercial (`stitchStoryboard`, ffmpeg-only, amber chrome), Dialogue Plan / Stitch / Captioned Reels (`planDialogue` + `stitchDialogue` + `buildDialogueSceneReels`, all ffmpeg or template-driven, sky chrome). Cinematic Video stays placeholder. Each new button carries `data-source-ready` + `data-busy` attrs; Horizontal also carries `data-burns-credits="true"`. Real-mode validation: one fresh real `avatar_videos` task `cf7e6067-…` on CEO Buzz / Brewster confirms the Horizontal wiring end-to-end — 1088×704, 18.25 s, 6.3 MB) | (post-v13) |
| PR BQ | V2 Lane Inline Brief Editing (gated v2 slice tracked in SESSION_048; new `POST /api/campaigns/{id}/brief` route patches `business / product / audience / tone` on the saved Campaign — only justified backend addition, route count 68 → **69**; new reusable `frontend/src/components/lanes/LaneBriefEditor.jsx` renders four editable form fields + Save / Cancel + busy/error/success states; mounted in Step 1 of all three lanes (SpokespersonLane / CinematicLane / DialogueLane); when no focused campaign, lane shows "Create or select a campaign to edit the brief." copy; SpokespersonStudio adds `handleUpdateBrief` that swaps the campaign in the local slice + bubbles `onCharactersChanged`; no Runway calls; no v1 changes; no generated media touched) | (post-v13) |
| PR BR | V2 Appearances Click-Through to Campaign Gallery (gated v2 slice tracked in SESSION_049; the previously-disabled "Open in gallery →" affordance on each Appearances row now bubbles up `onOpenCampaign(campaignId)` through SpokespersonStudio → App.jsx → CampaignGallery; CampaignCard accepts new `isOpenedFromV2` + `onClearOpen` props that scroll the matching saved card into view + flash a pink highlight ring for ~2 s; SpokespersonStudio renders a "Opened campaign in gallery: {label}" emerald banner that auto-clears after 2.5 s; no backend changes; route count unchanged at 69; pink chrome on the v2 button mirrors the studio's accent vocabulary) | (post-v13) |
| PR BS | V2 Appearances Click-Through Tab Hints (gated v2 slice tracked in SESSION_050; extends PR BR by passing the inferred mode through the click chain so App.jsx can resolve a target tab inside the saved CampaignCard; new `_tabFromInferredMode` helper maps Spokesperson Ad → character, Cinematic / Storyboard → visuals, Dialogue Scene → dialogue, Realtime → realtime, Mixed / Draft → overview; new `openCampaignTab` state threaded through CampaignGallery → CampaignCard; the existing v2 effect now flips `setActiveTab(targetTab)` alongside the scroll + highlight; banner copy now reads "Opened campaign in gallery: {label} · {mode} tab"; CampaignCard outer `<li>` carries `data-active-tab` for smoke + future tooling; no backend changes; route count still 69) | (post-v13) |
| PR BT | Wire V2 Cinematic Video Async Action (gated v2 slice tracked in SESSION_051; closes the last v2 lane render placeholder — Cinematic Video now fires real Runway `image_to_video` via the existing `api.startRunway` (POST `/api/runway/generate`) + `api.pollRunway` (GET `/api/runway/task/{id}`) helpers; SpokespersonStudio adds `handleGenerateCinematicVideo(id, onProgress)` that mirrors v1 `App.handleGenerateVideo` exactly — same 5 s ± 800 ms jitter, 60-attempt 5-min cap, terminal SUCCEEDED / FAILED / CANCELED handling; no infinite loops (cap-on-attempts guarantees termination); CinematicLane wires the button with rose chrome + `data-burns-credits="true"` + `data-source-ready` (gated on `runway_prompt` being truthy on the focused campaign) + `data-busy`; status row surfaces start phase, polling progress percentage, errors, and a download link to the fresh output URL when SUCCEEDED; output URL is **not persisted to the campaign** (would require a new backend route — kept out of scope per brief); smoke asserts the button has `data-burns-credits="true"`, `data-render-target="cinematic-video"`, follows fixture readiness disjunctions; no v1 changes; no backend changes; route count still 69) | (post-v13) |
| PR BU | Persist V2 Cinematic Video Result to Campaign (gated v2 slice tracked in SESSION_052; closes the "session-only" gap PR BT left open — fresh outputs now survive reloads. New `POST /api/campaigns/{id}/cinematic-video` route reuses `VideoCache.fetch` + `update_cache_fields` (the same plumbing v1 `POST /api/campaigns` uses at create time) to download the Runway URL, overwrite `data/videos/{id}.mp4`, and flip `cached_video_url → /api/campaigns/{id}/video`. Smallest possible field-specific endpoint; no new storage helpers; no new model fields. Route count 69 → **70**. Failure modes: 404 (campaign not found), 422 (URL min/max length), 502 (download / content-type / size-cap failure — campaign's `cache_status` / `cache_error` persisted in tandem). New `api.persistCinematicVideo(id, url)` helper. SpokespersonStudio's `handleGenerateCinematicVideo` now chains the persist call after polling SUCCEEDED + emits `'persisting'` / `'persisted'` / `'persist-failed'` progress phases; updates the local campaigns slice in place + bubbles `onCharactersChanged` so the v1 gallery refreshes alongside if open. CinematicLane prefers the persisted `cached_video_url` for the link (always when set) and only falls back to a session URL when persist 502s; new `data-persisted` button attr; status copy now reads "saving to campaign…" / "saved to campaign" / "saved (persist failed — session URL only)". Probes confirmed: 404, 422, 502 on broken upstream, and happy path persists + survives `GET /api/campaigns` reload. No v1 changes; no automatic real Runway calls fired this session.) | (post-v13) |
| PR CH | Demo Campaign Fixtures for New Spokespeople (fixture-only slice tracked in SESSION_062; new idempotent seeder at `scripts/seed-demo-campaigns.py` upserts four canonical demo campaigns — one per PR CG demo spokesperson — that complete the v2 narrative: **Brewster Bolt → CEO Buzz · Dumpster-to-CEO Energy Drink** (loud / funny / high-energy; intended modes spokesperson + reels + cinematic), **Clara Vale → AdSpark Studio · Persistent AI Spokesperson Platform** (polished / strategic / trustworthy; intended modes cinematic + spokesperson + realtime), **Rex Roadside → Freedom Ford · F-150 / Ranger truck spotlight** (practical / helpful / no-pressure; intended modes spokesperson + dialogue + reels), **Mina Spark → Spark Social · Corner-spokesperson commentary ads** (playful / creator-native / quick; intended modes reels + dialogue + corner-commentary). Each campaign lands as a draft with brief + business + product + audience + tone + selected_concept (title / hook / visual / caption / cta) + runway_prompt + commercial_script + social_post all filled with purposeful copy. **Zero cached outputs** — operators run Generate inside the workspace lanes to fill them. Idempotency key: `(character_id, business)` pair, since `Campaign` model has no `metadata` field. Re-running the seeder updates the demo-defined columns + refreshes the character_id link without disturbing operator-generated outputs (cached_video_url, host_video_url, voiced_commercial_url, storyboard_*, dialogue_*, *_reels_url, runway_task_id all preserved). **Existing user campaigns are NEVER touched** — only campaigns whose character_id matches a demo spokesperson + business matches the fixture. Spokesperson lookup is case-insensitive name match against the character store; if a demo spokesperson hasn't been seeded yet the corresponding campaign is skipped with a warning. Hand-rolls Campaign records (skipping `store.create()` because the official path doesn't accept character_id atomically); writes via the store's atomic `_write` so the tmp-then-rename safety pattern is preserved. UI verification: `library-stat-linked-campaigns` reads ≥4; Brewster Bolt's workspace Campaigns tab shows the CEO Buzz draft row. Smoke 3 passed (33.0 s). No Runway calls fired; no media generated.) | (post-v13) |
| PR CP | Restore Delete Spokesperson + Endpoint Audit (frontend + audit slice tracked in SESSION_072; closes the SESSION 070 P1 polish "delete is buried in a 9-pixel link" + delivers a written audit of how `generate-portrait` and `create-avatar` reach Runway. **Delete:** new `<DangerZone>` component (~115 lines) mounts in the workspace Identity tab below the embedded `<CharacterCard>`. Two-step UX: visible rose `Delete spokesperson` button (testid `spokesperson-workspace-delete`) → click reveals a typed-name confirmation block (testid `spokesperson-workspace-delete-confirm`) with an input (testid `spokesperson-workspace-delete-name-input`), `Delete` button (testid `spokesperson-workspace-delete-confirm-button`, `data-armed="true"\|"false"` reflecting whether typed name matches), and `Cancel` (testid `spokesperson-workspace-delete-cancel`) that collapses the zone. Confirm fires the existing `SpokespersonWorkspace.handleDelete` (PR CC) → `api.deleteCharacter(id)` → `DELETE /api/characters/{id}` → `navigate('/')`. Linked-campaign count surfaced in the prompt copy ("N linked campaigns will be unlinked"). Explicit copy explains: local delete only — campaigns survive (they orphan; PR CO's `relink-orphan-demo-campaigns.py` is the recovery), Runway avatars + voice clones survive (clean up via Runway dashboard). The legacy CharacterCard `delete` footer link is preserved untouched. Smoke walks the danger-zone state machine without deleting the canonical fixture (types a mismatched name → confirm stays disabled → Cancel collapses). **UI clarity:** Identity tab caption rewritten — was dev jargon ("PR CC embeds the existing card-level affordances; PR CD splits this into a dedicated IdentityPanel + VoicePanel"), now disambiguates `Portrait image` (still face, drives the tile + avatar `referenceImage`) vs `Runway avatar` (talking/lip-sync identity that drives Spokesperson Ads + realtime). **Endpoint audit (in SESSION_072 handoff):** `generate-portrait` calls `gen4_image_turbo` via `POST /v1/text_to_image` with `{model, promptText, ratio: "1280:720", referenceImages: [<charcoal seed PNG data URI>]}` — `prompt_override` from CreateSpokespersonFlow Step 2 takes precedence; otherwise the locked `PORTRAIT_TEMPLATES[template]` f-string fills with `{subject}` + `{style}`. Polls `/v1/tasks/{id}` 90 s, downloads the result to `backend/data/characters/{id}-portrait.png`. `create-avatar` calls `POST /v1/avatars` with `{name, referenceImage: <portrait PNG inlined as base64 data URI>, voice: {type: "runway-live-preset", presetId} OR {type: "custom", voiceId}, personality}`. Polls `/v1/avatars/{id}` 180 s for `READY`. The portrait IS consumed — the avatar binds to the cached portrait file; missing portrait short-circuits with an explicit error. Verdict: **both endpoints are right**. The PR CO rough-portrait observation is a prompt-content issue (seed `subject` strings read like ad copy not visual subjects; `species` is implied not stated), not an endpoint issue. Recommended PR CQ — sharpen seed fixture subjects + tighten PORTRAIT_TEMPLATES with explicit anchor wording. Build 479.72 KB / 130.93 KB gzip (+3.25 KB / +0.65 KB vs PR CO). Smoke 3 passed (28.6 s). Backend untouched; route count still 71. /legacy unchanged. No real Runway calls fired this slice.) | (post-v13) |
| PR CO | Repair Demo Data + Portraits + Stats Accuracy (data-repair + tiny stats-fix slice tracked in SESSION_071; closes the entire SESSION 070 V2 manual QA punch-list. Three commits worth of work in one slice. **(1) Demo spokespeople restored:** ran `scripts/seed-demo-spokespeople.py` against a degraded `characters.json` that had been pruned to a single faceless persona. Updates Brewster Bolt (existing) + creates Clara Vale (`920408399d30`) + Rex Roadside (`cdaeb5b32518`) + Mina Spark (`2fd897b776cc`). Idempotent name-keyed upsert preserves any operator-generated voice clones / avatars / metadata. **(2) Orphan campaigns relinked:** new `scripts/relink-orphan-demo-campaigns.py` walks `campaigns.json` and re-points orphaned demo campaigns (those whose `character_id` references a deleted record) to the matching live demo spokesperson by **business name**: CEO Buzz → Brewster Bolt, AdSpark Studio → Clara Vale, Freedom Ford → Rex Roadside, Spark Social → Mina Spark. Five campaigns relinked (CEO Buzz × 2, AdSpark Studio × 1, Freedom Ford × 1, Spark Social × 1). FocusNet (Piper Voltage's user-owned campaign) deliberately left as orphan — not in the demo seed list. The relinker preserves every output URL field, so Brewster Bolt's CEO Buzz `fc8a20c4` reattaches with all 4 cached outputs (cinematic / host / voiced / reels). Idempotent + safe to re-run + never deletes campaigns. Then re-ran `seed-demo-campaigns.py` to refresh fixture-defined fields on the now-relinked rows. **(3) Real Runway portraits fired** for the 4 demo personas via `POST /api/characters/{id}/generate-portrait` — Brewster Bolt SUCCEEDED (526 KB), Clara Vale SUCCEEDED (575 KB), Mina Spark SUCCEEDED (770 KB), Rex Roadside FAILED (`portrait task FAILED: An unexpected error occurred.` — same Runway upstream pattern as PR CI; record preserved with `portrait_url=null` so the PR CJ portrait-failed retry path is reachable). Total ~$0.075 in image credits. Logged in SESSION_REAL_API_CREDIT_BURN.md. **(4) Frontend stats accuracy fix:** `SpokespersonStudio.jsx` library-stats-row computation now scopes `linked-campaigns` + `cached-outputs` + `transcript-entries` to **live-linked** campaigns only (campaigns whose `character_id` resolves to a record in `characters`). SESSION 070 manual QA caught the un-scoped variant claiming "6 linked campaigns / 46 cached outputs" while the workspace surfaced 0 — the orphan + anonymous-test campaigns were inflating the headline numbers. After PR CO, library stats display `4 spokespeople · 5 linked campaigns · 4 cached outputs · 1 transcript entry` and reconcile with what an operator can actually click into. Smoke + build + drift + hygiene all green; no backend changes; route count still 71; build 476.47 KB / 130.28 KB gzip (+0.04 KB / +0.01 KB vs PR CN — pure filter). /legacy unchanged.) | (post-v13) |
| PR CN | Workspace Outputs Gallery (frontend slice tracked in SESSION_069; closes the SESSION 059 Fix #3 punch-list item — replaces the `/spokespeople/:id` Outputs tab `<TabComingSoon>` placeholder with a real `<OutputsGallery>` that surfaces every cached output URL across the spokesperson's linked campaigns. New `frontend/src/components/OutputsGallery.jsx` (~280 lines) walks 8 output URL fields per linked Campaign — `host_video_url` (Spokesperson Ad, horizontal), `cached_video_url` (Cinematic Video, horizontal), `voiced_commercial_url` (Voiced Cinematic, horizontal), `storyboard_video_url` (Storyboard, horizontal), `storyboard_voiced_url` (Voiced Storyboard, horizontal), `dialogue_scene_video_url` (Dialogue Scene, horizontal), `spokesperson_reels_url` (Captioned Reels 720×1280, vertical), `dialogue_scene_reels_url` (Captioned Dialogue Reels 720×1280, vertical) — and renders one card per populated URL. Each card embeds an inline `<video controls muted playsInline preload="metadata">` preview that pulls only the first frame (never autoplays, no automatic credit burn), labelled type + description, campaign id-prefix + business + product, status chip (ok/failed/unavailable/pending/mock — emerald/rose/amber/zinc tones), orientation pill (Horizontal vs Vertical · Reels with `aspect-video` vs `aspect-[9/16]` framing), and an `open / download ↗` link. Cards sort newest-first by parent `campaign.created_at`. Empty state: `data-testid="outputs-empty"` with copy "No outputs yet. Create a campaign or generate from the Campaigns tab." `<SpokespersonWorkspace>` swaps the Outputs tab block from `<TabComingSoon>` to `<section data-testid="spokesperson-workspace-outputs"><OutputsGallery linkedCampaigns={linkedCampaigns} /></section>`. Smoke `@ /` extended: open Outputs tab, assert workspace section + `outputs-gallery` visible, branch on card count — if zero assert `outputs-empty`, else assert first `output-card` + `output-card-video` + `output-card-link` all visible. Backend untouched. Build 476.43 KB / 130.27 KB gzip (+5.51 KB / +1.07 KB vs PR CM — the new gallery component). /legacy unchanged. No real Runway calls fired this session.) | (post-v13) |
| PR CM | Library Tile Simplification (frontend slice tracked in SESSION_068; closes the SESSION 059 Fix #2 punch-list item — strips each library tile down to a single browse-to-open surface. SpokespersonCard.jsx rewritten 691 → ~220 lines. Tile now shows: portrait or `Portrait pending` placeholder ("Open workspace to generate." sub-copy) + name (`tile-name`) + archetype pill (`tile-persona`) + role one-liner (`tile-subject`) + summary-chip strip (voice + linked + outputs + transcripts; outputs/transcripts only when > 0) + primary pink `Open Spokesperson →` link routing to `/spokespeople/:id`. SpokespersonStudio's `<SpokespersonCard>` mount drops every now-unused callback prop (`onGeneratePortrait`, `onCreateAvatar`, `onDelete`, `onCloneVoice`, `onApplyVoiceToAvatar`, `onRefreshAvatarVoice`, `onRefreshVoicePreview`, `onSetActive`, `onOpenCampaign`, `busyAction`); only `character`, `linkedCampaigns`, `isActive` remain. The handlers themselves stay in SpokespersonStudio (used by the workspace flow's onCharactersChanged paths) but no longer plumb to the tile. Workspace `/spokespeople/:id` Identity tab still embeds the full `<CharacterCard>` with all voice + portrait + avatar controls — nothing removed there. Smoke (`@ /`) tile-iteration block rewritten: assert simple tile shape (portrait XOR placeholder + name + persona) + summary chips visible + primary Open link works + the in-tile tab testids (`spokesperson-tab-{identity,knowledge,appearances}`, `spokesperson-{identity,knowledge,appearances}-tab`) all `toHaveCount(0)`. Build 470.92 KB / 129.20 KB gzip (-9.91 KB / -2.32 KB vs PR CL — the embedded CharacterCard + 3 tab content blocks gone). /legacy unchanged. No backend changes.) | (post-v13) |
| PR CL | Workspace Consumes Start Campaign Hint (frontend slice tracked in SESSION_067; closes the loop on PR CK's Step 4 "Start a campaign" checkbox. SpokespersonStudio gets `useNavigate` + when `handleSpokespersonCreated` receives `options.startCampaign=true`, navigates to `/spokespeople/{id}` after writing the localStorage hint. SpokespersonWorkspace mount adds a second useEffect: on `:id` mount, reads `localStorage.adspark.startCampaignHint`; if it matches, clears the key (single-shot) + `setActiveTab('campaigns')` + `setModeModalOpen(true)` so the mode picker opens in-place. End-to-end smoke: set hint to a known character id → goto `/spokespeople/{id}` → assert `data-active-tab="campaigns"` + `campaign-mode-modal` visible + localStorage cleared. No backend changes. /legacy unchanged. Build 480.83 KB / 131.52 KB gzip (+0.36 KB / +0.11 KB vs PR CK).) | (post-v13) |
| PR CK | CreateSpokespersonFlow 4-Step Stepper (frontend slice tracked in SESSION_066; replaces PR CB's lightweight modal with a 4-step stepper that captures rich creative-direction inputs the backend already supports. Step 1 (Identity) — name + 4-card archetype picker (mascot / founder / coach / local_guide) + species/role textarea + personality textarea + audience-vibe textarea (last → metadata.audience_vibe). Step 2 (Visual Direction) — 10 style chips (multi-select; concat into Character.style), fashion/wardrobe text input (appended to style with separator), editable portrait prompt textarea that auto-derives from Step 1+2 inputs via a `derivePortraitPrompt` helper mirroring backend's PORTRAIT_TEMPLATES; `portrait_prompt_dirty` flag prevents auto-clobber after edits + a `Reset to auto` link reverts. Step 3 (Voice) — featured-six quick-pick chip row + full 30-preset dropdown (all entries from `VOICE_PRESET_DESCRIPTIONS`) + rich detail card showing `describeVoicePreset(id).{label, summary, detail, gender}` + 6 speaking-energy chips (calm/energetic/playful/measured/fast/deliberate; selected ones append "Speaks: …" line to personality). Step 4 (Generate) — summary card showing every choice + primary `Create Spokesperson` button + 2 opt-in checkboxes (`Bind a Runway avatar` + `Start a campaign`) + phase-aware status row. Submit fires: `POST /api/characters` with name/template/subject/style/personality/voice_preset → `POST /api/characters/{id}/metadata` (new route — merges `creation_flow=v2-stepper` + audience_vibe + visual_style_chips + speaking_energy into `Character.metadata`) → `POST /generate-portrait` with `prompt_override` from Step 2's textarea → optional `POST /create-avatar`. **PR CJ portrait-failed phase preserved verbatim** with Retry portrait + Save without portrait. Backdrop click in failure state routes to Save without portrait. Modal width bumped to `max-w-lg`; max-h-85vh + overflow-y-auto so Step 2's prompt textarea has room. SpokespersonStudio's `handleSpokespersonCreated` extended to accept `(character, options)` — when `options.startCampaign` is true, writes a `adspark.startCampaignHint` localStorage entry future workspace mounts can read. CreateSpokespersonModal.jsx deleted. New backend route: `POST /api/characters/{id}/metadata` (merge semantics; null deletes; 32-key + 4 KB caps). Route count 70 → **71**. /legacy unchanged. Build 480.47 KB / 131.41 KB gzip (+14.07 KB / +3.68 KB vs PR CJ).) | (post-v13) |
| PR CG | Demo Spokespeople Fixtures (fixture-only slice tracked in SESSION_061, branded internally as PR CG to avoid commit-history collision with the user-briefed "PR CF — Create Real Demo Spokespeople Fixtures" rename — the PR CF copy-cleanup commit `6ad1bf7` already occupies that slot). New idempotent seeder at `scripts/seed-demo-spokespeople.py` upserts four canonical demo personas: **Brewster Bolt** (mascot · drew · high-energy product hype), **Clara Vale** (founder · clara · polished SaaS / B2B explainer), **Rex Roadside** (local_guide · marcus · dealership / automotive sales), **Mina Spark** (coach · ruby · creator-style social host). Each fixture lands with template / subject / style / personality / catchphrases / voice_preset filled, plus a `metadata.demo=true` + `metadata.demo_persona` + `metadata.demo_role` + `metadata.demo_use_case` tag so future tooling can detect them without name matching. Idempotency key: case-insensitive name match. Re-running the script updates the demo-defined fields without disturbing operator-generated portraits / voice clones / avatar bindings. **Existing user spokespeople (Brewster the Raccoon, Piper Voltage, Sir Landsloplot) are NOT touched.** No Runway calls fire — portraits stay blank for the operator to generate via the in-app `Generate Portrait` button. Seeder uses absolute `backend/data/` path via chdir + `Path` resolution so running from repo root targets the same `characters.json` the live uvicorn process serves. UI verification: `/` library now mounts 7 tiles with the 4-chip stats row reading `7 spokespeople`. Smoke 3 passed (43.6 s; legacy walkthrough longer because gallery now serves 7 cards). No backend / routing / component changes; CharacterCreate model + CharacterStore.create + .update path reused verbatim.) | (post-v13) |
| PR CF | V2 Copy Cleanup + Remove Dev Jargon (frontend slice tracked in SESSION_060; rewrites every user-visible "scaffold · PR BX" pill, "preview UX" pill, "classic UX" / "classic gallery" / "lands next" string in v2 surfaces. Lane headers swap from `Spokesperson Ad lane` / `Cinematic Ad lane` / `Dialogue Scene lane` (with internal `scaffold · PR BI/BK/BL` pills + dev-PR-reference taglines) to product copy: `Build a spokesperson ad` / `Create a cinematic video` / `Plan a dialogue scene` with task-oriented one-liners. Lane Step-2 hint copy updated: SpokespersonLane Step 2 no longer points to "classic UX Stage 3 PromptPreview"; CinematicLane Step 2 explains the regenerate-in-place flow ("Click Regenerate Real Cinematic Video below to refresh the silent cut in place"); DialogueLane Step 2 says "Click Plan Dialogue Lines below to seed a Hook / Beat / Closer structure" instead of pointing back to /legacy. Disabled-reason tooltips replace `classic UX` with `legacy wizard` (kept as a real fallback name where the v2 lane genuinely defers — per-shot storyboard generation, per-line dialogue rendering). CampaignModeModal heading swaps from `New Campaign · preview UX` to `Choose campaign type`; footer copy ("Lane-specific builders ship in PR BJ–BL — until then…") rewritten to "Your selection is remembered for this spokesperson — the matching builder mounts inside the workspace below." SpokespersonWorkspace TabComingSoon teases switch from `Knowledge panel lands next.` / `Realtime conversations land next.` / `Output gallery lands next.` to `Knowledge sources will appear here.` / `Conversation history will appear here.` / `Generated videos and reels will appear here.` per the brief. SpokespersonStudio empty-state copy stops referencing "the classic Character Studio (toggle UX in the footer)" and instead points at the new `+ Create Spokesperson` button. The thrown error message inside `handleGenerateCinematicVideo` (CampaignLanes.jsx + SpokespersonStudio.jsx) replaces "campaign has no runway_prompt — re-save in classic UX" with "This campaign has no saved prompt — re-save it in the legacy wizard before regenerating." Smoke gains a `FORBIDDEN_JARGON` regex check that walks `/`, the mode modal, and each lane mounted inside the workspace, asserting `scaffold ·` / `preview UX` / `lands next` / `ships in PR` / `classic UX` / `classic gallery` / `\bPR B[A-Z]\b` never leak into rendered text. Build 464.80 KB / 127.38 KB gzip (-0.84 KB / -0.16 KB vs PR CE — copy got tighter). v1 / `/legacy` unchanged. No real Runway calls fired this session.) | (post-v13) |
| PR CE | Workspace Campaigns Tab Mounts Campaign Lanes (frontend slice tracked in SESSION_058; new reusable `<CampaignLanes>` component (`frontend/src/components/CampaignLanes.jsx`) owns the mode modal + active-mode pill + Spokesperson / Cinematic / Dialogue lane mounts + every lane handler (`handleBuildSpokespersonReels`, `handleBuildVoicedCinematic`, `handleGenerateSpokespersonAd`, `handleStitchStoryboard`, `handlePlanDialogue`, `handleStitchDialogue`, `handleBuildDialogueReels`, `handleUpdateBrief`, and the `handleGenerateCinematicVideo` start-poll-persist sequence). Controlled-modal pattern: `modalOpen` + `onModalClose` props let any caller flip the modal from a header / tile / shortcut. `onCampaignsChanged(updatedCampaign)` callback merges per-handler updates into the parent's local slice. Workspace integration: Campaigns tab placeholder replaced with a real section that lists linked campaigns (compact rows: id-prefix · business · product · `rendered`/`draft` chip), a `+ New Campaign` header CTA that opens the in-place modal, and `<CampaignLanes>` mounted with the active spokesperson + linked campaigns + the full campaigns list (for `runway_prompt` lookups inside `handleGenerateCinematicVideo`). Workspace `+ New Campaign` header CTA now flips `setActiveTab('campaigns')` + opens the modal in-place — **no more navigate to `/legacy`**. The standalone `<CampaignModeModal>` mount inside the workspace removed (CampaignLanes owns it now). `<SpokespersonStudio>` lane code preserved unchanged; the legacy `/legacy` route still mounts the equivalent v1 surface end-to-end. Smoke Test 2 (`@ /`) extended: after the placeholder loop, click Campaigns tab → assert workspace Campaigns section renders + `+ New Campaign` button visible + `<CampaignLanes>` mounted + no modal yet → click + New Campaign → assert modal opens **at the same URL** (no navigation) → click Cinematic mode card → assert modal closes + active-mode pill `data-mode="cinematic"` + cinematic-lane mounts + spokesperson-lane / dialogue-lane both absent → click dismiss link → assert pill + lane unmount + localStorage `adspark.activeMode` cleared. Build 465.64 KB / 127.54 KB gzip (+6.19 KB / +1.61 KB vs PR CD — CampaignLanes component + workspace tab content + mode modal handoff). v1 / `/legacy` unchanged. No real Runway calls fired this session.) | (post-v13) |
| PR CD | Home Library Only (frontend slice tracked in SESSION_057, branded internally as PR CD to avoid commit-history collision with the user-briefed "PR CC — Home Library Only" rename — the previous workspace-shell commit `0b292e0` already occupies the PR CC slot). Strips campaign-creation surfaces off the homepage. New `hideCampaignControls` prop on `<SpokespersonStudio>` — when true, the global `+ New Campaign` button, the active-mode pill banner, the Spokesperson / Cinematic / Dialogue lane components, and the `<CampaignModeModal>` are all suppressed. `<Library>` passes `hideCampaignControls={true}` so `/` reads as "library only": heading + tagline + 4-chip stats row + `+ Create Spokesperson` CTA + spokesperson tiles. The `<SpokespersonWorkspace>`'s own `+ New Campaign` button stays; its mode-select handler now navigates to `/legacy` (was `/`) since `/` no longer mounts a lane — the legacy wizard becomes the canonical creation surface until lanes land inside the workspace's Campaigns tab. Workspace's Campaigns placeholder copy updated to point at this fallback. Smoke Test 2 (`@ /`) now asserts the **absence** of `spokesperson-new-campaign`, `spokesperson-active-mode`, `campaign-mode-modal`, `spokesperson-lane`, `cinematic-lane`, and `dialogue-lane` testids. Backend untouched. Build 459.45 KB / 125.93 KB gzip (+0.35 KB / +0.10 KB vs PR CC — three conditional gates and a workspace navigate target change). Smoke 3 passed (25.2 s). v1 / `/legacy` unchanged. The previous lane assertions (PR BH/BI/BK/BL/BN/BO/BP/BQ/BR/BS/BT/BU) remain exercised end-to-end via the `@ /legacy` test which walks the equivalent v1 wizard + gallery surface.) | (post-v13) |
| PR CC | Spokesperson Workspace Shell + Identity Tab (frontend slice tracked in SESSION_056; new `/spokespeople/:id` route + `<SpokespersonWorkspace>` component. Header: back link, portrait, name, persona pill (template-derived label), avatar pill (host_avatar_status: ready/mock/failed/pending colour-coded), voice pill (preset / cloned / applied / drift / failed mirroring the PR CB tile chip logic), linked-campaign count + subject. Primary `+ New Campaign` CTA opens the existing `<CampaignModeModal>`; mode select persists `adspark.activeMode` + `adspark.activeSpokesperson` then navigates to `/` where Library's lane logic mounts the appropriate surface. 5-tab nav: Identity (default, fully implemented — embeds the existing CharacterCard with every handler — generate portrait / create avatar / clone voice / apply voice / refresh avatar voice / refresh voice preview / delete — wired to the same `/api/characters/*` routes), Knowledge / Campaigns / Conversations / Outputs (all `<TabComingSoon>` placeholders, "lands next" copy + per-tab summary). Loading state renders a skeleton; unknown id falls back to a friendly not-found page with a "Back to Library" CTA. SpokespersonCard tile gets a primary `Open Spokesperson →` link in the summary chip strip that navigates to the workspace. Smoke Test 2 extended: open link click → /spokespeople/{id} URL → workspace mounts with all header pills + 5-tab nav + Identity active by default → click each placeholder tab → assert the mount; deep-link to a non-existent id renders the not-found state. /legacy unchanged. Build 459.10 KB / 125.83 KB gzip (+10.63 KB / +2.85 KB vs PR CB — the workspace component + new route + tile open link). v1 default load unchanged. PR CD splits the embedded CharacterCard into a dedicated IdentityPanel + VoicePanel; the placeholders ship as their own slices afterwards.) | (post-v13) |
| PR CB | Spokesperson Library Polish + Create Spokesperson CTA (frontend slice tracked in SESSION_055; turns the bare `/` Spokesperson Library into a real product home. New `<CreateSpokespersonModal>` opens via the primary `+ Create Spokesperson` button — 4-field form (name + template + voice_preset + optional subject) that calls the existing `POST /api/characters` + auto-fires `POST /api/characters/{id}/generate-portrait` so the new tile renders with a face. SpokespersonStudio header rewritten: heading `Spokesperson Studio` → `Spokesperson Library` (now an `<h1>` with `text-2xl`), the "preview UX" pill is removed (PR CA graduated v2 to default), tagline pinned to brief copy ("Create persistent AI spokespeople that star in ads, hold conversations, and carry campaign memory."), new 4-chip `library-stats-row` (spokespeople / linked campaigns / cached outputs / transcript entries — counts derive from the local characters + campaigns slices), primary `+ Create Spokesperson` CTA alongside the now-secondary `+ New Campaign`. SpokespersonCard tiles get a new at-a-glance chip strip above the tab strip: voice-state pill (preset / cloned / applied / drift / failed) + linked-campaign count + outputs count. `summariseKnowledge()` extended with `outputCount`. Smoke v2 case extended: heading text, tagline copy, all four stats chips with numeric `data-count`, primary CTA presence + open/cancel round-trip on the modal, all four modal form fields visible. No backend changes. Build 448.47 KB / 122.98 KB gzip (+9.59 KB / +2.00 KB vs PR CA — modal + stats row + tile chips). v1 default load unchanged; /legacy heading + create-character + footer-less behavior preserved.) | (post-v13) |
| PR CA | App Shell + Router + Spokesperson Library as Home (frontend architecture refactor tracked in SESSION_054; flips the homepage from the legacy 4-stage wizard to the Spokesperson Library — the v2 surface graduates to default with no flag required. New `react-router-dom@^7` dep introduces three routes: `/` (Library), `/legacy` (the verbatim v1 wizard + gallery, frozen), `/legacy/*` (alias to /legacy for emergency deep-links). New `<AppShell>` (persistent across navigations) + `<TopBar>` (logo, tiny health pill, "Legacy UI ↗" link / "← Library" return CTA when on /legacy) + `<Library>` (thin wrapper around SpokespersonStudio with active-spokesperson localStorage glue). Old App.jsx body cloned verbatim into `<LegacyApp>` minus the `isUxV2()` ternary + the footer UX toggle (no more "Try preview UX" / "Use classic UX" — top-bar Legacy link replaces it). One-shot localStorage migration: `adspark.ux === "v1"` redirects to /legacy once + clears the key; `?ux=v1` query param does the same; `?ux=v2` is stripped from the URL. SpokespersonStudio now threads `null` to SpokespersonCard's `onOpenCampaign` when its parent (Library) doesn't provide one, so the v2 Appearances "Open in gallery →" affordance reads its disabled placeholder state on `/` (PR BR/BS click-through preserved on /legacy; PR CB will land the workspace Campaigns tab as the new target). All 70 backend routes intact; all generation pipelines untouched; all gitignored media (videos / portraits / voice MP3s / host clips) reachable unchanged via existing URL fields on Campaign / Character. Smoke restructured: Test 1 hits /legacy (the wizard), Test 2 hits / (the Library) + asserts wizard surfaces are absent + asserts top-bar / health pill / Legacy link present, Test 3 exercises the top-bar Legacy round-trip. Build 438.88 KB / 120.98 KB gzip (+39.20 KB / +13.47 KB vs PR BU — primarily react-router-dom + AppShell/TopBar/Library scaffolding). No real Runway calls fired this session.) | (post-v13) |

## Known limitations (current main)

- **No multi-avatar realtime.** Realtime sessions are still
  single-character only; multi-character scenes use the async
  Dialogue Scene Builder instead.
- ~~**No vertical/Reels export of Spokesperson Ad or Dialogue Scene.**~~
  **Resolved by PR AG.** Both outputs now ship a 720×1280 letterbox
  via local ffmpeg (`scale=…:force_original_aspect_ratio=decrease,pad=…`).
  Source aspect is preserved; bars are filled with a dark slate
  backdrop by default. No new Runway calls; ~1–3 s per export.
- ~~**No caption overlays on Dialogue Scene.**~~ **Resolved by
  PR AH** for the vertical Reels export specifically. Per-line
  text is now burned in over the matching segment of the stitched
  Dialogue Reels via chained `drawtext=…enable='between(t,a,b)'`
  filters, with timings derived from ffprobe of the cached line
  clips. Captions on the horizontal Dialogue Scene Ad are still
  out of scope (the talking-head face is the primary visual; the
  vertical export is where text-over-video matters most).
- ~~**No spokesperson script captions on the social-ready exports.**~~
  **Resolved by PR AH.** The saved Commercial Script (or the
  templated `build_script` fallback) is wrapped via `textwrap`
  and rendered as a bottom-safe drawtext box across the full
  Spokesperson Reels duration.
- **No conversation transcript retrieval.** PR AE gives the avatar
  brand context; we don't yet wire `GET /v1/avatar_conversations/{id}`
  for a "replay your chat" UX.
- ~~**No conversation transcript retrieval.**~~ **Resolved by
  PR AJ.** `POST /api/campaigns/{id}/realtime-transcript` fetches
  `GET /v1/avatar_conversations/{id}` (Runway's session id doubles
  as the conversation id; the route layer captures it from the
  broker on success) and persists structured `TranscriptTurn[]`
  for the Realtime tab's replay card. Mock mode renders a
  deterministic 3-turn replay so the UX demos without keys.
- ~~**No avatar-side RAG documents.**~~ **Resolved by PR AI.**
  `POST /api/campaigns/{id}/realtime-document` POSTs a generated
  Markdown brand brief to `/v1/documents`, persists the returned id
  on the campaign, and (best-effort) `PATCH /v1/avatars/{id}` binds
  it to the resolved Runway avatar. The realtime broker passes
  `documentIds=[id]` on session create and swaps in a slimmer
  personality cue. Mock mode returns deterministic
  `mock_doc_<sha>` ids so the grounding flow can be exercised
  end-to-end without a Runway key.
- **No caption overlays on Dialogue Scene.** Per-line text is
  saved; `subtitles=` ffmpeg pass would burn them in. Tier-1.
- **No reaction shots** between dialogue lines — characters don't
  visually react to each other. Documented as the V1 trade-off.
- **`-stream_loop -1 -shortest` artefact** on Voiced Cinematic Ad —
  visual stream can run ~2 s past audio at GOP boundaries.
  Acceptable for V1 demo.
- **Audio in Brand Voice + dubs is sample-only.** They demonstrate
  the voice; the ad narration is the Spokesperson Ad / Voiced
  Cinematic Ad host clip.
- **Preset character library is not API-listable.** Runway's
  in-app preset characters (Music Superstar, Tooth, Mina, etc.)
  aren't exposed via `GET /v1/avatars`. AdSpark's Avatar Picker
  ships 4 mock-mode presets to preserve the UX shape.

## Current demo path (post PR AF)

1. **Stage 1** — pick or create a Character (Brewster the Raccoon,
   Piper Voltage, etc.).
2. **Stage 2** — fill the brief; concepts auto-generate.
3. **Stage 3** — Creative Direction panel opens. Edit / generate
   the **Commercial Script** above the **Runway Video Prompt**;
   pick **Visual Source = Use Character**; **Generate Video**.
4. Click **Save Campaign Card** — gallery scrolls to the new
   card with "just saved" pill, opens on Visuals.
5. **Pick your ad mode** on Overview:
   - **Spokesperson Ad** — one click on Overview, lip-synced.
   - **Cinematic Commercial** — open Visuals → Build Voiced
     Commercial.
   - **Dialogue Scene** — open Dialogue tab → Plan → Generate
     each line → Stitch.
6. Optional: Storyboard (Visuals → Plan Storyboard), Brand Voice
   (Voice tab), realtime (Realtime tab — campaign-aware
   personality + startScript).

## Out of scope (intentionally not implemented)

- WebRTC features beyond the V1 mic-only spokesperson call (webcam
  toggle, screen share, multi-participant rooms — gated by
  Runway's custom-voice limitations).
- Act-Two `/v1/character_performance` (different primitive — needs
  a driving performance video).
- Multi-character realtime (not exposed by Runway today; V1
  uses async Dialogue Scene Builder instead).
- Custom voice cloning (`/v1/voices` audio-clone path) — Tier-1
  candidate but burns extra credits per character.
- Direct text-to-speech narration (`/v1/text_to_speech`) — gated
  `voice.type` discriminator.
- Audio mixing into Pack outputs. Voiced Cinematic Ad is the
  audio-bearing Pack-shaped artefact; per-format Pack outputs stay
  silent.
- Server-side `/v1/uploads` — public URL + data URI cover current
  paths.
- Stability.ai integration.
- Auth, multi-user, public deploy — out of scope until next-phase
  scope is locked.
- Real-time refresh of `/provider-status`.
- Smart-framing for cross-aspect Pack crops.
- Background-task finishing.
- Avatar marketplace / preset library exposure.
- Knowledge documents (`/v1/documents`) for grounded realtime.
- Conversation transcripts (`/v1/avatar_conversations`).
- Character Studio K.5 polish (PATCH character, replace-avatar).
- Character Studio Phase L / M (export/import, marketplace).

See `docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md` §12 for the
ranked roadmap of what's still on the table.
