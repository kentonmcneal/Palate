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

## Evidence labels (required for any claim that something works)

Every statement about whether something works carries one of these:

- `COMMITTED` — verified in the current git commit
- `WORKING TREE` — present locally, not committed
- `LIVE` — verified against the deployed system **by invoking it**
- `DEVICE` — verified on a physical iPhone
- `INFERENCE` — not verified; name the artifact that would settle it

**A conclusion without a label is incomplete.** GitHub, the working tree, EAS,
the installed phone and live Supabase are five separate states. Compare them
explicitly rather than assuming they agree.

This exists because reading the source has repeatedly produced confident,
wrong answers here:

- `get_friend_profile_snapshot` raised 42702 on its first statement from
  migration 0008 to 0075. Every profile screen rendered "Profile not found" for
  65 migrations. The source looked correct and every push was green.
- `palate_overlap_rank` was revoked from `public` and `authenticated`, was
  documented as locked, and still answered the anon key with 200 — Supabase
  grants execute to `anon` by name, and PUBLIC is a separate grantee.
  `browse_profiles` then failed the same test in the opposite direction.
- The feed embedded `profiles!feed_events_user_id_fkey`, but that FK targets
  `auth.users`. PostgREST returned 400 on every request for the feature's
  entire existence; the client swallowed it into a `console.warn`.
- A bare `ios` line in `.gitignore` matched `modules/palate-visit-monitor/ios`
  at any depth, so no build EAS ever produced contained the native detector.

### How to actually verify, by layer

1. **plpgsql parses `return query` only at runtime.** A clean `supabase db push`
   proves nothing. Invoke the function over PostgREST and read the status code.
   When RLS blocks the interesting branch, impersonate inside a `do $$` block:
   `perform set_config('request.jwt.claims', json_build_object('sub', <uuid>)::text, true);`
   then call it. `supabase/tests/smoke.sql` does this in CI.
2. **Grants: revoke from `public` AND `anon` AND `authenticated` by name**, then
   prove denial with a call returning 401/42501. Revoking one grantee tells you
   nothing about the others.
3. **A PostgREST embed needs a real foreign key to the embedded table.** Test the
   literal query string with curl.
4. **A manual authenticated request does not verify a cron job.** Reproduce the
   cron-shaped request, headers included, and inspect the scheduled run.
5. **A successful `functions deploy` does not mean the function boots.** Call it;
   an unauthenticated call returning the function's own 401 proves the module
   loaded without spending anything.
6. **Classifier edits never touch rows already in `restaurants`.** Behaviour for
   existing places changes only when reclassify runs.
7. **A green landing-site build is not evidence the mobile app works.** CI builds
   both; read which job passed.
