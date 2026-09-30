# Passive inbox concurrency — independent review READY

**WORKING TREE / offline evidence: bounded acceptance.** The captured `PASSIVE_INBOX_CONCURRENCY.patch` correctly serializes local inbox operations within one loaded JavaScript module and rejects hydration responses that overlap a local write attempt. No corrective source patch is necessary for that stated scope. Do not describe this as account isolation, reliable mirror ordering, cross-runtime atomicity or durable removal protection.

The author packet was captured after `REPORT.md` became READY; its patch/report/hashes were unchanged at completion. `CAPTURE.json` binds the reviewed helper and independent controls. Author source SHA-256: `4e78199cb46e9bd57ddb1186400d32c41c852ce9703011a15bb7c44ffcf9318e`; patch SHA-256: `d438bc23ea2cb01fa83169d6f4924eb2d517ffec8591046d4e75c82cc9243c42`. Author's captured baseline HEAD is f7588ca8f1099c641c6dd5de58631e3242e68e21. No repository, ledger, claims or worklog writes.

## Why the queue is sufficient for its local claim

Read `passive-confirm.ts`, actual `passive-inbox-sync.ts`, `notification-dedupe.ts`, the patch, author tests and governing repository instructions. All production literal inbox-key access found is in passive-confirm. Add, remove, debug seed, strict reads including expiry, and restore commit run through the same promise tail. Queue errors settle the tail, allowing later work. Locked helpers call one another directly rather than reacquiring their own queue.

Hydration snapshots count/revision in the queue, waits for the mirror outside it, then checks current emptiness AND revision in a second job. Revision advances before setItem, including failed/uncertain writes and no-op removal. Thus emptiness after add→remove cannot authorize an old response. Mirror and scheduling are not awaited while the local queue is held. The existing scheduling queue remains independent.

**WORKING TREE / offline tests:** 30 simultaneous distinct captures retain 30 rows; 30 same-meal captures produce one admission and 29 duplicate suppressions. A write that commits and then rejects cannot be overwritten by a previously started restore; its retry deduplicates. A queued read waits behind an unfinished write. A stalled scheduler permits the next local mutation to commit. A newer hydrate followed by removal invalidates an older outstanding hydrate, even though the inbox is empty again.

## Tests executed independently

- Author standalone controls rerun against captured proposed source: **20/20 pass** (`AUTHOR_RERUN.log`).
- New independent controls: **12/12 pass**, comprising eight behavioral controls and four explicit demonstrations of unresolved limits (`INDEPENDENT.log`). “LIMIT” passes mean the limitation was reproduced, not fixed.
- Same independent controls against captured baseline: **7 pass /5 fail** (`BASELINE.log`). The four limitations reproduce on baseline too.
- Removing only the hydration revision comparison: **11 pass /1 fail**; delayed older hydrate after newer hydrate+removal is rejected by the oracle (`NO_REVISION.log`). This independently distinguishes revision protection from an emptiness-only guard.
- Read-only `git apply --check` passed against main's current helper.

The standalone harness executes the actual compiled public helpers, actual mirror/hydration implementation and actual notification serializer. AsyncStorage operations and Supabase auth/query transport are synthetic/deferred; no SDK HTTP request, native storage, real notification, paid API, device or live account is used. Schedule completion is controllable. All unexpected imports reject. Each case has a bounded deadlock timeout.

Author reports ten durable Jest tests and 316 tests across 21 suites. I inspected the durable cases but did **not** independently rerun that full Jest set or TypeScript gate; those remain author evidence. Main should run them on integration.

Run:

```sh
/opt/homebrew/bin/node outputs/passive-inbox-concurrency-independent/controls.cjs
```

Set `PALATE_MOBILE` to another installed mobile dependency root if needed. Optional positional source path selects a baseline/mutant. No installation required.

## Explicit limits reproduced with actual helpers

1. **Owner/account boundary remains open.** Start actual hydrate for account A and defer its select response. Change mocked current user to B, then resolve A's payload. Proposed restore writes A's venue into the device-global inbox. Revision has not changed, so it cannot detect the owner transition. `hydrateInboxIfEmpty` captures a user for its query but neither its return value nor the local key carries that owner. Mirror likewise resolves user at mirror execution rather than taking the initiating capture owner. This is a separate capture-owner/auth lifecycle design requirement, not supplied by this patch.
2. **Remote mirror ordering remains open.** Defer old actual mirror upsert, complete a newer empty mirror deletion, then release the old upsert. The old row returns to the remote mock. Local serialization does not serialize fire-and-forget mirror completion. RLS/actual SDK credential behavior was not tested and cannot be inferred from the mock.
3. **Fresh restore after removal still accepts stale mirror rows.** Complete removal, then begin a new restore with a stale remote row. The new snapshot is empty and current, so it restores the row. No in-memory revision scheme without durable removal/restore provenance closes this. Restarts also reset revision state.
4. **Expiry return/telemetry is not a live-entry count.** An otherwise valid 49-hour-old mirror row is written, `passive_inbox_restored` records count 1, and restore returns 1. The subsequent scheduling read expires it, leaves local empty and passes an empty snapshot to scheduler. Existing behavior, not a regression; callers must not interpret the return/event as “one usable prompt remains.” The patch does not filter restored rows by expiry before counting them.

Other limits from source: one never-settling storage request blocks all queued local work; no process/native lock; full schema validation is absent; getInbox's existing display fallback is still [] on failure; scheduling and local state are not one transaction. A storage call that never settles is distinct from a rejected promise, which the queue handles. Errors in best-effort mirror operations remain swallowed. No “empty means reinstall” safety claim is justified: the unchanged sync helper's old comment overstates that assumption; the new caller comment/report correctly narrows it.

## Compatibility and integration

**WORKING TREE byte comparison:** code before the Inbox section and after the Notify-or-inbox boundary is identical to current main. Coffee-inclusive notification titles/body are retained; actual mirror/serializer source copies also equal main. Apply additive patch hunks, not the full snapshot. No dependency or migration change. No notification policy, confidence threshold, dwell floor, coffee recognition or user-visible copy change in this patch.

I used the [Supabase skill](/Users/kentonmcneal/.codex/plugins/cache/openai-curated-remote/supabase/1.0.0/skills/supabase/SKILL.md) for the account/mirror review. No Supabase feature/SDK API/schema was implemented, and all verification stayed offline. No remote security or device verification is claimed.
