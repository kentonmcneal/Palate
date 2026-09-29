# Final independent review — centralized Right Now chain coverage

**WORKING TREE / offline RUN: accept the final three-file packet within this bounded scope. No additional production correction requested.** This supersedes the earlier integration hold for the removal-only packet. The nine shared canonical entries close the named compatibility gaps without restoring the bad hero-only substring filter. This is not a guarantee of exhaustive chain detection.

Baseline for behavior comparisons is original `80235dceff066b02dc50912dd998186872e823c4`, not the intermediate removal-only source. Current HEAD at capture is claim-only `b9b9bf746236548038b0b4ec0c3148499c08344c`; the reviewed changes are working-tree code. Exact hashes and copied three files are adjacent in CAPTURE.json/source.

## Exact scope and policy

Reviewed:

- mobile/lib/recommendation/right-now.ts removes the duplicate substring list/helper and its post-scoring hero filter. Visit-count and strategy/hour selection remain unchanged.
- mobile/lib/recommendation/chains.ts adds exactly nine normalized entries: `dairy queen`, `baskin robbins`, `cold stone`, `cold stone creamery`, `the capital grille`, `capital grille`, `bdubs`, `b dubs`, `chickfila`. No matching algorithm or generic-suffix set changes.
- mobile/lib/recommendation/__tests__/right-now-chain-parity.test.ts extends the five-strategy pipeline controls to all nine display spellings; 99 tests total.

Both “The Capital Grille” and “Capital Grille” are now excluded. Dairy Queen, Baskin-Robbins (and space-normalized Baskin Robbins), Cold Stone/Cold Stone Creamery, BDubs/B-Dubs, and Chickfila are excluded even without classifier flags. Existing Chick-fil-A and Buffalo Wild Wings exclusions remain. These names are no longer treated as desired eligible fixtures in the final independent tests.

The Capital Grille, Dairy Queen, Baskin-Robbins, Cold Stone and compact Chickfila/bdubs were old hero substring matches; Capital Grille without the article and spaced/hyphenated B-Dubs also close existing canonical spelling gaps rather than merely restoring an old exact string match. Adding canonical coverage also affects the secondary stretch slot, which never had the deleted local hero filter.

## Evidence provenance: no remote calls

Per instruction, this review made **no remote requests**. Main supplied these official-source citations and reported reviewing their content:

- [The Capital Grille site map](https://www.thecapitalgrille.com/site-map) and [FAQs](https://www.thecapitalgrille.com/faqs/1000).
- [Dairy Queen about](https://www.dairyqueen.com/en-us/about-us/).
- [Baskin-Robbins locations](https://locations.baskinrobbins.com/).
- [Cold Stone locator](https://www.coldstonecreamery.com/locator/) and [about FAQs](https://www.coldstonecreamery.com/faqs/aboutus/).
- [Buffalo Wild Wings delivery](https://www.buffalowildwings.com/delivery), reported by main to use B-Dubs.

These are **main-supplied primary-source evidence**, not independently fetched publisher verification in this packet. The code/behavior review relies on main's documented policy authorization for these brands. `chickfila` is explicitly a compatibility spelling from the original local matcher, **not an asserted publisher-formal brand name**. BDubs and B Dubs are normalized compact/spaced forms of the reported B-Dubs alias. No new national brand was inferred from a guessed name, venue count or score.

## Executed evidence

Actual copied source uses installed native Node/Jest and TypeScript. Candidate generation, name normalization/matching, eligibility/gems, toInput, compatibility/scoring, sorting and explanations run unmocked. External loading/database adapters throw; five specific cache-boundary tests return synthetic rows, with no network.

| Source | Pass | Fail | Total |
|---|---:|---:|---:|
| Final working tree | **545** | **0** | 545 |
| Original 80235dc with final expectations | 237 | 308 | 545 |
| Final minus nine canonical entries | 351 | 194 | 545 |
| Final with unrestricted brand-prefix matching | 465 | 80 | 545 |

Final 545 = **99 author's extended pipeline cases + 433 independent cases + 13 existing eligibility tests**. The independent cases retain sparse/familiar/scored/dense candidate scenarios, all five strategies, structured flags, hidden IDs, three-visit hero suppression, secondary stretch and actual fetched-row mapping from the prior review, while changing known-chain expectations to exclusion.

Additional canonical controls cover each of the nine entries with exact name, generic Restaurant suffix, store number, spaced dash location, parenthetical location and pipe location. Both standard gate and `cafes: allow` reject them: the cafe exception does not bypass chain policy. Detail ineligibilityReason returns the chain reason. Real generateCandidates produces no candidate for these named rows.

False-positive controls cover each new brand followed by the discriminative synthetic continuation “Orchard Noodles” through all five strategies, plus a preceding “Little … Orchard” and concatenated “…house”/“…ville” names. They remain eligible. Original Sonic Boom Ramen, Masonic Dining Hall, Denny Lane Kitchen, Outback Orchard Bistro and The Longhorn Table controls remain. The unrestricted-prefix mutant's 80 failures demonstrate these are sensitive checks, not just positive-chain examples.

Structured policy controls still cover chain_name, is_chain_brand, fast-food format, primary_type/types, low eligibility, permanent closure and hidden IDs. High ratings, acclaim, friend popularity and familiar visits cannot revive rejected candidates. Explicit false/null metadata and eligibility 0.5 continue to allow an otherwise eligible cheap independent. Sparse closest/quality empty states remain their existing missing-coordinate/rating behavior, not chain regressions.

## Cross-surface applicability and limits

WORKING TREE source evidence: the same shared gate is called by Discover (app/(tabs)/discover.tsx), Home recommendations (components/RecommendationsCard.tsx), featured-lists.ts, similar-restaurants.ts and palate-persona.ts. Right Now and pairCompatibility obtain candidates through generateCandidates. The added canonical names therefore change the common decision wherever those paths reach the gate; they are not a Right Now exception. The actual shared gate, including cafe override and detail reason, is tested here. **Those screens were not mounted or exercised on device**, and their loading/data correctness is not inferred from helper tests. Shortlist itself is not an eligibility boundary: it expects its caller's already-filtered inputs.

Conservative matching remains deliberately lossy. A non-generic trailing word such as a location written without a recognized separator may still avoid a name match. Conversely the existing normalizer treats text after spaced dash/pipe/@ and parenthetical tags as location noise; an independent with that exact ambiguous shape can still collide. Generic suffixes also cannot distinguish a truly independent business using a whole canonical brand phrase plus generic words. These are pre-existing matcher tradeoffs, not newly expanded substring matching. Structured chain signals remain additional coverage; absence is not proof of independence.

No blanket promise that every old substring rejection survives is made. The final patch preserves the explicitly reviewed canonical names/aliases while allowing meaningful non-generic continuations. Any additional brand/alias coverage should be justified and added centrally with paired exclusion/independent controls.

No repository/ledger edits, installs, services, live database/API calls or device verification. No full app build or all-suite run claimed. Final test source and optional ADDITIONAL_TESTS.patch are provided; use these **instead of** the older diagnostic independent tests whose known-chain allowed expectations described the incomplete intermediate policy.
