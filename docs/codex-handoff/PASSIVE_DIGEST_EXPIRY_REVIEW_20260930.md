# Independent digest expiry review — approved

WORKING TREE, executed offline against copied source: approve the bounded low-only deferral fix and shared 48-hour retention constant relocation. No actionable regression found; no corrective patch is proposed. Repository was read-only. Observed main HEAD at report time: e80408ae65e0e84be4a8a5b8041b36e635f3ce23; HASHES.json binds the actual tested copied bytes, since main was working concurrently.

## Reasoning

The scheduler compares the proposed extra-day slot with the earliest expiry among the low entries actually shown in the digest. The low-only branch guarantees that these are the relevant displayed entries; the existing 20-hour waiting test still prevents repeated deferral. Checking every shown low entry makes input order irrelevant when fresh and older captures coexist. If the optional deferral is unsafe, the existing normal next-slot path remains intact. No dwell, confidence, notification category, weekday schedule or capture-owner logic changes.

The retention policy has one primitive export and no imports. Importing it into both digest and confirm introduces no runtime cycle, and both calculations use elapsed 48 hours. Calendar slots still use local Date operations, so they follow local weekdays across DST rather than adding fixed 24-hour durations.

The real reader is inclusive at exactly 48 hours (detectedAt >= cutoff), not expired at that exact instant. It prunes one millisecond later. Thus strict slot < expiry is a conservative response-time safeguard; an exact-expiry notification is effectively unusable even though the row technically survives at that instant. The baseline description should preserve this distinction.

## Independent executable controls

expiry-independent.test.ts invokes actual scheduleDigest, buildDigest/digestTimeFor transitively, actual getInbox/readInboxLocked, actual local serialization and pruning. Mocks are at storage/native notification/network-adjacent data boundaries, analytics and eating-pattern retrieval. Digest computation and expiry filtering are not mocked. Synthetic AsyncStorage is used; no device or service request occurs.

Eight tests:
1. Friday 00:10 / Thursday 23:55 capture chooses Saturday 00:00 and remains readable just after delivery.
2. Friday 00:00 capture rejects a Sunday slot at exactly 48h.
3. New Year Thursday-to-Friday crossing preserves the same behavior.
4. Fresh-first/older-second mixture preserves both shown entries at delivery.
5. Ordinary Monday low-only deferral remains Tuesday 21:00.
6. Spring DST weekend retains Sunday 21:00 local and a live entry.
7. Fall DST weekend retains Sunday 21:00 local and a live entry.
8. Actual reader keeps an entry at exactly 48h, prunes and persists removal at +1ms.

RUN on copied WORKING TREE: all 8 pass independently in America/New_York, America/Chicago and UTC (24 executions). UTC additionally runs main's four expiry tests and sixteen digest-actions tests: 28 total pass in that combined run. Logs are NY.log, CHICAGO.log and UTC.log.

Counterfactual baseline changes only the new deferral guard back to its prior unconditional tomorrow-slot acceptance. Actual helper tests: 4 fail / 4 pass. Failures are the Friday early, exact-boundary, year-boundary and mixed-age cases. BASELINE.log retains assertions. This supplements main's separately reported 3-fail/1-pass baseline; it is not the same test suite.

## Bounds and integration

No new repository tests were duplicated or installed; independent test source is an output artifact only. Main can retain it as review evidence or integrate selected additional cases separately. No patch is needed from this reviewer.

This fixes optional tomorrow deferral. It does not prove every already-aged/restored entry can survive the normal next slot, nor guarantee time for a user who responds much later. Local timezone changes after scheduling, OS delivery delays, permissions, process termination and notification presentation require device validation. No OS, native-build, live service, owner isolation or cross-restart guarantee is claimed. Existing concurrent inbox display changes are outside this approval.
