# Independent Add search review — 2026-09-29

**Approve production Add change unchanged; apply the supplied test-only network-boundary correction.** Actual React19.2.3/react-test-renderer19.2.3 mounted component; no replica state machine. No repository edits, installs, paid/live service calls or devices.

## Findings

No blocking component issue found. Synchronous active ticket prevents same-batch keyboard/button duplicates before location resolution. Input object identity invalidates saved callbacks and A→B→A typing. Pending query requests may be explicitly rejoined without another dispatch; typing alone cannot adopt them. Post-location checks run on success and failure. Only latest input/ticket/account/lifetime owns results, alerts and spinner release. Old request cleanup compares identity before deleting map membership. Account-generation key resets owned state on rerender; layout lifetime invalidates unmounted/StrictMode cleanup continuations.

Paid search is never triggered merely by typing; actual useSuggestions remains mounted and its local boundary is mocked. Denied/synchronously failed location still permits a current explicit unbiased search. saveVisit behavior is preserved except requested robust message fallback. Null/blank search and save errors are safe. Existing save completion/navigation ownership remains outside this scope.

Test infrastructure finding: with current installed Expo/Jest, unmodified author tests plus independent mounted tests pass48 assertions but process exits1 due to `Cannot log after tests are done` from Expo's lazy fetch getter/native logger teardown. This is not a component failure, but it must not be reported as a clean green run. TEST_NETWORK_BOUNDARY.patch defines global fetch as an explicit throwing test boundary instead of allowing Expo's lazy getter to initialize at teardown. Every relevant service is already mocked; no assertion, timer or error logging is suppressed. After the change, same48 tests pass and Jest exits0. FINAL.log preserves the initial exit1 warning; FINAL_CLEAN.log is final evidence.

## Independent scenarios

Nine independently written scenarios reuse author's native boundary mocks and test helpers, with actual component/hooks/account clock:

1. Abandoned pre-location A settles, then explicit A retry creates one fresh dispatch.
2. Two distinct pre-location requests dispatch only latest input.
3. Explicit same-query rejoin of failed operation alerts once, then permits retry.
4. Same-batch edit invalidates saved keyboard callback before rerender.
5. Callback from unmounted instance cannot submit after fresh same-account mount.
6. Replaced-account paid failure cannot alert or clear new account spinner.
7. Synchronous location failure allows one unbiased request.
8. Synchronous paid exception releases admission; null save error shows fallback.
9. StrictMode-mounted pending location rejection after unmount cannot dispatch.

Together with all39 author scenarios:48/48 pass,2 suites, exit0. Original Add source against the exact same final tests:11 pass/37 fail, exit1. Actual mounted React/renderers verified19.2.3. Native components, router, geolocation, paid/local search and saveVisit are synthetic. No actual device/native renderer, mounted DOM, app-wide or new typecheck claim. Author supplied focused typecheck evidence separately.

## Source identity / application

Current repository Add source matched author base at independent capture. Author patch plus TEST_NETWORK_BOUNDARY.patch applied in scratch and reproduced exact tested Add/test bytes. Production Add is byte-identical to author's proposed source. HASHES.json captures approved identities. Independent test file is also supplied as add-search-independent.test.tsx for optional durable integration under mobile/lib/__tests__; it uses repository-relative imports, no dependency changes.

Run from mobile after patches (include independent filename only if copied):

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/add-search-safety.test.tsx lib/__tests__/add-search-independent.test.tsx
```

## Limits

Client admission count is not provider cost accounting. Once searchRestaurantsDetailed is called, this component cannot cancel SDK work, pin later credentials, prevent server retries or refund charges. Distinct explicit queries may overlap; settled queries can be explicitly resubmitted. Never-settling requests can remain pending until lifetime ends. No timeout/refund policy invented.

Root/generation updates remain required; no new auth subscription or independently observed credential clock. A tab blur is not an unmount. Complete save/timer navigation safety and shared free-suggestion redesign are outside the packet. No new product scope or unrelated passive-digest change.
