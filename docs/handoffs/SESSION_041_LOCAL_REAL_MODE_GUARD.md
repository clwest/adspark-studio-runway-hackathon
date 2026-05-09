# SESSION 041 — Local Real-Mode Runtime Guard (PR BJ)

**Date:** 2026-05-09
**Author:** Claude (Opus 4.7) for Chris (chris@donkeybetz.com)
**Branch:** `main` (PR BJ patch in flight on top of `42a8054`
`feat: spokesperson ad lane scaffold (gated v2)`; commit + push
pending after this handoff lands)
**Builds on:** SESSION_REAL_API_CREDIT_BURN (which exercised the
real Runway pipeline end-to-end and surfaced this runtime-mode
papercut).

## Goal

Multiple recent sessions auto-restarted servers with
`RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock` "for
safety", which forced mock mode even when the operator wanted
to test real generated assets in the browser. The user paid for
the credits — they decide when to spend them — so mock-by-default
was costing them real test cycles.

PR BJ flips the default. Real mode is now the canonical entry
point for **manual / in-browser testing**. Mock mode is reserved
for **Playwright smoke + CI + explicit dry-runs** and is booted
via a clearly-named separate script.

This is a runtime + docs slice. **No backend / model / route
changes. No frontend code changes.** PR BI's lane scaffold is
still the head of the v2 redesign track.

## Endpoint inventory

PR BJ adds **no new routes**. Route count stays at **68**.
Pure runtime + docs.

## What changed

### New files

- **`scripts/start-local-real.sh`** — canonical real-mode boot
  for manual testing. Sources `.env` without clobbering keys
  (no `RUNWAY_API_KEY=` or `IMAGE_GEN_PROVIDER=mock` overrides),
  kills any stale uvicorn/vite, boots both backgrounded, and
  prints the `/health` JSON + vite HTTP code + pids so the
  operator can confirm `runway_mock=false` at a glance. Warns
  loudly if `RUNWAY_API_KEY` is empty (suggests using the
  mock script instead). Logs to `/tmp/uvicorn-real.log` +
  `/tmp/vite-real.log`.

- **`scripts/start-local-mock.sh`** — explicit mock-mode boot
  for Playwright smoke + CI + safe dry-runs. Sets
  `RUNWAY_API_KEY=`, `OPENAI_API_KEY=`, and
  `IMAGE_GEN_PROVIDER=mock` for the spawned process tree only;
  the on-disk `.env` is untouched. Logs to
  `/tmp/uvicorn-mock.log` + `/tmp/vite-mock.log`.

- **`scripts/stop-local.sh`** — kills both servers + reports
  any survivors. Equivalent to
  `pkill -f 'uvicorn app.main:app|vite'` with confirmation
  output.

All three scripts marked `chmod +x` and follow the same
preamble shape as the existing `scripts/check-context-kit-drift.sh`
(repo-root resolve via `git rev-parse --show-toplevel`,
`set -eu` discipline).

### Modified files

- **`CLAUDE.md`** — Hard-rules section rewritten:
  - Old rule: *"No real Runway calls without explicit per-task
    approval. Mock mode … is the default for any automated
    work."* (Conflated *automated* runs with *manual testing*.)
  - New rules:
    1. **Real-mode is the default for manual / in-browser
       testing.** Boot via `bash scripts/start-local-real.sh`.
    2. **Mock-mode is reserved for Playwright / CI / explicit
       dry-runs.** Boot via `bash scripts/start-local-mock.sh`.
    3. **No automated real-mode generation runs.** Real Runway
       calls during slice work still require explicit per-task
       approval; smoke + drift + build never need real keys.
  - "Verification gates" snippet updated: smoke uses
    `start-local-mock.sh`, manual testing uses
    `start-local-real.sh`. The inline
    `RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock`
    pattern is now an anti-pattern documented as such.

- **`00-START-NEXT-SESSION.md`** — `## Run it` section
  rewritten:
  - Real-mode boot command (default) at the top with the
    in-browser testing context + "clicking buttons burns
    credits" warning.
  - Mock-mode boot command separately for CI / smoke / dry-run.
  - `## Run the smoke` reduced to two lines:
    `bash scripts/start-local-mock.sh; (cd frontend && npm run test:e2e)`.
  - Inline `RUNWAY_API_KEY= … IMAGE_GEN_PROVIDER=mock`
    snippets removed.

- **Memory** — new feedback memory at
  `feedback_real_mode_default.md` so future sessions don't
  fall back into mock-by-default. Combined with the existing
  "always confirm both servers running" rule, the behavior
  expectation is now durable.

### Frontend / backend code

- **None.** Zero JS / Python changes. Bundle size unchanged
  from PR BI (362.78 KB / 99.99 KB gzip).

## Exact real-mode start command

```bash
bash scripts/start-local-real.sh
```

Sources `.env` automatically. Don't pass any inline env
overrides.

## Exact mock-smoke command

```bash
bash scripts/start-local-mock.sh
(cd frontend && npm run test:e2e)
```

## /health real-mode result

```
$ bash scripts/start-local-real.sh
RUNWAY_API_KEY length: 132
OPENAI_API_KEY length: 0
IMAGE_GEN_PROVIDER:    <unset>
…
─── /health ───
{"status":"ok","service":"adspark-studio",
 "openai_mock":true,"runway_mock":false,
 "image_gen_mock":false,"any_mock":true}
─── vite ───
vite http=200
```

`runway_mock=false` + `image_gen_mock=false` confirm real
Runway visual + avatar + voice + dub + realtime + documents
flows are live. `openai_mock=true` is fine — there's no
OpenAI key in `.env`; concept generation falls back to the
deterministic mock without affecting Runway flows.

## Smoke result

```
$ bash scripts/start-local-mock.sh
…
─── /health (expect runway_mock=true, image_gen_mock=true) ───
{"status":"ok","service":"adspark-studio",
 "openai_mock":true,"runway_mock":true,
 "image_gen_mock":true,"any_mock":true}
…

$ (cd frontend && npm run test:e2e)
Running 2 tests using 1 worker
  ✓  1 [chromium] › … mock-mode end-to-end smoke (20.9s)
  ✓  2 [chromium] › … UX v2 SpokespersonStudio scaffold (751ms)
  2 passed (22.2s)
```

## Verification (this session)

| Check | Result |
|---|---|
| Local servers killed pre-test | `bash scripts/stop-local.sh` → `✅ servers stopped` |
| Real-mode boot | runway_mock=false, image_gen_mock=false, vite http=200 |
| Mock-mode boot | runway_mock=true, image_gen_mock=true, vite http=200 |
| `python -c "from app.main import app; print(len(app.routes))"` | **68** (unchanged) |
| `vite build` | 362.78 KB initial / 99.99 KB gzip (unchanged from PR BI) |
| Playwright mock smoke | `2 passed (22.2 s)` |
| Hygiene scan | empty (real-mode MP4s from SESSION_REAL_API still gitignored) |
| Drift guard | `context-kit anchors look recent.` |

## Server state at end of session

**Real mode** (per the new default + the "always confirm both
servers running" memory rule):

```
backend: pid=59211 · http://localhost:8000 · runway_mock=false
vite:    pid=59235 · http://localhost:5173 · http=200
```

The user can hit any Generate / Render / Attach button and
clicks will fire real Runway. The CEO Buzz / Brewster
real-mode demo assets from SESSION_REAL_API are still on
disk and play in the saved gallery whether the backend is
mock or real.

## Limitations / follow-ups

- **The scripts are bash-only.** Windows operators would need
  WSL or a PowerShell port. Out of scope; the project's
  existing `npm run dev` works on Windows but the env
  juggling doesn't.
- **No `start-local-real-mock-openai.sh`.** Real Runway +
  mock OpenAI is the current real-mode default (no OpenAI
  key in `.env`); a dedicated script for the inverse
  configuration isn't needed yet.
- **Scripts background uvicorn / vite via `nohup &`.**
  Killing the parent shell doesn't terminate them — that's
  intentional (operator can close the terminal and the dev
  servers stay alive). `bash scripts/stop-local.sh` is the
  matching teardown.
- **No PID files cleanup on stop.** `start-local-real.sh`
  writes `/tmp/uvicorn-real.pid` / `/tmp/vite-real.pid` for
  potential future use; `stop-local.sh` doesn't read them
  (uses `pkill` by name match instead). Acceptable: the pid
  files self-evict on macOS reboots / `/tmp` cleanups.
- **No CI integration changes.** Existing `.github/workflows`
  / Makefile targets (if any) still work — the smoke command
  is the same `npm run test:e2e`; only the boot command in
  front of it changed.

## Recommended next slice

Resume the redesign track with **PR BK — Cinematic Ad lane
scaffold** (was originally the recommendation after PR BI).
Mirror PR BI's shape:

- New `frontend/src/components/lanes/CinematicLane.jsx` with a
  3-step Brief / Visual Source / Render layout. Visual Source
  step previews the cached image_to_video silent visual;
  Render step has disabled placeholder buttons for the silent
  cut + the Voiced Cinematic Ad mux.
- Mounts in SpokespersonStudio when `activeMode === "cinematic"`.
- Tints the lane chrome fuchsia (matches PR BG's
  `MODE_PILL_CLASSES.Cinematic`).
- Backend untouched. No real API calls.

After PR BK: PR BL DialogueLane, PR BM Session Log, PR BN
Realtime tab slim, PR BO flip default + prune legacy.

The new runtime guard means future testing of any of these
lanes happens in real mode by default — the user can actually
see the generated assets without me re-killing servers into
mock mode.
