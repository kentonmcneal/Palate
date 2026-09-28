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
