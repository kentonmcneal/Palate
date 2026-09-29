# Active window: September 29–30, 2026

Deadline: 2026-09-30 16:01:54 UTC (11:01:54 a.m. Central). No production deployment or paid services.

## In progress
- Extend recommendation evidence beyond committed synthetic invariants; taxonomy/timezone/live retrieval gaps remain.
- Review newly audited LLM accounting/retry gaps and bounded mitigation; a hard account-wide LLM ceiling is not established.
- Continue social/layout/typo work after feed read-recovery and account/settings/crash-report corrections.

## Completed before this window
- Nearby request coalescing, malformed-cache and budget config checks.
- Error-reporting failure containment and honest admin status.
- Feed/profile copy corrections; malformed-location ranking protection.

## Next
- Device review of owner profile redesign; broader people-search reliability and profile layout.
- Expand recommendation relevance evidence beyond current synthetic invariants.
- Broader typo pass.

## Unverified / blocked
- Database-owned spending policy remains an unnumbered reviewed draft: required migration CLI attempts a denied telemetry write. Keep default cap zero; no paid tests or deployment.
- Current JS crash privacy and local Metro identity are verified offline; native crash coverage is intentionally disabled and device/server symbolication remains unverified.
- **PostgREST returns 504 to the push-drain cron, and nobody has explained it.** On 2026-09-14
  the drain ran 69 times in six hours and succeeded 21: 27 runs reported `server_push disabled`
  while the flag was `enabled = true`, and 21 returned `{"error":"[object Object]"}`. Both lied
  in the direction of looking fine. Once it could report, the message was `Gateway Timeout` on
  the first read of the run. NOT the database — 15/60 connections, no slow queries,
  `statement_timeout` 2 min, `push_outbox` 45 rows — so it is upstream of Postgres. Retries
  (`_shared/retry.ts`) mitigate it; nothing explains it. Full write-up: `CODEX_HANDOFF.md` §5.4
  K1/K2, open question S8.
- **That 504 rate is now measurable — done 09-29 in `529c7c1` on `main`.** It previously was
  not: `retryRead` absorbs up to three failures silently and every `send-push` call site
  discarded the `attempts` the helper already returned, so a run that succeeded on attempt 2
  was indistinguishable from one that never failed, and 72 clean runs proved nothing. Every
  response after the first read now carries `read_attempts` per read and `retried_reads`.
  First two live runs: `{"read_attempts":{"flag":1,"due":1},"retried_reads":0}` — zero retries,
  so on that sample the 504s are genuinely absent rather than hidden. **Two runs is not a
  rate.** Two gaps remain: only `flag` and `due` are exercised, because runs exit early at
  `{sent:0,pending:0}` and `recent`/`profiles` never execute; and pg_net prunes
  `net._http_response` to roughly six hours, so anything beyond that needs these counts
  sampled into a table that persists. Not done. The 504 cause is still unexplained.
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

- Completed locally: flat account-storage deletion pagination/error correction;18 actual-handler mocked cases pass. Nested storage/concurrent uploads/deployed erasure remain unverified.

- Completed locally: three profile push controls with strict unknown/readback states and operation ownership surviving section collapse;151 suites/1565 tests and TypeScript pass. Whole-screen/server ordering/device delivery remain unverified.

- Completed locally: actual offline iOS/Android JS+Hermes source-map identity production,9 artifact gates and independent review. Device stacks, uploads and server symbolication remain unverified.

- Completed locally: missing-cuisine novelty, Right Now availability preference and duplicate-metadata invariants. Independent red/green review;153suites/1668passed/1skipped andTypeScript. Human relevance, venue timezone and live retrieval remain unverified.

- Completed locally: feed focus/read recovery, explicit auth failures, blocked preview cleanup;154suites/1686passed/1skipped andTypeScript. Native and eventual consistency remain unverified.
- Additional local PostgreSQL18.3 source build/install succeeded in workspace, but initdb failed with sandbox shmget Operation not permitted; no server/concurrency test ran. No bypass or production action.
