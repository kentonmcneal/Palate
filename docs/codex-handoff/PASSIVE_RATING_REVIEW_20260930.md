# Independent passive-rating account review — READY / ACCEPT

Accept Laplace's RATE_VISIT_ACCOUNT.patch at the exact hashes in HASHES.json. No corrective production patch needed. Author final REPORT.md is READY and its final visits/source/patch hashes match the independently tested bytes. Scratch only; no live calls, repository edits, credentials, installs or build.

## Account and authorization assessment

rateVisit captures the existing generation before any await. requireAccountWriteUser validates both generation and authenticated ID; accountWriteAuthorization validates generation and session ID before extracting the bearer. The update is filtered by initiating user_id and visit ID and explicitly carries that bearer. After the awaited update, generation is asserted before accepting an error/success or invalidating personal signal. The same-account ABA generation is not confused with the original operation.

The installed SDK's fetchWithAuth awaits its token provider but only supplies Authorization when the query has not already supplied it. Inspection of installed src/lib/fetch.ts and real SDK transport controls verify the explicit A bearer survives a provider returning B. This is actual SDK request/header evidence with synthetic fetch, not a fluent mock assertion alone.

Important dispatch boundary: account replacement while the SDK is already awaiting its token provider can still be followed by dispatch of the already-constructed request. The independent deferred-SDK-token case reproduces this honestly: it sends A's bearer with A's row-owner filter, then rejects the stale completion and emits no invalidation. The proposal prevents substitution of B; it does not guarantee that every account change prevents an already-entered SDK request from being sent. No cancellation claim should be inferred.

## Independent executed evidence

- AUTHOR_RERUN.log: all14 author SDK/helper controls independently rerun, pass.
- INDEPENDENT.log:8 additional actual installed SDK2.110.7 controls pass: getUser error, getSession error, ABA and sign-out during HTTP, stale tolerated-column result, fresh B operation with matching B filter/header, missing session, and account change during SDK token-provider await.
- BASELINE.log: those same8 fail on original main rateVisit. These are overlapping ownership/authorization controls, not8distinct bugs.
- MOUNTED_RERUN.log: all4 new actual digest→actual rateVisit controls independently rerun, pass. Real screen/helper/account source, mocked auth/query transport and other side effects. Normal saved-visit flow remains; pending B/ABA/null cannot invalidate, remove the inbox entry, issue the next visit or show haptic success from the old screen.
- Final source/patch SHA verification passes. Author52-case combined run and types reviewed, not independently repeated in this bounded review. No full-suite or live RLS claim.

The independent runner extends the author's loader so the production function and installed SDK stay real. Auth and HTTP are injected synthetic boundaries. No real user or service request occurs. It accepts MOBILE_ROOT and optional VISITS_OVERRIDE and has no baked-in machine source paths.

## Semantics and scope retained

The API remains Promise<void>. Neither a204 nor the tolerated missing-column error establishes an affected row or persisted rating. A current-account tolerated error still invalidates as before; the regex remains broad. Ordinary errors reject. Stale generations reject before any success/tolerance can trigger invalidation. This is a focused account-boundary fix, not rating durability or schema migration.

The digest intentionally swallows optional rating failure so a saved place/time visit remains in the diary. Its rating cache is a completed-call cache, not durable-write evidence. The new auth checks can reject on transient auth failure; no dish inference or required rating is added. Actual saveVisit/recordPromptDecision behavior is unchanged.

The user_id filter complements, never replaces, server RLS. No deployed policy enforcement was tested. This does not solve stale caller data first invoked under B, global ownerless inbox/native queues, transactionality, logout token revocation or already-sent request cancellation.

Only rateVisit changes within visits.ts. The durable mounted test and portable author helper runner are appropriate scope. Integrate the author patch and run main's existing gates. No extra production changes requested.
