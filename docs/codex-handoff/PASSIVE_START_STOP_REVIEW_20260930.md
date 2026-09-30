# Independent passive start/stop review — READY

Verdict: accept the bounded consent/race mitigation with the attached small additive correction. No durable revocation or device verification claim. Repositories were read-only; all execution used copied sources and installed Palate Jest/React tooling with mocked storage, flags and native boundaries.

## Reproduced correction

Author helper hash is recorded in HASHES.json. A pending successful `setPassiveOptIn(true)` captures consent generation 1. Debug `stopPassiveCapture()` advances the same generation to 2. When the write succeeds, it cannot clear `consentBlocked`. Previously captured starts correctly cancel, but every fresh foreground/start also returns `not-opted-in` despite persisted consent `1`. Only another explicit enable recovers. This is fail-closed liveness/contract breakage, not a privacy bypass; it contradicts the author's explicit debug-stop policy.

ADDITIVE_FIX.patch separates cancellation of starts from changes in consent intent. Consent changes advance both clocks; debug stop advances only the start clock. A successful latest enable can finish, earlier starts remain cancelled, and a fresh start can resume. Failed enable and explicit opt-out still block. Apply AFTER PASSIVE_START_STOP.patch; the additive patch also installs eight independent regression controls. No UI production changes.

## Executed evidence

ORIGINAL.log: author's helper fails the fresh-resume reproduction; seven other independent controls pass. CORRECTED.log: five suites, 68/68 tests pass: author 16, independent 8, existing opt-in/day7 12, pending mounted toggle UI 32. Mounted UI uses Palate's installed React/renderer 19.2.3, not Groundwork's React DOM environment. No OS/device operations ran.

Independent controls exercise debug stop during successful and failed enable writes; overlapping on/off/on writes; direct false setter while consent read is pending; recovery after flag rejection and synchronous native-start throw; simultaneous native-stop/storage-write failure; and hung flag with off/on recovery. These run the actual copied helper, not a duplicate state-machine implementation.

UI_TEST_EXPECTATION.patch changes only two stop-call counts. A failed off write now still attempts native stop once; explicit retry attempts it a second time. Stored-value readback, truthful failure copy and successful retry assertions remain. This correctly follows the changed helper contract without weakening the UI requirements. Tested pending UI includes the author's copied repair-owner integration; this does not independently certify every pending UI change.

## Boundary findings and limitations

- Consent is strictly read before each start. Missing/0 denies, malformed/unavailable reads reject. Generation checks after storage and flag awaits prevent old requests from starting after same-runtime off. Direct false setter shares immediate stop behavior. Consent writes serialize invocation order separately from starts.
- Opt-out attempts native stop before storage awaits, including while a flag request hangs. A stop throw does not skip persisting off. If both stop and storage fail, storage error wins; native state remains unconfirmed. No atomicity is implied.
- A never-settling flag read still occupies the starts queue and delays later fresh starts, including after a new successful enable. Off persistence and immediate stop are unaffected. Our paired control releases the old flag and verifies old start cancels/new start succeeds. No speculative timeout change is included.
- Timestamp failure can leave saved consent 1 while runtime startup remains blocked. Explicit successful enable can recover. Existing first-opt-in timestamp semantics are preserved; it is not proof of native startup.
- Native bridge start/stop methods are synchronous and currently return true after calling the manager. No await separates the final JS guard from start. That supports the same-runtime ordering argument, not a guarantee of CoreLocation delivery or successful OS shutdown.
- **Native cold-start limitation remains:** PalateVisitMonitorAppDelegate calls resumeIfEnabled; the native manager consults its separate UserDefaults enabled bit before JS restoration. JS clocks do not govern that path or survive process death. Failed off persistence can leave consent 1 and allow a later fresh-runtime JS start. Failed native stop can leave monitoring enabled. Durable revocation needs a separate reviewed native/storage protocol.
- No capture-owner/account provenance is added. Delayed old-account code issuing a NEW enable, direct native callers, other runtimes and already-delivered records remain outside these clocks.
- Caller compatibility follow-up: actual `app/debug-visits.tsx` onStart awaits startup without catch and is passed directly to Button. New strict consent-read rejection can therefore reject the debug action without user-facing status. Native/flag failures could already reject this handler. Layout catches resume rejection; pending Settings handles startup errors. This debug-only error presentation gap is source-confirmed, not a mounted reproduction, and is not changed by the additive patch.

## Reproduce / integrate

Apply author's core patch, pending UI expectation patch in its stated integration order, then ADDITIVE_FIX.patch. In mobile run installed Node/Jest with `--runInBand --runTestsByPath` for passive-start-stop-safety.test.ts, passive-start-stop-independent.test.ts, passive-optin.test.ts, passive-day7.test.ts and passive-toggle-safety.test.tsx under lib/__tests__.

Exact source/test/patch SHA-256 values are in HASHES.json; original and corrected logs retained. Main should run its integration/type gates. No full-repository typecheck/build, cold-start experiment, real permission, device or live service verification is claimed.
