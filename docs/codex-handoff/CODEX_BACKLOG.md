# Active window: September 29–30, 2026

Deadline: 2026-09-30 16:01:54 UTC (11:01:54 a.m. Central). No production deployment or paid services.

## In progress
- SQL privacy fixes with synthetic local PGlite execution; full deployed schema remains unverified.
- Follows-list ownership and asynchronous mutation reliability.

## Completed before this window
- Nearby request coalescing, malformed-cache and budget config checks.
- Error-reporting failure containment and honest admin status.
- Feed/profile copy corrections; malformed-location ranking protection.

## Next
- Device review of owner profile redesign; broader people-search reliability and profile layout.
- Expand recommendation relevance evidence beyond current synthetic invariants.
- Broader typo pass.

## Unverified / blocked
- Local Postgres concurrency execution: no psql/Docker/Postgres available in PATH. Existing SQL atomic increment reviewed in source, not executed here.
- Real iPhone rendering and crashes: Xcode license blocker.
- Production Sentry delivery and deployed database/functions.
- Four SKU price estimates require billing verification.

## Rollback
Revert individual Codex commits; baseline tag codex-baseline-20260928 is retained. Never reset unrelated work.

## Completed in this window
- 5f1a5a2: conservative pre-fetch Google reservations, failure/concurrency mocks and independent source review. Live accounting remains unverified.
- f4729fc: recommendation cache invalidates on real profile/restaurant changes.
- Social mutation batch: independent race review, per-row like guards and comment-session/mutation reconciliation; 137 suites pass, device verification pending.

- 91a9374: three missing-evidence ranking corrections;49 synthetic evaluations.
- 708ec6f: edge authorization fixes;26 offline handler cases. SQL defects remain pending.
- Own profile connections/navigation and privacy wording:139 suites /1,240 tests passed; device review pending.
