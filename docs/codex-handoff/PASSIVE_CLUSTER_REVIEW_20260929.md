# Independent passive-detection review

**WORKING TREE / offline RUN: accept COFFEE_CLUSTER_FIX.patch as a bounded clustering/history correction.** No additional production patch is required for that scope. This does **not** certify NYC transit precision, recover all short coffee visits, or establish what caused the user's specific 7 Brew miss.

Reviewed final candidate SHA-256: `9d8eb7792d21a5ecc72e1534817e6a4b355f71439ae28f284f985274eae06f26`. Baseline pipeline SHA-256: `e2fa27c56ea2d80e0ddad6946973336b4a11466d811cbe30232341015f54e425`. Captured source/patch, author report and hashes are under reviewed/. No direct subagent messaging tool was available; review used Darwin's shared packet, which was marked ready and hash-consistent at final capture.

## Confirmed fixes

1. **Brief weekday stops no longer become workplace evidence.** Original source counted hour/weekday without duration. Three one-minute observations at 09:00 could suppress a later ten-minute visit. Candidate requires known finite dwell >=120 minutes in the existing weekday/non-lunch hours. Stored legacy five-minute daytime points immediately stop counting as work; legacy missing-duration daytime points also stop counting. Positive controls at exactly 120 minutes and eight hours still suppress after three distinct IDs.
2. **Rejected short observations no longer establish a new known area.** Actual runner qualifies, then calls recordForClustering even on qualification failure. Original six-minute away stop was rejected at the twelve-minute floor, but recording it made the next stop nearby “local” and eligible at six minutes. Candidate reuses the local/away floor before writing. Four successive rejected six-minute away stops through the actual runner retain only the distant home record, never reach the resolution flag, and do not lower the next floor.
3. **Sequential retries do not manufacture distinct evidence.** Same raw ID replaces its earlier record rather than appending. Four retries of one eight-hour record remain one point. A later five-minute→eight-hour update of that ID also stays one point. This is not transactional concurrency or physical-stay deduplication across different native IDs.
4. **Invalid/coarse records do not teach a precise cluster.** New records reject open/null bounds, nonfinite/nonpositive dwell, invalid coordinates and negative/nonfinite/>100m accuracy. Exactly 100m and genuine long stays remain accepted as cluster evidence. Eight-hour dwell remains available to work inference despite failing the four-hour meal ceiling.

No dwell floor was reduced: local 4.99 rejects, 5 accepts; away 11.99 rejects, 12 accepts. Four five-minute weekday coffee observations through the actual runner survive qualification and do not become “work.” Resolution is deliberately disabled by a mocked flag at that point; this test proves qualification/history flow, not successful venue lookup or logging.

## Tradeoffs and retained data

The 120-minute work rule is a conservative heuristic, not a calibrated office classifier. Long cafe visits can still look like work; workplaces with short or nonstandard shifts and unknown-duration legacy daytime evidence may no longer be inferred. Existing 11:00–15:00 lunch exclusion and weekends remain. This tradeoff removes unjustified short-stop workplace inference without treating recurrence alone as proof of a meal.

New records add visitId but retain the existing storage key and 500-point cap. Existing rows remain readable; there is no clearing/migration of old history. Legacy overnight points remain active. Coarse legacy rows cannot be retrospectively distinguished because stored points lack accuracy. Same-ID replacement preserves other stored records but is not guaranteed monotonic if callers submit a shorter later version. The current native path does not guarantee same-ID duration revisions. Concurrent AsyncStorage read/modify/write races remain outside this patch, as the author states.

## Independent execution

`independent-controls.cjs` executes the complete actual TypeScript pipeline module and actual passive-runner.ts via installed TypeScript in a Node VM. AsyncStorage is an in-memory map. Analytics/native logging are no-op adapters; the resolve flag returns false; all other external boundaries throw. Qualification, cluster mutation and suppression are not mocked. No services are imported/executed.

| Run | Pass | Fail |
|---|---:|---:|
| Independent proposed controls | **40** | **0** |
| Independent original controls | 18 | 22 |
| Remove work-duration predicate | 34 | 6 |
| Remove history dwell-floor predicate | 38 | 2 |
| Remove ID deduplication | 38 | 2 |
| Author controls rerun on captured proposal | **30** | **0** |

The 40 include three explicit remaining-limitation characterizations, not three additional fixes. Other controls exercise work dwell boundaries 0.5/1/4.99/5/8/119.99/120/480 minutes, weekday/lunch hour boundaries, invalid inputs, coarse source, exact accuracy bound, legacy short/unknown/overnight data, long overnight positive controls, retry replacement and actual runner paths. Forbidden service calls: zero.

An independent confidence-helper run loads the actual confidenceScore and actual mealWindow. A synthetic 12-minute 09:00 stop, 10m accuracy, one plausible coffee_shop/quick_service venue and no prior visit scores **0.7624479 (high)**. The same inputs with three candidates cap at **0.625 (medium)**. Five/eight minutes with one candidate are medium. These are deterministic model outputs, not measured likelihoods or user accuracy. Identical measured inputs for coffee buying and waiting at a nearby bus stop remain indistinguishable to this helper.

## Native + JS boundary review: unresolved

Native PalateVisitManager.swift was inspected, not compiled or executed against CoreLocation:

- The continuous detector uses 120m spatial radius and a five-minute dwell threshold. Timer emission sets emitted=true; later departure emits only if !emitted. An early away stop can therefore be sent at around five minutes, fail JS's twelve-minute floor, and never produce a later longer record from that candidate. CLVisit may independently supply a completed visit, but no guarantee or device recovery rate is established. New history validation appropriately stops a rejected early observation weakening later thresholds; it does not reconcile that stop's eventual duration.
- Departed-stop emission uses stored center/lastSeen; in-progress emission uses current time. The timer can infer elapsed dwell without a new in-radius fix. This patch does not add stale-fix/movement evidence or validate timer behavior in NYC.
- Native sub-five-minute stops may never be emitted. Clustering cannot recover absent observations. No actual 7 Brew trace, venue row, duration, permission state or native event log was provided.
- Work/home positive tests use completed long observations, which the early-latching continuous path does not itself guarantee. Keeping long CLVisit evidence is useful, but does not prove reliable workplace learning.

JS attribution remains separate: confidence receives accuracy/dwell/category/prior/meal/density but no fix-to-winning-venue distance or source. Ranking has a distance signal, yet a lone nearby venue is not proof that the user entered it. The unchanged isLoggableVenue policy allows chain/fast-food reasons for capture; recommendation-chain exclusion is not a reason to drop an actual coffee visit. No broad threshold relaxation is supported by this review.

## Explicit remaining known-area/precision limits

- **Existing contaminated travel history remains effective.** A stored one-minute point near the new stop still makes the area known and allows six minutes. The patch cannot reconstruct whether old short points were originally away from known areas: old schema lacks time/area provenance. No destructive reset is proposed.
- **One accepted twelve-minute away stop still promotes the surrounding 50km area.** That is existing isAwayFromKnownAreas semantics, not a durable-home model. This patch closes promotion by newly duration-rejected points only.
- **Three five-minute 23:00 observations still imply home.** Overnight logic is intentionally unchanged, including legacy fallback. It remains a potential recurring late-night-stop false negative.
- **The advertised away two-hit suppression is not established.** Source computes away against all history, so an already-near cluster also makes away false and can select the ordinary three-hit threshold. No claim that this patch fixes hotel/away inference is accepted.

Accepting this narrow patch should not close the broader NYC bus-stop/7 Brew investigation. Next useful offline scope is source-aware completed-duration reconciliation and matched-venue confidence with paired transit/coffee scenarios, without pretending GPS-identical traces are separable. Native build/device observation would still be needed afterward. Digest scheduling, actual venue resolution, notifications and confirmation/logging were not independently executed here.

## Reproduce and integration

From workspace:

```sh
/opt/homebrew/bin/node outputs/passive-detection-independent/independent-controls.cjs
/opt/homebrew/bin/node outputs/passive-detection-independent/confidence-boundary.cjs
```

Optional source argument to independent-controls selects the baseline or an isolated mutant. Baseline and mutant runs intentionally fail. Main owns integration/gates/build. Read-only patch applicability passes; only mobile/lib/passive-pipeline.ts changes. No repository edits, live calls, installs, permission requests, migrations or device claims.
