# Recommendation quality: independent offline review

2026-09-29. **COMMITTED baseline:** `91a9374`, including the prior 49 synthetic tests / 32-scenario matrix. **WORKING TREE evidence:** proposed changes and execution exist only in this workspace's copied sources. Current repository HEAD at final applicability check was `ff4980c`; the five recommendation source files exactly match the reviewed commit (MANIFEST.json). No repository writes, other-agent dispatch, installations, network, credentials, API calls, service actions or deployments. No other recommendation changes were present in the inspected worktree. Main owns integration and coordination of subsequent changes.

## Recommendation

Apply the bounded six-file patch after independent review: five production modules plus one new evaluation suite. It fixes two selection defects and adds defensive metadata idempotence. It does not retune taste, rating, price, diversity, or confidence weights and does not assert better human relevance.

`RECOMMENDATION_QUALITY.patch` includes the test; do not also install the standalone test as a duplicate. `source/` contains exact replacement files. Read-only `git apply --check` against current repository succeeds (APPLY_CHECK.log).

## Findings and fixes

### R1 — Unclassified cuisine is incorrectly treated as novel, emptying Best/Comfort

**COMMITTED source; WORKING TREE reproduction of unchanged baseline.** `candidates.ts:isStretch` treats matching format/flavor as sufficient even if all three cuisine fields are absent. Those rows enter `stretch_adjacent`. `right-now.ts:sortForStrategy` excludes that pool from Best and Comfort.

Independent fixture: five Italian visits with casual-dining format history; two eligible restaurants have ratings, prices, coordinates and casual-dining format, but no cuisine fields. The actual candidate/Right Now pipeline returns **Best=null and Comfort=null**. There are valid ordinary candidates; missing classification alone routed all of them out. Dense and sparse variants use 40/2,000 rows at 0/1/5/35 visits. Six nonzero-history variants fail the baseline pool invariant; a separate end-to-end diagnostic demonstrates both null heroes without stopping at the pool assertion.

**WORKING TREE fix:** when region, subregion and type are all absent, `isStretch` returns false. Such rows still enter the normal candidate pool. Format similarity does not establish an unknown cuisine is unfamiliar. After the fix, the two-row diagnostic yields the ordinary candidate `one` for both strategies.

Controls retain known unfamiliar adjacent cuisines across four cuisines. The preexisting 49 tests retain familiar-type fallback, explicitly new subregion discovery, learned attribute discrimination and unknown-cuisine uncapped behavior. No taxonomy equivalence was invented.

### R2 — Known-closed venues can win every Right Now strategy

**COMMITTED source; WORKING TREE reproduction of unchanged baseline.** `scoring.ts` subtracts 40 context points for closed hours, worth only 12 final points in right-now mode. Gem/taste advantages can exceed that. Closest, Comfort, Quality and primary Stretch sorting also bypass some or all of the final-score context term. The secondary Stretch card uses finalScore, but its soft penalty has the same limit.

Fixtures use a Tuesday 19:00 local clock. One venue is only open Tuesday 08:00–12:00; the alternative is open 17:00–23:00 or has unknown hours. The closed venue has richer supporting tags, higher rating and price, and is closer. **All five strategy × two alternative-hours cases (10) plus the secondary Stretch case select the closed fixture on baseline.** This is a deterministic availability contradiction, not a human-relevance label or claim about real opening-hour accuracy.

**WORKING TREE fix:** after each strategy's existing ordering, choose the first not-known-closed candidate; if every candidate in that strategy is known closed, retain its existing first fallback. Apply the same selection to the secondary Stretch list. Unknown hours stay unknown and eligible, not certified open. Keep compatibility scores, strategy ordering within each availability group, and browsing rankings unchanged. Correct the scoring comment that falsely said the soft penalty necessarily sinks every closed venue below any open one.

Controls: all-closed fallback across all five strategies; unknown-hours higher-ranked venue remains selectable over a known-open but lower-ranked one; every strategy returns empty when all inputs are hidden/permanently closed/fast food/chains. Selection never resurrects an ineligible candidate.

**Boundary:** preference is within the strategy's existing candidate subset. This is not a global guarantee of an open result; exclusions for visited venues, missing quality ratings, stretch routing, or missing coordinates remain. The all-closed fallback deliberately remains. The existing hours parser's venue/device timezone caveat is unchanged. No change to temporary business closure policy is proposed.

### R3 — Repeated metadata is counted as repeated evidence

**COMMITTED source; WORKING TREE reproduction of unchanged baseline.** `gems.ts:tagSignal` sums every tag occurrence; `compatibility.ts:sumAffinity` sums repeated occasions; `scoring.ts:scoreContext` counts repeated matching occasions. Repeating the same label is not another observation.

Paired measurement with five visits and all other fields fixed:

| Fixture | Gem adjustment | Compatibility | Final browsing score |
|---|---:|---:|---:|
| 4.2 rating / 80 reviews / one local-favorite tag | 9 | 65 | 75 |
| Same fixture / twelve copies of that tag | 32 | 65 | 98 |
| Unchanged 4.8 rating / 300 reviews / no acclaim tags | 17 | 69 | 85 |

This demonstrates a rank inversion caused solely by label repetition. It does **not** establish that the 4.8 venue is objectively or personally better. The independent oracle is that duplicating a fact should not change a score or ranking. Occasion repetition also inflates observed behavior affinity and time fit; twelve cuisine/history paired cases exercise each path.

**WORKING TREE fix:** deduplicate the existing lowercase tag keys before summing; deduplicate attribute keys before summing affinity; deduplicate occasion keys before matching current-time occasions. Distinct supporting labels still contribute, negative tag duplication is neutralized too, unknown tags remain neutral, and learned taste/occasion differences still discriminate.

**Important prevalence limit:** current deterministic classifier and LLM merge writers already use Sets for tags/occasions. The mapper passes arrays through and the scorer accepts duplicates, but this review does not establish that production rows currently contain them. This is defensive correctness for imperfect/imported/legacy inputs, not evidence of a widespread live classifier defect. No broader claim that metadata-rich venues are overranked is justified by this experiment.

## Independent evaluation design

New suite: **82 synthetic tests**, no founder graph/catalogue imports. I/O/loading modules are replaced by throwing stubs; actual graph assembly, eligibility, candidate pooling, deduplication, compatibility, final scoring, shortlist and Right Now execute unchanged except the proposed fixes.

Oracles are deliberately external to score formulas:

- Repeated labels contain no new facts: require equal scores and rank order in paired inputs.
- Missing cuisine cannot certify unfamiliarity: require ordinary eligibility and nonempty Best/Comfort for the controlled pool.
- A known-closed option should not win Right Now when that strategy has an open/unknown-hours alternative; explicitly preserve the agreed fallback/unknown semantics.
- Hidden/permanently closed/chain/fast-food exclusions must survive all strategy/fallback paths.
- Cold start with known distinct subregions and absent type has three distinct choices when enough eligible choices exist; entirely unknown rows are not collapsed into an invented cuisine.
- Balanced, otherwise symmetric cuisine histories should have equal compatibility; adding unlearned attributes alone should not change context-free compatibility.

Coverage includes four cuisines, histories 0/1/5/35, sparse/dense 40/2,000-row pools, optional metadata missing, reversed candidate orders, and mixed rating/tag/hour evidence. The new cold-start diversity matrix is four cuisines × two pool sizes = eight cases; the unknown-cuisine matrix is four history depths × two pools = eight cases. These are additional to—not a relabeling of—the prior 32-scenario matrix. Dense variants process every supplied row; they do not test upstream live retrieval limits.

Unlike the old paired matrix, new pipeline composition uses score-only stable sorting, without a synthetic ID tie-break. Permutation assertions concern diversity/exclusion invariants, not an invented production guarantee that ties yield the same IDs.

## Executed validation

**WORKING TREE, offline:**

- Unchanged `91a9374` with new suite: **45 failed, 37 passed, 82 total** (BASELINE.log). The negative controls detect all three changed behaviors.
- Patched recommendation directory: **26 suites / 385 tests passed**, including prior 49 synthetic tests, existing frozen-fixture regressions and all 82 new controls (ALL_RANKING.log).
- Native installed TypeScript app check: **exit 0** (TYPECHECK.log). App tsconfig excludes tests, so this is not a claim of TypeScript semantic checking for the Jest files; Jest executes/transforms them.
- Final formatted standalone new suite: **82/82 passed** (FINAL_NEW_TESTS.log).
- Read-only applicability check passes on the current repository. MANIFEST.json records base/current file hashes and patch hash.

Reproduction after applying the patch in a copy, from `mobile/`:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/recommendation/__tests__/
/opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
```

No full unrelated app Jest run or device/browser execution. Existing regression suites read their checked-in frozen historical fixtures; this review fetched no live catalogue/history. Timing is host test execution, not mobile latency evidence.

## Remaining gaps and claims not made

- Rich **distinct** acclaim/aesthetic metadata intentionally buys gem points; unknown metadata can receive different priors from observed mismatch. Changing those weights needs a reviewed objective and held-out relevance evidence. No fabricated MRR/precision, user satisfaction, causal fairness, or human relevance labels.
- Mixed taxonomy levels still yield separate diversity keys (`type:italian` vs `sub:italian_trattoria`). Region-only keys may be too broad. Fixing either requires a reviewed canonical taxonomy, not string guessing; this patch does not duplicate that prior unresolved design issue.
- Completely unclassified restaurants cannot yield guaranteed cuisine variety. Tests preserve uncapped unknowns rather than presenting guessed variety as known diversity.
- Distinct-label correctness, inaccurate/stale hours, malformed numerical fields, cross-timezone travel, upstream candidate truncation, and live data prevalence remain outside this patch's guarantees.
- Current “Best/Comfort exclude all known stretch candidates” policy can still yield no hero when every candidate is a genuinely classified stretch. This patch resolves only the false novelty from absent cuisine.
