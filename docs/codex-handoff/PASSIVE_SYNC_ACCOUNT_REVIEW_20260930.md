# Independent review: initiating-account passive sync

**APPROVED unchanged for the bounded initiating-account contract. WORKING TREE / synthetic offline evidence.** No additive production correction is required. Approval applies to the exact hashes in HASHES.json, not global passive-data account isolation.

## Review findings

The operation captures the existing account-generation token before its first await. Both authenticated identity lookup and session lookup are checked against that generation; A→B→A does not restore validity. Each personal PostgREST request pins both the initiating user_id and explicit Authorization header. The installed SDK still performs its asynchronous access-token lookup, but preserves an already supplied Authorization header. This is a public request-builder interface, not a private SDK lock assumption.

A failed or stale upsert cannot authorize prune. Empty-inbox deletion and prune are independently pinned. Mirror remains best-effort void; failures are not acknowledged as durable success. Hydration discards stale/error responses. Restore carries its original token through both serialized reads and the commit queue, retains the existing revision/emptiness checks, and checks after storage awaits. Expiry pruning within the guarded restore read cannot launch a replacement-account mirror after invalidation. Existing ordinary reads/mutations remain outside that added initiating-token guard.

The three changed Jest fixtures establish an initiating account and adjust hydrate-call assertions for the new explicit token argument. Existing storage/concurrency assertions are retained. I did not independently rerun the author's 316-test Jest regression or focused typecheck; those remain author evidence.

## Independently executed evidence

- **11/11 additional controls pass**, zero skipped/cancelled, running actual TypeScript source and installed Supabase JS 2.110.7 transport with synthetic auth/storage and a throwing global network fetch. The harness scaffolding is adapted from the author harness; the scenarios/assertions are independently added.
- **47/47 author controls reproduced**, zero skipped/cancelled. Covers credential awaits, response boundaries, all request families including prune, same-account refresh, invalid credentials, and queued restore commit.
- **No-header mutant: 4 failures / 47**, observing replacement `Bearer token-B` instead of initiating `Bearer token-A` at actual SDK transport.
- **No-restore-guard mutant: 3 failures / 11**, exposing expired-entry pruning and subsequent effects after account invalidation. Mutants are scratch copies; production files are untouched.
- Read-only current repository `git apply --check` passes. Applying the complete patch to a scratch overlay produces both production files byte-identical to the tested snapshots. Exact base/candidate and patch SHA-256 values are in HASHES.json.

Additional controls cover restore queued behind an earlier read, expired rows when the account changes during read (B and ABA), already-issued expiry writes, aborted upsert replies, ordinary hydration errors, explicit stale caller tokens, successful retry after mirror failure, a local insertion during remote hydration, and ABA at the SDK token await for both mirror and hydrate. Logs: INDEPENDENT.log, AUTHOR.log, NO_HEADER.log, NO_GUARD.log.

## Limits preserved

1. Ownerless capture/global inbox data is not assigned a trustworthy origin. A fresh invocation under B can still receive old A data. Queued ordinary mutations that invoke mirror later capture that later account.
2. An A request already dispatched may commit after transition; pinning is not cancellation. Same-account token refresh does not replace the captured bearer.
3. An already-issued AsyncStorage write can finish after transition against the shared global key. An explicit independent control confirms this permitted residual effect; the stale restore returns zero and suppresses later mirror/telemetry/scheduling initiation where guarded. This is not rollback or owner-scoped storage.
4. Scheduling or analytics already initiated may continue after transition. No native delivery or downstream account isolation is claimed.
5. Mirror order, concurrent devices, legacy provenance, durable removal tombstones and later fresh restores remain unresolved. Returning zero is not a persistence acknowledgement.
6. No live auth, RLS, backend, device or notification calls were made. Installed SDK transport is real; auth responses, storage and side effects are synthetic. No repository edits, installations or permissions were requested.

## Reproduction

From the workspace, run `/opt/homebrew/bin/node --test outputs/passive-sync-account-independent/independent.test.cjs`. Set PALATE_MOBILE to an existing mobile dependency installation if needed; SOURCE_ROOT optionally selects the copied five-file source directory. The default points at this author's packet and existing local dependency installation. These independent artifacts are review tools, not a proposed portable repository test installation. The author's patch separately includes the repository-relative durable runner.
