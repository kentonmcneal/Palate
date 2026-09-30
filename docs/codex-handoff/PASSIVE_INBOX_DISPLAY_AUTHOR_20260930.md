# READY — passive inbox display recovery

**WORKING TREE / offline author proposal; independent review required.** No repository changes, service calls, native notifications, sign-ins, installs or permissions. Source base HEAD b6a2c62 plus main’s newly integrated Darwin sync/restore working changes; strict serialized read introduced by5a3cf37 retained. Current unrelated claims-file edit untouched. Exact source/patch hashes in HASHES.json.

## Bounded behavior

Existing screen calls getInbox(), whose compatibility fallback returns[] on read failure. It renders “Nothing to confirm” even while first read is pending and after unavailable storage. The proposed screen has separate loading, ready and unavailable states. Only a successful strict read returning[] authorizes empty copy.

New `getInboxReadResult(): Promise<InboxReadResult>` returns either `{status:"ready",entries}` or `{status:"unavailable"}`. It wraps existing serialized `readInbox()` and inherits validation/expiry-persistence failure semantics. It does not change getInbox, scheduling, mutations, native capture or restore. Unexpected display-boundary rejection is also contained. Generic UI error copy avoids leaking raw storage/error details or claiming that an unreadable file is intact.

Same-session retry/refresh keeps previously verified rows visible. During refresh or after failure, rows explicitly wait for refresh and confirmation is disabled; retained row callbacks are rejected too. Successful empty response clears old rows; success with entries replaces them. Synchronous pending-request admission prevents double retry. Focus reloads after returning from confirmation; blur abandons old requests. Latest ticket, layout lifetime and initiating account generation gate result/error/finally, including ABA. Back and row navigation reject duplicate retained callbacks.

The owned inner session is keyed to the existing account generation. useSyncExternalStore subscribes to existing personal-signal invalidation, which RootLayout invokes synchronously after advancing that clock on auth events. Same-account invalidations do not reset the screen. Replacement account/sign-out clears component state rather than retaining another session's rows. Null account does not read storage or claim empty. No new auth fetch, subscription, clock or shared-store mutation is introduced.

## Exact patch paths

- mobile/app/passive-inbox.tsx — owned screen/session state and retry/refresh UI.
- mobile/lib/passive-confirm.ts — one additive result type/function hunk beside getInbox; no existing function body changed.
- mobile/lib/__tests__/passive-inbox-display.test.tsx —22 actual mounted cases.
- mobile/lib/__tests__/passive-inbox-display-read.test.ts —10 actual strict-reader/API cases.

Apply PASSIVE_INBOX_DISPLAY.patch; source/ is reference, not replacement files. No ledger/worklog/package changes proposed.

## Darwin coordination

Darwin's ready outputs/passive-sync-account/PASSIVE_SYNC_ACCOUNT.patch changes sync and guarded restore/read boundaries. This packet does not modify those hunks. The only shared-file edit adds a result wrapper immediately after unchanged getInbox. Do not replace passive-confirm.ts with this snapshot: the final reference snapshot contains Darwin’s guards, but other concurrent edits must still be preserved.

Both patches applied cleanly in a fresh scratch copy, Darwin first then this packet. The combined five-suite run passes71tests. Main should integrate both additive patches and preserve Darwin's account guards. This is compatibility evidence, not independent approval of Darwin's security patch. HASHES.json binds the exact Darwin patch tested.

## Executed evidence (WORKING TREE / synthetic)

Installed mobile React19.2.3 / react-test-renderer19.2.3; actual screen and existing account-generation functions mounted, native primitives/router-focus boundary/personal-signal notification boundary mocked. No substituted web React. Boundary callbacks model focus and RootLayout's advance-then-invalidate contract; no real navigation/device timing claim.

- MOUNTED.log:22/22 pass. Initial pending/unavailable/empty, explicit retry/recovery, same-batch duplicate retry, preserve-and-disable rows, both confirmation routes, stale success/failure and spinner ownership across blur/refocus, ABA/B/sign-out, account invalidation before render, same-account signal, null admission, back/unmount and StrictMode replay.
- BASELINE_MOUNTED.log:21fail/1pass using same assertions against old screen. Several failures are missing new UI/actions, not21distinct production bugs. The first-load and unavailable-versus-empty failures directly reproduce the display defect; the mock legacy getInbox returns the same[] fallback as the actual failed reader.
- STRICT_READ.log:10new API tests +39existing strict-read/queue/independent controls =49pass. Actual AsyncStorage mock covers missing/verified-empty, invalid JSON/shape/date/empty string, rejected reads/recovery, failed expiry persistence/recovery, queue continuing after rejection, legacy fallback unchanged.
- COMBINED.log:71/71, five suites, with Darwin applied. Existing strict/storage tests use Darwin's reviewed fixture changes; storage assertions preserved.
- MUTANT_ORDER.log:removing ticket equality causes3failures (old success/error/spinner). MUTANT_EMPTY.log:changing unavailable into ready[] causes8failures in10 actual API controls. Mutants are scratch only, not patch content.
- Focused strict TypeScript of both source files plus both tests/imports passes. The first scratch invocation omitted Jest types and native module sources; explicit installed Jest types and a copied existing modules directory resolved those omissions, without production/dependency edits.
- Read-only apply-check passes against current main. No full-app suite, build, EAS, browser, native Xcode or device evidence claimed.

Reproduce after applying in mobile, with existing dependencies:

```
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/__tests__/passive-inbox-display.test.tsx lib/__tests__/passive-inbox-display-read.test.ts lib/__tests__/passive-inbox-read-safety.test.ts lib/__tests__/passive-inbox-concurrency.test.ts lib/__tests__/passive-inbox-independent.test.ts
```

## Explicit limits

**Global ownerless inbox isolation remains unresolved.** Preventing an A request or retained A callback from updating B's UI does not prove that a newly initiated B read contains B captures. Existing global bytes can still be returned to B; no owner adoption, quarantine, migration or native capture rule is added. This is request/session protection only, not a privacy-isolation claim.

The result API inherits existing strict-reader expiry side effects (local persistence, best-effort mirror/analytics). It does not add account guards to those operations, roll back already-started writes, or cancel an in-flight native/storage request. Darwin's restore-specific guards remain intact but are not automatically applied to other global reads. Storage schema validation remains the existing dated-entry check, not new comprehensive payload validation.

Cached rows intentionally cannot be confirmed while freshness is unavailable. Refresh/focus checks freshness; this does not introduce a live subscription to every background inbox mutation or expiry timer. Physical layout, accessibility/screen-reader behavior, real navigation timing and production/device behavior require separate verification. The seven-Brew/end-of-day report remains a hypothesis, not a diagnosis established by this packet.
