# Passive intro journey — independent review complete

**Approve the final author packet with INTRO_GUARDS.patch.** Apply the author patch first, then this additive production correction and TESTS.patch. No repository files were edited. Exact reviewed author and corrected bytes are recorded in HASHES.json; all six author source hashes matched the final manifest, and the shared capture helper matched its declared unchanged hash.

## Findings and bounded correction

1. **P2: navigation callback lacked ownership.** Retained Not now callbacks navigated twice, navigated after unmount, and could navigate during an admitted operation despite the rendered disabled button. These are pre-existing unguarded navigation patterns retained by the proposal, not three newly introduced product defects. The correction requires a focused, idle owner and consumes that owner before navigating. Foreground denial explicitly releases its operation before manual continuation. The author’s legitimate continuation controls still pass.
2. **P2: account replacement during permission awaits could initiate a fresh consent write.** Actual account-generation changes A→B and A→B→A while notification permission was pending allowed the original operation to save global consent and start. The author report assumed account unmount rather than establishing it. This pre-existing account-boundary gap remains in the proposed continuation model. Capture the existing accountWriteSession identity at admission and require equality at each continuation. The owning finalizer releases busy state and reports setup as unconfirmed after replacement. It deliberately does not claim consent is off or native monitoring stopped.

## Executed evidence

- ORIGINAL.log: five independent mounted controls fail against the uncorrected author proposal (duplicate navigation, unmounted callback, busy callback, account replacement, ABA replacement).
- FINAL.log: **23/23 tests pass in two suites**, consisting of all 18 author controls plus five independent controls, against the final author source with the additive correction.
- Actual installed React/react-test-renderer 19.2.3 mounts the actual intro; actual capture/permission and account-generation helpers execute. Host UI primitives, navigation, native permissions/monitoring, flags, notifications, analytics and storage are mocked. Fetch is forbidden. No installs, paid calls, native prompts or live services.
- The author’s final mounted disclosure control verifies pre-confirmation lookup/sync and that location does not reveal an order. Source review also covers the four copy-only files: foreground onboarding, Visits, ProfileBody and Settings.
- No independent full-suite or typecheck claim. Author REPORT records its copied-tree successful typecheck. Integration should run the two explicit durable test paths and normal project typecheck.

## Semantic assessment

Start outcomes distinguish successful dispatch from unsupported builds, disabled flags, permission repair, consent cancellation and uncertain failures. A successful native start is not a future reminder guarantee. Consent/timestamp partial failure remains uncertain; retry only attempts startup and does not rewrite consent. Returning from phone Settings requires an explicit action. Suggestions precede confirmation and diary creation; dish details are optional. Expanded disclosure truthfully allows provider/server lookup and suggestion metadata sync before confirmation, and qualifies home/work filtering. Copy-only edits remove automatic diary and blanket location-privacy promises.

## Limits

This is screen-continuation protection, not global passive account ownership. A consent write or native start already dispatched before replacement may complete; neither UI cleanup nor the new generation check cancels such work. No device delivery, background execution, native stop completion, policy/native permission-string alignment, visual layout or accessibility signoff. Retained callbacks across a complete blur/refocus lifecycle and post-completion account changes are not exhaustively covered. No detector, paid-resolution, server, configuration or shared capture-helper changes are proposed.

## Reproduction after integration

From mobile, using existing dependencies:

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/passive-intro-journey.test.tsx lib/__tests__/passive-intro-independent.test.tsx
```

The explicit paths avoid accidentally selecting unrelated scratch suites. TESTS.patch adds the five independent controls without modifying the author’s 18 controls.
