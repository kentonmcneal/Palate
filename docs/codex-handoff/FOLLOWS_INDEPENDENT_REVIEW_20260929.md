# Independent follows review

**WORKING TREE / mounted local tests.** Reviewed current uncommitted `follows.tsx`, `ProfileBody.tsx`, and `follows-interactions.test.tsx`, plus caller-scoped `list_follows`, follow/unfollow helpers, profile route, and root auth routing. No repository writes or live operations.

## Actionable findings

### P2 — Route parameter remount discards pending mutation ownership

`mobile/app/follows.tsx:48`, `:63–66`, `:126–133`.

The new `key={initialTab}` destroys the component that owns the row gates/pending set whenever the route tab changes. Reproduction: load Followers with Alice not followed; start Follow Alice; update the route parameter to Following before the RPC resolves. The fresh component reads the pre-mutation state with an empty gate set, so Follow Alice can issue a second request. When the original request resolves, its old `active.current` is null and it never refreshes the new component. The new screen continues showing Follow after the server committed Follow.

Two independent mounted safety assertions fail: duplicate follow calls (2, expected 1), and missing Unfollow after old mutation success. This also applies to replacing/unmounting and reopening the route while a mutation remains in flight. Ordinary tab-button changes, which retain the component, are correctly covered by the existing suite.

Proposed fix: keep account-scoped pending mutations/revisions in an owner outside the route-tab keyed subtree (or preserve the mounted instance for route-param changes and synchronize tabs). New views must wait for/reconcile pending actions from the same account. If full close/reopen must be covered, state must outlive the screen. Preserve synchronous per-row gating and fresh-read requirement after uncertain writes.

### P2 — Existing ProfileBody load race installs the old target snapshot into the new target

`mobile/components/ProfileBody.tsx:83–119`; `mobile/app/profile/[id].tsx` passes changing `targetId` without a key.

This predates the navigation patch but affects its owner-only controls. Reproduction: start target A load; switch the mounted component to target B; resolve B; resolve A last. The screen now displays A under target B. In the mounted reproduction A is self, so B's screen also acquires owner-only connections/edit controls. Other snapshot-dependent actions can likewise be selected from the wrong relationship state while their handlers use current `targetId`.

The independent mounted safety assertion fails: “Current B” is replaced by “Old A” and owner controls. Proposed fix: invalidate snapshot loads on target/focus/account change with identity and request generation guards, clear old snapshot/auxiliary state, and apply the same ownership check to mutation-triggered loads/finalizers. A target-only key prevents this particular A→B reuse but does not address same-target refocus/account races.

## Auth/session assessment

The follows `session` field is a focus/tab generation, not an authenticated-user identity. Neither follows nor ProfileBody subscribes to or receives the current account ID. The root auth callback clears module caches but the Stack is not keyed by account; a non-null A→B session replacement does not itself trigger the sign-in redirect. Consequently these components do not establish an account boundary for local rows or pending mutations. Any shared mutation owner introduced for the first fix must be keyed by account, and old-account completions must never drive new-account reads/actions.

This is **source-supported, conditional on preserving the mounted route across an account replacement**; the mounted suite does not exercise the real root/auth transition, so it is not evidence of a reproduced normal sign-out/sign-in leak. Add a root/account-transition test or provide a route-unmount invariant before claiming auth-session coverage. Existing blur/refocus tests establish focus ownership only.

## Semantics that checked out

`list_follows(p_kind)` is caller-scoped. Rejecting explicit `user` routes (including legacy self links) and making other-user count labels noninteractive matches the chosen owner-only navigation contract. Current snapshot counts may still describe another profile; this patch changes affordances, not SQL disclosure. Real helpers invoke explicit follow/unfollow RPCs, not a server toggle. Duplicate follows are idempotent graph writes, so the first defect's demonstrated consequences are duplicate requests and stale UI, not a proven double-toggle.

Within one mounted follows instance, synchronous row gates, request invalidation, current-tab reconciliation, and fail-closed gating after uncertain writes/reload failures are sound in the exercised cases. Splitting profile and follow press targets avoids nested-button navigation. The report-copy change removes the unsupported deadline.

## Test evidence

The supplied **22 tests pass**. Three added safety assertions fail, representing the two findings above. Tests use the real current components, copied existing mocks, and installed Jest/renderer; fetch is forbidden. Source imports in the scratch test point at the repo read-only. Log: `jest-results.log`. Runnable scratch copy: `follows-review.test.tsx`.

```sh
/opt/homebrew/bin/node '/Users/kentonmcneal/Claude Code/Palate/mobile/node_modules/jest/bin/jest.js' --config '/Users/kentonmcneal/Documents/Codex/2026-09-27/how-x20/outputs/palate-follows-review/jest.config.json' --runInBand --watchman=false --runTestsByPath '/Users/kentonmcneal/Documents/Codex/2026-09-27/how-x20/outputs/palate-follows-review/follows-review.test.tsx'
```

The three red tests are intentional regression assertions, not a claim that the proposed fixes have been implemented.
