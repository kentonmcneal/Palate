# Invalid passive observations — independent review

**APPROVE the bounded working-tree validator change. No source fix required.** This is WORKING TREE / offline execution, not native or device proof. HASHES.json pins the tested source; the copy still matched main at packaging.

## Compatibility assessment

Current native makeRecord emits finite numeric coordinates/accuracy, numeric epoch milliseconds (potentially fractional), capturedAt, and nullable arrival/departure for CLVisit sentinels. Valid closed shapes remain accepted. Null bounds retain `open-visit` and cannot teach history. Missing legacy `source` remains compatible; source-specific accuracy thresholds are unchanged. SLC500m remains eligible for qualification but excluded from precise cluster learning.

Coordinate zero, poles/dateline and zero accuracy remain valid. Numeric strings, null accuracy, booleans, arrays/objects used as timestamps, nonfinite numbers and dates outside JavaScript's representable range are rejected. The new guard also protects clustering independently. Long valid work/home observations still teach history even when they exceed meal duration; zero/reversed durations cannot teach it.

Representable capturedAt values at epoch zero, negative epoch, Date limits and future dates remain accepted. That is intentionally **format/representability validation**, not freshness, clock sanity or temporal ordering validation. Current capturedAt/departure ordering and native five-minute timing are untouched.

The guard is not a full queue-envelope validator: null whole records, invalid IDs, unknown source enum values and hostile non-JSON coercion objects are not newly handled. In qualifyVisit, dwell computation still precedes the guard; normal parsed JSON malformed fields tested here fail closed, but this does not warrant a universal arbitrary-JavaScript-object safety claim. No such broad claim is needed to approve this scoped change.

## Executed proof

- Main54 invalid-observation tests plus existing44 cluster and17 attribution cases: **115/115 passed, 3 suites**. JEST.log records execution against copied source and installed mobile dependencies.
- Independent actual-source VM controls: **27/27 passed, zero external boundaries invoked**. Actual runPipelineForRaw/qualifyVisit/recordForClustering execute; storage and flags/telemetry/native logging are local mocks. Cache/catalogue/Places/confirmation boundaries throw if reached. This validates that malformed records do not proceed to those boundaries, not successful venue resolution.
- Independent controls against pre-change HEAD pipeline: **10 failed /17 passed**; nine attempts reached throwing external-boundary mocks. No real network calls occurred. BASELINE.log is expected negative evidence; current CONTROLS.log is green.

Independent cases cover missing/null/unrepresentable capturedAt, array/object dates, null accuracy and nonnumeric coordinates; all four native/legacy source shapes; three open-bound shapes; fractional milliseconds; representable captured-time extremes; long work, zero/reversed dwell and SLC clustering; JSON serialization of NaN to null. Actual native producer/bridge shapes were read in source, not executed.

Main's suite relies on repository Jest setup for AsyncStorage and Supabase mocks; it does not test runPipelineForRaw. The independent runner controls add explicit throwing downstream boundaries. No test invokes Google, database or notifications. No native freshness/device evidence or full-mobile-suite/typecheck claim is made by this review.

## Reproduction

```sh
/opt/homebrew/bin/node outputs/passive-invalid-independent/controls.cjs
```

PALATE_MOBILE optionally locates an existing installed mobile TypeScript dependency. Exact source snapshots and logs accompany this report. No repository changes, dependencies, live services, permission requests or production calls. No corrective patch supplied because none was required within scope.
