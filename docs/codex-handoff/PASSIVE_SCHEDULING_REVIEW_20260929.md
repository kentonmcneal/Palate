# Independent scheduling recovery review — 2026-09-29

**Approve with the supplied one-line strict-missing correction.** Author packet was marked ready. Reviewed passive-confirm/readInbox/rescheduleDigest, passive-digest/scheduleDigest, shared ownedBy/serialize and changed stateful cancellation test. Captured author base matched current repository's two implementation files before overlay. All implementation/testing occurred in scratch; no repository writes, installs, services, real notifications or device operations.

## Narrow finding / additive correction

P2 defensive recovery gap: `raw ? JSON.parse(raw) : []` treats a present empty string as verified missing storage. An empty string is invalid JSON, so an armed digest is cancelled even though inbox contents were not verified. This falsy fallback predates the proposal, but retaining it leaves a hole in the new strict-read contract. No normal writer generating empty strings or real corruption incident is claimed.

STRICT_MISSING_INBOX.patch changes only that condition to `raw === null ? [] : JSON.parse(raw)`. AsyncStorage missing-key null remains verified empty; every present value must parse and validate. Public getInbox still catches errors and returns [], preserving its caller contract. Apply after SCHEDULING_RECOVERY.patch.

The standard AsyncStorage Jest mock maps stored empty strings to null. The durable malformed-value cases therefore explicitly mock one getItem response to the exact stored string, matching the string-or-null interface and making the distinction testable. Initial scratch tests exposed this mock behavior; assertions were not relaxed. Final author-only negative run fails this empty-string case, and corrected code passes it.

## Cancellation review

Author replacement sequence is sound for this bounded same-process model: enumerate before any cancellation; cancel only requests whose kind is passive_digest; await cancellation; enumerate again; require no owned requests; clear remembered ID; then either stop for verified-empty inbox or schedule/save one replacement. Stale stored IDs cannot select unrelated reminders for cancellation. Enumeration rejection, cancellation rejection and fulfilled no-op cancellation do not authorize replacement. A request appearing during cancellation is detected by verification. Shared notification-dedupe cancellation behavior remains unchanged.

Verification failure after successful cancellation may leave no reminder. This is the explicit conservative duplicate-avoidance tradeoff; inbox remains available for retry. Metadata write failure after schedule leaves an owned orphan, recoverable through enumeration. No atomic OS transaction, cross-process lock, delivery recall or native enumeration-consistency guarantee is implied.

## Independent durable regressions

DURABLE_TESTS.patch adds mobile/lib/__tests__/passive-scheduling-recovery.test.ts:13 independent cases, no dependency/config changes. Executes actual rescheduleDigest, scheduleDigest, ownership and serialization; synthetic stateful Expo queue and repository AsyncStorage mock; analytics, observability, mirror and visit helpers mocked. Cases cover:

- Rejected inbox read preserves request/ID, then confirmed-empty recovery disarms without replay.
- Present empty string, whitespace, JSON null, object and invalid date remain unavailable.
- Missing storage is verified empty.
- Initial enumeration rejection preserves queue and ID.
- Fulfilled no-op cancellation blocks replacement and later recovers.
- Verification enumeration rejection blocks replacement after successful cancellation.
- Partial cancellation failure and retry preserve unrelated requests even with misleading stored ID.
- A new owned request appearing during cancellation blocks replacement.
- A second serialized call after failed cancellation reads newly emptied inbox instead of restoring prior content.

Durable tests are repository-relative and run with existing Jest tooling. No hardcoded workspace path in the test file. Existing author cancellation test assertions remain intact.

## Executed evidence

| Source/test variant | Result |
|---|---|
| Author26 handler controls: original |13 pass /13 fail, exit1|
| Author26 handler controls: proposed |26 pass, exit0|
| Author26: permissive-read mutant |19 pass /7 fail, exit1|
| Author26: no-verification mutant |25 pass /1 fail, exit1|
| Author26 on corrected final copy |26 pass, exit0|
| Independent13 Jest cases: author-only |12 pass /1 fail, empty-string contract|
| Independent13 + existing39 focused Jest: corrected final |52 pass,6 suites, exit0|
| Independent13 with verification removed |11 pass /2 fail, exit1|

Focused existing suites: passive-digest, digest-schedule, digest-cancels-on-confirm, notification-dedupe, digest-boundary. Copied unchanged app/digest.tsx supplied its existing boundary fixture. Existing Expo warning appears in two suites; no real native notification operation was performed. This is not a full application test/build or fresh strict typecheck claim.

Sequential application of author patch, strict-missing correction and durable test patch in scratch reproduces exact tested files. PATCH_CHECK.log and HASHES.json capture identity. Source/test logs accompany this report. Run from mobile after patches:

```sh
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/passive-scheduling-recovery.test.ts lib/__tests__/passive-digest.test.ts lib/__tests__/digest-schedule.test.ts lib/__tests__/digest-cancels-on-confirm.test.ts lib/__tests__/notification-dedupe.test.ts lib/__tests__/digest-boundary.test.ts
```

## Remaining boundaries

Account ownership remains separately unresolved and is not fixed by stricter cancellation. Ownerless inbox/action payloads, replacement-account mirror writes and logout cancellation require coordinated review. Opt-out meaning, stale notification content during unavailable reads, 7 Brew diagnosis, native background execution, travel/DST and actual OS delivery remain outside signoff.

Minimal dated-array validation is intentional, not complete schema validation. Public getInbox fallback and other read-modify-write races remain outside scope. Same-process scheduling serialization does not serialize every inbox writer; this review does not claim otherwise. Runner flag/admission fixes are preserved; no pipeline, auth, detector or shared scheduler policy edits.
