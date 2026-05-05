# Palate — project rules

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
