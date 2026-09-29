#!/bin/bash
# Who is holding what. Read-only, costs nothing, run it before you edit.
# See docs/AGENT_CLAIMS.md.
set -u
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Library/Developer/CommandLineTools}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

echo "== branch =="
b=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || { echo "  git unavailable — is DEVELOPER_DIR set?"; exit 1; }
echo "  $b   tip: $(git log --oneline -1 2>/dev/null)"
case "$b" in
  codex/*) echo "  !! This is Codex's branch. Committing here puts your work in their PR." ;;
esac

echo
echo "== uncommitted (this outranks the claims file) =="
if [ -z "$(git status --porcelain)" ]; then
  echo "  clean"
else
  git status --short | sed 's/^/  /'
  echo "  !! Assume these belong to another agent. Do not touch those paths; never 'git add -A'."
fi

echo
echo "== active claims =="
awk '/^## Active claims/{f=1;next} /^## Closed recently/{f=0} f && /^\| /{print "  "$0}' \
  docs/AGENT_CLAIMS.md 2>/dev/null | grep -v '^\s*| *---' || echo "  (none)"

echo
echo "== did the branch move under you? re-run before committing =="
echo "  local  $(git rev-parse --short HEAD 2>/dev/null)"
if git fetch -q origin "$b" 2>/dev/null; then
  r=$(git rev-parse --short "origin/$b" 2>/dev/null)
  echo "  remote ${r:-(none)}"
  [ -n "${r:-}" ] && [ "$r" != "$(git rev-parse --short HEAD)" ] && \
    echo "  !! The remote has moved. Fetch and look before you commit."
else
  echo "  remote (branch not pushed — nothing to collide with yet)"
fi
exit 0
