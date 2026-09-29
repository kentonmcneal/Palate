# Independent Google budget-policy review — 2026-09-29

## Disposition

**WORKING TREE / offline SQL execution:** No blocking correctness or permission defect found in the candidate. No SQL fixes proposed. Retain the unnumbered reviewed draft until migration tooling and the remaining target-environment checks are available. This is not evidence of deployed behavior or authorization to enable a paid cap.

Reviewed `../palate-budget-policy/google-budget-policy.sql`, its full 21-case runner/report, the original 0033/0179 migrations, and the actual helper exercised by the runner. Candidate SHA-256: `20479a081e0cc6918ce0d1a9b7acee2332c48f74a5f54b982b7e4f3d09961da1`. All five recorded repository source hashes match current source (see SOURCE_COMPARISON.json). No repository files changed. The unrelated observability changes remained present.

## Independently reproduced evidence

**WORKING TREE:** Candidate runner: **21/21 pass**, plus its disabled-default and unchanged-body checks. Original reservation runner: **41/41 pass**, including documented limitations of the old implementation. New independent SQL runner: **11/11 groups pass**. These are three separate suites, not 73 tests of the new policy: the 41-case suite exercises the original implementation without the new guard. All run locally on PostgreSQL 18.3 / PGlite 0.5.8. All helper transports are in-memory mocks; no live HTTP, credentials, paid requests, or deployed policy changes.

The additional runner proves:

1. Rename retains original function OID, byte-for-byte body, owner, argument signature/names, search path, and SECURITY DEFINER mode.
2. Initial cap zero rejects even exact-zero reservations without creating a counter row.
3. Under explicit default table/function grants to anon, authenticated, and service_role, all policy table privileges (including TRUNCATE, REFERENCES, TRIGGER and MAINTAIN) and internal function EXECUTE are absent after migration.
4. Actual calls fail for anon, authenticated, and an unrelated role relying on PUBLIC; service_role can invoke the guarded public function.
5. Missing policy row fails closed without changing counters.
6. Null day, null cost, and negative cost reject with 22023.
7. Null, smaller, and larger caller caps reject with 42501 without changing counters.
8. Temporary objects named after the policy and counter cannot shadow the fully qualified protected objects.
9. An explicit transaction retains the policy relation's RowShareLock; rollback releases it and rolls back the reservation. This does **not** prove tuple-lock contention between sessions.
10. The maximum permitted policy value and maximum integer reservation execute without overflowing the preserved threshold calculation.
11. Accidental duplicate application errors transactionally; rollback leaves the guard intact.

## Security and compatibility assessment

**WORKING TREE:** The database owns the active cap, starts disabled, and requires exact caller agreement. Lower or higher environment values cannot silently become alternate authoritative caps. Missing policy, null caller cap, and mismatches all fail before the reservation function is invoked. No destructive counter reset or change to the original warning/trip algorithm is introduced.

**WORKING TREE:** Explicit named-role revocations address Supabase's default-grant pitfall. RLS is enabled with no policy; service_role's BYPASSRLS does not substitute for revoked table privileges. The SECURITY DEFINER wrapper has a fixed search_path and its table/function references are schema-qualified. The internal routine remains callable by the trusted migration owner, which is required for delegation. Standard callers cannot reach it directly. The SQL is not a security boundary against a database owner, superuser, or arbitrary privileged membership/default grants outside the tested Supabase roles.

**INFERENCE, grounded in PostgreSQL locking rules:** FOR SHARE is the appropriate row lock: it conflicts with normal cap UPDATE/DELETE while permitting parallel readers. FOR KEY SHARE would be insufficient for a non-key cap update. The guard obtains the policy lock before entering the preserved counter lock. Locks last until transaction end, not until completion of the later HTTP call. A cap change cannot revoke an admission that already committed. Operators should use the same policy-before-counter lock order if changing both in one transaction. See [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html).

**WORKING TREE:** This remains a guard for the current reservation entry point, not a universal control for every possible Google request. The old bump_google_usage RPC and direct HTTP paths are outside its authority; current paid paths must continue using the reviewed helper. Conservative reservations can exceed the cap in the counter while the helper denies the subsequent paid fetch. The guard does not turn the ledger into a hard-capped spend field. Existing warned/tripped flags are preserved, including the day's existing trip latch.

**INFERENCE / integration condition:** Target database ownership, custom role memberships/ACLs, pre-existing OID-bound callers of the renamed routine, and PostgREST schema-cache refresh are not established by this fixture. The rename deliberately preserves the old OID; database routines already bound to that OID should be inventoried before integration. Matching source hashes do not establish absence of deployment drift.

## Remaining validation before calling this integrated

- Apply with the normal trusted migration owner in a disposable representative local database. Verify owner/ACLs and actual PostgREST execution contracts there; no paid endpoint calls are required.
- Use two real database sessions to verify policy-update contention: hold a successful guard call in transaction A, attempt a cap UPDATE in transaction B with a short lock_timeout and expect a timeout; roll back A, then verify B can update. In the reverse order, a caller waiting behind a changed cap must reject its old cap once the update commits. Confirm missing-row/disabled cases and rollback leave no newly charged reservation. PGlite's single backend cannot establish these interleavings.
- Keep the operator policy at zero during integration. Any later cap enablement requires separately authorized operational work and aligned deployed callers.

These are boundaries of this review, not findings requiring speculative SQL changes.

## CLI result

**WORKING TREE:** Found another installed official executable at `/opt/homebrew/Cellar/supabase/2.117.0/libexec/lib/node_modules/supabase/node_modules/@supabase/cli-darwin-arm64/bin/supabase-go`. Its help succeeds offline and reports 2.117.0. However, `migration --help` returns `unknown command "migration" for "supabase"`. It does **not** provide an alternate migration-creation path. The normal CLI's telemetry-write blocker was already reported by main; this review did not retry it, change HOME, request access, or manufacture a migration version. CLI transcripts are attached. Retain the reviewed SQL draft.

## Reproduction

From the workspace root, using the already installed embedded database:

```sh
/opt/homebrew/bin/node outputs/palate-budget-policy-independent/independent.test.cjs "$PWD/work/pglite/node_modules/@electric-sql/pglite"
/opt/homebrew/bin/node outputs/palate-budget-policy/budget-policy.test.cjs "$PWD/work/pglite/node_modules/@electric-sql/pglite"
/opt/homebrew/bin/node outputs/palate-budget-policy/source/scripts/security-sql/budget-sql.test.cjs "$PWD/work/pglite/node_modules/@electric-sql/pglite"
```

The new runner uses the sibling candidate SQL and source fixtures; preserve that layout. Logs: INDEPENDENT_RESULTS.log, CANDIDATE_RESULTS.log, BASELINE_RESULTS.log. No dependency installation is needed in this workspace.
