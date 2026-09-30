# Visit read-failure safety — author proposal

**WORKING TREE / offline synthetic execution.** Base `e22348c`. Scratch only; no repository edits, service calls, credentials, installs, transactions or migrations. Requires independent review before integration.

## Change

The actual saveVisit source discards the dedup lookup's error and both exact-count errors. A failed dedup can therefore authorize a fresh insert, while a failed new-visit count can produce a first-visit reward. An existing-row count failure returns an invented total of one.

The patch checks each returned error immediately after the existing account-generation assertion. It throws the SDK error unchanged. It also rejects absent or invalid exact counts instead of using `?? 0` / `?? 1`. The small private requireVisitCount helper requires a nonnegative safe integer; an unavailable count produces `Visit count is unavailable. Please try again.`

Successful empty dedup plus verified zero count still inserts and returns the first-visit reward. Successful existing-row lookup/count returns that row without inserting. Ordinary positive counts, time metadata, legacy-column fallback, feed/analytics ownership and function signatures remain unchanged. An existing-row count failure now rejects; it does not create another visit or pretend its total is known. No automatic retry was introduced.

Three changed paths:

- `mobile/lib/visits.ts`: explicit dedup/count error handling and count validation only.
- `mobile/scripts/visit-write-account.test.cjs`: retain original 54 controls, extend mock response capabilities, add 21 read-failure/recovery controls.
- `mobile/scripts/visit-write-account.README.md`: update count and document coverage/limits.

## Executed evidence

The portable durable runner reads actual source in its enclosing mobile/lib and installed mobile/node_modules. For this scratch proposal, base/proposed source directories were copied and the dependency directory linked to the existing installation. Tests execute real installed Supabase/PostgREST 2.110.7 with synthetic fetch/auth/restaurant/native boundaries. Production Supabase initialization and environment files are not loaded. There is no real network.

| Source/control | Pass | Fail |
|---|---:|---:|
| Current source, expanded controls | 59 | 16 |
| Proposed source | 75 | 0 |
| Remove explicit query-error checks | 69 | 6 |
| Remove count validation | 65 | 10 |

Zero cancelled/skipped tests in these final runs. Authoritative logs end in `_VERIFIED.log`. The original 54 account controls all pass. The 21 added controls comprise six HTTP/aborted-read cases with recovery across dedup/new-count/existing-count, ten unavailable/invalid count cases with recovery, four account-switch/error-precedence controls (A→B and A→B→A across both count branches), and one verified-zero first-visit control.

Failure assertions require no POST requests, haptics or cache invalidation; dedup failures cannot even proceed to the count query. Recovery uses the same harness/source instance with the fault removed, verifies actual total/insert behavior and pinned credentials. Query errors must retain the SDK error message rather than silently becoming a generic count error. HEAD error responses have an empty body, matching HEAD semantics; an empty SDK error message is preserved as before for explicit query errors rather than inventing a server explanation.

Focused strict TypeScript checking of the proposed visits.ts and its imported dependencies passes (`TYPECHECK.log`). Patch apply-check passes against the actual repository, and all touched base files still matched at packaging. Main's unrelated backlog edit was observed and left alone. No full application suite was rerun for this bounded proposal.

The first exploratory run used generic thrown fetch errors and hit the installed SDK's automatic retry backoff, exceeding the test timeout. It also tried a fractional raw count header that the SDK truncates with parseInt before exposing the count. Those exploratory logs remain separately named. Final controls use AbortError for immediate SDK-normalized fetch failure and test count values actually exposed as null, NaN, negative or unsafe integers. The proposal does not claim raw HTTP-header validation or full retry-backoff coverage.

## Running after integration

From repository root:

```sh
node --test mobile/scripts/visit-write-account.test.cjs
```

The .cjs script remains outside Jest autodiscovery; no package changes are needed. HASHES.json and base/proposed snapshots support review. Earlier visit-account safety evidence remains untouched.

## Explicit limits

This is fail-closed handling of the query result exposed by the installed SDK. It does not replace SDK response parsing. For example, malformed fractional count text normalized by the SDK is not detectable as fractional in this helper.

Dedup, count and insert remain separate requests. Two simultaneous successful saves can both miss each other and insert; counts can change between requests; a server-committed insert whose response is lost can still leave an uncertain outcome. Transactional uniqueness/idempotency, concurrency, time-window semantics and migrations are separate work. The patch introduces no claim that every duplicate is prevented or reward totals are transactionally exact.

Existing account-generation and pinned-Authorization limits remain: already-started A requests may finish under A, and ownerless A payloads newly invoked under B are not solved here. There is no device, live RLS or production data claim.
