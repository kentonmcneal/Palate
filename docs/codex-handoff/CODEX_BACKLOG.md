# Active window: September 29–30, 2026

Deadline: 2026-09-30 16:01:54 UTC (11:01:54 a.m. Central). No paid services. User subsequently authorized tested deployments with verified no incremental cost; runtime/backend compatibility remains a release gate.

Current checkpoint: read/ambiguity24f63d5 plus the Add search batch committed with this entry. The chronological notes below preserve earlier evidence; this top section supersedes their older in-progress labels.

## In progress
- Native completion reconciliation: design/synthetic packet ready, production native/JS coordination unimplemented. Add save completion and search safeguards completed locally.
- Passive capture-time account ownership remains a coordinated follow-up; design exists, full isolation unimplemented.
- Broader friends/feed/profile design, typo and recommendation evaluation coverage remain unfinished.

## Completed locally
- Strict raw/retry/processed reads and local inbox serialization/stale in-flight hydration protection:169suites/2,097tests,1skip andTypeScript; independent reviewed cases. Global ownership, remote mirror ordering and fresh stale restoration remain.
- Add save UI ownership and malformed passive-input rejection:167suites/2,061tests,1skip;TypeScript and27 independent actualrunner controls passed offline.
- Strict inbox mutation reads preserve unreadable/corrupt storage:163suites/1,963tests,1skip;TypeScript plus29 focused author/independent cases pass. Concurrency and bounded-retry loss remain.
- Add search duplicate/stale admission and result ownership:162suites/1,940tests,1skip andTypeScript pass;48 mounted author/independent controls. No live cost guarantee.
- e22348c initiating-account visit/decision/feed/analytics credentials;54 durable SDK transport controls,160 mobile suites/1,884tests passed,1skip andTypeScript at e22348c. Latest read/ambiguity batch:160suites/1,892tests,75durable SDKcontrols andTypeScript pass.
- 99cc3b5 coffee-inclusive reminder copy, ambiguous venue choice instead of direct Yes/No, durable attribution regression.
- 58a7f6a unavailable-inbox and cancellation recovery; conservative source/distance confidence. Actual delivery remains unverified.
- 7ddd2a2 unknown-confirmation retry, runner admission, brief-coffee workplace/history corrections; no relaxed dwell floor.
- f40e40e shared conservative chain eligibility; independent substring false positives removed, reviewed chain exclusions retained.
- fe08e2a confirmed LLM admission source integration and disabled paid shortcuts;123 offline cases. SQL remains disabled/zero draft outside active migrations, no live spending guarantee.

## Priority limits
- No actual7Brew incident trace/venue row or device notification delivery verified. Sub5min native capture, early5min one-shot emission versus12min travel qualification, stale fixes/120m NYC grouping, ownerless old data remain; legacy ambiguous prechecks are corrected locally.
- Notification queue acceptance is not OS presentation. All new work used mocks/synthetic data; no real-user notifications, deployment or paid calls.

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

- Completed locally: bounded LLM meter/ledger/retry/cache/stamp safeguards,93 offline controls and focused typing pass. NOT an atomic ceiling: concurrent admissions, next-call overshoot and durable unknown-cost holds remain unresolved.
- In progress: independently reviewed default-deny DB reservation design and all-route integration proposal; no active migration/deployment/spending authorization.

- Completed locally: three-route confirmed LLM admission and disabled paid operator/eval shortcuts,123offlinecases +154mobile suites/1686tests/1skip andTypeScript. Durable guardswiredtoCI(notremoteexecuted). SQLdraftdefaultszero outsideactivemigrations; live/concurrent/account-wide protection remainsblocked/unverified, notcomplete.


### Passive investigation checkpoint — 2026-09-29
- Completed locally:7ddd2a2 unknown-confirmation retention, runner admission, short-stop workplace/history safeguards.
- Completed locally pending current commit: strict reminder read/cancellation recovery and source/distance confidence ceiling;158 suites1,861 tests +TypeScript pass.
- In progress: account ownership design; no claim of complete passive privacy isolation.
- Unverified: actual7Brew trace/venue row, OS permission/delivery, NYC native stale-fix behavior, device background lifecycle.
- Remaining: native early5min emission versus12min travel reconciliation; sub5min capture; separate owner-scoped queues/actions/native lease; opt-out reminder semantics and coffee-inclusive copy.

2026-09-30 COMMITTED with entry: initiating-account mirror/hydration and queuedrestoreguards;170suites/2107tests+types and58SDK/sourcecontrols pass. IN PROGRESS honest inbox read/retry UI. UNVERIFIED/remaining full capture ownership, mirror ordering/tombstones, native short-stop/departure behavior and physical notification delivery.

2026-09-30 COMMITTED with entry: honest inbox loading/retry/stale callback protection; weekend low-only deferral cannot intentionally outlive shown entry retention. Main175suites/2150tests+types, then24independentexpiry executions pass. IN PROGRESS capture-status truthfulness; native stop duration/provenance and actual7Brew/device delivery remain unresolved.

2026-09-30 COMMITTED with entry: current-stop radius filtering prevents inherited out-of-radius cached suggestions; degraded filtered provider responses retry. Main177suites/2170tests/typespass. IN PROGRESS truthful capture status and strictserializedclusterhistory. Native sub5mincoffee/completion/captureownership remain unresolved.

2026-09-30 COMMITTED with entry: capture status respects optout and unknown reads; shared Home/Profile copy no longer promises tracking/delivery; auth bootstrap ordering corrected.179suites/2199tests/typespass. IN PROGRESS strictserializedhistory; activation toggle races and native/device verification remain.

2026-09-30 COMMITTED with entry: strictserializedhistory prevents failedread/new-user and lostupdate behavior; malformednewIDs rejected.181suites/2229tests/typespass. Native stop completion/captureownership, corruptdata recovery and real7Brew/device verification remain open.

- Completed: saved-consent capturetoggle, unknown/retry and repair ownership;183suites/2265tests/typespass. Sharedcorestart/stop and digest/onboarding followups pending.

- Completed: same-runtime consent/startstopordering;185suites/2289tests/typespass. Nativecoldresume/durableoff/accountownership remainunverified.
- LIVE: paused oldLLMbackfillcron14, readbackinactive. NewadmissionRPCsabsent; do notreactivatewithoutcostsafeprotocol. No appdeployyet.
