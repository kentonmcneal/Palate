# Offline visit-write account controls

From the repository root, using the project's supported Node runtime and already installed mobile dependencies:

```sh
node --test mobile/scripts/visit-write-account.test.cjs
```

From `mobile/`, use `node --test scripts/visit-write-account.test.cjs`.

This is a **node:test** runner, deliberately outside Jest's `lib/**/__tests__/**/*.test.(ts|tsx|js|jsx)` discovery. No package-script or dependency changes are required. Run this command separately from Jest in any gate that requires these controls.

The runner resolves `mobile/lib` and `mobile/node_modules` relative to its own location, regardless of the shell's working directory. It reads the actual repository `visits.ts`, `account-write.ts`, and `username-gate.ts` on each run; it does not select captured candidate snapshots or accept an alternate source directory. The installed TypeScript transpiler loads those modules into an isolated VM. If production code uses shared analytics, that source is loaded too.

All 75 controls use the installed Supabase/PostgREST request builder and authenticated fetch wrapper with an injected synthetic transport. Auth, restaurant lookup and native side effects are mocked. The production Supabase module and environment files are never imported. A fallback global fetch is blocked. No credentials, sign-in, network, notifications or device are needed. Each test has a five-second timeout so a missing expected asynchronous boundary fails rather than hanging indefinitely.

Coverage includes A→B and A→B→A during auth, restaurant resolution, dedup/count, insert/fallback, decision insertion and feed lookup; explicit Authorization preservation during the SDK's own token await; and ordinary writes, error handling, signed-out state, same-account refresh and private feed suppression. SDK-token controls deliberately depend on the installed transport's behavior; an SDK change that invalidates those pause points requires investigation, not deletion of the assertions.

These are source/transport regression controls, not device or production RLS evidence. An already-started request can finish under the initiating account. Ownerless old data first submitted while the replacement account is active remains outside this guard; one explicit control documents that limit. Caller work before entering saveVisit or recordPromptDecision is not covered by their invocation token.

Read-failure coverage rejects dedup and count query errors (including aborted fetches),
missing/unknown counts and invalid SDK count values without inserting or issuing rewards.
Both existing-visit and new-visit branches recover on a later successful read. A verified
zero count still permits a real first-visit reward. Account-generation checks take precedence
over stale failed-read results. This does not make dedup/count/insert transactional; concurrent
successful callers or a lost insert response still require separate concurrency/idempotency work.
