# Active window: September 29–30, 2026

Deadline: 2026-09-30 16:01:54 UTC (11:01:54 a.m. Central). No production deployment or paid services.

## In progress
- Security review of server readers and client privacy handling.

## Completed before this window
- Nearby request coalescing, malformed-cache and budget config checks.
- Error-reporting failure containment and honest admin status.
- Feed/profile copy corrections; malformed-location ranking protection.

## Next
- Independent social/feed/profile UI pass with reversible local changes.
- Recommendation evaluations across sparse histories and dense-city fixtures; prioritize measured defects over arbitrary reweighting.
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
