# Independent visit-write account review — 2026-09-29

**Approved unchanged for bounded initiating-session write protection. No additive implementation correction required.** This is not approval of complete passive ownerless-data isolation. Reviewed completed author packet, account-write/username-gate contracts, root account-clock updates, public restaurant-ID helper, shared/private analytics behavior, and installed Supabase/PostgREST code. No repository edits, real credentials, service/network calls, installs or devices.

## Initiating-session and deferred credentials

saveVisit captures generation before its first await, verifies user and session, pins Authorization, then checks generation after public lookup, personal reads, primary insert and fallback. A→B→A is rejected by generation identity; same-account refresh remains valid. Existing-row result/count and successful insert reward/feed paths stay behind these checks. recordPromptDecision skips stale/missing initiating identity, pins its insert, and suppresses stale completion diagnostics.

Installed Supabase JS2.110.7 fetchWithAuth awaits getAccessToken even when a header is already present, then fills Authorization ONLY if missing. Installed PostgrestBuilder.setHeader clones its Headers, sets the named value and returns the request builder. These are public APIs, not a private SDK lock or implementation patch. Source locations: mobile/node_modules/@supabase/supabase-js/src/lib/fetch.ts and @supabase/postgrest-js/src/PostgrestBuilder.ts. Actual installed SDK execution with injected fetch confirms A's explicit bearer reaches personal requests even when the credential await returns B. A second independent operation under B uses B; the prior per-request header does not poison shared client headers.

## Public restaurant lookup: precise scope

getRestaurantIdByPlaceId performs a GET of restaurants.id by google_place_id, with no personal-row write. It is unchanged and does NOT pin Authorization. Capturing a bearer before calling it does not bind its internal SDK awaits. Independent tests execute the exact function declaration extracted by TypeScript AST from current places.ts with real installed PostgREST/fetch wrapper and synthetic transport. On A→B during its token await the public lookup transmits B's token. On completion, generation validation rejects before dedup/count/visit/analytics/feed work; A→B→A also rejects. This is acceptable for the requested personal-write scope, not a guarantee that every request uses A credentials or that no read can occur after a switch.

The source baseline policy defines restaurants SELECT using(true) (supabase/migrations/0001_baseline.sql:235); this is evidence of intended public metadata, not live RLS verification. No Google, proxy or paid lookup is involved in this helper. Error and missing-row behavior remain propagated. Persistent token-provider failure rejects without rewards/feed; a transient failure follows installed idempotent GET retry and can succeed. An initial independent assertion incorrectly expected a single transient error to reject; the final controls separately test persistent failure and observed transient retry without changing production code.

## Replacement-account telemetry / feed

The private analytics helper preserves event/props and nonblocking behavior while eliminating shared track's deferred getUser. Writes use initiating user ID and bearer. Resolved analytics error reports only while the generation remains current; stale completion produces no new diagnostic. Ordinary analytics failure is still reported and does not reject a saved visit.

Detached feed lookup and insertion use the same pinned bearer and generation. A stale restaurant response does not start feed insertion. A feed insert already handed to the SDK may still finish under A after replacement; it cannot be recalled. Ordinary feed rejection remains best-effort and does not reject the saved visit. No replacement-account haptic/cache reward was observed after stale save completion. Rewards already emitted while A was current are not retroactively undone.

Observability's broader SDK session/user context is not redesigned. Existing backend triggers may fire for an A write committed before/after the UI transition. Stale completion rejection does not prove no visit or feed row committed.

## Ordinary failures and compatibility

Author controls preserve manual/auto payloads, receipt date/notes/time metadata, missing-column fallback, dedup/count results, private-feed suppression, auth/session failure and error telemetry. Same-generation session acquisition failure now denies work deliberately; it does not retry using another account. Signed-out save rejects; decision bookkeeping skips. recordPromptDecision ordinary resolved database failure remains nonthrowing/reporting; auth transport rejection remains rejecting.

Known pre-existing behavior remains: failed dedup/count reads are not a transaction-level uniqueness guarantee; read errors can fall through as absent/zero count. This patch does not repair that or claim exactly-once visits. Callers that begin another write after replacement need their own flow identity. No fresh caller-mounted/UI result guarantee is included.

## Independent execution and source identity

-12 independently written controls pass, zero skipped/cancelled. Includes actual public helper credential awaits A→B and A→B→A; ordinary public lookup success; persistent/transient credential failures; stale analytics/feed error completions; ordinary analytics/feed rejection; per-request header isolation; and actual-public-lookup path analytics/feed pinning inside SDK token await.
- Removing explicit headers (author no-headers source mutation) fails2/12 independent controls: actual analytics and feed requests arrive with B bearer.10 pass; exit1, no false green.
- Reproduced all54 author actual-source controls:54 pass, no skipped/cancelled.
- Independently applied author patch to current-source scratch copy and reproduced existing prompt-refusals/local-refusals/digest-confirm suites:44/44 pass,3 suites.
- Both touched repository files matched author captured base before application. Applied bytes matched author proposed snapshots. HASHES.json records implementation, changed test, helper and installed SDK source identity. Approved visits.ts SHA256:4878cb4329fb2dfc3644a43ba8508b442309076eb201a2f7f0ab5e5709d9aea7.

Harness is adapted from the author's transport boundary; independent assertions and actual public-helper loading extend that coverage. Real Supabase/PostgREST are used with a wholly injected synthetic fetch. Function extraction covers getRestaurantIdByPlaceId, not every places.ts import or paid path. Existing dependency location is configurable via PALATE_NODE_MODULES; the helper source capture currently uses this workspace's read-only repo path. This is a scratch review harness, not a portable durable test patch. No new strict typecheck/full-app/native/backend RLS claim.

Reproduce from workspace:

```sh
node --test outputs/visit-write-independent/independent.test.cjs
CANDIDATE=no-headers node --test outputs/visit-write-independent/independent.test.cjs
node --test outputs/visit-write-account-safety/handlers.test.cjs
```

Second command intentionally exits1. INDEPENDENT.log, NO_HEADERS.log, AUTHOR.log and JEST.log contain results.

## Explicit exclusions

Ownerless input newly submitted under B is still treated as B; capture-time ownership cannot be recovered here. Receipt resolution before saveVisit invocation, later rating/decision writes started as fresh calls, update/delete/photo/visibility writers, account-owned passive storage/notifications and headless gate initialization remain separate. Existing synchronous root generation updates are required. No promise that delayed/unobserved auth changes are detected by the clock, that tokens remain valid forever, or that already-started requests are cancelled.
