# Passive next audit — bounded radius correction

WORKING TREE / offline actual-source evidence. Proposed additive PASSIVE_RADIUS.patch changes passive-pipeline.ts and adds five tests. No repository edits, paid calls, installs, native builds or device operations.

## Smallest shippable candidate

The shared nearby-cache quantizes latitude/longitude into 0.0015-degree buckets. Passive resolution requests a 75m radius for stop/visit observations (300m for SLC), then trusts a cache hit as if it were fetched around the current stop. Two locations roughly 133m apart can share a bucket. A restaurant at the old query center is therefore offered for the new stop, despite exceeding its existing search radius. The current attribution ceiling merely makes it unchecked; it does not remove the false candidate.

The proposal excludes venues with valid coordinates demonstrably beyond the current source's existing resolution radius before ranking, refusals and confidence evaluation. It applies consistently to cache/catalogue/provider rows; no new lookup or cache change is introduced. Missing/invalid venue coordinates retain the previously tested recoverable, unchecked behavior. No global dwell threshold changes, source inference, home/work reclassification or new native protocol.

## Reproduction and executed controls

Actual nearby-cache storage/bucketing and actual resolver/ranking/confidence/digest modules execute. Data boundaries, native APIs, analytics and account query responses are mocked; Google and database calls throw if attempted. All fixture coordinates are synthetic.

Five added cases: same-bucket 133m neighbor rejected; mixed distant row plus in-range eight-minute chain coffee preserves only coffee; 65m uncertain suggestion remains; SLC's 300m radius retains a 120m candidate unchecked; missing coordinates remain recoverable/unchecked.

Baseline: 2 failures /20 passes across five new and seventeen existing attribution tests. Candidate: 22/22 pass. The two failures are the actual cache collision and extra distant candidate in the coffee fixture. candidate.log and baseline.log contain results. Main's existing attribution controls additionally cover centroid matches, two-door ambiguity, bad coordinates, poor accuracy, excluded/refused nearer rows and five-minute chain coffee. No full suite or typecheck is claimed.

## Limits / tradeoff

The guard uses the existing query radius as the acceptance boundary; it does not claim GPS containment or calibration. A real venue outside that radius can be omitted, consistent with the requested search envelope. It cannot distinguish a bus stop at a restaurant centroid from a meal. It cannot recover an in-range venue absent from an adjacent-center cache response; if all cached rows are out of range it returns no resolution through the existing terminal no-candidate behavior, without buying another lookup. Main should independently assess this conservative precision/recall tradeoff before integrating. This is a proposed correction, not independently approved content.

The mixed-row result can become less ambiguous after out-of-radius candidates are excluded. Its confidence remains governed by the existing source/accuracy/matched-distance gates. The existing all_filtered_out diagnostic includes radius filtering as well as loggability after this small proposal; no new analytics event vocabulary is introduced.

## Native/account plan assessment

Read passive-native-reconciliation/PLAN.md and passive-account-isolation-plan/PLAN.md. Stable stop revisions, completion re-emission, evidence freshness and 120m native grouping need coordinated native identity/acknowledgement and ownership changes; a JS-only retry of today's one-shot five-minute record cannot manufacture the missing twelve-minute evidence. No such patch is proposed here. Repeated short work-history coffee and the source-aware precheck ceiling are already fixed and preserved.

Capture-time account provenance, ownerless legacy queues and already-sent operations remain unresolved by this radius proposal. Existing mirror request ownership is not capture ownership. No new account listener, native activation, migration or automatic adoption is proposed.

If main rejects the radius tradeoff, keep this as a reproduced finding and do not broaden it into paid fallback. The next bounded app defect to investigate is strict/serialized cluster-history storage: its read-modify-write can lose concurrent qualified history, and read failures currently masquerade as empty history. That needs a separate queue/failure contract and actual storage controls, not a threshold adjustment; it is not fixed or proven here.
