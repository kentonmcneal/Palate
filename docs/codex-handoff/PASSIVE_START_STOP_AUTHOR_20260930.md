# Passive start/stop safety — READY for independent review

WORKING TREE / offline author proposal. No repository edits, permission requests, native calls, deployments, installs or paid services. Core patch: passive-capture.ts plus16 mocked-boundary tests. UI_TEST_EXPECTATION.patch separately adjusts one pending UI test's two call-count expectations; no UI production edit.

## Actual source findings and call sites

startPassiveCaptureIfEnabled previously omitted consent entirely. Debug directly calls it; intro and old settings call setPassiveOptIn(true) then start; layout calls resume on foreground. Resume previously read consent before the asynchronous flag read, so opt-out during that await could be followed by native start. optOut persisted first, so a rejected write skipped native stop entirely. Concurrent true/false writes could finish in reverse order.

Read Mendel's READY passive-toggle-safety report/component/tests and Chandra's REPAIR_OWNER.patch. Their new Settings component captures its own UI/account lifetime, reads back partial writes and handles startup rejection. This proposal keeps helper signatures and StartResult reasons compatible. It does not provide caller-account ownership for intro/debug/layout.

Native source inspection: startMonitoring writes a separate UserDefaults enabled bit, then starts location services; stopMonitoring writes false, stops services and clears candidate. resumeIfEnabled uses that native bit before JS restoration. This is SOURCE evidence only: UserDefaults durability, CoreLocation delivery and stop completion are not proven by Jest. Pending precise callbacks/native one-shot protocol remain outside scope.

## Bounded policy

Every start now strictly reads consent and requires true, remote flag and Always. Unknown/malformed storage rejects instead of authorizing startup. Resume delegates to the same gate. Missing/0 returns not-opted-in. Read failure remains distinguishable from explicit opt-out to callers that catch errors.

A same-runtime generation changes synchronously for consent intent and explicit stop. Every pending start captures its generation and rechecks after awaits. A stop cannot be undone by an earlier start, including off→on→off or off→on while an old flag read finishes. A fresh explicit enable can authorize a fresh start; stale continuations cannot.

Consent writes serialize invocation order independently of the start queue. Opt-out sets a runtime block and invokes native stop immediately, before any persistence await and without waiting for a flag read. It still attempts to persist off if native stop throws, then reports failure. Failed off persistence leaves the runtime block in force even if stored consent remains1. setPassiveOptIn(false) now shares this revocation behavior, so callers cannot bypass the stop by using the lower-level setter. A plain debug stop cancels already-pending starts but leaves saved consent intact; a later fresh foreground/start may resume, preserving debug-stop versus opt-out distinction.

Starts serialize with one another. They do not hold the consent-write queue while awaiting flags, so a hung flag cannot prevent opt-out persistence or immediate stop. Queue rejection is contained for later recovery. Native start/stop bridge methods are synchronous; there is no await between final guard and native start.

## optInAt and partial writes

Preserved exact first-opt-in policy and write order: write consent1, then read first timestamp, then stamp only if absent/falsy; re-enable never replaces an existing timestamp. No timestamp removal or reset on opt-out. Timestamp read/write failure can therefore leave consent1 persisted while the operation rejects. In this runtime the incomplete enable remains blocked until a later explicit successful enable. Strict status still truthfully reports stored consent1, matching the UI's incomplete-enable message. An interrupted/rejected earlier enable may stamp the first timestamp before a queued opt-out completes, as under the existing first-opt-in contract; this packet does not redefine it as successful native-monitor start time.

Off persistence and native stop are not atomic. Both are attempted; if both fail, the storage rejection surfaces and native state is unconfirmed. A stop failure cannot guarantee monitoring ceased. A stopped native monitor plus failed JS off-write leaves saved consent1; cold restart can later allow foreground JS to start again. The runtime block cannot survive process death. Solving that requires a reviewed durable intent/bridge protocol, not claiming this in-memory generation is durable consent revocation.

## Executed controls

New actual-helper suite:16/16 pass. Baseline same suite:12 fail/4 pass. Corrupt consent variants, unavailable reads, direct bypass, pending flag resume, failed off write, prompt off persistence, native-stop throw, pending enable overwritten by off, off→on invalidation, debug stop, timestamp failure, first timestamp preservation, flag/permission gates and recovery all covered.

Combined scratch:60/60 pass across new16, existing opt-in/day7 twelve, and Mendel's32 mounted UI cases with Chandra's REPAIR_OWNER.patch applied. One UI case intentionally changed: failed off persistence now observes immediate stop once, then explicit retry observes stop twice. UI_TEST_EXPECTATION.patch contains only those two count changes. All other UI tests unchanged. Candidate.log and baseline.log retained. Actual helper logic runs with mocked native/flags/storage; no real permissions/location operations. No full repository typecheck or full suite claim.

## Limits and integration

The clock/queues exist only within one JS module instance. Cross-runtime/cold restart, capture-owner provenance, global ownerless queues and native resume are not solved. Already-started OS monitoring requires successful native stop; no lock-screen or queued-record deletion claims. Direct native calls outside these helpers are outside this guard. Delayed old-account caller actions that invoke a NEW enable require separate caller/account ownership guards; this patch does not silently add an auth listener.

Apply PASSIVE_START_STOP.patch only as additive hunks. Apply UI_TEST_EXPECTATION.patch after Mendel's packet; keep Chandra's repair-owner patch. Core patch does not alter settings, intro, debug, layout, shared history or radius code. Main should obtain independent review and run its integration/type gates. Exact hashes bind tested helper and patches.
