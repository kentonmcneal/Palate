# Passive capture status honesty — READY for independent review

## Confirmed issue and bounded correction

The original `captureStatus` returns `ok` / “On” whenever Always location and notification grants are true, including `optedIn:false`. OS grants survive opting out; they do not establish consent or active monitoring. Original Home TrackingLine separately trusted cached `on`/`lastCheck` props, so even correcting the shared selector alone would leave contradictory Home status. The warning also promised that meals “log themselves”; Home promised every eating stop would be picked up and a guaranteed digest. These claims exceed this confirmation-based, fallible pipeline and omit drinks.

The patch reports saved opt-in and verified grants, not monitoring health. Explicit opt-out takes precedence over grants; unreadable opt-in or required grants remain unknown. Unknown has neutral styling and guidance to return/reopen for a fresh check, with no permission-repair action. Home footer and Profile use the same status reader as the strip. A generation guard prevents older async reads or unmounted completions replacing newer results. Read-only strict helpers are additive: legacy permission/notification/opt-in readers and capture startup behavior are unchanged.

Copy now describes possible food or drink stops, review/confirmation, and missed stops. Settings changes are copy only. Home hero changes are copy/comments only: its priority, routing, scheduling calculation, and inbox handling are unchanged. No new “enabled” input, remote flag fetch, native changes, or runtime-health claim was introduced.

## Actual state semantics inspected

- `lib/passive-capture.ts`: stored key `palate.passive.optIn` records consent, separately from grants. Opt-out stores false and stops monitoring. Resume checks opt-in. Startup additionally requires the native module, `passive_capture_detection`, and Always authorization. These status reads cannot prove startup succeeded.
- `lib/passive-permissions.ts`: legacy helpers swallow failures into false. The new status-only helper reads native authorization once, or Expo permissions when the module is absent; unknown/error propagates. CoreLocation’s `always` cannot distinguish provisional Always from confirmed background authorization. Wording therefore says location **reports** Always.
- `lib/notifications.ts`: legacy helper catches errors and uses `granted` alone. Installed Expo `src/NotificationPermissions.ts` explicitly documents accepting iOS PROVISIONAL as well as `granted`. The new status-only reader recognizes quiet provisional authorization and preserves errors. Existing scheduling/activation consumers retain legacy semantics.
- `components/CaptureWarning.tsx`, `components/HomeHero.tsx`, `app/(tabs)/me.tsx`: actual shared consumers inspected and mounted. The Home `lastCheck` value is a settings-read timestamp, not proof of detector health; the footer no longer presents it as such.
- `app/settings.tsx`, `app/(tabs)/index.tsx`, `lib/home-state.ts`: inspected opt-in/grant snapshots and existing activation copy. Settings toggle/startup logic remains unchanged.

## Verification

- **72 passing tests / 8 suites**: new honesty controls plus existing capture-status, passive-optin, home-state, own-profile-connections, notification-primer, notification-dedupe, notification-schedule suites. See `REGRESSION.log`.
- New controls cover all 16 boolean combinations, failed/unknown reads, strict helper domains, provisional notifications with `granted:false`, actual mounted strip/Profile/Home, recovery on foreground, old completion after newer opt-out, and unmount/remount. Home copy controls preserve drinks/review/missed-stop qualifications.
- **Four selected controls fail on original source** (`BASELINE.log`). This is a focused red baseline, not a claim that the entire new suite is compatible with missing additive helpers.
- Removing the generation check fails the stale-completion control (`STALE_MUTATION.log`). Coercing failed opt-in reads to false fails the unknown/recovery control (`UNKNOWN_MUTATION.log`). Both mutations were restored before final checks.
- Actual installed Palate React **19.2.3** and matched react-test-renderer **19.2.3**. Service/native boundaries mocked. Controls assert no permission request, monitoring start, or flag read. No OS/device/Expo bundle verification claimed.
- The test loads actual `notifications.ts` through TypeScript CommonJS transpilation in a VM with explicit mocked imports, to exercise its dynamic-import helper under standard Jest. This tests the actual helper source, not Metro/ESM packaging. Other subject helpers/components use ordinary Jest source imports.
- TypeScript `--noEmit`: exit 0 (`TYPECHECK.log`, empty on success).
- Patch checks cleanly against captured current working-tree bytes (`APPLY_CHECK.log`). All 12 affected-file bases matched main at packaging (`HASHES.json`). No repository files were written.

## Integration and reproduction

Apply `PASSIVE_STATUS_HONESTY.patch` from the Palate repository root after independent review. It contains nine production files and three test files. `source/mobile/` contains the exact proposed files. Do not replace whole files if main changes after the captured hashes.

From an applied mobile checkout or the prepared scratch candidate:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath lib/__tests__/capture-status-honesty.test.tsx lib/__tests__/capture-status.test.ts lib/__tests__/passive-optin.test.ts lib/__tests__/home-state.test.ts lib/__tests__/own-profile-connections.test.tsx lib/__tests__/notification-primer.test.ts lib/__tests__/notification-dedupe.test.ts lib/__tests__/notification-schedule.test.ts
/opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
```

`PRESERVATION.json` records untouched inbox, sync, and Home index snapshots. Main’s `passive-confirm.ts` and `passive-inbox.tsx` changed after the scratch snapshot; neither is in this patch. The 72-test run used the captured snapshot, so it is not a verification of those later concurrent changes. The patch does not change confirmation storage, pending-inbox display, sync guards, scheduling, native detection, or consent writes.

## Limits / remaining gaps

- Verified settings do not prove native availability, remote feature-flag enablement, successful monitor startup, notification delivery, or complete capture. Green `ok` means the checked local settings agree, not “running.”
- Existing legacy scheduling/activation helpers still reject quiet provisional notifications when `granted:false`; this UI-only patch does not change delivery behavior. CoreLocation provisional Always remains unobservable through the current API.
- Settings still uses its existing boolean reads/toggle behavior; this patch does not solve its initial unknown state, read/mutation races, or ignored startup result. The revised copy makes no running claim.
- Other onboarding/activation prose, including passive-capture-intro, still deserves separate review; this is not a certification of all passive copy. Home activation selection continues to use its existing legacy snapshots.
- Unknown recovery is focus/foreground/remount based, not an inline retry button. No new storage subscription is added; a consent change is observed on the existing reevaluation triggers.
- No real device, notification delivery, native prompt, account, network, or live-service test was performed. No repository or ledger edits.

## Main copy review / handoff note

Main suggested a shorter permission-only success message: “Location and notifications are allowed. Review suggested food or drink stops before adding them.” Quiet provisional variant: “Location is allowed. Notifications may arrive quietly. Review suggested food or drink stops before adding them.” Both avoid a monitoring guarantee and are reasonable presentation refinements. This packaged revision retains the tested, explicit saved-opt-in / location-reports-Always wording; the shorter copy has not been applied or tested here. Acceptance of `ok` still requires saved opt-in, independent of the wording. A reviewer may adopt the shorter copy with corresponding mounted text assertions without changing the state model.

Unknown is rechecked on focus, foreground, and remount; the mounted recovery control proves a successful later read removes the unknown state. Persistent read failures remain honestly unknown. There is no inline retry button, so do not describe this as one-tap retry or guarantee recovery from a permanent platform failure.
