# Passive inbox concurrency — READY for independent review

**WORKING TREE / offline tested author proposal.** Apply PASSIVE_INBOX_CONCURRENCY.patch as additive hunks only. It changes inbox functions in mobile/lib/passive-confirm.ts and adds ten durable regressions. Main's coffee-inclusive copy is preserved byte-for-byte outside these functions; source still matched the captured base and `git apply --check` passed at packaging. HASHES.json records identities and current baseline commit. No repository writes.

## Change

One promise queue serializes every local INBOX_KEY read and read/modify/write in this module: display reads (including expiry), scheduling reads, capture additions, removals, debug seed and hydration commit. Failed jobs release the queue for later work; strict read/expiry errors keep their existing behavior. The raw locked helpers are private and are used only from queue jobs. No other production file accesses the literal inbox key in the source inventory inspected.

Hydration takes a local count/revision snapshot under the queue, reads the mirror outside it, then reacquires the queue and rechecks both revision and current emptiness before writing. Add→remove→empty cannot fool the recheck. Revisions advance before every local write attempt, including no-op removal and uncertain failures; an in-flight response is conservatively discarded after such an attempt. Hydrated dated-entry arrays are validated before persistence so bad remote dates cannot poison the strict local reader.

The existing hydration helper still receives the local count and skips remote reads when nonempty. Scheduling remains outside mutation locks; rescheduleDigest acquires only a short queued local read, then runs its own existing scheduler serialization. No inbox operation awaits a scheduler while holding the inbox queue. Mirror calls remain fire-and-forget; they are not ordered by this fix.

## Executed validation

- **20/20 actual-helper adversarial controls passed**: controls.cjs transpiles the proposed passive-confirm, actual hydrateInboxIfEmpty and actual notification serializer. Deferred local get/set operations plus mocked Supabase auth/select transport exercise overlaps. Mirror and OS scheduler boundaries are mocks, never services.
- Same20 controls against baseline: **14 fail /6 pass**. Overwrites, lost removals, stale restoration and missing serialization are reproduced.
- Remove only hydration revision comparison: **3 fail /17 pass**, catching empty→nonempty→empty, no-op removal and uncertain failed-write cases that an emptiness-only check misses.
- **10 durable Jest regressions pass** on candidate; **all10 fail** on baseline. Actual public helpers exercised through deferred AsyncStorage and hydration boundary mocks.
- Existing passive suites plus ten new tests: **316/316 passed across21 suites**. JEST.log includes the strict-read, scheduling, attribution, invalid-observation and clustering suites. No full-app gate claim.
- Focused strict TypeScript covering changed helper/imports and new test passed, exit0. Scratch test config explicitly includes installed Jest types; no dependency changes.
- Main-copy compatibility: read-only patch application check passed; proposal source differs from main only in inbox concurrency functions/comments. No new notification copy or category changes.

Cases include add/add, same-meal dedup, add/remove in either order, remove/remove, expiry/add, debug/add, reads behind pending writes, successful restore, nonempty skip, parallel restores, hydration versus local add/remove/debug seed, unavailable reads, corrupt storage, failed writes/expiry, malformed hydrated dates and post-error queue recovery. A one-second per-case timeout in the standalone harness rejects deadlocks; no sleeps, live service calls or native operations.

## Limits — deliberately not solved

- Same JavaScript runtime/module instance only. No cross-process transaction, native/JS shared lock, Fast Refresh guarantee or distributed atomicity. A never-settling local storage call blocks subsequent local inbox work; remote hydration is outside the lock and cannot do so.
- Capture/account ownership remains device-global and unresolved. The revision is not an account token. A switch during hydrate or mirror can still involve the wrong account without the separate capture-owner design.
- Remote mirror writes remain unordered and best-effort. An old mirror can finish after a new one. This patch does not change SDK credential capture, server RLS or multi-device conflict handling.
- Revision state is in memory, not a tombstone. A later *new* restore after removal can still accept a stale mirror, even in the same process; a restart also resets the revision. Only responses already in flight across local writes are protected. No “empty implies reinstall” guarantee.
- Scheduling runs on a queued snapshot after lock release; local state can change while OS scheduling runs. Existing scheduler serialization/subsequent reschedules are retained, not a transactional OS/storage guarantee. Tests mock the OS scheduler.
- Debug fixtures can duplicate IDs when repeatedly seeded in the same millisecond; this pre-existing behavior is unchanged. Strict validation remains dated-array validation, not full schema validation. Existing best-effort getInbox display behavior remains.

No live Supabase, notifications, paid APIs, native build/device, installation, repo/claims/worklog edits or deployment. This is an author packet awaiting independent review, not an integration approval.

## Use

Apply PASSIVE_INBOX_CONCURRENCY.patch, not the full snapshot. The source snapshot and controls are review artifacts. From this workspace:

```sh
/opt/homebrew/bin/node outputs/passive-inbox-concurrency/controls.cjs
```

After main integrates, run the new passive-inbox-concurrency.test.ts with the passive suites. The standalone harness defaults to the existing mobile TypeScript installation; PALATE_MOBILE may point to another installed mobile dependency root.
