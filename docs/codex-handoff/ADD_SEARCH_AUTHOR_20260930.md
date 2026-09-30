# Add search admission and stale-result safety — author packet

**WORKING TREE / mounted synthetic execution.** Observed HEAD `e22348c`; main had unrelated passive-digest/backlog changes and continued integration concurrently. The captured Add source still matched the actual repository when packaging. No repository writes, live calls, paid calls, installs, device access or backend changes. Independent review required.

## Contract inspection and reproduced defect

- Add's existing handleSearch tests only nonempty query. Button loading state is neither synchronous nor a keyboard-submit guard.
- It awaits getCurrentLocation before invoking searchRestaurantsDetailed. A changed query, account or unmounted screen previously could still dispatch the old search afterward, then overwrite results/degraded/loading or emit an obsolete alert.
- getCurrentLocation checks existing foreground permission and requests a position; it does not itself request a new permission in this path. Failure intentionally permits unbiased search.
- searchRestaurantsDetailed calls places-proxy with action=search, query and optional coordinates. callProxy awaits the SDK function invocation and formats errors. It has no screen cancellation contract. A mocked invocation count is therefore a client admission metric, not the number of Google charges or server attempts.
- Free suggestions use searchRestaurantsLocal (search_restaurants_local RPC), driven by the actual debounced useSuggestions hook. Their paid/free distinction must remain intact.
- saveVisit's existing synchronous savingRef gate and celebration/navigation flow are preserved. This packet changes its alert fallback only, as explicitly requested.

## Proposed behavior

`ADD_SEARCH_SAFETY.patch` touches only:

1. `mobile/app/(tabs)/add.tsx`
2. New `mobile/lib/__tests__/add-search-safety.test.tsx`

The owned inner Add session is keyed by the existing account-generation identity. The normal root account remount contract is retained, and an Add rerender under a replacement generation resets its local query/results state too. Account checks use the existing shared clock; no new auth listener or service call is introduced.

A layout-effect lifetime token invalidates work on unmount/StrictMode cleanup. Search input is an identity object updated synchronously when typing; saved submit callbacks for an older input cannot authorize a new call. Current input, account generation and mounted lifetime are required at admission.

A synchronous active submission and per-trimmed-query pending map prevent repeated keyboard/button submissions from allocating another location/search operation. An explicit different-query search remains allowed while an older paid call is in flight. A request checks the active input/request and account/lifetime again after location succeeds OR fails, before crossing the potentially paid boundary.

If the user types A→B→A, typing alone never adopts the old A response. If they explicitly submit A again while its same-session operation is pending, that new submission joins the existing operation and owns its eventual result. This includes equivalent surrounding whitespace. It does not allocate a second paid attempt for the same still-pending query. If the old pre-location operation has already been abandoned/finished, an explicit new submit starts a fresh operation normally.

Only the latest submission ticket may set results/degraded state, display a search error, or clear the spinner. Old completion cannot clear a newer pending spinner. Query edits clear obsolete paid results and degraded messaging. Pending entries release on settlement; failures and completed successful searches permit a new explicit retry/search. Location failure still allows a valid unbiased search.

The initial location warm-up also verifies account/lifetime before setting suggestion bias. No shared suggestion component is edited. Typing continues to call only the free local suggestion boundary. “Search everywhere” remains available when local suggestions exist.

Both existing search/save alerts now preserve any nonblank string message and use “Try again” for empty, whitespace-only, missing or invalid messages. Null thrown search values are safe. No Wishlist or restaurant screen changes.

## Mounted evidence

Tests mount the actual Add component with installed React/react-test-renderer and the repository Jest preset. React hooks, useSuggestions debounce/controller, and account-generation identity are real. Native primitives, router, location, paid/local search, and saveVisit are mocked. Tests call both mounted button and keyboard handlers in one update batch and count attempts at searchRestaurantsDetailed. No real Google/proxy/network work occurs.

**WORKING TREE / offline results:** proposed **39/39 pass**; baseline **10 pass / 29 fail**. Focused strict TypeScript checking of Add and copied imported dependencies passes. Patch apply-check passes. No whole-app gate is claimed.

The 39 controls cover duplicate submissions before location and while paid work is pending; changed queries before paid dispatch; reverse responses; stale error and spinner ownership; explicit failure recovery and repeated completed searches; query A→B→A discard/rejoin; saved callbacks; account A→B/A→B→A/sign-out during location and paid work; account rerender; unmount; denied-location fallback; free suggestions and explicit wider search; degraded reset; blank query; StrictMode-mounted submission; warm-up bias ownership; manual local suggestion saving, duplicate-save gate, first/repeat celebrations, delayed navigation and failed-save retry; meaningful/blank error messages.

Negative controls run as separate scratch copies, never by altering repository code:

- Remove synchronous duplicate admission and pending reuse: 4 failures.
- Remove the query/request check immediately before paid dispatch: 2 failures.
- Remove account guards: 6 failures.
- Restore blank-message fallback behavior: 6 failures.
- Remove result-ticket/input identity: see `result-identity_VERIFIED.log` for the targeted stale-result/alert/spinner failures.

Logs ending `_VERIFIED.log` are final runs. Initial 35-control runs are preserved too. The Expo Jest preset emits a native logger warning with these deliberately minimal native mocks; these are not device tests. No failed native logger call is counted as a search attempt or a production diagnosis.

To run after integration from mobile:

```sh
node node_modules/jest/bin/jest.js --runInBand lib/__tests__/add-search-safety.test.tsx
```

Base/proposed source and HASHES.json identify the exact proposed files and inspected contracts. Mounted tests are included in the patch for durable regression coverage.

## Boundaries and follow-up findings

**INFERENCE / explicit limits:** this is client UI admission and completion ownership, not a live cost control. Once searchRestaurantsDetailed is invoked, an account/query change cannot retract that request, pin credentials inside the SDK, prevent server retries or refund spending. Google budget, SKU accounting, deployed flags, production caching and device behavior were not exercised. Existing server enforcement remains essential.

The map is scoped to a mounted account session. It is not persistent dedup across app launches, screens or processes. Distinct explicit queries may overlap; completed searches can be explicitly repeated. A never-settling location/search promise can remain pending for that query; this patch does not invent a timeout, transport cancellation or refund policy. Lifetime means mounted lifetime, not tab focus; no new blur behavior is introduced.

Account guards rely on the existing synchronously advanced generation clock. They cannot detect an SDK account change not yet reflected by that clock. Root remount/owned key reset supplies UI state reset; no new independent auth clock is created.

Save completion alerts, celebration dismissals and delayed navigation retain their original behavior beyond the requested nonblank fallback. Their broader stale save/timer ownership is a separate UI scope; saveVisit's pinned-write safeguards do not themselves protect every subsequent screen callback. This proposal does not claim that follow-up work is solved. Likewise, shared free suggestion behavior is preserved rather than globally redesigned.
