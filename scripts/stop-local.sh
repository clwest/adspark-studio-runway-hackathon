#!/usr/bin/env bash
#
# stop-local.sh — kill backend (uvicorn) + frontend (vite) for
# Character OS. PR BJ (SESSION_041).
#
# Usage:
#   bash scripts/stop-local.sh

set -u

pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

REMAINING="$(pgrep -lf 'uvicorn app.main:app|vite' || true)"
if [ -n "${REMAINING}" ]; then
  echo "⚠️  some processes still alive:"
  echo "${REMAINING}"
  exit 1
fi
echo "✅ servers stopped."
