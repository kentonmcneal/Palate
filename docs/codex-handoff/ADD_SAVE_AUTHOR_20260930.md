# Add save completion ownership — READY for independent review

**WORKING TREE / offline mounted execution.** Scratch-only proposal against main's locally integrated Add search source, not original pre-search Add. Read current AGENTS.md, CLAUDE.md, CODEX_HANDOFF.md and recent CODEX_WORKLOG; claims check observed tip f516c1f with main-owned uncommitted Add/search tests. User explicitly authorized this disjoint scratch proposal. No repository/claims/ledger edits, installs, paid/network calls, deployment or devices. Shared visits.ts unchanged.

## Reproduced issue

Existing Add save completion updates celebration/burst or alerts after account replacement and can arm navigation after unmount. Existing repeat navigation timer does not check account/lifetime; first-celebration dismissal can navigate after account replacement/unmount or when invoked twice. Saved row callbacks can begin another save after their account becomes stale. saveVisit's internal initiating-account protection does not protect all of these subsequent UI callbacks.

Original current Add fails22 of26 mounted ownership controls. Some controls intentionally mock a successful stale save response to isolate the UI boundary: that is defense against obsolete completion, not a claim that shared saveVisit always succeeds after a switch.

## Bounded proposal

ADD_SAVE_OWNERSHIP.patch changes only mobile/app/(tabs)/add.tsx and adds mobile/lib/__tests__/add-save-ownership.test.tsx.

- A save starts only in a live mounted lifetime and current account generation; existing synchronous duplicate-save admission remains.
- Each admitted save receives a distinct owner. A later manual save invalidates earlier celebration/delayed navigation, clears any previous navigation timer and hides the prior first-visit celebration. This happens even if the newer save subsequently fails: a previous success must not navigate away during the newer action/error.
- Save success/error/finally can update UI only while lifetime, account generation and save owner still match. Same-account refresh remains valid; A→B→A is stale. A stale finally cannot unlock another owner.
- First celebration stores its save owner. Dismiss checks identity/lifetime/account and consumes that owner synchronously, making duplicate/saved obsolete callbacks inert.
- Repeat timer checks ownership when fired and consumes it before navigation. Clearing timeout is paired with callback checks, so an already-queued callback cannot navigate after replacement/new save. Layout cleanup invalidates owner and clears timer on unmount/StrictMode cleanup.
- Editing search input does not abandon an already-authorized manual save. Ordinary first/repeat celebration, exact1100ms repeat delay, failure retry and query/search behavior remain.

No new auth listener, transport, account clock, provider request, shared writer implementation or search policy.

## Actual mounted evidence

Installed React and react-test-renderer19.2.3, actual Add component/hooks/account-generation module, native primitives/router/search/save boundaries mocked. All saves are synthetic. New tests use local suggestions and explicitly check no paid search for the ordinary manual-save path. Network fetch is a throwing test boundary, preserving the earlier Expo teardown correction.

| Variant | Result |
|---|---|
| Original current Add, new ownership suite |4 pass /22 fail, exit1|
| Proposed Add, new ownership suite plus existing Add search suites |74/74 pass,3 suites, exit0 (26 new +48 existing)|
| Remove timer callback ownership check |23 pass /3 fail, exit1|
| Remove post-save success ownership check |20 pass /6 fail, exit1|
| Focused strict TypeScript of Add/imported dependencies |pass, exit0|

26 controls: first/repeat/error completion under B, A→B→A and sign-out; all three outcomes after unmount; timer and stored dismissal after B/ABA/unmount; stale row callbacks; duplicate manual taps/dismissals; superseded timer callback invoked directly after clear; superseded celebration; ordinary failure retry; query-edit preservation; same-account refresh in StrictMode; stale failure while replacement account save is pending. Existing48 search controls pass unchanged.

PROPOSED.log, BASELINE.log, NO_TIMER_CHECK.log, NO_SAVE_CHECK.log and TYPECHECK.log preserve evidence. This is not mounted native/OS behavior, ReactDOM testing, shared-save SDK validation or a full app gate. No new live/device claim.

## Application and identity

Current repo Add still matched BASE_add.tsx at final packaging. Patch applied to scratch captured base reproduces PROPOSED_add.tsx and the new test exactly. HASHES.json records all deliverable identities; PATCH_CHECK.log records the check. Apply only ADD_SAVE_OWNERSHIP.patch, not snapshots in addition.

From mobile after applying:

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/add-save-ownership.test.tsx lib/__tests__/add-search-safety.test.tsx lib/__tests__/add-search-independent.test.tsx
```

## Exact limits

The existing account-generation clock must observe transitions; no independent auth subscription is added. Lifetime means mounted lifetime, not tab focus. Navigation already dispatched while current cannot be recalled. Saves already sent may commit and produce shared writer/backend side effects; this UI patch neither cancels nor undoes them. Stale UI completion is ignored without claiming no visit was saved.

No ownerless payload/capture-time isolation, receipt flow changes, other screen completion guards or transactional dedup. An unresolved save continues holding this instance's save admission until settlement or unmount. Query edits preserve a legitimate pending save; this packet does not impose row-membership/search-query ownership on a manually chosen visit. Existing component-internal animations may continue while mounted; stale navigation/dismissal callbacks are denied.

Independent review is still required before integration. No new ledger promotion or repository commit was performed.
