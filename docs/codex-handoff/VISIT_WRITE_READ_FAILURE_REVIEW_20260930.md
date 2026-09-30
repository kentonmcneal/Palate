# Independent visit read-failure review — 2026-09-29

**Approved unchanged for bounded dedup/count failure handling.** No additive source correction required. Author packet reviewed; all three actual repository paths matched captured base before scratch application. Separate passive-digest changes untouched. No repository writes, installations, credentials, network/service requests or device operations.

## Correctness

Each query error is checked immediately after the existing account-generation assertion. A failed dedup cannot advance to count or insert. Either exact-count branch rejects query errors and unavailable/invalid exposed counts. The SDK error object is thrown directly; a stale account error takes precedence. Valid zero is accepted, yielding first-visit reward only in the new-row branch. Existing-row success still returns without new insert or reward.

requireVisitCount accepts nonnegative safe integers and denies null, NaN, negative, infinite/unsafe values. This checks the SDK result, not raw Content-Range grammar; installed parseInt normalization can erase malformed fractional text. The implementation preserves this explicitly documented limitation. No request ordering, bearer binding, fallback-field behavior or caller signature changes beyond fail-closed reads.

A theoretical count of Number.MAX_SAFE_INTEGER passes and adding one is outside the safe-integer range; this has no plausible per-user visit volume and is not an actionable blocker for this bounded fix. Counts can legitimately disagree with an earlier dedup result under concurrent deletion; an existing-row result with count0 remains accepted, demonstrating that no cross-request snapshot/consistency guarantee is provided.

## Caller effects

Source review: Add catches failure, displays an alert and releases its saving ref/state; no celebration on failure. Wishlist removes its entry only after successful save, so failed reads preserve the wishlist item. Restaurant logBeenHere catches and releases logging; success navigation/extra haptic are after save. Receipt acceptance updates accepted status only after save returns. These are source observations, not mounted UI tests.

Actual digest-confirm plus actual proposed saveVisit were executed together with synthetic transport: failed count leaves entry in failed results, performs no removal/decision bookkeeping, and a later recovered save removes it once. Notification confirmVisitById queues save failures before inbox removal; this patch therefore routes these newly recognized failures into the existing retry queue. Ownerless queue/account semantics remain unresolved and were not edited.

Nonblocking UX follow-up: failed HEAD responses can produce an SDK error with empty message. Add/Wishlist/restaurant use nullish fallback, so they can display an empty message beneath their failure title. This patch deliberately preserves the SDK error unchanged; consider a separate caller-level nonblank-message fallback. No automatic retry loop was added. A pre-existing passive-confirm comment claiming dedup guarantees idempotency is overstrong; this review does not endorse it.

## Independent execution

- Expanded author durable runner on copied proposed source:75/75 pass, zero skipped/cancelled.
-10 independently written controls:10/10 pass. Cover dedup/count errors and missing counts in both branches; no writes/rewards; same-instance recovery; account-switch precedence; no legacy insert fallback after failed dedup; existing-row count; actual digest caller retention/recovery.
- Same independent controls against original implementation:3 pass/7 fail, exit1. These failures reproduce unwanted success/side effects and digest removal; negative run is not green.
- Author patch applied in scratch and every changed byte matched proposed snapshots. HASHES.json records exact approved source, durable runner and README. PATCH_CHECK.log records base identity and application.

Harness transport factory is adapted from author code; independent controls are additional assertions. Installed Supabase/PostgREST2.110.7 executes with injected synthetic fetch, auth and restaurant boundaries. The original54 account controls remain intact in the expanded75 suite. The additional actual digest test transpiles current digest-confirm.ts and injects proposed saveVisit; an initial scratch invocation used wrong argument order and was corrected before final positive/negative logs.

No redundant full application suite or new typecheck claim; author supplied focused typecheck evidence. No production database/RLS/device claim. Scratch harness uses local dependency/source paths; the proposed durable repository runner itself remains root-relative and needs no install.

Reproduce from workspace:

```sh
node --test outputs/visit-read-failure-independent/independent.test.cjs
node --test work/visit-read-failure-independent/mobile/scripts/visit-write-account.test.cjs
```

See INDEPENDENT.log, BASELINE_INDEPENDENT.log and AUTHOR.log.

## Limits retained

Dedup/count/insert are separate requests. Concurrent successful saves can still duplicate, counts may change, lost insert responses remain uncertain, and a stale rejection cannot undo an already-committed write. No transactional uniqueness, exact reward snapshot, ownerless-origin protection or caller-flow account isolation is claimed. Guard/token semantics from the prior account patch remain unchanged.
