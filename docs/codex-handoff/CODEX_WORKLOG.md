# Codex worklog — 2026-09-28

## Baseline and scope
- User confirmed prior sessions finished. Baseline tag: `codex-baseline-20260928`; branch: `codex/handoff-priorities`.
- Handoffs and governing rules read in full before code. No landing changes, deployment, paid calls, real user data, or credentials added.
- Existing handoffs were committed by the previous session before the baseline was created.

## Changes (WORKING TREE)
- Persona nearby lookup and candidate generation now use `getOrFetchNearby`; pair compatibility reaches the latter, so it is not a third independent direct call.
- Cache coalesces simultaneous requests per location/radius and awaits persistence before releasing the pending request. Failures release the pending entry. TTL expires at five minutes; malformed/future cache timestamps are rejected.
- Synthetic 2,000-restaurant fixture and proxy-boundary counting tests: the modeled journey makes 11 nearby requests plus three explicit searches, with zero additional requests for same-bucket repeats within the TTL. Different radii intentionally have different cache keys.
- Actual server spending helper is executed in an isolated VM with mocked database and fetch. Tests prove sequential cutoff, unreadable-budget refusal, and a metering retry without a second fetch.

## Verification
- WORKING TREE: TypeScript check passed.
- WORKING TREE: Full Jest suite after cache changes: 131 suites; 1,137 passed, one skipped. Three additional server-helper tests subsequently passed separately.
- WORKING TREE: Source scan found Google Places URLs only in centralized-spend callers, plus gmail-import's documented direct IDs-only call. No masks or SKU prices changed.
- No LIVE or DEVICE verification performed. Xcode/Sentry/GCP blockers in handoff remain.

## Limits and next work
- Client proxy calls are not synonymous with Google billed calls. The fixture does not prove UI rendering or live backend fan-out behavior.
- INFERENCE from current helper source: post-request metering allows concurrent calls to overshoot; a thrown fetch is not metered, and two failed meter writes can leave usage uncounted. A durable atomic reservation requires a separately tested database change. Do not describe this budget as a strict concurrent cap.
- An unauthenticated response would prove function boot only, NOT the deployed version or migrations; handoff claims to the contrary are insufficient.
- Remaining: verify deployed controls when safe access permits, crash reporting, feed/profile/UI work, broader ranking evaluation, confirmed SKU prices.

## Rollback
Revert only Codex commits on this branch. The baseline tag preserves the starting source. Do not reset/clean/stash or restore unrelated paths. No secrets were copied or committed.

Final first-batch validation: WORKING TREE full Jest suite passed 132 suites, 1,140 tests, one skipped; TypeScript passed. Server tests are mocked, not LIVE evidence.

## Feed/profile copy batch
- WORKING TREE: empty feed now describes shared/public activity accurately and offers Find people and Log a visit actions; removed the claim that every logged meal appears.
- WORKING TREE: profiles with fewer than five visits label the taste persona as an early impression. Restaurant labels are clearer.
- WORKING TREE: year-in-review placeholder no longer promises an unsupported December 15 launch; describes the feature as in development.
- TypeScript passed. No DEVICE or LIVE verification; these copy changes do not complete the larger social/profile redesign.
- First cost/cache batch is COMMITTED as fac1d9d. Strict concurrent server budget reservations remain outstanding and require database validation.

## Budget configuration and sequential boundary hardening
- WORKING TREE: invalid, zero, negative, overflowing or sub-micro-dollar budget settings disable spending. Current recorded spend is checked as well as the trip flag, so lowering the cap takes effect immediately. An individual request that cannot fit the remaining recorded budget is refused, including the first request of a day.
- WORKING TREE validation: six actual-helper VM tests passed, TypeScript passed, full Jest suite passed 132 suites / 1,143 tests / one skipped. Entirely mocked networking and database; no real API requests.
- This is NOT an atomic reservation. Concurrent requests can still race; thrown fetches and failed post-fetch metering remain gaps. Missing/malformed spend data fails closed; source relies on spend_micros added by migration 0179. No field masks or SKU prices changed.
- Supabase reference fetches failed (markdown unsupported, reference routes 404). No Supabase feature/API change or schema migration was introduced; existing maybeSingle query adds an existing column. No LIVE or DEVICE claims, deployment, or spend.

## Crash-reporting resilience
- WORKING TREE: concurrent initialization shares one attempt; failed initialization is contained and retryable. SDK capture/breadcrumb/normalization failures no longer reject back into the global rejection handler. Test events return false when they cannot be queued.
- Admin wording separates SDK acceptance from verified delivery and configured DSN from successful initialization. Root crash screen no longer guarantees unsaved data safety.
- Validation: actual observability source executed in a VM with mocked SDK/synthetic DSN; five new tests cover concurrent init, retry, capture failures, hostile error getter, breadcrumb failures and accepted test events. Existing normalization tests pass. TypeScript passes. Full Jest: 133 suites, 1,148 passed, one skipped. Initial test harness hit Jest dynamic-import limitations; CommonJS VM transpilation resolved it without package changes.
- No Sentry network calls, DEVICE testing, or LIVE verification. Production DSN and actual delivery remain unknown. No change to the existing policy of swallowing global production exceptions. Native crashes remain outside this JS-only evidence.
- Budget configuration changes are COMMITTED in c0be455; earlier local test evidence applies to that commit.

## Ranking location robustness — 2026-09-29
- WORKING TREE: malformed coordinates (nonfinite or outside geographic bounds) now receive neutral missing-location treatment instead of a NaN score or invented proximity signal. Valid zero and boundary coordinates remain accepted. No ranking weights changed.
- Three targeted tests and TypeScript passed. Initial full Jest launcher crashed with a segmentation fault; repeated using explicit native /opt/homebrew/bin/node succeeded. Full result recorded below. No API calls or DEVICE/LIVE validation.


Test Suites: 134 passed, 134 total
Tests:       1 skipped, 1151 passed, 1152 total
Snapshots:   0 total
Time:        11.112 s
Ran all test suites.

## New autonomous window — 2026-09-29 16:01:54 UTC
Deadline 2026-09-30 16:01:54 UTC. Existing follow-up reactivated, no duplicate. User explicitly authorized bounded subagents; Groundwork vocabulary, quant and home UI have disjoint scopes. See CODEX_BACKLOG.md for current priorities and blocked verification.

## Conservative Google reservations
- WORKING TREE: reserve assigned SKU cost through existing atomic bump_google_spend before fetch. Only valid returned totals within cap authorize a Google call. Read/RPC failure or malformed reservation refuses spending. Fetch errors retain reserved cost; unknown RPC outcomes can double-reserve on retry but never double-fetch.
- Independent read-only reviewer assessed SQL locking, retries, cap changes, midnight, free SKUs and rollout. Details and limitations in GOOGLE_RESERVATION_REVIEW.md. No schema change; no local or live Postgres execution claimed.
- Fourteen actual-helper offline tests passed, including two isolated workers sharing a serialized fake meter with stale reads, mixed SKUs, committed-but-lost replies and HTTP/network failures. TypeScript passed. Full Jest: 134 suites, 1,159 passed, one skipped. No network-capable mocks or real service calls.
- Counter totals now represent conservative reservations, not exact invoice spend; alerts use matching wording. Complete fleet adoption and real prices remain unverified.

## Compatibility cache correctness
- WORKING TREE: cache identities now include actual taste-graph values (including Map/Set contents), not just counts; restaurant snapshots also participate. This fixes collisions between equal-size profiles, edited ratings, and enriched restaurant rows. Implicit feedback remains excluded because it affects rank rather than the headline match.
- Four regression tests passed for distinct profiles, in-place rating changes, restaurant updates and equivalent snapshots. TypeScript passed. Combined full suite before final social guard edits: 136 suites / 1,166 passed / one skipped. No paid requests, live evaluation or DEVICE validation. Snapshot serialization trades some CPU for correctness; device profiling is still needed at large histories.


## Social mutation reliability — 2026-09-29
- WORKING TREE: Feed likes now use per-row synchronous gates and pending controls. Failed optimistic updates reverse only their own like delta; stale refreshes cannot overwrite an in-flight/recent like mutation. Other rows remain intact.
- WORKING TREE: Comments use distinct post sessions, send ownership tokens, load sequence and successful mutation replay. Switching A→B→A cannot let an old response clear a new draft or replace new comments; successful sends/deletes/blocks/likes reconcile against stale list snapshots. Deleting/blocking also clears an affected reply target. Composer is disabled until initial load succeeds.
- WORKING TREE: Replaced direct native input rendering with the shared TextInput wrapper; removed unsupported report-response SLA and improved feed description. Landing untouched.
- Independent review found three additional reopen races; reviewer implemented fixes and fifteen mounted regression cases. Main reviewed the mutation replay and added affected reply-target cleanup.
- Validation: complete local Jest run passed 137 suites / 1,182 tests, one skipped (/tmp/palate-social-reviewed.log). After final reply-target cleanup, focused 19 tests and TypeScript passed. Mocked component cases cover out-of-order loads, same-tick duplicate likes, old/new send ownership, reopened sends, stale snapshots, delete cascades, blocks and stale error alerts.
- LIVE / DEVICE: not tested or deployed. This establishes mocked local behavior, not production authorization, network reliability or device visual quality. Existing Xcode license blocker remains.
- Rollback: revert this batch commit, preserving unrelated work and baseline recovery tag. No database changes.


## Recommendation missing-evidence corrections — 2026-09-29
- WORKING TREE: fixed three independently reproduced defects. Empty format/occasion histories no longer penalize newly available restaurant metadata; known cuisine types can populate familiar pools when subregion is absent; diversity cap falls back to known subregion/region when type is absent.
- WORKING TREE:49 synthetic tests include32 combinations of four tastes ×0/1/5/35 visits ×40/2,000 candidates, through actual candidate/scoring/shortlist/Best/Comfort code. Only data-loading boundaries mocked; accidental live requests throw.14 targeted tests fail on unchanged baseline, pass on proposed fixes. Main reviewed the scoped changes and actual pipeline tests.
- Validation: all49 new tests passed in integrated full run; TypeScript passed. Overall run1230 passed/1failed/1skipped; sole failure was unrelated concurrent profile typography and is handled in its separate batch. Detailed cases and limitations in PALATE_RANKING_REVIEW_20260929.md.
- INFERENCE: synthetic invariants improve known broken behavior, not measured human recommendation relevance. No ranking weights tuned. Mixed type/subregion taxonomy remains separately keyed; region-only grouping is broad. Upstream live retrieval limits and device latency remain unverified.
- LIVE / DEVICE: no calls or deployment. Rollback: revert this recommendation commit only; baseline recovery retained.


## Edge authorization hardening — 2026-09-29
- WORKING TREE: group-recs now checks bidirectional blocks independently of retained follow edges; follows/profile/block authorization read failures fail closed. Existing authorized public/mutual-friends cases preserved.
- WORKING TREE: notify-feed-post verifies linked visit ownership/publicity, friends-only reciprocity, bidirectional blocks and explicit JWT authentication before selecting push recipients. Existing push kill-switch unchanged. No real push sent.
- Independent source audit identified8 server issues plus3 UI contract mismatches (SECURITY_AUDIT_20260929.md). This commit addresses the two edge routes only; SQL repairs remain a separate uncommitted review/testing task. Source findings are not live exploit results.
- Validation:26 mocked executions of actual transpiled handlers passed after integration via scripts/security-edge-authorization.test.cjs. Both block directions with retained follows, private/one-way access, hidden/forged visit references, invalid auth, authorization read failures and valid controls covered. No real SDK/network/database used. Main reviewed patch; no production deployment.
- Limits: SQL RLS/grants, concurrent privacy changes after recipient selection, queued notifications and deployed auth SDK behavior require separate verification. Rollback: revert this edge commit only, understanding that it restores the identified authorization gaps; retain tests/evidence when planning a replacement.


## Own profile navigation and privacy wording — 2026-09-29
- WORKING TREE: introduced owner-only My profile / Connections sections, six explicit navigation actions, shared typography tokens and a 44px settings control. No invented counts or activity; no landing changes. Connection definitions reflect mutual follows.
- Privacy wording now acknowledges visible basic identity and connection counts, instead of claiming a private profile hides everything. Compatibility recommendations are labeled TASTE MATCHES instead of implying friendship. These are intended contracts; outstanding SQL privacy findings are tracked separately, not represented as resolved.
- Validation: nine mounted profile navigation/auth tests plus three typography checks passed; complete integrated Jest passed139 suites /1,240 tests /one skipped. TypeScript passed. Main reviewed the component and corrected off-scale typography and overly broad connection-list wording.
- DEVICE / LIVE: no native visual, VoiceOver, large-text or live privacy verification. Switching to Connections unmounts ProfileBody, so returning reloads it and resets its scroll; accepted bounded tradeoff, not a preserved-scroll implementation.
- Rollback: revert this batch commit to restore the prior profile layout/copy. Baseline recovery tag retained; no database change.


## Local SQL privacy and integrity protections — 2026-09-29
- WORKING TREE: additive migration0183 denies blocked/private-mutual readers, excludes hidden visits from city summaries, rejects forged feed visit links, requires visible posts for likes, and validates same-post one-level comment parents. Comment identity/post/parent are immutable, including privileged structural updates, to prevent stranding replies. Visit pushes require public visits and the correct audience. Existing feed selection remains unchanged.
- Main reviewed candidate and integrated durable tests under scripts/security-sql. Actual integrated PGlite0.5.8/PostgreSQL18.3 run:57/57 passed, comprising8 baseline controls,43 patched SQL cases and6 actual-handler/SQL authorization cases. Real local roles/RLS/security-definer functions execute; auth/transport and unrelated schema remain synthetic. The prior26 offline edge tests are separate evidence.
- Evidence and limitations: LOCAL_SQL_SECURITY_20260929.md; reproduction in scripts/security-sql/README.md. Fixture does not replay full migration history or test multi-session timing. No real notifications, LIVE operations or deployment. PGlite is an external free test tool, not a production dependency.
- Existing malformed reply trees require separate preflight/repair decisions. Legacy forged events are hidden, not deleted. Read-only preflight supplied but not run live. Deployed version, grants, auth, concurrent privacy changes and queued notification delivery remain unverified.
- Rollback: since nothing is deployed, revert this batch commit locally; do not reverse security SQL against production without a separately reviewed replacement migration. Baseline tag retained.


## Correct field-mask pricing and actual SQL budget proof — 2026-09-29
- WORKING TREE: current rating/price/opening-hours masks require Enterprise, while prior callers declared Pro. Corrected structural details20,000 micros and text/nearby search35,000 micros; rich details25,000 unchanged. Public global first-paid-tier sources independently verified; no claim of account invoice verification. Unknown/retired/inherited SKUs now refuse before any meter read/fetch.
- Six paid-mask variants and Gmail's free IDs-only exception are covered by AST contracts. These checks enumerate current callers; they are not runtime mask validation or automatic future-spender discovery. See GOOGLE_FIELD_PRICING_20260929.md.
- Independent review:18 focused cases passed; main full integration141 suites /1,266 tests passed, one skipped, TypeScript passed.
- New durable scripts/security-sql/budget-sql.test.cjs executes original0033 and0179 SQL plus current helper against PGlite. Main rerun41/41 passed. Real committed reservations are exercised under lost/malformed replies and SQL/HTTP failures; no network-capable fetch. Source hashes print with results.
- GOOGLE_BUDGET_SQL_PROOF_20260929.md records counterexamples and limits: mixed caller caps can exceed the smaller cap; old deployments do not dollar-meter; raising a cap retains old trip; lost replies can consume alert flags without delivery. Single embedded backend does not prove multi-session concurrency or deployed auth. No billing access, paid calls or deployment.
- Rollback: revert this batch commit locally, recognizing it restores lower inaccurate estimates. Original migrations untouched; baseline tag retained.


## Search respects blocks — 2026-09-29
- WORKING TREE: additive migration0184 excludes blocks in both directions inside search_users before the20-row limit. Source audit found the security-definer search lacked the directory's block predicate. Existing exact-email (email not returned), display substring, username prefix and bare-identity visibility remain unchanged; private/friends identities are not made public-content profiles.
- Independent worker supplied real local PostgreSQL tests; main reviewed and integrated durable scripts/security-sql/search fixture. Main rerun20/20 passed: bidirectional baseline reproductions, incoming-block RLS, unblocked parity, ACLs, query matching/limits, no-subject and wildcard controls.
- No LIVE calls/deployment; minimal fixture does not prove full migration-chain compatibility, production grants, query performance or concurrent block changes. SEARCH_BLOCKS_REVIEW_20260929.md records limits.
- Rollback: revert locally only; deployed reversal would reopen the privacy gap and needs a separately reviewed replacement. Baseline tag retained.


## Connections navigation and request ownership — 2026-09-29
- WORKING TREE: own follower/following/friend tabs validate route inputs; other profile counts no longer open the caller's own list under a misleading target. Unsupported target routes explain the limitation. Per-row synchronous gates remain until authoritative reconciliation, including errors, refocus and tab/route changes.
- Independent review reproduced three regressions in the initial proposal. Integrated fixes retain mutation ownership across route changes and isolate profile state by target identity; old target/focus loads cannot overwrite a newer profile or launch stale reloads. Removed unsupported report-response SLA.
- Validation:38 mounted connection/profile cases pass; full integration1337 passed/one skipped/one unrelated unused People helper failure. After that cleanup,84 focused connection/People/dead-export cases pass; TypeScript passed. Native transport cancellation and already-dispatched writes are not claimed.
- DEVICE / LIVE: no device visual/accessibility or deployed privacy verification. Target-key isolation resets profile local state on target changes. Landing untouched.
- Rollback: revert this batch commit only; preserve baseline tag and unrelated changes.


## People discovery privacy and asynchronous recovery — 2026-09-29
- WORKING TREE: screen sessions follow actual account identity; stale session restoration, old focus/search/enrichment replies and captured old actions cannot publish into the new screen. Search uses the server's three-character boundary. Failed reads have retry states, and unknown follow status disables mutations until reconciled.
- Strict bidirectional block reads fail closed. Independent review reproduced retained hidden identities when a sibling data read failed, plus named mutation errors that could retain/reintroduce blocked people. Privacy results now retire identities independently of search/directory success; errors are pruned/suppressed too. Migration0184 remains separately required server protection.
- Visibility invitation links to explicit profile settings; it no longer silently writes visibility. Session dismissal replaces the unused discovery-prompt write helper, which was removed after the dead-export guard caught it.
- Validation:43 mounted People cases pass, including real helper mapping/failure controls. Full integrated run1337 passed/one skipped with only the subsequently fixed dead-export failure; final84 focused tests pass. TypeScript passed before unused helper removal; no test threshold relaxed. PEOPLE_INDEPENDENT_REVIEW_20260929.md records red/green reproductions and limits.
- LIVE / DEVICE: no production/service calls, native layout or VoiceOver validation. No realtime block subscription, transport cancellation, or rollback of already-sent mutations. Landing untouched.
- Rollback: revert this batch commit locally; keep baseline/recovery tag and server privacy migration independently.


## Account transition and profile write ownership — 2026-09-29
- WORKING TREE: root rejects stale initial auth restoration and unmounted callbacks; navigation state remounts on account replacement/sign-out while same-account refresh preserves drafts. Username claimed state is scoped to an account generation, including A→B→A, without dropping subscriptions.
- Username/onboarding completions use the initiating session token before navigation/marking; setUsername/setDisplayName recheck token and resolved user before submission, then pin the update row to the initiating ID. Independent review had caught the deferred-getUser wrong-account path; final review confirms it fixed.
- Validation:19 focused cases pass in main and independent review. Independent reviewer additionally ran20 actual-helper/gate cases covering explicit/default tokens, mismatched auth, A→B→A, same-ID refresh and post-submission account changes. Full integrated suite included these19 passing cases; only unrelated dead-export issue subsequently fixed. TypeScript passes.
- Evidence: ACCOUNT_WRITE_REVIEW_20260929.md. LIVE / DEVICE: auth transport, native routing and production RLS unverified. Already-submitted writes cannot be recalled; other profile/avatar/background writers are not certified by this scope.
- Rollback: revert this batch commit locally; retains baseline tag. This restores the identified account-state risks, so prefer a reviewed forward fix if a regression is discovered.


## Reviewed database-owned spending policy draft — 2026-09-29
- WORKING TREE / DRAFT: reproduced different worker caps admitting50,000 micros against a smaller25,000 cap. Added reviewed SQL draft under scripts/security-sql/policy, outside active migrations. A database-owned policy must match the caller cap; zero/missing policy refuses admission. Default is zero, not an authorized paid allowance.
- Existing0179 reservation routine body/OID preserved under an internal name; public guard share-locks policy before reserving, with explicit table/internal-function privileges revoked from public/anon/authenticated/service_role. Existing conservative accounting and warning/trip latches unchanged.
- Main source review and durable local reruns:21 policy cases plus11 independent ACL/compatibility groups pass. Independent reviewer also reran41 original baseline cases separately. No network-capable fetch, live service or deployment. Evidence: GOOGLE_POLICY_DRAFT_REVIEW_20260929.md and GOOGLE_POLICY_INDEPENDENT_REVIEW_20260929.md.
- BLOCKED migration-file integration: installed CLI evenhelp attempts denied ~/.supabase telemetry write; alternate official executable lacks migration commands. Required skill workflow uses migration new, so draft stays unnumbered rather than inventing migration metadata. Other work continues.
- LIVE / INFERENCE limits: single-backend PGlite does not prove multi-session policy update contention, deployed roles/ownership/OID-bound callers/PostgREST refresh or fleet adoption. Old/direct paid paths bypass the guard; current source inventory found no new unmetered paid Places caller. Already admitted calls cannot be recalled; no invoice guarantee. Before any deployment, follow README prerequisites and retain zero absent new spending authorization.
- Rollback: revert this draft/test commit only; active migrations/runtime are unchanged. Existing unrelated backlog commit854cd8c preserved.


## Bounded JavaScript crash-report privacy — 2026-09-29
- WORKING TREE: configured JS transport reconstructs error events/envelopes after SDK hooks. Removes freeform messages, user/request/extra data, attachments, breadcrumbs and unsupported channels; retains validated categories, coordinates, canonical Expo bundle names and supplied source-map debug IDs. Independent review fixed coercible values/changing getters forwarding unvalidated data.
- Native initialization/crash/session collection disabled through this JS configuration. This does not erase historical queues or independently initialized native SDKs. Default transient JS instrumentation may still run; no all-collection-disabled claim. Diagnostic detail/grouping reduced deliberately.
- Main full integration before final8 regressions:147 suites/1452 pass/one skipped including concurrent account work; final observability-focused59/59 pass. TypeScript passes before final primitive-validation follow-up; reviewer full scratch TypeScript passes after it. No service requests, real payloads or deployment.
- Independent real Core/Browser serialized-envelope controls reproduce eight validation failures then pass11/11; source-map compatibility controls11/11 include documented limitations. See OBSERVABILITY_JS_REVIEW_20260929.md and OBSERVABILITY_DIAGNOSTICS_REVIEW_20260929.md.
- INFERENCE / unverified: runtime debug-ID generation is not yet established; current default Expo serializer does not populate the Sentry registry in the reviewed fixture. Retaining supplied IDs does not prove shipped symbolication. Metro integration follow-up active. Native crash coverage/offline transport unavailable; device/server verification remains outstanding.
- Rollback: revert this local batch commit; doing so restores the earlier broad payload behavior. Prefer a reviewed forward fix. Baseline tag preserved, landing untouched.


## Remaining profile writes and coordinated account cleanup — 2026-09-29
- WORKING TREE: eight profile/preference writers capture initiating account generation and pin row identity. Avatar pickers guard permission/picker/file/upload stages; already-issued A uploads may leave A-owned orphans. Destructive confirmations capture identity and send the initiating JWT explicitly. Public-avatar wording corrected.
- Privacy editor serializes same-tick writes, suppresses an unconfirmed audience while saving and reconciles uncertain errors. A read is only a snapshot, not proof of final ordering against a delayed commit; zero-row updates remain an unverified acknowledgement limitation.
- Independent review reproduced old A logout clearing a newly signed-in B with the real installed SDK. Added one public-helper promise queue for OTP/Google/Apple credential submission and logout; stale cleanup rechecks inside queue, which stays held through SDK storage removal/notifications. Current source has no implemented auth-callback token-ingestion path; future replacement paths must join the queue.
- Main integrated147 Jest suites/1452 tests pass/one skipped; TypeScript passes. Actual installed SDK mock-transport controls17/17 plus independently authored7/7 pass in main. Independent bypass-queue negative control18fail/6pass establishes ordering dependence. No real auth/sign-in/messages/services.
- Evidence: REMAINING_PROFILE_WRITES_REVIEW_20260929.md, AUTH_CLEANUP_AUTHOR_20260929.md and AUTH_CLEANUP_REVIEW_20260929.md. Original author claims are superseded by independent R1 finding and queue correction.
- Remaining: notification-toggle overlap is a separate active fix; SDK refresh/startup/native/multiprocess behavior not exhaustively verified; unresolved SDK operation can hold queue. Endpoint erasure completeness separately scoped. No deployment or device proof.
- Rollback: revert this batch locally as a unit, preserving baseline tag and unrelated work. Removing queue restores reproduced replacement-session loss risk.


## Account-storage deletion pagination — 2026-09-29
- WORKING TREE: repeatedly list offset0 while deleting flat user-prefix objects. Previous increasing offsets skipped100 objects in a250-object example. Listing errors/missing data now fail closed before account-row deletion.
- Main actual-handler mock execution:10 author cases plus8 independent cases pass, covering0–1000objects, listing/removal failures, auth/method contracts, later-bucket failure, RPC failure and repeat cleanup. No Deno remoteimports or actual Storage SDK/service run.
- Evidence: DELETE_PAGINATION_AUTHOR_20260929.md and DELETE_PAGINATION_REVIEW_20260929.md. Tests supplied as durable offline scripts. Current uploaders use flat filenames; nested folders/concurrent uploads/eventual consistency are not certified. Partial deletion is not rolled back; error counts omit partial current-bucket removals.
- LIVE / unverified: deployedStorage/auth/RPC behavior and exhaustive erasure remain unverified; no deployment or user deletion occurred.
- Rollback: revert this local batch commit; that restores skipped-page/list-failure behavior. Preserve baseline tag and unrelated work.


## Notification preference ownership and readback — 2026-09-29
- WORKING TREE: Activity/Likes/Comments controls start unknown, use strict account-bound reads, serialize same-field callbacks before render and reconcile both successful/failed updates. Missing/nonboolean/wrong-account rows never become a guessed switch value. Failed reads offer retry; ambiguous writes retain an explicit snapshot warning. Different fields remain independent.
- Independent review executed the actual CollapsibleSection and reproduced12 failures: collapse destroyed operation ownership and allowed overlapping writes or lost warnings. State now lives above collapsible presentation and survives closing/reopening. Account generation still invalidates old callbacks/results.
- Main integration151 suites/1565 tests pass/one skipped; TypeScript passes. Six focused suites contain178 tests, including27 actual-collapse cases and18 independent strict-reader cases. No real push/auth/service calls, native UI or deployed policy verification.
- Evidence: PUSH_PREFS_AUTHOR_20260929.md and PUSH_PREFS_REVIEW_20260929.md. Receive-preference comments now follow current source columns; sender visibility is separate. Backend-wide ordering, cross-screen recreation of uncertain writes and notification delivery remain unverified. Readback is a snapshot, not proof a timed-out request cannot commit later.
- Rollback: revert this local batch; earlier preference guessing/overlap returns. Existing recovery tag, landing and account cleanup preserved.


## Offline Metro runtime/source-map identity — 2026-09-29
- WORKING TREE: added installed Sentry Expo Metro integration to generate matching runtime registry and source-map debug IDs. Release-for-web/replay/annotations/development-source-context additions explicitly disabled. No uploader/dependency/native project changes.
- Actual isolated whole-app iOS/Android plain-JS and Hermes exports succeeded with allowlisted environment, dotenv/telemetry/upload disabled and network-denial preload. Default Expo iOS control has map/comment ID but no Sentry runtime registry; proposed JS exports populate it. Core derives metadata from generated registries and existing privacy transport preserves it.
- Main durable artifact gate9/9 passes against author artifacts; independent gate9/9 plus separate source/hash/config checks pass. Both real Hermes bytecodes contain matching composed-map IDs and registry identifier; bytecode was not executed on a device. Independent59 observability tests and main full151 suites/1565 tests/one skipped pass.
- Evidence: METRO_DEBUG_ID_AUTHOR_20260929.md and METRO_DEBUG_ID_REVIEW_20260929.md. App-export VM stops at missing native bridge after registry creation; this is not app boot/device proof. Source maps stay local.
- LIVE / DEVICE limits: upload/OTA packaging/ingestion/server symbolication/native crashes/web or split bundles unverified. This closes the demonstrated runtime-ID generation gap for tested local export paths only. No paid calls/deployment.
- Rollback: revert this local config/test commit; runtime registry generation then returns to the demonstrated missing-default condition. Baseline tag retained.


## Recommendation selection and metadata invariants — 2026-09-29
- WORKING TREE: unknown cuisine cannot establish novelty merely through matching format/flavor; prevents otherwise eligible unknown rows emptying Best/Comfort. Right Now and secondary Stretch prefer the first not-known-closed venue within their existing strategy subset; preserve order and all-closed fallback. Unknown hours are not certified open. Browsing compatibility/weights and upstream eligibility remain unchanged.
- WORKING TREE: duplicate occasion/affinity keys and case-normalized gem tags count once. Distinct evidence still contributes. Existing writers already deduplicate common paths; no live duplicate prevalence claim. Flavor compatibility weight remains zero; no claim of improving that disabled dimension.
- WORKING TREE validation:82 author synthetic controls,45 fail on baseline;21 independent boundary controls,8 fail on baseline. Four tastes,0/1/5/35-history and40/2000-row pools, actual pipeline, throwing I/O boundaries. Independent checks include hard exclusions, open/close boundaries, overnight/week wrap and multi-candidate all-closed order. Main full153suites/1668passed/1skipped plus TypeScript pass (/tmp/palate-ranking-full.log and -tsc.log). No API/service/device execution.
- INFERENCE/LIMITS: invariant correctness supports these bounded fixes, not measured human relevance, personal satisfaction or native performance. Device-local hours interpretation, imperfect/stale data, mixed cuisine taxonomy, strategy exclusions and upstream retrieval caps remain. No invented precision/MRR or known-open guarantee. Detailed evidence RECOMMENDATION_QUALITY_AUTHOR/REVIEW_20260929.md.
- Coordination: read new a57e72a governing changes; recorded scoped claim366e0ee, preserved other-session docs and504 observations. This session performed no live verification/deployment. COMMITTED identifier is the commit containing this entry. Rollback: revert that isolated batch; baseline recovery tag remains; no data migration.


## Feed read ownership and visible recovery — 2026-09-29
- WORKING TREE: focus/request generations own feed reads and taste enrichment; stale results cannot overwrite current content or release newer gates. Same-tick refreshes coalesce; like gates survive blur. Completed blocks/reports/comment-count updates invalidate an overlapping snapshot rather than guessing a merge.
- WORKING TREE: failed refresh keeps existing cards with explicit retry; loading/error/successful-empty states remain distinct. Independent review caught returned auth errors and explicit null sessions appearing successful; errors now recover, absent account clears reader state, root account remount remains the cross-account boundary. Blocking also removes that user's inline comment previews, without subtracting preview count from an already-authoritative total.
- Validation:18 actual-screen mounted cases (including real report/block menu chain) plus focused regressions; main full154suites/1686passed/1skipped andTypeScript pass. Logs /tmp/palate-feed-final-full.log and -tsc.log. Original12cases had11baselinefailures; independent18-case extension caught4failures before additional correction. Mockedservices/focus/commentsboundary, no realAPI/nativeexecution.
- UI: original recovery card using existingtokens,44point minimumactions and accessibilityroles/live-regionprops. DEVICE rendering,VoiceOver,touch/large-text behavior stillunverified. Conservatively discarding an overlapping snapshot may delay other newposts untilnextrefresh; never-settlingreadneedsfocuschange; no persistentblocktombstones or eventualconsistency guarantee. Counts on other unopened posts may be stale.
- Evidence FEED_RECOVERY_AUTHOR/REVIEW_20260929.md. COMMITTED is this entry's commit. No landing changes, deployment or paidcalls. Rollback: revert thisbatch; retains prior mutation/auth/privacy improvements and recoverytag.
