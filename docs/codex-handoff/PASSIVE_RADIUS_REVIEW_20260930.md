# Radius correction — independent review

**WORKING TREE / offline: approve bounded radius filtering with DEGRADED_RADIUS_FIX.patch.** One retry regression must be corrected before integration. No repo edits, real provider/database/native calls, or installations.

## P2 — degraded far-only response becomes a terminal miss

The author filters radius after the provider's existing degraded-response emptiness check. A degraded response with loggable but entirely out-of-radius rows passes that check, loses every row afterward, and returns null. The runner maps null to terminal no-venue-found; an unavailable lookup has therefore become a permanent miss. This is introduced by the new filtering path, although previously those distant candidates were wrongly offered instead.

An independent actual-resolver test reproduces this: original candidate has 1 failure/9 passes. DEGRADED_RADIUS_FIX.patch carries the degraded flag forward and throws the existing retryLater error when radius/type filtering leaves no usable rows. The final assertion checks retryLater:true, not just any exception. No second provider request is made. Existing all-refused behavior is unchanged.

## Confidence and coordinate policy

Removing distant candidates can raise confidence enough to precheck the remaining precise centroid match. An independent control proves that behavior. This is consistent with existing source, accuracy, matched-distance and single-candidate gates: the excluded 120m venue is outside the requested75m search envelope. Approval accepts this explicit policy tradeoff; it is not proof of building containment or a calibrated improvement. A venue just outside75m is omitted even with poor position accuracy; thresholds are unchanged and no paid fallback is added.

Unknown/invalid venue coordinates remain eligible but do not independently authorize precheck. A matched centroid plus an unknown-coordinate candidate remains ambiguous/unchecked. Null and out-of-range latitude controls execute; NaN/Infinity supplied through the actual JSON cache normalize to null, so those cases are serialization/missing-coordinate evidence rather than direct nonfinite runtime tests. The source guard directly checks Number.isFinite and latitude/longitude bounds.

## Executed evidence

Final **32/32 tests,3 suites pass**, exit0:10 independent controls,5 author radius cases,17 existing attribution cases. Actual resolver, nearby-cache, ranking, confidence and digest execute; IO boundaries are mocked. FINAL.log and ORIGINAL.log record results. The author's actual cache bucket133m collision control is reproduced. No physical/native or paid transport evidence is claimed.

Independent controls cover cache confidence escalation; cache no additional lookup; catalogue all-far terminal result with no provider fallback; ordinary provider all-far result; degraded provider all-far retry; invalid coordinates; mixed unknown/centroid ambiguity; and consistent catalogue/provider row filtering. Provider fixtures use one synthetic provider function response, not a real Google request. Cache/catalogue exclusion does not buy another lookup. Existing SLC300m and65m unchecked controls pass.

## Integration and limits

Apply author PASSIVE_RADIUS.patch, then DEGRADED_RADIUS_FIX.patch. TESTS.patch adds the independent controls. HASHES.json binds reviewed source and patches. No source beyond passive-pipeline or unrelated capture/account policy is changed.

Returning no candidates for a nondegraded cache/catalogue hit can still lose an actual in-range venue omitted from that cached query; this precision/recall tradeoff is explicit and accepted within the requested envelope. No fallback repair, cache redesign, GPS containment, capture ownership or global privacy guarantee is established. all_filtered_out now includes radius exclusion; rejectedSample still only lists nonloggable rows, so diagnostics do not fully explain radius misses. This is a nonblocking existing diagnostic-shape limitation, not evidence of zero misses.

Status honesty remains next once its author report is READY.
