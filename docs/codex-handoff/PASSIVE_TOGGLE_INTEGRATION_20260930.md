# Passive toggle test integration — READY

Root cause confirmed, minimal test-only patch provided. No repository changes.

## Actual failure

Settings now imports the named PassiveCaptureToggle component. Three pre-existing custom VM loaders do not explicitly handle that module. Their generic named-export proxy returns an async helper function for unknown export names. React mounts that synthetic async function as PassiveCaptureToggle and reports “An unknown Component is an async Client Component.” This is not evidence that the production component is async or that a Next/server-component change belongs in this native app.

BASELINE.log reproduces the supplied /tmp/palate-toggle-all.log signature exactly: three affected suites,67 failed/13 passed. The13 unaffected profile cases do not render Settings' new child.

## Minimal change

TEST_LOADER_FIX.patch adds one exact-module branch (with explanatory comments) to each of:
- mobile/lib/__tests__/push-preferences-mounted.test.tsx
- mobile/lib/__tests__/push-preferences-independent.test.tsx
- mobile/lib/__tests__/profile-settings-boundary.test.tsx

The branch returns `{ PassiveCaptureToggle: () => null }` only for `../components/PassiveCaptureToggle`. It does not change generic mocks, silence errors, weaken assertions, skip cases or substitute Settings itself. The real Settings PushPreference implementation, real account-generation state, edit-profile/onboarding screens and real CollapsibleSection in the independent push suite remain as before. Capture consent behavior is outside these suites and remains exercised by its actual-component author/independent suites. These screen tests are not a claim of full Settings/capture integration behavior.

## Executed evidence

- BASELINE.log:67fail/13pass,3suites on copied current integrated source.
- CORRECTED.log:126/126pass,7suites: the affected3 plus passive-toggle-safety, passive-toggle-independent, passive-optin and passive-provisional. Real installed React/test-renderer with existing mocked SDK/native boundaries; no live calls.
- NEGATIVE_CONTROL.log: remove real Settings PushPreference admission guard in scratch only; all3 duplicate-identical-callback cases fail, expected1write versus2. This shows the loader change still exercises production push interaction logic. Original Settings bytes restored and hash-verified afterward.
- Read-only git apply --check passes against current repository tests.
- HASHES.json records exact original/proposed test and unchanged Settings/capture component hashes.

No full-suite rerun or new typecheck claimed. Main should apply this test-only patch and rerun its full gate. No production code, dependency/config files, shared helpers, or unrelated tests changed.
