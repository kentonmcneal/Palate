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
- **PostgREST returns 504 to the push-drain cron, and nobody has explained it.** On 2026-09-14
  the drain ran 69 times in six hours and succeeded 21: 27 runs reported `server_push disabled`
  while the flag was `enabled = true`, and 21 returned `{"error":"[object Object]"}`. Both lied
  in the direction of looking fine. Once it could report, the message was `Gateway Timeout` on
  the first read of the run. NOT the database — 15/60 connections, no slow queries,
  `statement_timeout` 2 min, `push_outbox` 45 rows — so it is upstream of Postgres. Retries
  (`_shared/retry.ts`) mitigate it; nothing explains it. Full write-up: `CODEX_HANDOFF.md` §5.4
  K1/K2, open question S8.
- **That 504 rate is currently unmeasurable, not zero.** 72 of 72 drain runs were clean in the
  retained `net._http_response` window on 09-29, but `retryRead` absorbs up to three failures
  silently and `send-push` discards the attempt count it already returns, so a run that
  succeeded on attempt 2 is indistinguishable from one that never failed. Surfacing `attempts`
  in the response settles it from one day of `net._http_response`. Cheap; do this before
  claiming the drain is healthy.
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

- Completed locally: People account/request ownership, strict block filtering and mutation recovery;43 mounted cases pass. Realtime block updates/native verification remain unverified.

- Completed locally: account-scoped root/username gate and username/display-name writes;19 focused plus20 independent cases pass. Other profile writers remain an audit item.

- Reviewed draft: database-owned Google cap closes mixed-worker policy gap in21+11 local cases. Migration-file integration blocked by CLI telemetry write; SQL remains outside active migrations, defaultzero. Live/multisession checks outstanding.

- Completed locally: reviewed JS error-envelope privacy boundary,59 focused tests. Native crash coverage intentionally disabled; historical/native-independent queues unverified.
- In progress: Metro runtime debug-ID generation and offline bundle/map verification; actual device/server symbolication remains unverified.

- Completed locally: remaining profile/avatar account ownership and coordinated deletion/logout cleanup;147 suites/1452 tests plus24 real-SDK offline controls pass.
- In progress: notification preference serialization/unknown-state recovery; separate storage-deletion pagination fix. Live auth/device/RLS and complete erasure remain unverified.
