# Independent review: final root / username / profile write boundary

**WORKING TREE / OFFLINE EXECUTION.** Reviewed the current uncommitted `_layout.tsx`, `claim-username.tsx`, `onboarding/profile-setup.tsx`, `lib/username-gate.ts`, `lib/profile.ts`, and focused tests. No repository edits, permission requests, live authentication, database mutations, or paid operations.

## Verdict

**The original wrong-account deferred-getUser defect is fixed for setUsername and setDisplayName. No new actionable regression found in these scoped changes.**

Both helpers capture a token before their internal await (explicitly supplied by the save screen or via the default parameter), check token identity and resolved user ID after getUser, and filter updates by the captured accountId. A save started under A cannot retarget B when the deferred auth result returns B. An A→B→A transition replaces the token object and also prevents submission. Same-ID auth refresh preserves the token and permits normal saves.

The claim/onboarding callers retain completion-side checks before marking or navigating, and suppress obsolete-session errors/finalizers. Onboarding passes the original token through its later optional display-name write. These guards complement the helper's pre-submission checks; neither replaces the other.

Root success restore and auth callbacks establish the gate account before rendering new session state. Late restores and callbacks after root unmount are rejected. Account-ID Stack keying destroys screen state on committed account replacement/sign-out and preserves drafts on same-ID refresh. The username gate preserves subscriptions while clearing claimed state for a new account; no production test-reset calls are involved.

## Execution evidence

**19/19 existing focused Jest cases pass:**

- root-account-boundary.test.tsx: 4 mounted actual-root VM tests, with real username-gate module and mocked native/router/auth services.
- username-gate.test.ts: 7 gate tests.
- profile-write-account.test.ts: 8 deferred-auth write tests.

**20/20 additional independent cases pass** in `independent-proof.cjs`. It executes the actual current transpiled profile.ts and username-gate.ts with only the Supabase boundary mocked. For each helper and both explicit/default tokens it checks:

1. A→B before auth resolution: zero update submissions.
2. A→B→A before auth resolution: zero update submissions.
3. Token still A but getUser returns B: zero update submissions.
4. Same-ID refresh: exactly one update pinned to A.
5. Switch after submission: existing update remains pinned to A and old completion cannot mark B's gate.

`jest.log`, `independent.log`, and `results.json` preserve results. The JSON includes SHA-256 hashes for the helper/gate source executed.

## Limits

This verifies local source behavior with mocked auth/transport, not live Supabase/PostgREST or native navigation. Already-submitted mutations cannot be recalled; pinning prevents them being redirected to B, and live RLS remains the enforcement boundary if credentials change in transit. The screen guards reject their stale completion effects.

The scope is username/display-name saves and root/gate state. It is not a claim that every other profile writer, avatar flow, background operation, or module cache is account-scoped. No unrelated changes are proposed.

## Reproduce

```sh
/opt/homebrew/bin/node outputs/palate-write-boundary-final/independent-proof.cjs
/opt/homebrew/bin/node '/Users/kentonmcneal/Claude Code/Palate/mobile/node_modules/jest/bin/jest.js' --config "$PWD/outputs/palate-write-boundary-final/jest.config.json" --runInBand --watchman=false --runTestsByPath '/Users/kentonmcneal/Claude Code/Palate/mobile/lib/__tests__/root-account-boundary.test.tsx' '/Users/kentonmcneal/Claude Code/Palate/mobile/lib/__tests__/username-gate.test.ts' '/Users/kentonmcneal/Claude Code/Palate/mobile/lib/__tests__/profile-write-account.test.ts'
```
