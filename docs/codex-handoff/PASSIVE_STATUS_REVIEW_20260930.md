# Passive status honesty — independent review

**WORKING TREE / offline: approve with COPY_AND_SESSION_FIX.patch.** Final author READY report and affected source reviewed. No repository writes. Source/patch hashes in HASHES.json.

## Accepted shorter copy

Normal: “Location and notifications are allowed. Review suggested food or drink stops before adding them.”

Quiet: “Location is allowed. Notifications may arrive quietly. Review suggested food or drink stops before adding them.”

The state model still requires verified saved opt-in, Always location and notification allowance. Copy describes permissions, not successful monitor startup, running health, complete detection, or guaranteed delivery. Provisional notifications remain distinguished without claiming legacy activation/scheduling now supports them. Author quiet/Profile assertions are updated, and independent mounted Home/Profile assertions check the exact requested text. Consent remains a required input even though it is not restated in the success sentence.

## P2: old session bootstrap can override newer auth event

Existing useHasSession lets delayed getSession overwrite a newer onAuthStateChange result. Independent mounted controls reproduce both directions: redisplay the strip after signout, or hide it after signin. This is pre-existing behavior retained by the proposal, not a new capture or cross-account data leak. The additive correction increments a local auth revision on events and permits the initial read only before any event. Existing unmount cleanup remains. No new auth calls, private SDK behavior or global auth coordination is introduced.

## Independent evidence

- Original packet:4/4 new controls fail. Two are real session-order races; two intentionally assert the requested shorter copy not yet adopted. They are not four production defects. ORIGINAL.log retained.
- Corrected: **76/76 tests across9suites pass**, exit0 (FINAL.log):72 author/regression tests plus4 independent mounted tests.
- Full copied candidate TypeScript noEmit check passes with incremental disabled, exit0 (TYPECHECK.log).
- Read-only author patch apply-check passes against current repository. This run uses the copied author candidate; it is not a rerun of main's entire latest suite or concurrent inbox/radius changes.
- Actual React/react-test-renderer19.2.3 mounts components; native/service/router boundaries are mocked. Independent setup adapts author harness. The actual notifications helper uses the author's TypeScript VM loader; no Metro/device packaging claim.

TESTS.patch adds4durable mounted cases; COPY_AND_SESSION_FIX.patch updates2production files and the existing author text assertions. Integrate after the author patch. No permission requests, monitoring start, flag fetch, paid requests or notification delivery occurred.

## Substantive contracts checked

Explicit opt-out overrides grants, unreadable consent remains unknown, required unknown grants do not become success, and quiet provisional notifications are permission-only success. Native authorization reads preserve unknown/errors; Expo fallback reads existing permissions without requesting them. Missing opt-in storage is intentionally never-opted-in, not failure; corrupt values reject. Legacy reader and activation semantics remain unchanged.

The shared status hook clears old status while reevaluating, preserves failed reads as unknown, and rejects earlier completions by generation. Focus/foreground/remount support retry; there is no inline retry button. Home no longer trusts on/lastCheck as detector-health proof. Profile/strip share the status result. Unknown states avoid permission-repair actions. Routing remains opt-in intro, notification intro, or OS settings as appropriate.

## Limits

Settings/permissions are device-global, not evidence of capture ownership or account-specific consent. This patch does not isolate legacy inbox bytes, bind already-started local effects, fix general stale retained action callbacks, or prove remote/native availability. A permission result remains a snapshot; foreground/focus reevaluation is not continuous OS monitoring. useCaptureStatus has no account-generation subscription; the inputs are global settings, so no per-account data conclusion follows.

CoreLocation provisional Always is not distinguishable by this API. Quiet notification permission may be accepted here while legacy scheduling helpers still decline it. Green styling represents verified local settings only. Settings toggle read/mutation races and other onboarding prose remain separate work. No actual device/accessibility/layout/notification delivery validation was performed.

The separately reviewed radius degraded-response correction remains unchanged and still throws retryLater:true when degraded far-only results yield no usable candidate. This status patch does not touch the resolver or runner.
