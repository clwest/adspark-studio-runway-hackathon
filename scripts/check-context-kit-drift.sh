#!/usr/bin/env bash
#
# context-kit drift bandage — quick warn-only check.
#
# Counts commits + tags landed since the most recent edit to any
# context-kit anchor doc:
#   - 00-START-NEXT-SESSION.md
#   - docs/WHAT_IT_IS.md
#   - docs/INVENTORY.md
#   - docs/handoffs/*
#
# Threshold (default 5) is configurable via env CONTEXT_KIT_DRIFT_LIMIT.
# Always exits 0 — this is a warning, not a CI gate. If you want it to
# hard-fail before a tag/push, wrap it in a Makefile target or a
# Claude Code hook (see CLAUDE.md).
#
# Usage:
#   bash scripts/check-context-kit-drift.sh
#   CONTEXT_KIT_DRIFT_LIMIT=3 bash scripts/check-context-kit-drift.sh

set -u

# Resolve repo root + cd there so the script works from any cwd.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${REPO_ROOT}" ]; then
  echo "context-kit drift check: not a git repo (cwd=$(pwd))" >&2
  exit 0
fi
cd "${REPO_ROOT}"

LIMIT="${CONTEXT_KIT_DRIFT_LIMIT:-5}"

# Anchor paths. ``docs/handoffs`` is a directory, so we feed it as a
# pathspec — git log -- ``path/`` returns the most recent commit that
# touched anything under it.
ANCHORS=(
  "00-START-NEXT-SESSION.md"
  "docs/WHAT_IT_IS.md"
  "docs/INVENTORY.md"
  "docs/handoffs"
)

# Find the most recent commit timestamp across all anchors.
LATEST_TS=0
LATEST_REF=""
for ANCHOR in "${ANCHORS[@]}"; do
  if [ ! -e "${ANCHOR}" ]; then
    continue
  fi
  TS=$(git log -1 --format=%ct -- "${ANCHOR}" 2>/dev/null || echo 0)
  if [ -n "${TS}" ] && [ "${TS}" -gt "${LATEST_TS}" ]; then
    LATEST_TS="${TS}"
    LATEST_REF="${ANCHOR}"
  fi
done

if [ "${LATEST_TS}" -eq 0 ]; then
  echo "context-kit drift check: no anchor docs found (looked for ${ANCHORS[*]})"
  exit 0
fi

# Commits on HEAD since that timestamp (exclusive — `--since` is
# strict-greater-than). Subtract 1 from the ref count to exclude the
# anchor commit itself when it sits on HEAD's history.
COMMITS_SINCE=$(git rev-list --count --since="@${LATEST_TS}" HEAD 2>/dev/null || echo 0)

# Tag count since that timestamp. Each tag's creator-date is checked;
# count tags whose creatordate > LATEST_TS. Skip if no tags at all.
TAGS_SINCE=0
if git tag --list | grep -q .; then
  TAGS_SINCE=$(
    git for-each-ref --format='%(creatordate:unix) %(refname:short)' refs/tags \
      | awk -v ts="${LATEST_TS}" '$1 > ts {n++} END {print n+0}'
  )
fi

LATEST_HUMAN="$(git log -1 --format='%h %s' -- "${LATEST_REF}" 2>/dev/null || echo "(unknown)")"
LATEST_DATE="$(git log -1 --format='%cd' --date=short -- "${LATEST_REF}" 2>/dev/null || echo "?")"

echo "context-kit anchors last touched ${LATEST_DATE} via ${LATEST_REF}"
echo "  └─ ${LATEST_HUMAN}"
echo "commits on HEAD since:    ${COMMITS_SINCE}"
echo "tags created since:       ${TAGS_SINCE}"
echo "drift threshold:          ${LIMIT}"

if [ "${COMMITS_SINCE}" -gt "${LIMIT}" ]; then
  cat <<EOF

⚠️  context-kit drift: ${COMMITS_SINCE} commits since anchors were refreshed.
   Consider a docs refresh before pushing/tagging.
   Anchors: 00-START-NEXT-SESSION.md / docs/WHAT_IT_IS.md /
            docs/INVENTORY.md / docs/handoffs/SESSION_NNN_*.md
EOF
  exit 0
fi

echo
echo "✅ context-kit anchors look recent."
exit 0
