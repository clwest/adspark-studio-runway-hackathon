#!/usr/bin/env bash
#
# start-local-mock.sh — boot Character OS in **mock mode** for
# Playwright smoke runs, CI, and safe dry-runs that should never
# burn Runway / OpenAI credits.
#
# PR BJ (SESSION_041) — explicit counterpart to start-local-real.sh.
# Forces every provider to mock by clearing RUNWAY_API_KEY +
# OPENAI_API_KEY and setting IMAGE_GEN_PROVIDER=mock for this
# process tree only. The on-disk `.env` is untouched.
#
# Usage:
#   bash scripts/start-local-mock.sh
#
# Stop:
#   pkill -f 'uvicorn app.main:app|vite'

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
  echo "✗ not a git repo" >&2
  exit 1
fi
cd "${REPO_ROOT}"

# Kill any prior instances so we don't end up with a real-mode
# backend still serving on port 8000 while the smoke pretends
# everything is mocked.
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

LOG_DIR="/tmp"
UVI_LOG="${LOG_DIR}/uvicorn-mock.log"
VITE_LOG="${LOG_DIR}/vite-mock.log"

# Backend (mock-forced via env).
(
  cd backend
  # shellcheck disable=SC1091
  source .venv/bin/activate
  RUNWAY_API_KEY= OPENAI_API_KEY= IMAGE_GEN_PROVIDER=mock \
    nohup uvicorn app.main:app --port 8000 --log-level warning \
    > "${UVI_LOG}" 2>&1 &
  echo "$!" > /tmp/uvicorn-mock.pid
)

# Frontend.
(
  cd frontend
  nohup npm run dev > "${VITE_LOG}" 2>&1 &
  echo "$!" > /tmp/vite-mock.pid
)

echo
echo "Boot logs:"
echo "  backend → ${UVI_LOG}"
echo "  vite    → ${VITE_LOG}"

sleep 4

echo
echo "─── /health (expect runway_mock=true, image_gen_mock=true) ───"
curl -s http://127.0.0.1:8000/health || echo "(backend not responding yet)"
echo
echo "─── vite ───"
curl -s -o /dev/null -w "vite http=%{http_code}\n" http://localhost:5173/ \
  || echo "(vite not responding yet)"

echo
echo "─── pids ───"
pgrep -lf 'uvicorn app.main:app|vite' || true

cat <<NOTE

✅ Character OS booted (mock mode — NO real API calls will fire).
   Backend:  http://localhost:8000
   Frontend: http://localhost:5173

   Use this mode for:
     - Playwright smoke (cd frontend && npm run test:e2e)
     - CI runs
     - Safe dry-runs of unfinished UI flows

   For real-mode manual testing (default):
     bash scripts/start-local-real.sh
NOTE
