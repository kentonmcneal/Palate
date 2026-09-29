# Offline recommendation review and patch — 2026-09-29

Base: COMMITTED Palate `8cea049`. Deliverable: `palate-ranking-review.patch`.
Implementation and validation took place ONLY in a workspace copy. No Palate repo
writes, installations, permission requests, credentials, live data/API requests,
commits or deployments. Installed native Node and Jest were reused.

## Changes proposed (WORKING TREE, workspace copy)

1. `mobile/lib/recommendation/compatibility.ts`: only include a restaurant's format
   or occasion dimension in behavior fit when the user has history for that
   dimension. Empty maps are absence of evidence, not evidence against the venue.
   With price-only history at price 2, revealing format and occasion previously
   lowered an identical restaurant from 71 to 55 match; the patched pair remains 71.
   Existing format/occasion history still discriminates between matching and
   nonmatching values. No weights or price policy changed.
2. `mobile/lib/recommendation/candidates.ts`: recognize cuisine-type history when
   subregion is absent, both in taste pooling and in stretch exclusion. A familiar
   type-only Italian/Chinese/Mexican/Indian venue no longer becomes a false stretch.
   The original behavior can make Best and Comfort return null despite a valid,
   personally matching candidate. The fallback is deliberately limited to missing
   subregion: an explicitly new subregion can still enter stretch through matching
   format. Existing region/subregion pool priority is unchanged.
3. `mobile/lib/recommendation/shortlist.ts`: for the diversity cap alone, use
   normalized type, then subregion, then region, with distinct namespace prefixes.
   Do not change exploration's cuisine-type history lookup. Entirely unclassified
   venues remain uncapped; thin same-cuisine pools still fill the requested size.
4. New `mobile/lib/recommendation/__tests__/synthetic-paired-ranking.test.ts`:
   actual candidate generation, compatibility/final scoring, shortlist and
   Best/Comfort functions. Only data-loading boundaries are mocked, with throwing
   stubs. No scorer, eligibility, deduper or reranker is mocked.

## Deterministic evaluation

32 scenarios = four cuisines (Italian, Chinese, Mexican, Indian) × four history
sizes (0, 1, 5, 35 visits) × two pools (40, 2,000 restaurants). Zero visits means an
empty graph, not a quiz-seeded graph. Ratings, review counts, prices and locations
are paired; a fixed local clock and seed are supplied. Candidate retention, finite
scores, preferred-versus-alternate score order, empty-history neutrality, selection
under reversed input order, metadata enrichment, and nonempty Best/Comfort picks
are asserted. A stable ID tie-break is used by the test's ranking composition;
this is not a claim that production ties are input-order independent.

Seventeen additional tests cover price-only histories, existing format/occasion
history discrimination, four explicit-new-subregion controls, sparse/dense
subregion diversity at three history depths, region fallback, entirely unknown
and thin pools, hidden/permanently closed/fast-food exclusions, duplicate IDs and
empty input. Total: 49 new tests. No historical founder fixture is imported.

## Validation evidence

- COMMITTED baseline source copied into the isolated workspace, with the new test:
  **14 failed, 35 skipped** for `price-only|familiar type|known subregion`.
  All targeted regressions detect existing defects. See
  `palate-ranking-baseline-regression.log`.
- WORKING TREE workspace patch: initial complete new suite **49 passed** in
  47.389 seconds. Repeated new suite passed in the combined run recorded in
  `palate-ranking-patched-tests.log`. That combined run had one unrelated test
  failure because the workspace copy omitted two screens read by the existing
  mapper test. After copying those unchanged screens, all **five existing suites /
  27 tests passed** (`palate-ranking-existing-tests.log`). Thus 49 new + 27 existing
  tests pass, across the recorded runs; no claim of one all-green combined run.
- COMMITTED base: `git apply --check` accepted the patch without writing the repo.
- Full app TypeScript/full Jest suite, device behavior and production behavior have
  NOT been verified. Main should apply/review and run those integration checks.

## Exact integration command (for main)

From the Palate repo, apply the accompanying patch after reviewing it. The test
is included in the patch; do not separately add the standalone copy as another
test. Then, from `mobile/`:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/recommendation/__tests__/synthetic-paired-ranking.test.ts
```

The project's existing Jest testMatch discovers this file; no package/config edits
are needed. No ledger/worklog changes are included.

## Limits and taxonomy caveat

The diversity fallback fixes repeated *known identical subregions* hidden behind
null type. It does not establish equivalence across taxonomy levels: `type:italian`
and `sub:italian_trattoria` remain separate keys even if a human would group them.
Correct cross-level grouping needs an explicit reviewed taxonomy or canonical
cuisine family, not string-prefix guessing. Region-only fallback can also group
several distinct cuisines broadly. Exploration logic is intentionally unchanged.

The matrix evaluates controlled invariants, not measured human relevance. It does
not demonstrate prediction accuracy, MRR superiority, personalization for new users,
or a validated quality/price tradeoff. The dense run exercises all supplied rows,
not the live catalogue/RPC's upstream retrieval limits. Other gaps include quiz
conflicts, varied opening hours and distances, malformed non-location fields,
realistic taxonomy coverage and device latency. The ~47-second Jest duration is
host test runtime across repeated dense passes, not a device-performance claim.


Main integrated all three fixes and synthetic tests2026-09-29. TypeScript passed. Integrated new49 tests passed; full suite had one unrelated new profile typography failure, corrected with shared theme tokens and tested separately. See CODEX_WORKLOG for final combined validation. No deployment.
