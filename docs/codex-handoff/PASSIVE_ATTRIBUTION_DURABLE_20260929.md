# Durable attribution regression

`PASSIVE_ATTRIBUTION_TEST.patch` adds only `mobile/lib/__tests__/passive-attribution.test.ts`. It is repository-relative and discovered by the existing Jest testMatch; no package/config/dependency changes are required. Production baseline: committed `58a7f6aa6cc73d3f7ac320f2350d720efcb4887e`; relevant hashes in HASHES.json.

## Actual code exercised

Production `resolveVenue`, loggability filtering, refusal filtering, `rankCandidates`, distance calculation, `confidenceScore`, opening-hours and eating-pattern logic, `buildDigest` and its precheck/ambiguity conversion. None of these functions is mocked or replaced by a copied algorithm.

Mocks are at cache, catalogue, refusal-history, auth/database, native bridge, telemetry and notification boundaries. AsyncStorage uses the repository's existing in-memory Jest setup. Supabase auth returns no user, so prior-visit DB reads cannot run; unexpected database/Google/notification calls throw, and assertions require their absence. No installed modules or packages were added.

The suite manually forwards resolution's score/band into an InboxEntry, using the fields forwarded by `notifyOrInbox`, to test the digest. It intentionally does not claim coverage of inbox persistence, `notifyOrInbox`, qualification, native GPS sampling or notification delivery. The five-minute case demonstrates resolution/attribution retention, not native emission. No mounted UI claim.

## Seventeen cases

- Precise stop and CLVisit: lone venue 65m away remains available but medium/unchecked (2).
- Matched centroid: stop, CLVisit and absent legacy source retain high/prechecked status (3).
- Nearer first row excluded as non-food: actual 65m winner is scored, not the excluded centroid (1).
- Nearer food row removed by local refusal history: remaining 65m winner is scored (1).
- Two eligible doors remain ambiguous and unchecked (1).
- Missing, NaN, infinite and out-of-range venue coordinates cannot earn prechecks (5).
- SLC with precise reported accuracy stays unchecked (1).
- 51m-accuracy centroid stays unchecked (1).
- Five-minute recommendation-ineligible national-chain coffee remains captured medium/unchecked (1).
- Catalogue path applies the same rule and requests `recommendableOnly:false`, without paid fallback (1).

The fixture clock is constructed at device-local 13:00 so meal-window behavior does not depend on the test runner timezone. Coordinates are synthetic. No original users or visit data are involved.

## Completed execution

- **17/17 Jest cases pass** on copied committed source (GREEN.log).
- **Focused strict TypeScript including the test file: zero diagnostics** (TYPES.log). App-wide checks were not rerun.
- Restoring the old pre-attribution confidence scorer in scratch: **13 failures, 4 passes** (BASELINE_RED.log).
- Changing matched-distance calculation to use the first unfiltered row instead of the ranked winner: **2 failures, 15 passes**, exactly the excluded/refused near-row cases (WRONG_ROW_RED.log).
- Forcing all sources to `visit`: **1 failure, 16 passes**, the SLC case (SOURCE_ERASURE_RED.log).
- Each negative control exited 1 (MUTATION_EXITS.json); original production files were restored in scratch afterward. Invalid-coordinate test names were then clarified without changing assertions; final 17-case run and typecheck pass.
- Read-only `git apply --check`: passed.

## Repository command after integration

From `mobile`:

```
node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/__tests__/passive-attribution.test.ts
```

On this host runs used `/opt/homebrew/bin/node` and the existing mobile node_modules. The proposed test contains no absolute paths, workspace imports, bespoke runner, installs or external-service dependency. All edits and deliberate regressions occurred in scratch copies, never in the app repo. Main owns integration and independent review.
