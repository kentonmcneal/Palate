# Independent strict inbox mutation review

**WORKING TREE / offline execution. Approved four production substitutions unchanged.** Test-only TEST_FIX.patch supplied against captured main test. Actual current passive-confirm.ts remained identical to tested copy at packaging. No repository edits, live calls, notifications or services. Add save ownership packet remains complete and untouched.

## Production assessment

addToInbox, removeFromInbox and seedDigestFixtures now propagate strict read/parse/validation/expiry-persistence failures before their subsequent mutation. restoreInboxFromServer uses the same strict read before hydration; its existing catch returns0, without treating an unreadable local inbox as permission to fetch/replace remote data. getInbox remains best-effort display fallback. Scheduler retains its previously reviewed strict read.

Six additional actual-function controls cover each mutation's expiry-pruning write rejection, removal recovery preserving unrelated entries, and restore recovery reading current nonempty storage. On expiry write failure, original stored snapshot remains unchanged and mirror/hydration/scheduling are not invoked. This prevents the old second write from replacing data after the pruning write failed.

## Caller propagation and precise retry limits

- notifyOrInbox rejection reaches passive-runner's existing retry handling rather than marking a successful inbox result. However these ordinary storage errors consume attempts; after3 the runner marks the raw ID processed/dropped. This is not indefinite durable retry or a complete no-loss guarantee. No retry policy changed here.
- removeFromInbox now rejects before replacing unreadable data. Several existing callers intentionally swallow removal failure after a durable visit/decision (digest-confirm, notification confirmation and confirmation screens). The row can remain and be prompted again; it is not automatically queued for removal. This patch prevents destructive overwrites, not eventual cleanup or duplicate-prompt elimination.
- restore catches and returns0; root invokes it at existing lifecycle points, not a new retry timer.0 means no rows restored, not verified empty/successful synchronization. Read failure now prevents hydration rather than invoking it with invented0 local rows.
- Debug seeding propagates failure; no empty replacement is authorized. This is debug fixture behavior, not a production recovery mechanism.

Caller observations above are source review, not mounted/native execution. Account-global rows, stale restore completion and concurrent read/modify/write races remain unchanged. In particular, data added during remote hydration can still be overwritten by its later result. Strict reads do not serialize writers, attach owners or introduce merge/conflict resolution.

## Test correction and evidence

Captured main test initially failed20/23 here despite sound production changes: existing AsyncStorage setItem mock history included fixture seeding, and its getItem implementation collapses stored empty string to null. TEST_FIX.patch clears only the write mock's call history after seeding, injects the exact empty-string native read once, and acknowledges the standard mock's normalized later read. No production assertion is removed: zero mutation/mirror/hydration/schedule calls remain mandatory. The empty-string preservation evidence is zero setItem calls; final official-mock read is expected null rather than misrepresented as a native read.

With test boundary corrected:
- Main23 + independent6 =29/29 pass,2 suites, exit0.
- Reverting only four strict mutation reads to getInbox:27 fail/2 pass, exit1.
- PROPOSED.log preserves initial fixture/mock failures; FINAL.log and BASELINE.log are final positive/negative evidence.

Tests execute copied actual passive-confirm helpers. AsyncStorage, visits, mirror, scheduler and Expo boundaries are synthetic. No full app gate, new typecheck, actual scheduler/OS delivery or live account claim. Main's prior full-suite evidence is separate. HASHES.json records tested implementation and original/corrected test hashes. No additive implementation patch required.

Optional independent durable file: passive-inbox-independent.test.ts, copy under mobile/lib/__tests__. Test correction is only for the captured test; if main independently fixed the same mocking issues, compare before applying.
