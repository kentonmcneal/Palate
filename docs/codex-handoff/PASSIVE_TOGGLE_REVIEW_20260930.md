# Passive toggle — independent review

**WORKING TREE / offline: approve UI packet with REPAIR_OWNER.patch.** Mendel directly confirmed final READY bytes and no pending author edits. Author patch SHA3141e1018d2d84c47d3ccdfe611eb1a2719f6017139315a21ab6155d9a98ad4b verified; settings/tests/shared-helper snapshots match HASHES.json. No repository changes or Groundwork build/server interaction.

## P2 — stale repair completion releases newer action lock

The new component uses a boolean navigation lock. Request1 opens phone settings and remains pending; after blur/refocus, request2 starts. Resolving request1 unconditionally clears that boolean, admitting request3 while request2 is pending. Independent mounted control reproduces three openSettings calls instead of two. This is introduced by the new action guard, not a shared capture-helper problem.

REPAIR_OWNER.patch gives navigation an identity token. Only the repair request still owning that token may release it. Focus resets and intro one-shot behavior remain; ordinary error/retry flow is unchanged. No extra native permission/monitor action is added.

## Executed evidence

- Original author proposal:1failure/3passes across4independent mounted controls (ORIGINAL.log).
- Corrected: **46/46 tests,4suites pass**, exit0 (FINAL.log):32 author mounted,10 existing helper/provisional and4 independent controls.
- Independent controls verify old repair settlement cannot unlock a newer repair; Check again does not retry a failed stop; late repair error after account replacement is suppressed; retained old stop-retry callbacks cannot revoke newly saved consent.
- Actual React/react-test-renderer19.2.3 mounts the production component and real consent/permission/startup helpers. Storage/OS/flags/router/focus boundaries are synthetic, global fetch throws, and permission-request APIs remain uncalled. This is not native/device navigation evidence.
- Author typecheck/mutations inspected, not independently rerun. No latest-main full-suite claim. TESTS.patch adds4durable controls; HASHES.json binds corrected component and artifacts.

## Contract review

Saved consent is separate from permission and feature availability. Unknown consent is not displayed as off; known consent can be revoked when permission/flag status is unavailable. Confirmed flag-off hides only known off, preserving opt-out for saved on. Missing permission routes to intro without saving or prompting from this screen. Partial timestamp persistence and failed stop are visible; strict readback reports saved value without inferring monitor state. Explicit stop retry is separate from read-only Check again.

Write admission is synchronous and current-render-bound. Read tickets, focus/lifetime/account identity prevent abandoned results from becoming current state; a pending write retains its slot through blur/refocus. The post-save guard blocks new caller-owned startup after ownership changes. These are UI operation guards, not cancellation of shared helper work already underway.

## Shared helper coordination / limits

Darwin's core start/stop work remains separate. Current helper can still start after an awaited flag despite intervening consent/account change, and failed opt-out persistence can prevent stop. Already-issued global writes can complete after screen replacement; another screen/runtime is not serialized by this component. No owner migration or runtime-health guarantee is approved.

If Darwin extends StartResult with stale/cancelled or other reasons, update startMessage exhaustively and rerun against those final helper bytes; this approval binds the current helper union. Retest full integration after combining helper changes.

Nonblocking existing copy adjacent to the extracted Settings control still says background logging means “never have to think about it.” That overstates this review/confirmation workflow. Mendel has been notified; their separate journey-copy audit owns it. No extra copy edit is included here.

Physical rendering, accessibility, real phone-settings return timing and native startup/delivery remain unverified. No services, installs, repo edits, ledger edits or permissions requested.
