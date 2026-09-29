# End-of-day scheduling recovery — bounded author proposal

2026-09-29. **WORKING TREE / synthetic execution** only. Ready for independent review. No repository writes, notifications, sign-ins, APIs, installations or deployment. Account isolation remains a separate high-priority issue. This patch is independent of the pending passive-runner confirmation-flag patch.

## Changed paths

SCHEDULING_RECOVERY.patch contains:

1. `mobile/lib/passive-confirm.ts`: extract strict private readInbox; keep public getInbox's existing fallback behavior; use the strict read only in rescheduleDigest.
2. `mobile/lib/passive-digest.ts`: digest-specific fail-closed cancellation/replacement using authoritative pending OS requests.
3. `mobile/lib/__tests__/digest-cancels-on-confirm.test.ts`: stateful synthetic pending-notification queue and stronger assertions that confirmation leaves zero pending digests and replacement leaves one.

`notification-dedupe.ts` is unchanged. Its shared cancellation policy is neither changed nor silently inherited by this stricter digest path. Existing `ownedBy` is reused only as a pure ownership selector. Source snapshots/hashes included.

## Unavailable is different from empty

**WORKING TREE, reproduced baseline:** a rejected AsyncStorage read is caught by getInbox and becomes []. The scheduler interprets that as verified empty and cancels the armed reminder even though the unanswered entry remains in storage.

**WORKING TREE proposal:** private readInbox throws on storage read/JSON failure, malformed array or non-finite dated entries, and failure to persist expiry pruning. rescheduleDigest's existing catch records digest_schedule_failed and captureError before touching the OS queue. It does not retain or replay a stale inbox snapshot. Later retry reads current storage: if confirmations have emptied it, cancellation is then appropriate; if new entries exist, replacement reflects those entries.

Missing storage, a valid empty array, or successfully persisted expiry of all entries are verified-empty cases and still disarm the digest. The minimal dated-array validation is not a complete InboxEntry schema validator. Public getInbox keeps its current [] fallback for other callers: broader UI/read-modify-write behavior is explicitly outside this patch.

## Owned-request cancellation must succeed

**WORKING TREE, reproduced baseline:** both remembered-ID cancellation and shared cancelScheduledOfKind swallow failures. A replacement is then scheduled alongside an old request.

**WORKING TREE proposal:** before cancelling anything, enumerate pending requests. Select only `content.data.kind === passive_digest`, await every cancellation without swallowing rejections, enumerate again, and require no owned requests remain. Only then clear the remembered ID and either finish (verified empty) or schedule a replacement.

- Failed first enumeration leaves the armed request and remembered ID untouched; no cancellation/replacement attempted.
- Cancellation rejection stops replacement. A fulfilled no-op cancellation is caught by the second enumeration.
- Partial cancellation may already have removed some requests; it cannot be rolled back. Remaining owned requests stay discoverable for a later attempt, and no replacement is added.
- A verification read failure after successful cancellation can leave **no** reminder armed. This deliberately prefers no duplicate to an unverifiable replacement; the inbox remains and foreground reconciliation can repair it.
- The OS queue, not the stored ID, identifies ownership. Orphans with missing/stale stored IDs are removed. An unrelated weekly reminder is never cancelled merely because an incorrect stored ID points at it.
- The old getStoredId callback parameter is retained (renamed `_getStoredId`) for call compatibility but no longer consulted. Stored-ID read failure cannot defeat authoritative queue enumeration.
- Failure to clear the ID aborts replacement. If scheduling succeeds but saving its new ID fails, its kind-tagged request remains discoverable; next successful reconciliation removes that orphan before creating one replacement.

This is not an OS transaction or cross-process mutex. Existing rescheduleDigest serialization covers this module's same-process calls. A request can fire while cancellation is in progress; already-delivered notifications cannot be recalled. Independent schedulers/processes adding requests after final verification are not ruled out. Actual Expo/iOS enumeration consistency remains DEVICE unknown.

## Source-handler red/green

**WORKING TREE / synthetic actual handlers:** handlers.cjs executes copied passive-confirm, passive-digest, inbox mirror, confidence/eating-pattern and shared serialization/ownership code. AsyncStorage, Expo scheduling/queue, analytics and Supabase boundaries are synthetic; no real notifications or network. Cases inspect the synthetic pending queue, stored ID, inbox retention, replacement counts and failure telemetry.

| Variant | Passed | Failed |
|---|---:|---:|
| Baseline | 13 | 13 |
| Proposed | 26 | 0 |
| Proposed with scheduler reverted to permissive getInbox | 19 | 7 |
| Proposed without final owned-request verification | 25 | 1 |

Coverage: read rejection; invalid JSON/null/nonarray/null entry/non-finite date; failed expiry persistence; verified empty/missing/all-expired; recovery to newer nonempty and confirmed-empty data; first and verification enumeration rejection; cancellation rejection/no-op/partial failure; orphan and stale IDs; unrelated reminders; metadata-clear/write failure; schedule rejection/recovery; overlapping serialized reschedules; actual removeFromInbox; unchanged public read fallback.

**WORKING TREE validation:** focused strict tsc passes on copied source and its local dependency tree. Five relevant existing Jest suites pass, **39 tests total**: passive-digest, digest-schedule, digest-cancels-on-confirm, notification-dedupe, digest-boundary. Four suites/37 tests passed in the first run; the boundary suite initially could not read its app/digest.tsx fixture because the scratch copy omitted app/. Copying that unchanged file and rerunning the boundary suite yielded its2 passing tests. This was a fixture setup error, not a production failure hidden or a threshold relaxed. JEST.log and JEST_BOUNDARY.log preserve both results.

The existing cancellation test mock always returned an empty OS queue even after scheduling. It now tracks requests by ID and deletes them on cancellation. Assertions are stronger, not removed. This matters because the proposal intentionally no longer trusts a remembered ID over an authoritative empty OS queue.

Read-only git apply --check passes. No full application build/test gate, native delivery, or LIVE verification claimed.

## Reproduce

From workspace root with existing local TypeScript:

```sh
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-scheduling-recovery/handlers.cjs base
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-scheduling-recovery/handlers.cjs proposed
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-scheduling-recovery/handlers.cjs unsafe-read
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-scheduling-recovery/handlers.cjs no-verification
```

Baseline and both deliberate mutations must exit1; proposed exits0. Copied source/negative variants are included. Apply the patch only; full proposed snapshots are alternatives for inspection, not additional patches.

## Remaining high priority

**WORKING TREE finding from preceding audit, unchanged:** local inbox, queued actions and scheduled digest payloads have no account ownership. A replacement account can see/reschedule old local entries; mock-boundary mirror writes can tag those entries with the replacement account. This recovery patch does not make that safe. Owner-scoped storage, async account-generation guards, notification-action ownership and logout/switch cancellation need a coordinated separate patch with a safe policy for legacy ownerless data.

Opt-out semantics and the reported 7 Brew incident also remain outside this fix. Preserving an armed request during an unavailable read preserves its old content; without a verified snapshot the scheduler cannot know whether that content has become stale. It retries on existing foreground/capture/removal entry points, not a new timer or server cron.
