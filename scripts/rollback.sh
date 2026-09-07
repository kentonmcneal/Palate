#!/bin/bash
# ============================================================================
# rollback.sh — undo the last OTA, on every runtime, in one command.
# ----------------------------------------------------------------------------
# An OTA reaches every install within two cold starts. That is this app's
# sharpest operational advantage and its sharpest edge, and at the moment you
# need to undo one you will be reading a crash report, not a README.
#
# So: no arguments, no thinking. `scripts/rollback.sh` republishes the update
# group that was live BEFORE the most recent publish, on each runtime
# separately, because a group id belongs to one runtime and the runtimes are
# published independently.
#
# Restore first, diagnose second. The previous bundle is known to have worked;
# a fix written under pressure is not.
#
#   scripts/rollback.sh --list     what is out there, newest first
#   scripts/rollback.sh            undo the last publish everywhere
#   scripts/rollback.sh --dry-run  print the commands without running them
#
# Note this republishes the previous group, it does not delete the bad one.
# Nothing is destroyed, and rolling forward again is the same command against a
# newer group id.
# ============================================================================
set -u

RUNTIMES=(0.1.10 0.1.9 0.1.8 0.1.7)
BRANCH=production
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mobile" || exit 1

MODE="${1:-undo}"

# One JSON read, reused. Enough rows to hold several publishes per runtime.
LIST_JSON="$(npx eas-cli@latest update:list --branch "$BRANCH" --limit 40 --json --non-interactive 2>/dev/null)"
if [ -z "$LIST_JSON" ]; then
  echo "Could not read the update list. Are you logged in? (npx eas-cli@latest whoami)"
  exit 1
fi

# The parser lives in a temp file rather than inline. `python3 - <<EOF` puts
# the SCRIPT on stdin, which is where the JSON needs to be, and the two collide
# silently — the parse just returns nothing. Written once, removed on exit.
PARSER="$(mktemp -t palate-rollback)"
trap 'rm -f "$PARSER"' EXIT
cat > "$PARSER" <<'PYEOF'
import sys, os, json
rt = os.environ["RT"]
rows = json.load(sys.stdin).get("currentPage", [])
seen = set()
for r in rows:
    if r.get("runtimeVersion") != rt:
        continue
    g = r.get("group")
    if not g or g in seen:
        continue
    seen.add(g)
    # eas renders message as: "the text" (2 hours ago by someone). Keep the
    # quoted half; the attribution is noise when you are rolling back.
    m = (r.get("message") or "").strip()
    if m.startswith('"'):
        rest = m[1:]
        if '"' in rest:
            m = rest[: rest.index('"')]
    print(g + "\t" + m[:64])
PYEOF

groups_for() {   # runtime -> "groupId<TAB>message", newest first, de-duplicated
  printf '%s' "$LIST_JSON" | RT="$1" python3 "$PARSER"
}

if [ "$MODE" = "--list" ]; then
  for V in "${RUNTIMES[@]}"; do
    echo "=== runtime $V ==="
    groups_for "$V" | head -5 | nl -w2 -s'. '
  done
  echo
  echo "Newest is 1. \`scripts/rollback.sh\` republishes 2 on every runtime."
  exit 0
fi

echo "Rolling back $BRANCH to the previous update on each runtime."
FAILED=0
for V in "${RUNTIMES[@]}"; do
  PREV="$(groups_for "$V" | sed -n '2p' | cut -f1)"
  PREV_MSG="$(groups_for "$V" | sed -n '2p' | cut -f2)"
  if [ -z "$PREV" ]; then
    echo "  $V: no previous update to roll back to, skipping"
    continue
  fi
  echo "  $V -> $PREV  ($PREV_MSG)"
  if [ "$MODE" = "--dry-run" ]; then continue; fi
  npx eas-cli@latest update:republish --group "$PREV" \
    -m "Rollback: restoring $PREV_MSG" --non-interactive >/dev/null 2>&1 \
    || { echo "    FAILED on $V"; FAILED=1; }
done

if [ "$MODE" = "--dry-run" ]; then echo "(dry run — nothing published)"; exit 0; fi
[ "$FAILED" = "0" ] && echo "Done. Two cold starts to take effect; tell people to force-quit twice." \
                    || echo "One or more runtimes failed. Re-run, or publish by hand."
