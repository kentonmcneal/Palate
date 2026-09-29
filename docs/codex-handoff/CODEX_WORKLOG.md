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
