# Passive history safety — independent review

**WORKING TREE / synthetic offline: approve with IDENTITY_GUARD.patch.** Reviewed final author report and history hunks against current main pipeline/runner in scratch. No repository writes.

## P2 — writer can create history rejected by new strict reader

recordForClustering checks coordinates/timestamps/accuracy but not raw.id. It writes an empty, null or numeric ID unchanged. The proposed strict reader rejects those values, so a malformed direct/debug invocation can poison the shared history and make later valid qualification retry indefinitely. Existing production queue validation limits exposure; this is a helper-boundary mismatch, not evidence of a normal native record doing this. The writer's permissiveness predates the patch, but its interaction with the new reader creates the blocking consequence.

Three independent controls reproduce invalid incoming IDs being appended. IDENTITY_GUARD.patch rejects missing/non-string/empty incoming identities before storage, consistent with the function's existing early-return policy for invalid observations. Valid legacy stored points without identity remain readable; this does not repair or delete existing malformed bytes. The guard does not change qualification thresholds or normal IDs.

## Executed evidence

- Original candidate: **12 independent controls pass,3 fail** on incoming identity validation (IDENTITY_RED.log).
- Corrected: **147/147 tests,5 suites pass**, exit0 (FINAL.log):15 independent,15 author history,117 existing pipeline/cluster/invalid-observation controls.
- Independent controls cover nine malformed stored field variants, queued write rejection followed by successful independent append, concurrent short coffee records remaining eligible, concurrent appends preserving the500point cap, and three malformed incoming identities.
- Author controls reproduced actual runner retryLater retention without attempt burn, failure recovery, ambiguous persisted-then-rejected write replay, legacy compatibility, concurrent IDs/same ID and qualification's single snapshot.
- Actual source executes with explicit in-memory AsyncStorage and mocked/throwing service boundaries. Harness setup is adapted from author; independent scenarios/assertions are added. No native device, notification, paid/API or auth service invocation.

Current main passive-pipeline.ts and passive-runner.ts were copied before author history hunks were applied. The complete catalogueCandidates/resolveVenue suffix is byte-identical to current main: accepted radius/degraded-response retry/diagnostics are preserved (PRESERVATION.md). Other dependencies use author scratch. This is not a full latest-main test/typecheck claim; main should run integration checks. Hashes bind patches/report/final pipeline in HASHES.json.

## Semantic and concurrency assessment

Only null means missing history. Malformed/unavailable storage cannot authorize the new-user floor or silence home/work evidence. Legacy points lacking dwell/identity keep existing behavior; present invalid fields are rejected without rewriting bytes. All local readers and merges share one promise tail; a rejection releases it, and locked functions do not recursively enqueue. One qualification snapshot now drives travel and suppression. Concurrent short coffee observations do not meet work duration, while queued genuine work evidence is observed before later qualification.

The patch's choice to retry unknown history is conservative and coherent. It can block otherwise processable observations when stored history is persistently corrupt. No automatic repair is claimed. Qualification and record insertion are separate queued jobs, so this is not a transaction covering the complete pipeline. Already-written evidence may affect later retries as before. Existing caps, legacy duplicates and ID update ordering remain unchanged.

## Integration and limits

Apply PASSIVE_HISTORY_SAFETY.patch then IDENTITY_GUARD.patch. TESTS.patch adds15independent controls. No other production correction is needed in this bounded review.

The lock is one module instance, not cross-runtime/multiprocess protection. Retry queue caps and storage failures can still lose records; zero attempt increment is not indefinite guaranteed retention. Global history remains ownerless and may influence another account. Travel and home/work heuristics remain heuristics, not verified ground truth. No native acknowledgement, capture revision, account isolation, storage migration or global durability guarantee is established.
