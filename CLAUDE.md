# Palate — project rules

## Spending policy (applies to ALL agents, including scheduled/background runs)

**Never take any action that costs money without explicit, per-action approval
from the user.** This is a hard rule. When an agent reaches a step that would
incur cost, it must STOP, describe the action and its cost, and wait for the
user to say go.

This includes, but is not limited to:
- `eas build`, `eas update`, and any other paid Expo command
- Paid API calls (LLM/classifier calls, Google Places, geocoding, email sends)
  beyond what a normal local dev run requires
- Provisioning or scaling any paid cloud resource (Supabase, hosting, etc.)
- Anything that consumes a paid quota or could generate a bill

Free, read-only operations are always fine: `git` status/log/diff, `tsc`,
`jest`, `eas whoami`, `eas build:list`, `eas env:list`, reading files.

When unsure whether something costs money, assume it does and ask first.

## Build / ship policy

**Never run `eas build` (or any EAS command that triggers a build) without an
explicit "build N", "ship", or "run the build" instruction from the user.**

EAS builds cost real money on the user's paid plan once the monthly included
quota is exceeded. The user wants to batch multiple changes into a single
build instead of shipping incrementally.

When code changes are ready:
- Make the edits
- Type-check
- Bump `mobile/app.json` `buildNumber`
- **Stop and report.** Wait for the user to explicitly say "build" before
  invoking `eas build`.

This applies to `eas build`, `eas update`, and any other paid Expo command.
Free reads (`eas whoami`, `eas build:list`, `eas env:list`) are fine.

## Build numbering note

EAS uses **remote version source** for this project — the `buildNumber` field
in `app.json` is informational only. EAS auto-increments on the server, so
local edits to `buildNumber` are for human readability, not Apple submission.
