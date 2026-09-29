# Independent push-preferences review

## Result

**WORKING TREE / copied-source local execution:** one actionable defect in the supplied patch, reproduced and corrected. Apply `PUSH_PREFS_COLLAPSE_FIX_20260929.patch` **after** `outputs/palate-push-prefs/profile-push-preferences.patch`. Correction changes only Settings plus two new independent regression suites. No repository writes, installs, secrets, live services, or paid operations.

**COMMITTED / baseline source:** reviewed against `ff4980c`, which contains requested auth-cleanup commit `2940e17`. The supplied patch passed apply-check on that baseline. Main subsequently placed the supplied preference changes in its working tree while this review ran; those modifications were not made by this worker.

## P1 — ordinary section collapse destroys mutation ownership

**WORKING TREE / reproduced:** supplied `mobile/app/settings.tsx:275–278` nests `ProfilePushPreferences` inside the actual `CollapsibleSection`. The latter's `components/CollapsibleSection.tsx:55` renders its body only while open. Closing the section therefore destroys the preference owner, including `pending`, `revision`, state and uncertainty (`settings.tsx:437–467`). Opening it creates fresh owners.

Concrete cases for activity, likes and comments:

1. Start a write, close/reopen Wrapped & reminders before completion, invoke the new switch. A second write is submitted while the first is pending. The first completion cannot reconcile because its owner was destroyed. This is an ordinary in-screen interaction, not the documented limitation of destroying the whole Settings screen.
2. Close/reopen while the successful write's readback is pending. A replacement initial read enables the switch; the original reconciliation is discarded and its result cannot publish.
3. After a failed write with successful snapshot readback, close/reopen. The warning that the uncertain write may still finish disappears.
4. Close/reopen during initial load. A duplicate initial request replaces ownership of the first. This is additional coverage of the same lifetime defect, not a separate severity finding.

**WORKING TREE / test gap:** the supplied mounted tests replace `CollapsibleSection` with a host string, so children never actually unmount on collapse. The independent suite executes the real component, real Settings hooks/effects and real account-generation module. Native widgets, unrelated services, and preference IO are mocked.

## Bounded correction

**WORKING TREE:** retain `ProfilePushPreferences` and its generation-keyed session owner above the collapsible section. Three fixed-order preference hooks own the same existing per-field state machine and return its controls to a render callback inside the section. Closing only destroys presentation; outstanding reads/writes, gates, and warnings survive. Account-generation replacement or actual screen destruction still invalidates old completion/callback ownership. No helper or schema behavior changed.

Initial preference reads now start when Settings mounts even if the section stays closed, matching the old main-screen eager-read behavior. The surrounding reminder section resets closed when the account generation changes; same-ID auth events preserve it and preserve operation state.

## Other requested contracts

**WORKING TREE / source and local tests:** no additional actionable defect found in these bounded paths:

- Strict reads reject returned auth/query errors, absent/wrong profile, null/missing/non-boolean fields; false remains false. Deferred getUser or row completion after A→B→A is rejected using token identity, before profile query where possible. These tests execute real helper/account-generation code with synthetic Supabase results.
- Uncounted/zero-row-shaped successful UPDATE is followed by a strict read. Contrary readback displays the observed value with uncertainty; matching readback does not prove rows affected, as the author's report correctly states. Read failure renders unknown and Retry rather than a default enabled state.
- Same-tick duplicate callbacks are serialized per field. The slot remains held while reconciliation is unresolved; a second failed write can start only after it finishes. Different field operations remain independent.
- Old initial reads, retained handlers, write finalization, and reconciliation after unmount/account replacement/ABA cannot publish into or initiate work for the new owner. Same-ID notifications do not release gates or clear warnings.
- Retry reads only; uncertainty intentionally survives later reads. There is no claim of backend request ordering, cancellation, or queued push cancellation.

## Independently executed evidence

**WORKING TREE / local execution:**

- Supplied candidate + all 45 independent cases: **12 FAIL / 33 PASS**, exit 1. Twelve failures are four collapse cases × three fields. First case directly observes **two writes instead of one**. All 18 independent strict-helper cases pass before correction.
- Corrected source + all original and independent suites: **178 PASS / 6 suites**, exit 0. Original coverage: 133 tests. Added coverage: **27 actual-collapsible mounted cases + 18 real-reader boundary cases**.
- Mobile `tsc --noEmit --incremental false`: PASS, no diagnostics.
- Correction apply-check against copied candidate: PASS. Original patch apply-check against captured main baseline: PASS.

Logs: `CANDIDATE_RED.log`, `GREEN.log`, `TYPECHECK.log`. `MANIFEST.json` gives candidate/fixed Settings hashes. `source/` contains the corrected Settings copy and both new test files; the additive patch is the integration artifact.

Mounted cases per field: pending write across collapse, pending readback across collapse, warning across collapse, same-tick failures plus pending reconciliation, ABA pending write, ABA initial read, unmount during readback, initial load across collapse, and same-ID auth event during pending write/after failure.

Reader cases per column: deferred auth ABA, in-flight row ABA, stale token before auth, returned auth error even with a user, thrown query failure, and same-account event preserving a valid pending read.

## Reproduction and limits

Apply original patch then correction in a copied mobile tree using the installed dependencies. Run `/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --runTestsByPath` with the six files: `push-preferences-independent.test.tsx`, `push-preferences-readers-independent.test.ts`, `push-preferences-mounted.test.tsx`, `push-preferences-readers.test.ts`, `profile-settings-boundary.test.tsx`, and `remaining-profile-writes.test.ts` under `lib/__tests__/`. Run `/opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false`.

**INFERENCE / unverified:** native Switch interaction, accessibility on a device, SDK wire behavior, backend RLS/row counts, final ordering of ambiguous server requests, and actual push delivery. Local tests do not settle these. Whole-screen destruction still releases local ownership; reopening a new screen cannot reconstruct an uncertain earlier server operation. Server idempotency/version ordering would be needed for a stronger cross-screen or cross-device guarantee.
