# Palate — project rules

## Spending policy (applies to ALL agents, including scheduled/background runs)

**Never take any action that costs money without explicit, per-action approval
from the user.** This is a hard rule. When an agent reaches a step that would
incur cost, it must STOP, describe the action and its cost, and wait for the
user to say go.

This includes, but is not limited to:
- Paid API calls (LLM/classifier calls, Google Places, geocoding, email sends)
  beyond what a normal local dev run requires
- Provisioning or scaling any paid cloud resource (Supabase, hosting, etc.)
- Anything that consumes a paid quota or could generate a bill

Free, read-only operations are always fine: `git` status/log/diff, `tsc`,
`jest`, `eas whoami`, `eas build:list`, `eas env:list`, reading files.

When unsure whether something costs money, assume it does and ask first.

## Build / ship policy

**EAS builds and updates are PRE-AUTHORIZED** (2026-08-21). They are covered by
the monthly Expo subscription and the user is explicitly not cost-sensitive
about them: "not worried about build costs on a monthly subscription — do
whatever you need to do to create a good app."

So `eas build`, `eas update`, and `eas submit` may be run without stopping to
ask first. Still:
- Type-check and run tests before building; don't burn a build on a typo.
- Say what the build/update contains and report the result.
- Prefer batching related changes into one build over shipping incrementally —
  that's about review cycles and tester churn, not money.

**This exemption is ONLY for EAS build/update/submit.** Everything else in the
spending policy above still requires explicit per-action approval: paid API
calls (LLM/classifier, Google Places, geocoding, email sends) beyond normal
local dev, and provisioning or scaling any paid cloud resource.

### Runtime version gotcha (learned the hard way, 2026-08-21)

`runtimeVersion` uses the `appVersion` policy, so **the runtime IS the
`version` string in app.json**. Every build through 0.1.0 shared runtime
`0.1.0`, which meant an OTA carrying new JS was delivered to old binaries that
lacked the native code it needed — passive capture failed silently as
`native-module-unavailable` on older installs.

**When a build adds or changes native code, bump `version` in app.json** so it
gets its own runtime and old binaries can't receive its updates.

Do NOT switch to `{"policy": "fingerprint"}` without debugging it first — it
was tried on 2026-08-21 and every build failed in the "Configure expo-updates"
phase within ~84s (build `d0050c72`). The fingerprint itself resolved fine
locally and remotely; the failure is server-side in the configure step and the
log needs an authenticated browser session to read.

## Build numbering note

EAS uses **remote version source** for this project — the `buildNumber` field
in `app.json` is informational only. EAS auto-increments on the server, so
local edits to `buildNumber` are for human readability, not Apple submission.
