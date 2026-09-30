# Independent passive storage strict-read review

WORKING TREE/offline synthetic execution. **Approve current passive-runner.ts/passive-capture.ts changes unchanged for bounded strict-read safety.** No repository writes, installs, services, native device calls or additional implementation correction.

## Semantics and ordering

Runner loads processed IDs and retries before native drain. Rejected read, malformed JSON/envelope and present empty string cannot authorize native acknowledgement, qualification or venue resolution. Missing keys remain verified-empty. Durable raw read is strict even when native module is unavailable or its pending queue is empty. Raw persistence still precedes native clear. Debug/display getQueuedVisits remains best effort and cannot authorize a destructive handoff.

Validation matches existing writers: nonblank string IDs, nonnegative safe-integer attempts and finite nonnegative firstFailedAt. No UUID-only restriction or required modern observation fields; identity-only older raw rows pass to qualification unchanged. Zero-attempt/zero-date retry envelopes remain accepted. Duplicate processed IDs remain accepted and collapsed by Set. IDs are checked for blankness without rewriting their value. Native source emits string UUID IDs; inspected TypeScript bridge getPendingVisits/clearVisits contract is compatible. No Swift/native runtime execution.

The raw durable validator deliberately does not validate lat/lng/source/accuracy/time observations; qualification owns those rules. It does not prove newly returned native payload validity if a broken bridge violates its typed contract. Native clear return-count is still ignored; no new acknowledgement guarantee is claimed.

## Executed independent evidence

Used main's FINAL Map-backed AsyncStorage test, not its earlier recursive-spy artifact. Plain async Map methods preserve empty strings and permit restoration without recursive jest.fn rebinding. No initial24-failure figure is used.

- Final main24 + independently written10 controls:34/34 pass,2 suites, exit0.
- Exact same final tests against committed pre-change runner/capture:26 fail/8 pass, exit1. Fresh negative run, not reused author baseline.
- Independent controls cover legacy identity-only raw data; zero retry metadata; duplicate processed IDs; failed merge persistence followed by recovery preserving older record; native clear rejection with durable handoff retained; corrupt durable queue with empty native queue; processed/retry read failure guard release and retry; invalid retry identity before native access; native-unavailable strict-read/legacy success.

Tests run actual copied runner/capture with synthetic native/storage/flags/qualification/notification boundaries. Legacy rows reaching qualification are verified; their actual qualification eligibility is not asserted. No real venue/paid lookup, SDK auth or notification scheduling is used. FINAL.log/BASELINE.log and HASHES.json preserve evidence. Optional durable independent file passive-storage-independent.test.ts uses repository-relative imports and can be placed in mobile/lib/__tests__.

## Recovery and unresolved limits

Run-level read failure rejects before drain and existing running finally releases admission. These failures do not enter per-item attempt handling because processing never began. Later lifecycle invocation can recover after a transient read error. Permanent malformed storage is deliberately preserved and blocks the queue until repaired; no silent reset or automatic corruption repair is implemented.

Native-clear failure after durable persistence leaves the saved raw copy for retry. AsyncStorage writes for retry/processed/raw are still separate and not transactional; partial writes/lost acknowledgements can replay work. No revision conflict guard, whole-queue lock across runtimes, monotonic persistence or ownership namespace. Duplicate raw IDs within legacy arrays, processed/retry contradictions, bounded queue capacity and captured-time account ownership remain existing semantics.

Changing load order cannot prevent another writer from changing bookkeeping after its read. This is not paid-call admission accounting, infinite retention, cross-account isolation or exactly-once processing. Existing misleading runner comment saying drained records exist nowhere else remains historical; durable JS handoff precedes native clear.

No new full app/typecheck/device proof. Source changes accepted only at hashes in HASHES.json; compare if main edits after this review.
