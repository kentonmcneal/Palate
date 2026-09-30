# Passive history safety — author packet, independent review pending

WORKING TREE, executed offline in copied source. Proposed additive patch changes only passive-pipeline.ts history helpers/qualification and adds fifteen tests. No repository edits, paid calls, native changes or account-isolation claims. Radius resolution hunks are untouched.

## Source and consequences

Read actual pipeline helpers and runner call sites before changing. Cluster-history key accesses occur only in passive-pipeline.ts in the searched mobile production source. runPipelineForRaw first qualifies, then records history, then resolves/notifies. processPendingVisits catches retryLater separately from ordinary failures. The runner has a same-runtime admission guard, but exported pipeline/helper entry points are also available to debug/direct calls; helper safety must not depend on every caller using that guard.

The old load helper catches storage/parse failures and returns []. Thus unavailable history can authorize the new-user five-minute floor instead of a known-away twelve-minute floor, skip real home/work suppression and let recordForClustering overwrite the stored evidence. Valid JSON with wrong field types may also influence suppression. Independent overlapping records can read the same old array and lose one update. A reader can qualify while an already-enqueued work-evidence write is pending. qualifyVisit previously read two different history snapshots for travel and suppression.

## Proposed behavior

One promise queue serializes all reads and read/merge/write operations in this JS module. Locked helpers never enqueue recursively. Each rejection releases the tail so a later successful storage operation can recover. Qualification obtains one snapshot and uses it for both travel and home/work decisions.

Only getItem returning null means missing/empty. JSON parse, shape, coordinate, hour, weekday, optional dwell and optional identity errors make history unavailable. Legacy points lacking dwell/visitId remain accepted with their existing semantics. The proposal never deletes, repairs or adopts malformed stored bytes. Optional present values must have their documented types.

Read and write failures throw the existing retryLater error. No normal suppression/admission outcome is returned from unknown history, and no resolver call follows it. Record validation remains before history access; invalid/coarse/incomplete observations still cannot write. Existing local/travel floors, long-stay learning, ID replacement, 500-point cap and work/overnight thresholds are unchanged. A write that succeeds then rejects can replay the same ID without adding another point.

## Executed proof

Candidate: 132/132 tests across four suites. Baseline: 12 failures /120 passes using the same tests. Logs: candidate.log and baseline.log. Fifteen new controls plus 117 existing pipeline, clustering and invalid-observation cases.

New controls: concurrent distinct IDs; read during pending work-evidence commit; truly missing key; empty string, broken JSON, wrong array shape, null entry and invalid weekday; rejected read; rejected write with recovery; persisted-then-rejected write replay; valid legacy rows; actual runner four retries without attempt burn then recovery; concurrent same ID; single snapshot qualification. Existing tests retain invalid/coarse/incomplete/short-travel rejection, recurring short coffee versus work/overnight evidence, travel floors and ID idempotency.

Actual pipeline, clustering and runner execute with synthetic data. The test's explicit in-memory AsyncStorage boundary supports controllable failures and deferred operations. Resolution/service/native/notification boundaries throw or are mocked; no services are invoked. No full repository typecheck/suite or device validation is claimed.

## Runner and durability limits

History failure prevents further work for that record and goes into the runner's existing retry queue, without increasing attempts. It is retried on a future runner invocation; this patch adds no timer. Persistent corruption therefore blocks processing until storage is repaired externally; it is not silently reset.

The runner still retains at most 50 retry entries and 1,000 processed IDs, and retry/bookkeeping writes themselves can fail. Native acknowledgement and cross-store crash atomicity are unchanged. Do not interpret the zero-attempt policy as unlimited guaranteed retention. No automatic migration/cleanup or broad queue redesign is included.

Serialization is within this JS module instance, not a multiprocess storage transaction. Different JS runtimes or external writers remain outside its lock. Qualification and subsequent history insertion are individually queued operations, not one transaction spanning asynchronous resolution. Existing self-history on later resolution retries and legacy duplicate points are unchanged. Capture-owner provenance, global ownerless storage, native completion revisions and cross-account isolation remain separate unresolved work.

## Integration

Apply patch hunks, not copied source files. The pipeline hunks are in cluster-history and qualification sections and do not alter the radius proposal's resolution section. Main should independently review and run its current typecheck/full suite after combining concurrent changes. Test artifact is history-safety.test.ts; patch destination is passive-history-safety.test.ts. Exact source/test hashes accompany this report.
