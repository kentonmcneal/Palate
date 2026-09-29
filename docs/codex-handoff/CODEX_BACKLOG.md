# Active window: September 29–30, 2026

Deadline: 2026-09-30 16:01:54 UTC (11:01:54 a.m. Central). No production deployment or paid services.

## In progress
- Independent review fixes for profile/follows request ownership; account transition boundary.
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
- Multi-session Postgres concurrency remains unverified. Local PGlite privacy execution now passes57 cases; this single embedded engine does not establish concurrent server behavior.
- Real iPhone rendering and crashes: Xcode license blocker.
- Production Sentry delivery and deployed database/functions.
- Current masks/rates verified against public Google tables; account invoices, deployed caller adoption and mixed-cap rollout remain unverified.

## Rollback
Revert individual Codex commits; baseline tag codex-baseline-20260928 is retained. Never reset unrelated work.

## Completed in this window
- 5f1a5a2: conservative pre-fetch Google reservations, failure/concurrency mocks and independent source review. Live accounting remains unverified.
- f4729fc: recommendation cache invalidates on real profile/restaurant changes.
- Social mutation batch: independent race review, per-row like guards and comment-session/mutation reconciliation; 137 suites pass, device verification pending.

- 91a9374: three missing-evidence ranking corrections;49 synthetic evaluations.
- 708ec6f: edge authorization fixes;26 offline handler cases. SQL defects remain pending.
- Own profile connections/navigation and privacy wording:139 suites /1,240 tests passed; device review pending.

- SQL privacy migration0183 and durable fixture:57 local PostgreSQL cases pass; no deployment or full-chain proof.

- Field-mask pricing corrections:18 focused mocks/contracts,41 actual local SQL/helper cases; full141 suites /1,266 tests pass.

- Search block enforcement0184:20 local SQL cases pass. People UI safeguards are separate, still under independent review.

- Completed locally: connection route ownership, mutation reconciliation, profile target-race isolation;38 mounted cases pass. Native/device verification outstanding.
