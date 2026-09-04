---
name: ship
description: Release Palate — decide OTA vs build, bump the version when native code changed, ship, and verify. Use whenever changes are ready to reach a device.
---

# Shipping Palate

Every rule here exists because skipping it broke something real.

## 1. Never ship red

```bash
cd mobile && npx tsc --noEmit && npm test
```

Both clean, or stop. A failing test has never once been "unrelated".

## 2. Decide OTA vs build from the DIFF, not from memory

Find the commit the current TestFlight build came from:

```bash
cd mobile && npx eas-cli build:list --limit 1 --platform ios --json --non-interactive
```

Then ask what has changed since it:

```bash
git diff --name-only <that-commit>..HEAD -- mobile/modules/ mobile/app.json
```

- **Empty** → JS only → `eas update` reaches the existing binary.
- **Anything listed** → native or Info.plist changed → you need a **build**.

Do not reason about whether a change "feels native". Run the diff.

## 3. Bump `version` whenever that diff is non-empty

`runtimeVersion` uses the **appVersion** policy, so the runtime IS the
`version` string in `app.json`. Every build through 0.1.0 shared runtime
`0.1.0`, which meant OTAs landed on binaries missing the native code they
needed — passive capture failed silently as `native-module-unavailable`
for weeks.

The same trap caught the Gmail OAuth fix: `Info.plist` gained a URL scheme,
but two OTAs were shipped instead of a build, so the callback still could
not route. **An OTA cannot change native config.**

Do NOT switch to `{"policy": "fingerprint"}` — tried 2026-08-21, every
build failed the "Configure expo-updates" phase in ~84s (build `d0050c72`).

## 4. Ship

OTA (JS only):
```bash
cd mobile && npx eas-cli update --branch production --message "<what>" --environment production --non-interactive
```

Build (native changed):
```bash
cd mobile && npx eas-cli build --platform ios --profile production --auto-submit --non-interactive
```

Both are pre-authorized. Run long ones in the background.

Edge functions and migrations are separate — a classifier change reaches
nobody until `places-proxy` is deployed:
```bash
npx supabase functions deploy places-proxy
npx supabase functions deploy gmail-import --no-verify-jwt
npx supabase db push
```

## 5. Verify against the artifact

Check the **runtime version** in the update output matches a binary that
exists. An OTA to a runtime nobody has installed reaches nobody and reports
success.

For anything data-shaped, query the live system rather than trusting the
migration ledger. Example that mattered: PostgREST's cached schema claimed a
column was absent while queries against it succeeded.

## 6. Report honestly

Say what shipped, what it reaches, and what remains unverified. "Deployed"
is not "working" — one confirmed-by-evidence commit is worth more than
twelve shipped ones.
