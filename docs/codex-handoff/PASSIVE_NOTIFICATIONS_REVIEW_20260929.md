# Independent notification review — 2026-09-29

Approved bounded author CONFIRM_FLAG_RETRY.patch. Separate RUNNER_ADMISSION.patch supplied for a pre-existing overlap defect. Apply author patch first, then this additive patch; only mobile/lib/passive-runner.ts changes. No source repository writes, installations, services, device calls or real notifications occurred.

## Finding and correction

P2: processPendingVisits checked running, then awaited the detection flag before setting running. Simultaneous foreground/native callbacks both entered runProcess. Independently reproduced two venue lookups and two clustering writes for one raw visit in both original and author-only source. This is NOT introduced by the confirmation change. Happy-path inbox deduplication and scheduling serialization still produced one pending reminder; this is not evidence of duplicate delivered notifications.

The separate correction acquires running synchronously before the first await and moves detection admission inside the existing try/finally. Disabled detection, unavailable detection, normal completion and rejected processing release the guard. Overlapping callers retain the existing skipped-summary behavior. No scheduling/recovery implementation changes. This is a guard within one loaded JS module, not a cross-runtime lock or durable exactly-once protocol. It does not promise immediate trailing execution for an event arriving during an active run.

## Confirmation semantics

Unknown confirmation defers before qualification, clustering and venue resolution. Five repeated attempts retain the durable raw copy and retry entry with attempts=0 and no processed marker, lookup, clustering or notification scheduling request. A fresh JS runtime recovers the durable queue; later true creates an inbox and reminder. An unknown new visit leaves a pre-existing scheduled reminder unchanged. Explicit false remains an intentional terminal outcome. Existing stale flag-cache policy remains unchanged; author controls exercise stale true/false. Missing database row still maps to explicit false by source inspection. Retry capacity50 and processed capacity1000 remain; no unlimited retention or historical replay guarantee.

## Executed evidence

- Independent broader controls: original baseline8/11 passes, failing two unknown-confirmation controls and overlap. Author-only earlier10/11 passes, overlap fails (PROPOSED.log). Combined final11/11 passes separately in America/Chicago, America/New_York and UTC.
- Six focused admission controls pass on final: suspended detection lookup with eight competing callers; disabled detection recovery; unknown detection recovery without draining; rejected durable handoff recovery; confirmation-unknown retry/recovery; existing reminder preservation during unknown new confirmation.
- Negative control removes only admission correction by testing author-only source:5/6 pass, suspended-lookup overlap fails. Exit1, not false green.
- Author reproduction: original10/12, author proposed12/12. Four separately labeled unresolved observations reproduced, not interpreted as safety passes.
- Scratch additive patch application reproduces exact tested final bytes. HASHES.json captures original, author, final and read-only current repository source; current source matched original at capture.

Actual copied flags, capture handoff, runner, inbox, mirror, digest and scheduling helpers execute. AsyncStorage, native monitor and Expo/Supabase boundaries are synthetic; tests count attempted schedule requests, not only final pending entries. Clustering and venue resolution are explicit seams. Additional actual qualifyVisit controls reject short/low-accuracy fixtures and accept qualifying durations. Those controls do not establish why an actual 7 Brew visit was missed. No full application build/typecheck, native lifecycle or OS delivery certification.

Reproduction from workspace root with existing local TypeScript dependency:

```sh
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-notifications-independent/controls.cjs work/end-of-day-notifications-independent/final
/opt/homebrew/bin/node outputs/end-of-day-notifications-independent/admission-controls.cjs work/end-of-day-notifications-independent/final
/opt/homebrew/bin/node outputs/end-of-day-notifications-independent/admission-controls.cjs work/end-of-day-notifications-independent/proposed
```

Last command intentionally exits1. Harness currently uses this workspace's existing Palate TypeScript installation; no portability claim. Source copies remain in work/. Logs, controls and source hashes accompany this review.

## Separate unresolved boundaries

Scheduling recovery belongs to Mendel: failed inbox read cancels an existing reminder, failed cancellation can leave two requests, unknown enumeration can leave an orphan plus replacement. These remain reproducible with the combined runner fix and are not modified here.

Account ownership remains unresolved: actual mirror helper can tag an old device-global inbox entry with replacement account B in the mocked boundary; notification payload lacks account ownership. No cross-account real service writes occurred. Opt-out still leaves scheduled reminders; digest scheduling does not consult permission in the exercised path. Mock acceptance is not proof OS permission denial displays a notification. Product policy must clarify reminders for already-captured visits after capture opt-out.

Scheduling DATE controls verify device-local weekday21:00/weekend end-of-evening midnight and low-confidence deferral; no timezone-travel, DST or physical delivery guarantee. Broader source/account findings from the author report remain separate from this bounded approval.

MultiBlank independent review is complete and preserved at outputs/multiblank-drill-independent/REVIEW.md; no content or component changes were made during this notification task.

## Durable Jest addition (final follow-up)

DURABLE_TESTS.patch adds mobile/lib/__tests__/passive-admission.test.ts only. Six tests cover repeated confirmation-unknown retention/recovery without delivery, explicit false, eight competing calls during suspended detection, and guard release on detection false, detection rejection and handoff rejection. Uses repository-relative imports and existing Jest/AsyncStorage conventions, no new dependency or install.

Executed actual installed Jest/expo configuration against copied mobile sources and the combined final runner: new6 plus existing passive-retry5 =11/11. Existing retry assertions were unchanged; scratch mock adds readFlag resolved true as main requested. That one-line existing mock update is intentionally left to main and is not in this additive test patch. An initial harness attempt reset all Jest mocks and erased the AsyncStorage mock implementation; final test resets only its explicit function seams, preserving storage behavior and the original assertions.

Negative control against author-only runner fails overlap (5/6), demonstrating admission regression detection. Original baseline additionally fails confirmation semantics. See JEST_FINAL.log, JEST_NEGATIVE.log and JEST_BASELINE.log. Durable tests intentionally mock notifyOrInbox and prove zero calls into delivery; independent actual-handler controls above separately prove zero Expo scheduling requests. They do not claim full native delivery coverage.

Run after applying both source patches and main's existing mock update, from mobile:

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/passive-admission.test.ts lib/__tests__/passive-retry.test.ts
```
