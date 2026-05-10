# SESSION 070 — V2 Full Manual UI QA + Demo Readiness Review

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` at `89bfd47` (`feat: workspace outputs
gallery (PR CN)`).
**Mode:** Real-mode servers
(`bash scripts/start-local-real.sh`); `runway_mock=false`.
**Method:** A one-off Playwright walk
(`/tmp/qa-screenshots/session-070/`) clicked through every
v2 surface end-to-end against the live data, captured 16
full-page screenshots, and dumped DOM observations to
`observations.json`. **No** real generation buttons
clicked; **no** real Runway calls fired.

> ⚠️ **Headline finding:** the v2 *interaction model* is
> demo-ready. The v2 *data layer* is not. Live
> `backend/data/characters.json` has been pruned to a
> single faceless persona (Brewster Bolt, no portrait, 0
> linked campaigns) while every cached-output campaign in
> `backend/data/campaigns.json` references a
> `character_id` that no longer exists. The Outputs
> Gallery PR CN just shipped renders empty for the only
> visible spokesperson. **Recommendation:** before any
> demo, re-run the PR CG/CH idempotent seeders +
> regenerate demo portraits + relink the orphan output
> campaigns. Details + recommended PR CO at the bottom.

## What I tested + what I did NOT test

**Walked end-to-end:**
- `/` Spokesperson Library home (heading, tagline, stats
  row, primary CTA, tile rendering, Open link → workspace).
- Create Spokesperson 4-step flow — Identity / Visual
  Direction / Voice / Generate. Filled every required
  field (name, archetype, subject) and walked Step 1 →
  Step 4. **Did not submit** (would burn portrait credits
  + create a junk record).
- `/spokespeople/{id}` workspace — header pills, all 5
  tabs (Identity, Knowledge, Campaigns, Conversations,
  Outputs), `+ New Campaign` mode picker, all 3 lanes
  (Spokesperson / Cinematic / Dialogue) mounted in-place,
  active-mode pill dismissal.
- Cinematic / Spokesperson lane button states — verified
  `data-burns-credits` flag + disabled-reason copy
  without clicking. **Did not click any "Generate Real …"
  button** anywhere.
- `/spokespeople/this-id-does-not-exist` not-found
  fallback.
- `/legacy` round-trip (heading + back link).

**Did NOT test:**
- Real-mode generation flows (no creds burned).
- Mobile viewports beyond confirming desktop layout.
- Cross-browser; Playwright Chromium only.
- Realtime spokesperson voice (would need an active
  campaign with a bound avatar — none exists today).
- The PR CL `startCampaignHint` round-trip (covered by
  smoke; no need to repeat).

## Pass / fail table (against the user's 8-section checklist)

| § | Area | Result | Detail |
|---|---|---|---|
| 1 | Homepage feels clean | **PASS-with-data-bug** | Heading + tagline + 4-chip stats row + `+ Create Spokesperson` CTA + 1 tile all render correctly. Bug: only 1 tile renders (Brewster Bolt, no portrait, 0 linked campaigns). The other 3 PR CG demo personas are gone from `characters.json`. |
| 1 | No old wizard/galleries on home | **PASS** | No Stage 1/2/3 surface, no Concept Cards, no `<CampaignGallery>` mount, no v1 wizard nav. The library is the home. |
| 2 | Create flow walks 4 steps | **PASS** | All 4 steps render. testids all wired (`create-spokesperson-{name,template-mascot,subject,personality,audience-vibe,style-chips,style-chip-{N},fashion,portrait-prompt,reset-prompt,voice-featured,voice,voice-detail,energy-chips,summary,avatar-toggle,campaign-toggle,submit,next,back,cancel}`). |
| 2 | Fields make sense | **PASS** | Step 1 captures name + 4 archetype cards + species/role + personality + audience-vibe. Step 2 owns 10 visual style chips, fashion line, and the editable portrait prompt. Step 3 owns 6 featured-voice quick-picks + full 30-preset dropdown + voice detail card + 6 energy chips. Step 4 owns a summary + the bind-avatar + start-campaign opt-ins. |
| 2 | Portrait prompt is editable | **PASS** | Auto-derives a 254-char prompt on Step 1+2 input ("Studio portrait of test mascot for qa walk. modern, warm, on-brand. Front-facing, head-and-shoulders crop. Expressive eyes, soft warm smile. Simple solid mid-gr…"). Textarea is editable; `Reset to auto` link reverts; `portrait_prompt_dirty` flag prevents auto-clobber after edits. |
| 2 | Did NOT submit | **PASS** | Walked Step 4 → clicked Back to Step 1 → clicked Cancel. No record created. |
| 3 | Workspace header understandable | **PASS** | Header reads "Brewster Bolt", with avatar pill ("avatar · not created") and voice pill ("voice · preset · felix"). Persona / archetype pill shows "Mascot · animal/brand". |
| 3 | Identity tab has the right controls | **PASS** | Embeds the full `<CharacterCard>` with Generate Portrait / Create Avatar / Clone Voice / Apply Voice / Refresh Avatar Voice / Refresh Voice Preview / Delete handlers all wired. |
| 3 | Campaigns tab opens mode picker in-place | **PASS** | URL stays at `/spokespeople/{id}` after `+ New Campaign` click and after picking any of the 3 modes. |
| 3 | Mode lanes mount inside workspace | **PASS** | Cinematic / Spokesperson / Dialogue lanes all mount inside `<CampaignLanes>`; active-mode pill dismissal cleanly unmounts them. |
| 3 | No unwanted /legacy jumps | **PASS** | No `<a href="/legacy">` anywhere on `/` or in workspace. Only the deliberate top-bar `Legacy UI ↗` link routes there. |
| 4 | Cinematic lane button | **PASS** | `data-burns-credits="true"`, disabled (no `runway_prompt` on a focused campaign yet, label "Generate Real Cinematic Video — no prompt"), rose-chrome warning visible. |
| 4 | Spokesperson lane button | **PASS** | `data-burns-credits="true"`, disabled (no avatar bound yet, label "Generate Real Spokesperson Ad — no avatar"), rose-chrome warning visible. |
| 4 | Dialogue lane | **PASS** | Mounts; lane shape + step copy match the PR CF cleanup. |
| 4 | Credit-burn buttons clearly marked | **PASS-with-polish** | Both `Generate Real …` buttons carry `data-burns-credits="true"` + visible "burns credits" caption. The disabled-reason copy is concatenated to the button label without separation in `textContent` (renders fine visually but reads weird in screen readers / smoke). See polish fix #2. |
| 5 | Real Brewster outputs appear | **FAIL — BLOCKER** | Outputs gallery renders the empty pill ("No outputs yet. Create a campaign or generate from the Campaigns tab.") for Brewster Bolt. The cached outputs on `fc8a20c4` (CEO Buzz, 4 outputs) + `22fa0a24` (FocusNet, 3 outputs) reference deleted character ids and are orphaned. **PR CN works correctly** — the data is broken. |
| 5 | Video previews work | **N/A** | Cannot test until outputs are re-linked. Component code is correct (verified via PR CN smoke yesterday). |
| 5 | Links work | **N/A** | Same. |
| 5 | Empty state is clear for new spokespeople | **PASS** | Pink pill copy "No outputs yet. Create a campaign or generate from the Campaigns tab." renders cleanly. |
| 6 | Knowledge placeholder not confusing | **PASS-with-polish** | Copy reads "Knowledge sources will appear here." with a "Grounding documents and transcript history for this spokesperson. 0 linked campaigns feed this view." sub-line. Honest + scoped. Polish: the "0 linked campaigns" clue conflicts with the home stats showing "6 linked campaigns" — see blocker #1. |
| 6 | Conversations placeholder not confusing | **PASS** | Copy "Conversation history will appear here." with sub-line "Realtime sessions and transcript replays for this spokesperson." |
| 7 | /legacy still works | **PASS** | Heading "AdSpark Studio" renders; full v1 four-stage wizard accessible via top-bar `Legacy UI ↗` link. |
| 8 | Visual polish — duplicated buttons | **PASS** | No duplicate primary CTAs after PR CM tile simplification. |
| 8 | Visual polish — confusing jargon | **PASS** | PR CF copy cleanup holds; smoke `FORBIDDEN_JARGON` regex did not regress. |
| 8 | Visual polish — broken portraits | **FAIL — BLOCKER** | The only living spokesperson (Brewster Bolt) renders the gray "Portrait pending" placeholder. PR CI was supposed to land portraits for the demo personas but the live `data/characters/` only contains the Brewster Bolt placeholder — no PNG. |
| 8 | Visual polish — empty states | **PASS** | Outputs empty pill, "No spokespeople yet" empty state, dialogue lane empty hint all clean. |
| 8 | Visual polish — spacing / labels | **PASS-with-polish** | Stats row + tile chip strip + workspace header all read cleanly. The two textContent concatenations on the lane buttons are readable but not ideal; see polish fix #2. |
| 8 | Visual polish — responsive | **NOT TESTED** | Desktop only this pass. |

## Top 5 demo blockers (P0 — must fix before showing v2 to anyone)

### 1. Live `characters.json` has decayed to one faceless persona
**Severity:** P0 · blocks demo trust on first paint.
- `backend/data/characters.json` currently holds **1**
  record: `4be4ad28f91a Brewster Bolt` (template `mascot`,
  voice `felix`, **no portrait_url**).
- The PR CG seeder (SESSION_061) was supposed to leave 4
  demo personas (Brewster Bolt / Clara Vale / Rex
  Roadside / Mina Spark). Three are gone.
- Result: home library shows 1 tile with a gray
  placeholder. Demo opener lands flat.

### 2. Every cached-output campaign is orphaned from its character
**Severity:** P0 · directly nullifies the PR CN ship.
- 6 of the 44 campaigns have a `character_id` set; **0
  of those 6 character_ids resolve** to a record in
  `characters.json`:

  | Campaign | character_id (orphan) | business | outputs |
  |---|---|---|---|
  | `56344420` | `28d6df60…` | Spark Social | none |
  | `9915bcd4` | `dc52be03…` | Freedom Ford | none |
  | `cf11a847` | `541a300c…` | AdSpark Studio | none |
  | `88164695` | `abf9ce2f…` | CEO Buzz | none |
  | `22fa0a24` | `5f1b3738…` | FocusNet | **cinematic + host + voiced** |
  | `fc8a20c4` | `d0478949…` | CEO Buzz | **cinematic + host + voiced + reels** |

- Brewster Bolt's live id is `4be4ad28`. None of the 6
  campaigns reference it. Result: workspace shows "0
  linked campaigns feed this view" + Outputs gallery
  empty.

### 3. Library stats row claims "6 linked campaigns" + "46 cached outputs" the workspace can't surface
**Severity:** P0 · creates a trust gap the demo cannot
recover from.
- `library-stat-linked-campaigns` reads **6** (counts
  every campaign with any `character_id`, alive or not).
- `library-stat-cached-outputs` reads **46** (counts
  every populated output URL across all 44 campaigns,
  including 38 anonymous "Local coffee shop" test
  campaigns from the PR A-era).
- `library-stat-transcripts` reads **39**.
- The home looks loaded. Click any tile → it's empty.
  Operator's first conclusion is "the workspace is
  broken."

### 4. Brewster Bolt has no portrait
**Severity:** P0 · the only tile on the demo's first
paint is blank. PR CG/CI was supposed to land a portrait;
re-running the portrait generator (`POST
/api/characters/{id}/generate-portrait`) on this
character is a one-shot fix but burns ~$0.05 of Runway
credit.

### 5. PR CN gallery + PR CL hint round-trip can't be demoed today
**Severity:** P0 · the two most recent shipped slices are
unreachable as user-visible value:
- PR CN gallery: empty for the only spokesperson.
- PR CL hint: only fires when a spokesperson is created
  + the "Start a campaign" checkbox is ticked. With one
  pre-existing tile, the demo path is "create a
  spokesperson then watch the workspace open mid-
  campaign-flow" — but creating one fires real portrait
  generation (~$0.05) so the live demo is hesitant to
  click it.

## Top 5 polish fixes (P1 — would lift the demo from "works" to "polished")

### 1. Lane button label concatenation (`Generate Real Cinematic Videono prompt`)
**Severity:** P1 · accessibility / smoke clarity.
- Both `cinematic-lane-video` and
  `spokesperson-lane-horizontal` render the disabled-reason
  immediately after the button label without a separator.
  Visual is fine (the reason is in a separate
  `<span>` with its own padding) but `textContent` reads
  `"Generate Real Cinematic Videono prompt"`.
- Fix: add a leading separator (`" — "` or a `\u00A0`)
  to the disabled-reason span text. ~2 lines per lane.

### 2. Library stats row should scope to *living* + *demo-eligible* counts
**Severity:** P1 · prevents the discrepancy in blocker
#3.
- Either filter `linked-campaigns` to only count
  campaigns whose `character_id` resolves to a live
  character, or expose the orphan count as a separate
  diagnostic chip.
- For the **outputs** stat, scope to campaigns that are
  reachable from the library (link-resolved). Today it
  counts the 38 anonymous "Local coffee shop" rows that
  no library tile surfaces.

### 3. Tile "0 campaigns" reads cold next to the home stats "6 linked campaigns"
**Severity:** P1.
- When the only tile shows `0 campaigns` in the chip
  strip but the home header says `6 linked campaigns`,
  the operator's mental model breaks. After fix #2 above
  these will reconcile naturally.

### 4. Heading concatenation in Library h1
**Severity:** P2.
- `textContent` of the `<h1>` reads "Spokesperson
  LibraryRunway-powered" — the "Runway-powered" tagline
  pill is a sibling but the missing whitespace is jarring
  in screen readers + screenshots-with-text-extraction.
- Fix: add a visually-hidden space or a `aria-label` on
  the heading.

### 5. Conversations + Knowledge placeholders should hint at the *closest* working surface
**Severity:** P2.
- Operator on the Knowledge tab reads "0 linked
  campaigns feed this view" with no follow-up CTA. A
  mini-link "→ Create a campaign in the Campaigns tab"
  would close the loop.
- Same on Conversations: "→ Bind an avatar in Identity
  to start a realtime call".
- Each fix is one `<Link>` per tab.

## Demo readiness verdict

> **v2 is *not* demo-ready as of this session — but the
> blockers are *data*, not *code*. Two seeder runs +
> one fixture-relink script + one portrait regeneration
> moves the demo from blank to polished. Estimated cost:
> ~$0.10 in Runway credit (4 portraits) + 30 minutes of
> work.**

**What's working** (the entire interaction model):
- Library home, workspace, 4-step Create flow, all 3
  campaign lanes, mode picker in-place, Outputs gallery
  empty/populated branches, hint round-trip plumbing,
  not-found fallback, /legacy fallback. **PR CA → PR CN
  ship as a coherent product.**

**What's blocking** (data integrity):
- 3 missing demo personas, all referenced campaigns
  orphaned, no demo portraits visible, headline stats
  count records the user can't reach.

## Screenshots captured

All under `/tmp/qa-screenshots/session-070/` (gitignored
— do not commit). Reference the matching observation
key in `observations.json` for DOM-side state at the
moment of capture.

| File | Surface |
|---|---|
| `01-home.png` | `/` Spokesperson Library |
| `02-create-step1.png` | Create flow Step 1 — Identity (filled) |
| `03-create-step2.png` | Create flow Step 2 — Visual Direction (auto-derived prompt) |
| `04-create-step3.png` | Create flow Step 3 — Voice |
| `05-create-step4.png` | Create flow Step 4 — Generate (summary + opt-ins) |
| `06-workspace-identity.png` | `/spokespeople/4be4ad28f91a` Identity tab |
| `07-workspace-knowledge.png` | Knowledge placeholder |
| `08-workspace-campaigns.png` | Campaigns tab (empty linked-campaigns list, lane mounted but no active mode) |
| `09-workspace-mode-modal.png` | Mode picker modal in-place |
| `10-workspace-cinematic.png` | Cinematic lane mounted |
| `11-workspace-spokesperson-lane.png` | Spokesperson lane mounted |
| `12-workspace-dialogue-lane.png` | Dialogue lane mounted |
| `13-workspace-conversations.png` | Conversations placeholder |
| `14-workspace-outputs.png` | Outputs empty state |
| `15-workspace-not-found.png` | Unknown id fallback |
| `16-legacy-home.png` | `/legacy` AdSpark Studio wizard |

`observations.json` contains the textContent / count /
attribute observations behind the pass/fail table above.

## Recommended next slice — PR CO

**PR CO — Demo Data Restoration + Library Stats Sanity**

Three commits in sequence, all idempotent / no schema
change / route count holds at 71:

### CO.1 — Re-run the demo seeders + relink orphan campaigns

```bash
python scripts/seed-demo-spokespeople.py   # re-creates 3 missing personas
python scripts/seed-demo-campaigns.py      # idempotent; no-op for existing
```

Then add a small one-shot relink helper
(`scripts/relink-orphan-demo-campaigns.py`) that walks
campaigns where `character_id` is set but the id is not
alive, and re-points it to the matching demo
spokesperson by `(business)` rule. Specifically:

- `CEO Buzz` → Brewster Bolt (the live `4be4ad28`)
- `Spark Social` → Mina Spark
- `Freedom Ford` → Rex Roadside
- `AdSpark Studio` → Clara Vale
- `FocusNet` → leave orphan (Piper Voltage was a
  user-owned spokesperson, not a demo seed; relinking
  could trample the operator's work)

Net effect: Brewster Bolt's CEO Buzz campaign reattaches
with its 4 cached outputs, lighting up PR CN's gallery
on demo path 1.

### CO.2 — Regenerate the 4 demo portraits (gated)

User-approved only — burns ~$0.10. Runs after CO.1
re-creates the 3 missing personas. Loop:

```bash
for id in $(jq -r '.[].id' backend/data/characters.json | head -4); do
  curl -X POST localhost:8000/api/characters/$id/generate-portrait \
    -H 'Content-Type: application/json' -d '{}'
done
```

Re-fires the same path `<CharacterCard>`'s "Generate
Portrait" button uses. Expect 3 SUCCEEDED + maybe 1
upstream failure (Rex Roadside has historically failed
twice; the portrait-failed phase from PR CJ handles it
gracefully).

### CO.3 — Library stats sanity (P1 polish #2 above)

`SpokespersonStudio.jsx` `library-stats-row`
calculation tightens to:

- `linked-campaigns`: count campaigns where
  `character_id` is set **AND** the id resolves to a
  live character.
- `cached-outputs`: count outputs only on link-resolved
  campaigns.

Same render, smaller numbers, but they reflect what the
operator can actually click into. Smoke gets a check
that `library-stat-linked-campaigns` matches the sum of
per-tile `spokesperson-summary-linked` counts.

### Optional CO.4 — Lane button textContent fix (P1 polish #1)

Two edits in `CinematicLane.jsx` /
`SpokespersonLane.jsx` — prepend a `\u00A0— ` to the
disabled-reason span. Half a screen of diff.

### Time + cost estimate

| Step | Time | Real cost |
|---|---|---|
| CO.1 seed + relink | 25 min | $0 |
| CO.2 portraits | 5 min | ~$0.10 |
| CO.3 stats sanity | 30 min | $0 |
| CO.4 button polish | 10 min | $0 |
| **Total** | **~70 min** | **~$0.10** |

After CO ships, the demo path is:

1. Open `/` → 4 demo tiles with portraits, stats reading
   `4 spokespeople · 4 linked campaigns · ~10 outputs · 39
   transcripts`.
2. Click Brewster Bolt → Identity tab loads with the
   real portrait, voice pill green.
3. Click Outputs → 4 cached cards play inline.
4. Click Campaigns → CEO Buzz row visible; mode picker
   opens in-place; cinematic lane mounts with the saved
   prompt.
5. Click Create Spokesperson → 4-step flow round-trips.

That's the full v13-class demo restored.

## Verification (this session, docs-only deliverable)

| Check | Result |
|---|---|
| Hygiene scan | empty (no PNG / video committed; screenshots stay in `/tmp/`) |
| Drift guard | `context-kit anchors look recent.` (1 commit since anchors were last touched) |
| Real-mode servers | left running; `runway_mock=false`, `image_gen_mock=false` |
| Real Runway calls fired | **zero** |
| Files modified this session | `docs/handoffs/SESSION_070_V2_FULL_UI_QA.md` (new); `frontend/tests/_qa-session-070.spec.js` (test-only walk script — gitignored if added) |

No commits land outside this handoff.
