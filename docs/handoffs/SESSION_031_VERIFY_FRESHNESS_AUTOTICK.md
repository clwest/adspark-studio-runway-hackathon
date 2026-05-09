# SESSION 031 — Voice Verification Auto-Tick Freshness Caption (PR AZ)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR AZ patch in flight on top of `0a93c79`
`feat: live mic level meter for voice recording`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_030 (PR AY Mic Level Meter), SESSION_028
(PR AW Freshness Label), SESSION_027 (PR AV Avatar Status
Refresh), and the rest of SESSION_011–SESSION_029.

## Goal

PR AW added the *"Last checked Nm ago"* caption next to the
verify pill, but the label was static between renders — once it
read "4m ago" the operator had to trigger another action
(clone / apply / refresh) before it advanced to "5m ago".

PR AZ adds the smallest possible polish: a per-tile 60-second
timer that bumps a local `nowMs` state so the caption advances
buckets on its own. **No backend round-trip, no polling, no
new endpoints.** Just a `setInterval` that updates one piece of
React state once per minute.

Hard scope locks (carried forward from the brief):
- Frontend-only.
- No backend calls from the timer.
- No polling.
- No batch refresh.
- No UI redesign.

## Endpoint inventory

PR AZ adds **no new routes**. Route count stays at **68**. Pure
frontend slice.

## What changed

### Frontend

- **`frontend/src/components/CharacterCard.jsx`** — three small
  additions:
  1. A `freshnessVisible` derivation (alias for the existing
     `customVoiceReady && avatarReady` gate) so the timer's
     visibility condition is named explicitly.
  2. A `nowMs` `useState(() => Date.now())`. Initialised lazily
     so the initial render uses the actual mount time.
  3. A gated `useEffect` that:
     - Returns early if `freshnessVisible` is false.
     - Resets `nowMs` to the current time on mount + when
       `verified_at` changes (so a freshly-loaded card never
       reads stale `nowMs` from a stale React tree).
     - Schedules `setInterval(() => setNowMs(Date.now()), 60_000)`.
     - Returns the cleanup function `() => clearInterval(id)` so
       unmounts and visibility-gate flips both tear it down.
  4. The freshness caption call site now passes `nowMs` as the
     second argument: `formatVerifyFreshness(c.avatar_voice_verified_at, nowMs)`.

The PR AW formatter helper itself is unchanged — it already
accepts an explicit `nowMs` argument so deterministic tests can
pin time. PR AZ just wires the React state into that argument.

### Backend

- **No changes.** Zero backend impact; the timer never makes a
  request.

### Docs

- `docs/INVENTORY.md` — feature stack reflects PR AZ; route count
  narrative confirms unchanged at 68.
- `docs/OPERATOR_USAGE_MAP.md` — Character Studio §1 freshness
  subsection gained an "auto-tick" paragraph.
- `docs/WHAT_IT_IS.md` — intentionally unchanged; PR AZ is the
  smallest possible UX detail on top of PR AW.
- `00-START-NEXT-SESSION.md` — Character-layer section + build
  sizes / route count.
- `docs/handoffs/SESSION_031_VERIFY_FRESHNESS_AUTOTICK.md` —
  this file.

## Auto-tick behavior

```
Mount tile (or reach `freshnessVisible === true`):
  ↓ useEffect fires
  ↓ setNowMs(Date.now())            (reset baseline)
  ↓ const id = setInterval(() => setNowMs(Date.now()), 60_000)
  ↓ returns () => clearInterval(id)

Every 60 s while caption is visible:
  ↓ setNowMs(Date.now())            (single state update)
  ↓ React re-renders the tile once
  ↓ formatVerifyFreshness(verified_at, nowMs) advances bucket if delta crossed

When verified_at changes (clone / apply / refresh response lands):
  ↓ effect deps include c.avatar_voice_verified_at
  ↓ React tears down the previous interval
  ↓ Re-runs the effect with fresh baseline
  ↓ Caption immediately re-renders with the new "just now" baseline

When freshnessVisible flips false (clone cleared, avatar removed):
  ↓ effect's cleanup runs
  ↓ Interval is cancelled
  ↓ Tile no longer carries a timer

On unmount:
  ↓ cleanup runs (same code path as above)
```

The visibility gate matters for tile gardens — characters
without a cloned voice + avatar never carry a timer. With four
fixture characters in mock mode, that's at most four
intervals; in practice usually 0–2 because the mock smoke
campaign rarely clones.

## Cleanup behavior

Three reliable teardown points:

| Trigger | What runs |
|---|---|
| `freshnessVisible` flips false | `useEffect` previous-effect cleanup → `clearInterval(id)` |
| `c.avatar_voice_verified_at` changes | `useEffect` previous-effect cleanup → `clearInterval(id)`, then new effect re-runs with fresh baseline |
| Component unmounts | `useEffect` cleanup → `clearInterval(id)` |

`clearInterval` on an already-cleared id is a no-op, and React
guarantees the cleanup runs before each subsequent effect
invocation, so double-fires (StrictMode dev) are safe.

The timer never holds a closure over stale `nowMs`; each tick
calls `Date.now()` directly. So even if the interval somehow
fires after a stale mount, the worst case is a single redundant
state update.

## Mock behavior

Mock mode is identical to real mode here — the timer never
touches the network. After a mock-mode clone+apply, the
persisted `avatar_voice_verified_at` is roughly `Date.now()`,
the caption renders *"Last checked just now"*, and the timer
advances buckets at the boundaries:

| Time after clone | Caption |
|---|---|
| ≤ 45 s | *Last checked just now* |
| 46 s – 59 s | *Last checked 0m ago* |
| 1 min boundary (auto-tick) | *Last checked 1m ago* |
| 5 min later | *Last checked 5m ago* |
| 60 min boundary | *Last checked 1h ago* |
| 24 h boundary | *Last checked 1d ago* |

Bucket transitions verified by a 9-case Node probe pinning
explicit `nowMs` values at every boundary.

## Verification (this session)

Servers were killed and restarted in mock mode before each
verification block per the brief.

| Check | Result |
|---|---|
| Local servers killed pre-test | `pgrep -lf 'uvicorn\|vite'` → `(none)` ✅ |
| Mock backend health | `{"status":"ok",…,"any_mock":true}` ✅ |
| Vite dev server | HTTP 200 ✅ |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) ✅ |
| `vite build` | 326.48 KB initial / 91.65 KB gzip + 561.97 KB lazy chunk |
| Playwright mock smoke | `1 passed (21.5 s)` ✅ |
| Auto-tick bucket-transition probe (Node) | 9/9 transitions correct ✅ |
| Hygiene scan (incl. `\.webm`) | empty ✅ |
| Drift guard | `✅ context-kit anchors look recent.` ✅ |

The 9-case probe pinned explicit `nowMs` values at every
bucket boundary:

```
✓ t+0s     → Last checked just now
✓ t+44s    → Last checked just now    (45s boundary)
✓ t+46s    → Last checked 0m ago      (45s boundary)
✓ t+1m     → Last checked 1m ago      (60s tick)
✓ t+2m     → Last checked 2m ago
✓ t+5m     → Last checked 5m ago
✓ t+59m    → Last checked 59m ago     (60m boundary)
✓ t+60m    → Last checked 1h ago      (60m boundary)
✓ t+24h    → Last checked 1d ago      (24h boundary)
```

## Server restart confirmation

```
pkill -f "uvicorn app.main:app"   # killed
pkill -f "vite"                   # killed
RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
  uvicorn app.main:app --port 8000  # fresh
npm run dev                        # fresh
sleep 5 && curl /health -> 200; vite -> 200
```

After the frontend code change, the backend stayed live (no
backend changes). Smoke + build + helper probe all ran against
fresh processes. Servers are stopped at the end of the session.

## Limitations / follow-ups

- **One interval per visible tile.** Each CharacterCard with a
  cloned voice + avatar carries its own timer. With small
  libraries (4–10 chars) this is fine; for libraries with
  dozens of characters a single page-level interval would be
  more efficient. Out of scope for V1.
- **Tab-inactive throttling.** Browsers throttle `setInterval`
  in inactive tabs to ~once per minute already, but Chromium
  goes further (1 s minimum). Not a concern for a 60-s timer.
- **No "tick on visibility return".** If the operator switches
  tabs for 90 s, the timer fires once on return and the
  caption immediately catches up. Acceptable.
- **No cross-tab sync.** Two tabs viewing the same library each
  carry independent timers. Acceptable.
- **Smoke can't observe the tick.** A single-shot Playwright
  run takes ~22 s; the auto-tick fires at 60 s. The bucket
  transitions are covered by the helper probe instead.
- **`useEffect` deps include `c.avatar_voice_verified_at`.**
  This means a quick succession of clone+apply calls during
  the same 60-s window will reset the timer multiple times.
  Each reset is cheap (cancel interval, fire one state
  update); not a real issue.

## Recommended next slice

The Tier-1 + AK / AL / AM / AN / AO / AP / AQ / AR / AS / AT /
AU / AV / AW / AX / AY / AZ slices are all ✅ shipped.
Next-tier candidates:

1. **Library-level "Refresh all"** — bulk-trigger PR AV +
   PR AX for every character with avatar + cloned voice in a
   single click. ~50 LOC frontend, no backend.
2. **Voice repair history** — tiny audit trail on the
   character record so each repair produces a `{timestamp,
   before_id, after_id}` log row.
3. **Per-campaign transcript history** — small archive list
   (or `keep` flag) on PR AJ so operators can keep multiple
   session replays per campaign.
4. **Peak-hold indicator on PR AY meter** — small red dot
   lingering ~500 ms at peak position so the operator can
   see clipping bursts.
5. **Library-level voice pill summary** — one-line "X
   characters ready · Y unverified · Z drifted" line at the
   top of the library so the operator can scan health at a
   glance without inspecting each tile.

Each is a 1–2 hour slice. None blocking.
