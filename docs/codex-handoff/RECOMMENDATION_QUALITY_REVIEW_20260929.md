# Independent recommendation-quality review — 2026-09-29

**WORKING TREE — approve the bounded production patch. No additional production correction is required.** Its three changes repair demonstrable pipeline behavior: absent cuisine no longer establishes novelty, Right Now selects a not-known-closed option within the existing strategy pool, and repeated metadata no longer counts as repeated evidence. This is independent of the proposal author. No human relevance, satisfaction, live prevalence or mobile performance claim follows from this review.

The repository was read-only. Baseline production hashes match the author's five-file manifest; the repository HEAD observed during review was `a57e72a0e49a29ee56497d7258647f9dc1a7f6ea`, newer than the author's report. The patch was reproduced in an isolated copy, and reverse applicability verified that the copy matches the supplied patch. `BASE_HASHES.json` and `PATCH_SHA256.txt` pin the reviewed sources/artifact. Concurrent backlog changes were untouched.

## Pipeline and semantic findings

**WORKING TREE / source and execution — hard filtering remains upstream.** `generateCandidates` applies `filterRecommendable` with the user's hidden set, then venue deduplication, then pool assignment. Right Now's new selector only chooses from already-filtered strategy candidates; its fallback cannot reintroduce a discarded input. Hidden IDs, permanent closure, explicit fast-food formats/types, chain names, national-name detection, chain-brand flag and classifier eligibility below 0.5 are covered by the independent controls for every strategy.

Important existing data-contract distinction: **`quick_service` alone is intentionally eligible**, because the classifier also uses it for cheap independent food. `FAST_FORMATS` does not contain that value. Broad older comments saying every quick-service venue is excluded are inaccurate; this patch correctly does not turn a low-price proxy into a new hard exclusion. `CLOSED_TEMPORARILY` also intentionally remains eligible; the exact permanent enum is excluded. The independent tests pin these policies rather than silently redefining them.

**WORKING TREE — missing cuisine fix is appropriately narrow.** With no region/subregion/type, a shared format or flavor is not evidence of unfamiliar cuisine. The guard fixes both format-only and flavor-only adjacency, leaving those records in ordinary pools. Classified unfamiliar cuisine can still enter adjacent discovery. Known type/subregion cases remain covered by the existing regression suites. This does not infer a cuisine for unknown rows or invent taxonomy equivalences. Region-only/mixed-granularity policy remains unchanged.

**WORKING TREE — availability is a selection preference, not a new hard filter.** The helper preserves strategy order among open/unknown choices, falls back to the original first choice only when all members of that strategy subset are closed, and also applies to the secondary Stretch selection. Unknown hours remain eligible without being labelled open. Compatibility values, browsing ranking and strategy-specific exclusions remain intact. An available venue excluded by the strategy does not cause a cross-strategy fallback; that is the documented boundary, not a global open-venue guarantee.

The actual `venueOpenAt` parser is reused. Independent cases verify opening-minute inclusion, closing-minute exclusion, overnight periods, week wrap, and the always-open sentinel through the actual Right Now pipeline. The mapper retains Google period arrays and the business-status enum. Device-local Date interpretation is unchanged: no venue timezone conversion is introduced. Malformed periods, invalid Dates, stale provider hours and partial-period interpretation are existing parser limitations, not certified by this patch.

**WORKING TREE — metadata deduplication preserves distinct evidence and weights.** Tags are lowercased as before, then Set-deduplicated before adding acclaim/negative values. Distinct supporting tags still add their separate values. Exact occasion keys are deduplicated before learned affinity summation and time-slot hit counting. Classifier/LLM schema uses the lowercase underscore occasion keys exercised by the tests; free-form gem tags retain their existing lowercase/hyphen convention. There is no new whitespace normalization, taxonomy rewrite, or broad removal of distinct labels.

`sumAffinity` is also referenced by flavor scoring, but **FLAVOR_WEIGHT is currently zero**. Do not claim this patch improves flavor-based compatibility discrimination. Flavor adjacency can affect stretch pooling; flavor compatibility is disabled by existing policy. Independent controls verify that repeated or distinct flavor labels and changed flavor counts do not accidentally re-enable that weight. Occasion affinity and distinct acclaim controls establish that the active scoring dimensions are not flattened. History observations themselves are not deduplicated by this patch.

## Validity of the 82 new controls

**WORKING TREE — valid synthetic invariants, reproduced.** The suite invokes real graph assembly, mapper/pooling where applicable, scoring, shortlist, and Right Now; I/O modules are replaced with throwing mocks. The key metamorphic oracle—duplicating one fact must not change rank/score—is independent of the production weight formula. Null cuisine and known-closed alternatives use semantic selection oracles, not golden relevance labels.

The 82 count includes diagnostic and preservation tests, not 82 newly failing defects. The baseline has 45 failing and 37 passing cases exactly as reported. In particular, the paired-score diagnostic only asserts pipeline shape; its console scores are evidence, not a separate ranking-quality guarantee. Cold-start synthetic subregion keys test diversity mechanics and are not assertions of a real-world cuisine taxonomy. Reversed-order checks test exclusion/diversity properties rather than unsupported tie-ID stability. Dense 2,000-row cases process supplied inputs and do not exercise live retrieval/truncation.

The author's all-closed cases use one candidate. Independent two-candidate controls additionally preserve closest versus quality ordering when both venues are closed. Independent time-boundary, extra hard-enum, flavor-only unknown-cuisine and meal-slot controls extend the scope without modifying production code.

## Reproduction and artifacts

**WORKING TREE — executed offline in copied sources:**

- Original baseline + author's exact new suite: **45 failed / 37 passed / 82 total**, matching the report (`BASELINE.log`).
- Additional independent boundary suite on baseline: **8 failed / 13 passed / 21 total** (`INDEPENDENT_BASELINE.log`).
- Additional independent boundary suite on proposal: **21/21 passed** (`INDEPENDENT_PROPOSED.log`).
- Full recommendation suite including those 21 controls: **27 suites / 406 tests passed** (`PROPOSED_COMPLETE.log`). Subtracting the independent additions reproduces the author’s **26 suites / 385 tests**.

The initial full-suite workspace copy omitted app/components files that several existing tests inspect as text. That setup produced missing-file failures, not ranking failures. The complete rerun includes those files. Initial reviewer assertions also incorrectly treated quick_service as a hard exclusion and flavor weight as active; source inspection corrected those test assumptions before the final 21-case run. No production code was changed to satisfy them.

`INDEPENDENT_CONTROLS.patch` optionally adds only `mobile/lib/recommendation/__tests__/independent-boundaries.test.ts`. It is additive to the author's patch and does not replace its 82-test file. The standalone test text is also included; install either the patch or the file, not both.

Reproduce in a workspace copy from mobile:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/recommendation/__tests__/
```

No independent full-app TypeScript check, device/browser execution, live catalogue/history retrieval, API call, dependency installation, deployment, or human evaluation was performed. The author's typecheck remains author evidence. Frozen fixtures used by preexisting regressions are local historical fixtures, not fresh service observations. Existing eligibility/metadata/hours caveats remain; no further coverage is claimed.
