# READY — passive-capture consent toggle safety

**WORKING TREE / offline author proposal; independent review required.** Base6c93209. No repository edits, live calls, actual OS permission requests, installs, deployments or device claims.

## User experience

The switch represents the person's saved choice, not a claim that location monitoring works. A saved-on choice stays on when permission is absent, unknown or the feature is paused, so the person can revoke consent. Location access and availability have separate plain-language explanations. Visits still require confirmation before entering the diary; no automatic logging promise.

Initial loading and failed/corrupt preference reads do not become an off switch. Unknown shows an explanation and Check again. A failed health read does not prevent turning off known saved consent, but unknown consent prevents accidental change. Confirmed feature-off with consent-off remains hidden as before; a stored-on choice remains accessible for opt-out during a feature pause.

Enabling without Always navigates once to the existing intro without writing consent or requesting permission from Settings. Focus return reads the saved choice again. Review phone location settings opens the existing OS settings route only after a tap; foreground return reads status without restarting or enabling capture. Open-settings failure has visible retry.

Saving disables repeat/reversed retained switch callbacks synchronously. After success or partial failure, strict readback shows the actual saved value. A timestamp-write failure can leave consent on; the UI reports incomplete enablement and does not proceed to startup. A failed stop can leave consent off but monitor state unconfirmed; explicit Try turning off again retries the existing opt-out helper even if the stored switch is already off. Check again reads only and never retries a write automatically.

Startup result copy distinguishes requested monitoring from flag-off, missing permission and unavailable native support. No successful read is proof of detection, delivery or monitor health. Some stops may be missed; manual visit entry remains available.

## Scope

- mobile/app/settings.tsx: replace only the local PassiveCaptureEntry and its dedicated imports with an owned component. Other Settings controls unchanged.
- mobile/components/PassiveCaptureToggle.tsx: consent/status/action ownership.
- mobile/lib/__tests__/passive-toggle-safety.test.tsx:32 actual mounted cases using real consent/permission/startup helpers and mocked storage/native/flag boundaries.

No shared capture, permission, flag or account helper edits. HASHES.json verifies their bytes unchanged against main. Existing global consent storage semantics retained. Apply the additive patch; reference files are not full-file replacements for evolving main.

## Request/session behavior

Each inner component is keyed to the existing account generation. useSyncExternalStore uses RootLayout's existing advance-clock-then-personal-signal-invalidate contract. No new auth fetch or generation owner is introduced.

Layout lifetime, focus identity and latest read ticket reject abandoned status results. Foreground can replace a pending read; a mutation blocks refresh until it settles. A synchronous write slot plus current-render state identity prevents repeat and retained callbacks. Account checks precede writes and check after consent persistence before startup. Blur/unmount/account change suppress subsequent caller-owned navigation/startup/readback; ABA is distinct. A pending write retains its slot across blur/refocus in the same mounted instance.

Already-entered asynchronous helper work is not cancelled. Readback is not rollback or transactional storage.

## Executed evidence — WORKING TREE / synthetic

Actual installed mobile React19.2.3 and react-test-renderer19.2.3 mount the production component. Actual passive-capture.ts, passive-permissions.ts and account-generation functions execute. AsyncStorage uses its official mock, native authorization/start/stop and Expo permission APIs are mocked, flag responses are synthetic. Focus/AppState and personal-signal notifications are modeled; global network fetch throws. Permission-request functions are asserted never called.

- PROPOSED.log:32 mounted controls plus10 existing passive-opt-in/provisional controls = **42/42 pass,3suites**.
- Initial pending, corrupt/rejected read and retry; consent-on/missing permission; unknown permission/flag; paused feature with saved consent; disabled unknown enable; intro return and phone-settings foreground return; failed repair; ordinary explicit enable and all three reachable false startup reasons.
- Partial timestamp failure, failed persistence/failed native stop and retry, same-batch repeats, pending-read versus toggle, retained old-render callback, out-of-order read, B/ABA/sign-out during save, blur/refocus, unmount, null account and StrictMode.
- BASELINE.log:31fail/1pass against the actual original local Settings function extracted verbatim except exported name/import scaffold. BASELINE_EXTRACTED_COMPONENT.tsx preserves that adapter. Many failures reflect missing new states/actions rather than31distinct production defects.
- MUTANT_ORDER.log:removing read-ticket equality fails the stale-read test. MUTANT_ACTION.log:removing the post-save ownership check causes5failures for account/focus/unmount continuations.
- Focused strict TypeScript, including Settings/imports, owned component and tests, passes (TYPECHECK.log and SETTINGS_TYPECHECK.log). Read-only patch application check passes. No full app suite/build or physical rendering claim.

After integration, run from mobile using installed dependencies:
- /opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/__tests__/passive-toggle-safety.test.tsx lib/__tests__/passive-optin.test.ts lib/__tests__/passive-provisional.test.ts

## Darwin coordination / intentionally unresolved

Darwin owns shared start/stop safety. This packet preserves the current helpers byte-for-byte:
- startPassiveCaptureIfEnabled does not itself check saved consent; after its awaited flag read, it can start even if consent/account/lifetime changed meanwhile.
- resume checks consent before that flag await; a concurrent opt-out can therefore be followed by stale start.
- optOut awaits persistence before stopping; failed persistence can leave monitoring running.
- A write already sent to global AsyncStorage can finish after screen destruction or account replacement. The component's per-instance slot cannot serialize other screens, root resume, or a new mounted instance.
- Global consent is not account-owned. Request-generation protection is not ownership migration.

The UI reports these failures honestly but does not claim to fix their core side effects. Reproduction and fixes belong to Darwin's shared-helper packet; do not infer native stop from a readback of false.

Current StartResult supports started:true or false reasons native-module-unavailable, flag-off, no-always-permission, not-opted-in. There is **no stale/cancelled reason yet**. The UI maps that current union; actual startup currently reaches the first three false reasons, while not-opted-in is available to resume. If Darwin extends the union, integrate an honest message for the new reason and rerun these tests; do not label stale cancellation as permission denial or successful startup.

No real OS permission flow, native capture, actual Always/provisional transitions, notification delivery or cold-launch behavior is verified. Synthetic return-from-intro/settings evidence establishes screen refresh behavior only. Physical accessibility/text wrapping and full-device navigation require later device review.
