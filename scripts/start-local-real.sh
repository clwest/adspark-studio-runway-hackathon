#!/usr/bin/env bash
#
# start-local-real.sh — boot AdSpark Studio for **real-mode manual
# testing**. PR BJ (SESSION_041) — this is the canonical entry
# point for in-browser testing because it lets the operator
# actually exercise Runway-backed flows (avatar_videos,
# image_to_video, /v1/voices, /v1/documents, realtime).
#
# Sources `.env` from the repo root WITHOUT clobbering any of
# the keys, then starts uvicorn (port 8000) + vite (port 5173)
# in the background and tails just enough output to confirm
# both processes are alive. Health probe at the end prints the
# runway_mock / image_gen_mock flags so the operator can see
# at a glance which mode each provider resolved to.
#
# **DO NOT** force IMAGE_GEN_PROVIDER=mock or null out
# RUNWAY_API_KEY here. Mock mode lives in start-local-mock.sh
# for CI / smoke / explicit dry-runs.
#
# Usage:
#   bash scripts/start-local-real.sh
#
# Stop:
#   bash scripts/stop-local.sh           (or pkill -f 'uvicorn app.main:app|vite')

set -eu

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
  echo "✗ not a git repo" >&2
  exit 1
fi
cd "${REPO_ROOT}"

if [ ! -f .env ]; then
  echo "✗ no .env at repo root — copy backend/.env.example to .env first" >&2
  exit 1
fi

# Kill any prior instances so we don't accidentally end up with
# two backends fighting over port 8000 (or, worse, an old mock
# backend masking a real-mode start).
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# Source .env so RUNWAY_API_KEY / OPENAI_API_KEY land in the
# shell that backgrounds uvicorn. `set -a` exports every
# assignment until `set +a`.
set -a
# shellcheck disable=SC1091
source .env
set +a

# Sanity surface (don't print key values). Pin defaults so
# `set -u` doesn't trip on a missing OPENAI_API_KEY (legitimate
# in this repo — concept generation falls back to mock).
RUNWAY_API_KEY="${RUNWAY_API_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
IMAGE_GEN_PROVIDER="${IMAGE_GEN_PROVIDER:-}"
echo "RUNWAY_API_KEY length: ${#RUNWAY_API_KEY}"
echo "OPENAI_API_KEY length: ${#OPENAI_API_KEY}"
echo "IMAGE_GEN_PROVIDER:    ${IMAGE_GEN_PROVIDER:-<unset>}"

if [ -z "${RUNWAY_API_KEY:-}" ]; then
  echo
  echo "⚠️  RUNWAY_API_KEY is empty — backend will boot in mock mode." >&2
  echo "    If this is intentional, prefer scripts/start-local-mock.sh." >&2
  echo "    Otherwise check your .env." >&2
fi

LOG_DIR="/tmp"
UVI_LOG="${LOG_DIR}/uvicorn-real.log"
VITE_LOG="${LOG_DIR}/vite-real.log"

# Backend.
(
  cd backend
  # shellcheck disable=SC1091
  source .venv/bin/activate
  nohup uvicorn app.main:app --port 8000 \
    > "${UVI_LOG}" 2>&1 &
  echo "$!" > /tmp/uvicorn-real.pid
)

# Frontend.
(
  cd frontend
  nohup npm run dev > "${VITE_LOG}" 2>&1 &
  echo "$!" > /tmp/vite-real.pid
)

echo
echo "Boot logs:"
echo "  backend → ${UVI_LOG}"
echo "  vite    → ${VITE_LOG}"

# Give both a moment to come up.
sleep 4

echo
echo "─── /health ───"
curl -s http://127.0.0.1:8000/health || echo "(backend not responding yet)"
echo
echo "─── vite ───"
curl -s -o /dev/null -w "vite http=%{http_code}\n" http://localhost:5173/ \
  || echo "(vite not responding yet)"

echo
echo "─── pids ───"
pgrep -lf 'uvicorn app.main:app|vite' || true

cat <<NOTE

✅ AdSpark Studio booted (real-mode default).
   Backend:  http://localhost:8000
   Frontend: http://localhost:5173

   Health JSON above shows runway_mock / image_gen_mock per provider.
   When RUNWAY_API_KEY is set, runway_mock=false and clicks burn credits.

   For mock-mode (CI / smoke / safe dry-run):
     bash scripts/start-local-mock.sh
NOTE
