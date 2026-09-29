# Visit-write account safeguard — author packet, independent review required

2026-09-29. **WORKING TREE / synthetic execution**, captured against Palate tip `58a7f6a`. Repository read-only throughout. No real users, services, notifications, credentials, installs, or native builds. This is an author proposal, not independent approval or LIVE/DEVICE evidence.

## Scope and result

`VISIT_WRITE_ACCOUNT_SAFETY.patch` changes two paths:

- `mobile/lib/visits.ts`: `saveVisit`, `recordPromptDecision`, their private feed continuation, and a private account-bound analytics helper for their two events.
- `mobile/lib/__tests__/prompt-refusals.test.ts`: update mocks to support session authorization and headers; assert the actual account-bound analytics insert instead of the former shared `track` mock.

No changes to account-write.ts, username-gate.ts, shared analytics, callers, backend, native queues, storage namespaces, or ownership policy. Public argument/return types are unchanged. Captured base/proposed source and exact SHA-256 hashes accompany this packet. Patch apply-check succeeds and both touched repository files still matched captured base at packaging.

**WORKING TREE finding:** saveVisit previously awaited restaurant resolution before obtaining the current user. Switching A→B while that lookup was pending could create A's intended visit under B. Later SDK credential resolution could also substitute B's bearer token for requests built with A's user_id. A row ID alone does not bind Authorization. recordPromptDecision had the same deferred-current-user risk during getUser.

## Proposed behavior

saveVisit captures the existing AccountWriteSession generation synchronously, verifies the initiating user, and acquires that user's Authorization before restaurant work. After each awaited result it checks the generation before the next request, retry, reward, feed action, or returned result. Existing-row dedup/count and missing-column fallback are inside this boundary. A→B→A remains stale; same-account refresh remains valid.

All visit reads/writes, fallback, feed lookup/insertion, and these two analytics inserts set per-request Authorization explicitly. The feed continuation carries the same token and bearer and stops after a stale restaurant-result response. The existing static personal-signal import replaces an unnecessary dynamic import await in the success path.

The shared restaurant-ID helper is unchanged: it reads a restaurant identifier, not a personal visit row. Its credential handling is not modified; the initiating visit credentials are acquired before invoking it, and no subsequent visit work proceeds if its completion is stale.

recordPromptDecision captures the same generation at invocation. Signed-out, missing-user, mismatched-user, and observed stale-generation paths do not insert. A stale returned insert result does not emit error analytics under a replacement account. Ordinary resolved database failures remain reported and non-throwing. Ordinary auth transport rejection still rejects. Failure to acquire a valid pinned session now stops rather than falling back to mutable SDK credentials; a same-generation session lookup error/mismatch rejects. This is a deliberate fail-closed safety boundary, not a retry under the new account.

The two private analytics writes are included because the original shared track helper awaits getUser and would otherwise reintroduce the race immediately after the protected write. The private helper preserves non-blocking/error-reporting behavior, uses the initiating user and bearer, and suppresses stale completion diagnostics. Shared analytics behavior is untouched. Observability's broader session context/transport policy is not redesigned here.

## Evidence and controls

**WORKING TREE / executed offline:** `handlers.test.cjs` loads captured actual visits.ts, account-write.ts and username-gate.ts through TypeScript transpilation. Baseline also loads actual analytics.ts. Restaurant resolution, auth results, observability and device effects are synthetic. Requests use installed **Supabase JS/PostgREST 2.110.7**, including the actual authenticated fetch wrapper, with a fully injected mock fetch; no socket/network transport is used. That wrapper awaits its access-token provider even when Authorization is supplied, then preserves the supplied header. Tests deliberately switch accounts inside that await and inspect the final transport headers and bodies.

| Run | Passed | Failed |
|---|---:|---:|
| Captured baseline | 19 | 35 |
| Proposed source | 54 | 0 |
| Negative: remove explicit Authorization headers | 49 | 5 |
| Negative: replace generation identity with account-ID equality | 42 | 12 |
| Negative: remove visits.ts continuation assertions | 40 | 14 |

No cancelled or skipped controls. Failures in the baseline include missing protective stages as well as concrete unwanted continuation/credential behavior; they are not 35 distinct production defects.

Controls cover both A→B and A→B→A during getUser, getSession, restaurant resolution, dedup read, count (new/existing), primary insert, missing-column fallback, decision insertion, and detached feed lookup. SDK-token-await controls verify actual transmitted credentials for primary/fallback visit writes, decision writes, feed insertion and analytics. Already-started requests are allowed to finish under A; tests do not claim they are cancelled.

Ordinary controls cover manual/auto payloads, caller-supplied receipt time, notes, time metadata, reward/count, existing-row dedup, legacy-field retry, private-visit feed suppression, ordinary failure paths, signed-out/missing/mismatched auth, same-account refresh, coordinates and decision error reporting. A deliberate boundary test confirms that a payload newly submitted under B is still written as B: the patch cannot prove its historical origin.

**WORKING TREE / executed offline:** three existing Jest suites pass **44/44 tests**: prompt-refusals, local-refusals, digest-confirm. The changed prompt-refusals mock initializes the real account gate and provides a synthetic session/header method; it checks analytics event payload and Authorization rather than relaxing the error-reporting requirement. Focused strict TypeScript checking of visits.ts and imported dependencies passes using copied source and existing installed dependencies.

Initial scratch setup lacked the source-read tests' two confirmation screens and Expo's ambient type file. Those unchanged files were copied; the suites and type-check then passed. `JEST_INITIAL_SETUP.log` and `TYPECHECK_INITIAL_SETUP.log` retain those setup errors. No full app gate, mounted UI test, device or backend authorization test is claimed.

Reproduce source controls from this output directory:

```sh
/opt/homebrew/bin/node --test handlers.test.cjs
CANDIDATE=base /opt/homebrew/bin/node --test handlers.test.cjs
CANDIDATE=no-headers /opt/homebrew/bin/node --test handlers.test.cjs
CANDIDATE=id-only /opt/homebrew/bin/node --test handlers.test.cjs
CANDIDATE=no-visit-boundaries /opt/homebrew/bin/node --test handlers.test.cjs
```

The installed dependency path can be overridden with PALATE_NODE_MODULES. Snapshots, not mutable repository production source, determine baseline/proposal behavior. Logs and mutation snapshots are included for review.

## Compatibility and precise limits

**WORKING TREE / source inspection:** unchanged callers include Add (`app/(tabs)/add.tsx`), Wishlist (`app/(tabs)/wishlist.tsx`), restaurant detail, receipt-forwarding.acceptReceipt, passive confirms and digest-confirm. Their existing manual/auto source, date and notes arguments remain accepted; ordinary result fields remain intact. No caller is forced to invent an owner token. This is API compatibility and source-handler validation, not a claim of complete caller-flow account isolation.

**Important unsolved boundary:** an ownerless A payload whose saveVisit/recordPromptDecision invocation begins while B is active is still accepted as B. Capturing at function invocation cannot recover capture-time ownership. The existing passive account-isolation plan remains required. Likewise, acceptReceipt does a restaurant lookup before calling saveVisit; an account switch before that invocation is outside this guard. Multi-step callers that start a fresh decision/rating/receipt-status write after a switch need their own initiating flow context. No protection is claimed for rateVisit, updateVisit, photo uploads, deletion/undo or visibility writes.

A request already passed to the SDK can finish after an account switch. Explicit Authorization keeps it under A (or it fails); a post-response generation check cannot undo a committed visit, database trigger or feed event. saveVisit then rejects stale completion, so the caller must not assume rejection proves no A row exists. Existing restaurant/time dedup remains unchanged and is not transaction-level exactly-once protection.

The safeguard relies on the existing root account-generation updates. It does not add pre-SDK sign-out admission closure or initialize account identity in a headless process. If the gate is uninitialized/null, saveVisit rejects and decision bookkeeping skips. A delayed auth transition not yet reflected by that clock cannot be detected solely by the clock, although matching-user/session checks and pinned bearer prevent replacing A's write credentials with B's. A token expiring during a long operation fails; this patch does not refresh/retry under another session.

**INFERENCE / review required:** independent review should verify the boundaries and transport evidence before integration, with particular attention to same-generation session failures, already-committed stale saves, headless invocation readiness, and the private analytics helper. Native delivery, production RLS and human/device behavior remain unverified.
