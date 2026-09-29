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
