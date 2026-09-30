# Add save ownership — independent review

**APPROVE the exact author patch for its bounded Add save-completion scope. No source correction required.** WORKING TREE / offline mounted evidence only; no live, device or backend-write claim.

Reviewed Chandra's ADD_SAVE_OWNERSHIP.patch, current Add source, actual account-generation adapter/root key, and celebration callers. Main Add at `7a2868734549addba11180173675e69b7cf54af5` matches the author's base byte-for-byte. Independently tested candidate matches PROPOSED_add.tsx byte-for-byte. HASHES.json pins the approved source and patch.

## Correctness assessment

The synchronous busy ref still rejects overlapping manual saves. Admission checks mounted lifetime and current account generation before calling the writer. Every admitted save replaces the completion owner, cancels prior repeat navigation and hides the prior first-visit celebration. Thus a newer save that fails still prevents an older success from navigating over its error.

Success/error/finally use the same owner/lifetime/account predicate. An old account's successful response or failure cannot alter a replacement account's celebration or release its pending save. A→B→A invalidates the old generation; same-account refresh and ordinary rerender preserve it. Query edits preserve an already-authorized save, as intended.

Both delayed repeat navigation and captured first-celebration dismissals check ownership at invocation and consume the owner before navigation. Clearing the timeout alone would not suffice for an already-queued callback; the explicit check supplies that protection. Layout cleanup invalidates the lifetime/owner and clears the timeout. The existing root account-key boundary remains important; no new auth subscriber is introduced.

No new paid boundary, writer call, dependency, account clock or search-policy change. No concrete blocking regression found in this scope.

## Independently executed controls

Actual installed **React 19.2.3 and react-test-renderer 19.2.3** are asserted in the additional suite. Actual Add component, hooks, useSuggestions and account-generation code run. Native primitives, router, celebrations, location, searches and saveVisit are mocked; fetch throws. No actual services execute.

| Candidate/control | Result |
|---|---|
| Proposed source: author26 + existing search48 + independent12 | **86/86 passed, 4 suites, exit0** |
| Baseline Add: independent12 | **6 failed /6 passed, exit1** |
| Proposed source without repeat-timer ownership check: independent12 | **3 failed /9 passed, exit1** |
| Proposed source without consuming repeat-timer owner: independent12 | **1 failed /11 passed, exit1** |
| Focused strict TypeScript for Add/imported dependencies | **passed, exit0** |

The 12 additional controls cover:

1. Exact installed React/renderer versions.
2. A retained repeat timer invoked twice navigates once.
3. A failed newer save invalidates the old repeat timer; subsequent retry can navigate normally.
4. A failed newer save hides and invalidates the old first celebration; retry gets a fresh valid dismissal.
5–6. Old-account first/repeat success while replacement-account save is pending cannot publish UI or unlock another save.
7. Old mounted-lifetime timer cannot navigate over a same-account remount's pending save.
8. Actual timeout handle is cleared on unmount, not merely ignored at callback time.
9. Never-settling save retains duplicate admission across query edits.
10. Same-account rerender preserves valid first-celebration dismissal.
11. Malformed current save reply reports failure and permits retry.
12. Synchronous writer throw releases admission and permits retry.

Baseline/mutation logs intentionally contain failing assertions. PROPOSED.log is the final successful candidate run; candidate source was restored exactly after mutation tests and then typechecked. No full-mobile-suite claim.

## Integration

Apply the author's `outputs/add-save-ownership/ADD_SAVE_OWNERSHIP.patch` unchanged. Optionally add this packet's `INDEPENDENT_TESTS.patch` (one new test file) to retain the 12 independent controls. The test patch does not repeat or change the author's application patch. Test source is also supplied separately as add-save-independent.test.tsx.

Re-run from mobile after integration:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/add-save-ownership.test.tsx lib/__tests__/add-save-independent.test.tsx lib/__tests__/add-search-safety.test.tsx lib/__tests__/add-search-independent.test.tsx
```

## Explicit limits

This guards mounted save-completion ownership, not tab focus. A still-mounted Add tab may navigate after blur; that behavior is retained and outside the author's stated scope. A pending writer is not cancelled and can already have committed. The shared writer's transport/auth correctness is not established by these mocked-save tests.

FirstVisitCelebration and VisitCelebration are mocked here. Their native animations, permission timer and share flow are not covered; approval does not extend to those internal side effects. Root replacement/clock behavior was inspected in source, not re-proven with mounted root tests in this packet. A stale mounted instance whose clock changes without a render/root unmount stays unavailable rather than acquiring a replacement account; normal root-key replacement is the existing contract.

No repository writes, installs, permission requests, paid operations, live services or deployment. This independent review approves only the pinned Add patch and its stated UI boundary.
