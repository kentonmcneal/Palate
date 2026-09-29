# End-of-day notifications — bounded notification-path audit

2026-09-29. **WORKING TREE / LOCAL SYNTHETIC EXECUTION** throughout unless explicitly marked INFERENCE. These labels describe source and copied-handler tests, never deployed state or a physical phone. Read Palate AGENTS.md, CLAUDE.md, CODEX_HANDOFF.md, CAPTURE_SPEC.md, the relevant source/tests and current claims. Initial observed tip b9b9bf7; concurrent recommendation-chain edits were left untouched. No repository/ledger/claim edits, sign-in, messages, service/paid calls, deployment, native build or install. Supabase skill read for the backend review; no new Supabase feature or schema change was implemented, and user-authorized offline scope supersedes its live-query suggestions.

## Main finding and supplied fix

**WORKING TREE, reproduced:** confirmation uses `isFlagEnabled(CONFIRM_FLAG)`, unlike the tri-state resolution gate. With no cached confirmation flag and a failed lookup, false fallback yields a normal resolved outcome. `runProcess` adds the raw ID to processedIds. Future runs filter that raw ID even if the confirmation flag becomes readable. No inbox entry or digest was created.

Important precision: `drainNativeVisits` first persists the native entries to `palate.passiveCapture.queue`, THEN clears those native IDs. It does not erase the durable JS queue. The observed failure strands the remaining raw visit behind its processed marker; it is not proof every copy was physically erased.

**WORKING TREE proposal:** CONFIRM_FLAG_RETRY.patch changes only `mobile/lib/passive-runner.ts`. Read the confirmation flag tri-state before qualification/clustering/resolution; unknown throws existing retryLater and does not consume attempts. Reading before those side effects avoids repeatedly recording the same location into clustering or rerunning venue lookup during a confirmation-only flag outage. Explicit false still follows the existing terminal kill-switch behavior; true proceeds normally. Detector qualification/resolution implementation is unchanged.

This intentionally defers even potentially unqualified raw stops until confirmation availability is known. It does not redesign the bounded retry queue (50), processed cap (1000), storage-error handling, account isolation or the existing resolution-unknown path. Do not interpret “no attempt consumed” as unlimited durable retention: queue-cap eviction remains possible. A stale cached flag continues to govern offline, matching existing policy. Missing database row remains explicit false. No already-processed visits are automatically replayed: recovering historical stranded raw records needs separately reviewed migration/recovery semantics.

## Trace: passive visit → inbox → reminder → answer

| Stage | WORKING TREE path and limits |
|---|---|
| Detection / native handoff | passive-capture.ts: opt-in controls resume; remote detection flag + native Always authorization control starting. Native pending events are mirrored to a device-global JS queue before native clearing. Native emission and actual wake behavior remain DEVICE unknown. |
| Runner | _layout.tsx starts processing on signed-in foreground and native event callbacks. processPendingVisits checks detection flag, reads retries/processed IDs, calls qualification, clustering, resolve gate/venue lookup, then confirm gate and notifyOrInbox. Runner itself has no account parameter or user-opt-in check. |
| Inbox creation | passive-confirm.ts: recent dismissal suppresses outright; repeated refusals demote to low. Entry is stored before scheduling. Same venue + same device-local calendar day collapses to one entry, deliberately also collapsing a real same-place second visit that day. |
| Reminder | REALTIME_PROMPTS_ENABLED=false. The active path is local `rescheduleDigest → scheduleDigest → expo-notifications` DATE trigger, not server push. Copy is fixed when scheduled. A day with no digest-worthy entries schedules nothing. |
| Foreground repair | _layout.tsx reschedules, drains queued confirm actions and attempts mirror hydration at signed-in launch; active events reschedule again. A failed local schedule retains the inbox and emits digest_schedule_failed/captureError; a later successful reconciliation repairs it. |
| Tap / actions | `kind: passive_digest` plain tap opens /digest. One high/medium entry carries the shared Yes/No category and place/inbox params; answered actions fall through to confirmVisitById/declineVisitById. Multiple confident entries open the digest. Payload carries no account ownership token. |
| Confirm/remove | Inbox removal rewrites/cancels the pending digest. Digest-confirm's source orders durable save before removal. A local scheduling failure does not roll back an inbox write. Notification-action failures use a device-global confirmQueue; its account ownership is a separate risk below. |

**WORKING TREE:** the server mirror in passive-inbox-sync is backup, not an end-of-day push queue. Migration 0132 scopes passive_inbox rows with auth.uid()=user_id and prunes at seven days. The client expires local inbox rows at 48h; mirror hydration only runs when local inbox is empty. RLS cannot detect that account B is uploading an entry that originally belonged to A if the client labels it B.

## Schedule, timezone, quiet hours and unconfirmed filters

**WORKING TREE / synthetic handlers:** Sunday–Thursday 21:00 device local; Friday/Saturday use hour24, meaning midnight at the END of that evening. Eating-pattern argument is currently ignored despite older comments claiming personalization. Weekday-after-slot entries schedule tomorrow. Low-only entries younger than20h defer to tomorrow's slot; older low-only entries avoid another age-based deferral. No separate local evening-reminder opt-out found in Settings; its “Log visits in the background” toggle stops capture, not existing reminder delivery.

**WORKING TREE:** local digest scheduling does not consult profile.timezone or server next_sendable_at. Date calculations use device timezone; scheduled DATE is an absolute instant. Changing timezone after scheduling needs reconciliation for updated local time; OS travel/DST delivery behavior is DEVICE unknown. Synthetic tests pass in America/Chicago, America/New_York and UTC, but do not simulate changing the timezone of an already scheduled OS notification or certify DST transitions.

**WORKING TREE:** the explicit weekend-midnight digest policy differs from realtime quiet21–08 and server quiet22–08. The fixed schedule has dedicated tests stating midnight was requested. This audit preserves that choice; it does not “fix” midnight back to daytime. Copy promising nothing late at night is therefore not a universal description of current local policy.

**WORKING TREE:** getInbox removes entries older than48h. Digest notification includes entries within an anchored prior-slot window plus20min grace, no future timestamps; screen uses unwindowed remaining inbox. Up to6 entries are included, high before medium before low; current sort is chronological ascending within each band (despite a nearby comment saying newest first). Removed confirmations no longer schedule; empty inbox cancels. It is an inbox-membership filter, not a fresh backend query for every previously confirmed/manual visit. Content cannot be revalidated at OS fire time; already-delivered notifications are not withdrawn by cancelling a scheduled request.

## Separate local reproductions — NOT fixed by this patch

Four observation controls deliberately reproduce unsafe/ambiguous behavior in BOTH baseline and proposal. Their passing assertions mean reproduction succeeded, not that these paths are correct.

1. **WORKING TREE, privacy/account boundary:** after synthetic A creates an inbox entry, synthetic B can read it from the same device-global storage, reschedule its named-place digest, and the actual mirrorInbox function uploads it tagged user_id B to the mocked data boundary. Keys include passive.inbox, processedIds, retryQueue, confirmQueue, digestNotifId, notifRate/lastNotifAt and passiveCapture.queue; entries/actions have no owner. auth.signOutForAccount does not clear these stores or scheduled local notifications. No repository-wide cleanup call was found in the inspected mobile sources. **INFERENCE:** stale notification actions/queued confirms could write under a replacement session; actual cross-account visit writes were NOT invoked in this audit.
2. **WORKING TREE, opt-out/permission:** optOutOfPassiveCapture writes false and stops the monitor but leaves a pending digest. Actual rescheduleDigest runs afterward without reading user opt-in or notification permission; the mocked OS boundary accepts scheduling. This does not prove denied OS permission delivers anything. Product policy needs an explicit answer about confirming already-captured visits after tracking opt-out, then cancellation + scheduling gates if opt-out means no further reminders.
3. **WORKING TREE, failed read:** getInbox catches a storage read failure and returns []. Reconciliation then cancels the armed reminder although the unanswered entry is still in storage. A later foreground may repair it, but a quiet evening can be missed. Narrow next fix: distinguish unavailable inbox from verified-empty inbox and preserve the existing schedule on unavailable reads; test recovery without resurrecting confirmed rows.
4. **WORKING TREE, failed cancellation:** cancellation errors are swallowed by stored-ID cancellation and cancelScheduledOfKind. Reschedule continues to create a new request, leaving two pending requests in the synthetic OS queue. Serialization prevents successful same-process interleaving, but does not prove OS cancellation succeeded. Narrow next fix: fail closed on unsuccessful owned-request enumeration/cancellation before scheduling a replacement; retain retry evidence. Avoid changing shared notification-dedupe semantics without coordinating its other callers.

**INFERENCE / next coordinated scope:** account safety requires owner-scoped storage plus an account generation guard for async reads, writes, mirror hydration and queued notification actions; account-bound notification payloads and logout/account-switch cancellation; and an explicit policy for legacy ownerless rows. Do not simply migrate ownerless visit/location data to whichever account signs in next, and do not clear another account's data to make tests pass. This crosses auth, capture storage, inbox, mirror, layout and notification actions and is deliberately not bundled into the one-file flag patch.

## Local/push/cron distinction

**WORKING TREE source review only:** server send-push is an independent outbox drainer. It uses x-cron-secret authentication, server_push gate, due-row/expiry/attempt checks and per-class quota admission before Expo transport. Migration0093 schedules drain_push_outbox every5minutes; migration0132 schedules inbox pruning at03:25UTC. Neither constitutes an evening passive-digest delivery path. No passive_digest enqueue into push_outbox was found. Enabling server_push is not a repair for a missing local digest.

**INFERENCE — LIVE unknown:** current cron installation/runs, deployed function boot, actual flag values, Expo tickets/receipts, account tokens and profile timezone. Instructions say server_push is founder-owned/off; migration0150 contains an ON update. These are conflicting historical/source artifacts, not grounds to assert the current production value. No switch touched. Existing push timezone gates are distinct from digest timing; retry-time server quiet-hour correctness was not executed or certified here.

## 7 Brew: hypothesis, not incident diagnosis

**WORKING TREE, synthetic actual functions:** current qualification with empty history, closed accurate stops rejects2min and4.99min, accepts5/7/12min; travelling floor is12min. isLoggableVenue accepts a synthetic coffee venue marked national_chain or fast_food with eligibility0, rejects eligibility0 with no reason or not_a_food_venue, and accepts missing/nonzero eligibility. The check is based on eligibility/reason, not the name “7 Brew.” This does not verify a real 7 Brew row, its types, native short-stop emission, accuracy, suppression history, ranking or distance.

**INFERENCE:** a short coffee visit may fail before the notification path due to dwell/native emission/eligibility/resolution, or may be stranded at the confirmation flag/read/scheduling stages identified here. None is established as the cause of the user's experience. Needed incident evidence: appropriately redacted native event timestamps/dwell/accuracy; pipeline stage outcome; flag-cache outcome at that time; local inbox presence; scheduled local request/timezone and OS authorization; then device delivery/tap evidence. Detector author owns native/qualification changes; this patch changes none.

## Verification and artifacts

**WORKING TREE / local synthetic execution:** handlers.cjs executes copied actual flags, capture handoff, runner, inbox, mirror, digest, serialization and scheduling helpers. AsyncStorage, native monitor queue, Supabase response boundary and Expo notifications are synthetic. Qualification/clustering/venue resolution are explicit mocked seams in this notification integration harness; no real venue/API calls. A separate coffee-boundaries.cjs executes the captured actual qualifyVisit/minDwellFor/isLoggableVenue with empty synthetic history. Source snapshots/hashes included.

- Baseline Chicago:10 pass/2 fail. Proposed:12 pass/0 fail, repeated in Chicago/New York/UTC.
- Four unresolved observations reproduce in each variant/timezone, separately labelled.
- Unknown confirmation retains a retry entry with attempts0 after5 runs; no processed marker, no clustering or lookup while unknown; later true creates one inbox and one pending digest; repeat run adds neither.
- Explicit false, stale true/false and unknown resolution behavior retained. Actual local reminder removal/dedupe/refusal/demotion/schedule failure recovery/weekend rollover checked.
- Read-only git apply --check passes. No full tsc/Jest/application build claim; TS sources were transpiled and actual handlers executed. No production SQL/cron execution, OS delivery or native background lifecycle verification.

Reproduce from workspace root (existing TypeScript only):

```sh
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-notifications/handlers.cjs base
TZ=America/Chicago /opt/homebrew/bin/node outputs/end-of-day-notifications/handlers.cjs proposed
/opt/homebrew/bin/node outputs/end-of-day-notifications/coffee-boundaries.cjs
```

Baseline exit1 is expected. Proposed green establishes this bounded patch, not end-to-end production reliability or a diagnosis of 7 Brew. Main should integrate only after independent review and its normal checks.
