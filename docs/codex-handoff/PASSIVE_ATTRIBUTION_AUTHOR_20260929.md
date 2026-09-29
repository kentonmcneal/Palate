# Source-aware matched-venue confidence proposal

## Outcome and exact scope

`MATCHED_VENUE_CONFIDENCE.patch` changes two production files plus focused existing tests:
- `mobile/lib/passive-pipeline.ts`: pass source and validated distance to the actual ranked winner into scoring.
- `mobile/lib/passive-confidence.ts`: require positional/source evidence before permitting the high band.
- `mobile/lib/__tests__/passive-confidence.test.ts`: qualify the existing ideal fixture with attribution evidence and add 13 regression cases.

No native code, qualification/dwell thresholds, candidate selection, ranking, Google lookup, clustering, persisted schema, digest implementation, or notification scheduling is changed. This patch is additive to the separate clustering proposal: apply the patch, not the entire copied pipeline file, so integration preserves any newer clustering edits.

Latest repository HEAD observed during validation: `f40e40e12355bbf5f4f5caab580c28b1775831be`. Exact captured base/candidate hashes are in SOURCE_HASHES.json. Read-only `git apply --check` passed against the current repo. Repo source was never edited.

## Reproduced defect

The actual resolver and scorer, followed by actual digest construction, turn a synthetic 45-minute lunch stop with 10m reported accuracy and a sole restaurant 65m away into a high-band/prechecked restaurant visit. Both `stop` and `visit` sources reproduce it. Distance helps rank the sole candidate but is absent from confidence; precise GPS describes the stop, not attendance at that restaurant.

A second actual reproduction: two plausible restaurants can still earn high confidence because the existing density ceiling for two is above 0.75. Two doors should not be answered on the user's behalf.

These are synthetic counterexamples, not evidence of an actual user's NYC bus stop or 7 Brew visit. No real coordinates/trace from a user were used; NYC coordinates merely anchor a synthetic metric offset.

## Conservative correction

Existing evidence weights and closed-venue penalty remain. Add a ceiling of **0.74** unless all conditions hold:
1. Known precise-source family: `stop` or `visit`. SLC is never sufficient for prechecking, even when it reports a small accuracy value. Legacy raw records without a source normalize to `visit` per the existing native bridge contract; unknown runtime strings do not qualify.
2. Finite, nonnegative reported accuracy no worse than **50m**.
3. Finite, nonnegative matched-venue distance within **max(20m, reported accuracy)**. Invalid/missing venue coordinates do not supply evidence.
4. Exactly one eligible candidate, using the full pre-top-three candidate count.

The 20m centroid tolerance and 50m precision ceiling are explicit, conservative **heuristics**, not calibrated probability thresholds or polygon containment. At 10m accuracy, a venue 15m away can still earn high; one 21m away cannot. At 50m accuracy a matched centroid can earn high, while 51m cannot. These boundaries are tested and require independent product review.

Medium remains an available, unchecked suggestion. The correction does not suppress resolution or erase a possible meal. Genuine near-centroid long lunches remain high; a five-minute synthetic chain coffee remains medium and captured. Recommendation-ineligible chain metadata remains loggable. Closed venues remain low. All changes only lower or preserve scores.

## Completed validation

### Actual-source synthetic suite

`attribution-controls.cjs` transpiles and runs actual pipeline, confidence and digest modules with explicit in-memory/cache/catalogue stubs. Unmocked imports throw. Google resolution and notification calls throw; authenticated database access is blocked. Both cache and mocked catalogue paths are covered, with `recommendableOnly:false` asserted.

- Original captured source: **12/26 pass, 14 expected failures**.
- Candidate: **26/26 pass**, **zero Google invocation attempts**.
- Red cases include sole venue 65m away (both precise sources), unknown/SLC source, 21/40/74m mismatches, two candidates, 51m accuracy, absent/invalid venue coordinates, catalogue path, strong prior/dwell failing to excuse a mismatch, missing direct attribution evidence.
- Passing controls include genuine centroids, 15m offsets, legacy source, 3/6 candidate ambiguity, 80/100/300m poor fixes, closed venue, short chain coffee.

The resolver-to-digest harness forwards the same score/band fields as `notifyOrInbox`; it does not execute inbox persistence or notification delivery. This is actual module execution, not mounted UI or physical-device proof. RED.log and GREEN.log preserve the completed outputs.

Run from workspace:

```
/opt/homebrew/bin/node outputs/passive-attribution-audit/attribution-controls.cjs
```

An optional first argument chooses a source lib directory; `PALATE_MOBILE` may point at an existing installation for TypeScript. No installation required.

### Existing-framework regression suite

Focused Jest against copied current source, existing mobile dependencies, no installation:
- passive-confidence, passive-digest, passive-pipeline, passive-ranking, passive-loggable
- **5 suites / 88 tests passed** (JEST.log).
- TypeScript `--noEmit` on the copied lib/components/modules plus theme: **exit 0**, empty TSC.log. The scratch copy does not include app routes, so this is not a whole-app typecheck.

## Compatibility and limitations

- Existing stored inbox entries retain their old scores/bands. This proposal does not retroactively clear historical prechecks; those entries lack matched-distance evidence for reliable rescoring.
- Other future callers of `confidenceScore` must provide source and matched distance to earn high. Missing data degrades to medium rather than manufacturing precision. Existing ideal unit fixtures are updated accordingly.
- Demotion can change digest ordering and which entries fit the existing six-item cap. Entries still use existing inbox retention/held-back behavior; no new prompt guarantee is claimed.
- A nearby bus stop can share the same centroid/uncertainty circle as a restaurant. GPS alone cannot distinguish those cases. High remains a heuristic, not proof of eating.
- `stop` does not prove a fresh successful one-shot fix: native timeout fallback can emit under the same source. This change uses reported accuracy, not unrecorded freshness/provenance. Native timer staleness and trace continuity remain separate work.
- Google centroids can lie far from the customer's table or drive-through lane. Such true visits may now need explicit selection, a deliberate conservative cost. No candidate is removed by this change.
- No billing, paid API, real user, device, deployment, or live-notification operations occurred.

## Native early-emission follow-up (separate scope)

The native primary stop detector emits around five minutes, sets an emitted latch, and normally does not emit the completed stay again. JS's away floor is twelve minutes. A real longer away visit can therefore be discarded based on the early sample. Correcting this requires explicit pending/reconciliation semantics or additional native evidence; globally lowering floors would also admit brief transit stops. No native change is included here, and this confidence patch does not recover sub-five-minute visits that never reach JS.

Independent review required before integration. Review exact cutoff tradeoffs, existing-history behavior, and preservation of separately reviewed clustering changes.

### Concurrent main integration checked

Main applied the clustering changes while this packet was being prepared. The pipeline base hash therefore no longer matches current main; the only observed difference was that separate clustering patch. The attribution patch still passes application checking. Applied it to a fresh **scratch** copy of main's three target files and unchanged digest: attribution **26/26** and clustering **30/30** both pass (INTEGRATED_ATTRIBUTION.log, INTEGRATED_CLUSTER.log). This explicitly verifies additive integration without reverting main's clustering work. Copied source in this packet remains the original attribution-only candidate; use the patch for integration.
