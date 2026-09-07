#!/bin/bash
# ============================================================================
# ota.sh — publish the same JS to every live runtime.
# ----------------------------------------------------------------------------
# runtimeVersion uses the appVersion policy, so THE RUNTIME IS THE VERSION
# STRING in app.json. eas update has no --runtime-version flag (checked against
# eas-cli on 2026-09-07), so reaching three runtimes means rewriting app.json
# three times and putting it back.
#
# That rewrite is a trap for anything that stages files while it runs. Twice in
# one day a `git add -A` landed mid-loop and committed version 0.1.8, which
# breaks nothing until the next build and then breaks it silently: a binary
# built from that commit is runtime 0.1.8, and every 0.1.9 update sails past
# it.
#
# So: RUNTIMES is the single source of truth, the first entry is the real
# version, restoration happens in a trap so a crash or a Ctrl-C still puts it
# back, and a lock file exists for the duration. app-version.test.ts reads both
# and fails the whole suite if app.json is wrong or the lock is present.
# ============================================================================
set -u

RUNTIMES=(0.1.10 0.1.9 0.1.8 0.1.7)   # first entry is the true app version
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JSON="$ROOT/mobile/app.json"
LOCK="$ROOT/.ota-running"

restore() {
  sed -i '' "s/\"version\": \"0\.1\.[0-9]*\"/\"version\": \"${RUNTIMES[0]}\"/" "$APP_JSON"
  rm -f "$LOCK"
}
trap restore EXIT INT TERM

MSG="${1:?usage: scripts/ota.sh "<message>"}"
echo "ota in progress — do not stage files" > "$LOCK"
cd "$ROOT/mobile"

for V in "${RUNTIMES[@]}"; do
  sed -i '' "s/\"version\": \"0\.1\.[0-9]*\"/\"version\": \"$V\"/" "$APP_JSON"
  echo "=== runtime $V ==="
  npx eas-cli@latest update --branch production --environment production \
    -m "$MSG" --non-interactive 2>&1 \
    | grep -E "Update group|Runtime|Branch|Platform|Error|error" | head -12
done

restore
trap - EXIT INT TERM
grep -n '"version"' "$APP_JSON"
echo OTA-DONE
