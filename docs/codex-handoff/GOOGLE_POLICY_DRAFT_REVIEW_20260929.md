# Google budget follow-up — independent review requested

**WORKING TREE / LOCAL EXECUTION.** Proposed output-only SQL closes mixed-cap admissions for the current reservation helper. No repository changes, paid calls, credentials, live database/API execution or deployment. No change to prices, masks, the TypeScript helper or the tested reservation body. Repository HEAD inspected: `647ecd7`.

## Actual gap and selected scope

The existing SQL proof identifies mixed caps, legacy callers and best-effort alert delivery as limitations. Reproduced its mixed-cap counterexample using the actual helper with actual PGlite statements: two workers use 25,000 and 50,000 micro-dollar caps and both observe a stale empty preflight. Each reserves 25,000 and performs one mocked fetch. The day's total reaches 50,000, exceeding the smaller caller's cap. This is deterministic evidence that each caller currently supplies its own policy; it is not a concurrent multi-server benchmark.

Read the reservation review, budget SQL proof, field-pricing review, spend/launch history, helper, 0033/0179 migrations and current caller inventory. The older spend/launch document's call-count/free-tier claims are historical, not current budget specifications.

**WORKING TREE source inventory:** all current paid Places requests found in `places-proxy`, `reclassify` and `featured-lists-refresh` use `spendGoogle`. Gmail's direct Places request uses exactly `places.id`, the existing IDs-only exception covered by the pricing suite. Its OAuth/Gmail endpoints are not Places spending paths. No new current paid direct-fetch path was demonstrated. Old `bump_google_usage` remains callable and unmetered in dollars, but no executable current spender calls it. Old deployments remain unverified; revoking that RPC would not undo a historical fetch-before-meter request, so this proposal does not claim to solve fleet adoption by revocation.

## Proposed change

`google-budget-policy.sql` is a **review draft, not an assigned migration**:

1. Add a single operator-owned `google_spend_policy` row with `daily_cap_micros`. RLS is enabled and all table privileges are revoked from public/anon/authenticated/service_role. Zero or a missing row disables admission.
2. Rename existing `bump_google_spend` to `reserve_google_spend_internal`, retaining its original implementation and revoking direct execution from the application roles, including service_role.
3. Restore the public `bump_google_spend` signature as a security-definer guard. It reads and share-locks the policy row, rejects disabled/missing policy or a caller cap that differs from it, validates basic input, then calls the unchanged reservation implementation.

The existing helper already refuses unconfirmed/error reservations, so a worker with a stale larger **or smaller** configured cap makes no Google call and consumes no reservation. Matching workers retain the existing conservative admission rule and response shape. It is intentional that a smaller configured worker cannot create a second threshold or consume shared warning/trip flags.

`FOR SHARE` holds the policy stable through the reservation transaction. It does not cancel an HTTP request admitted before an operator changes the policy. The policy cap is a reservation estimate boundary, not a verified invoice limit.

**Deployment behavior must be independently reviewed:** this draft inserts cap **0**, disabling current guarded paid calls. It does not guess the live environment or authorize a $5/day allowance merely because $5 is the source default. Before deployment/enablement, main must choose an already approved cap, confirm current worker rollout/configuration, and plan the cached/degraded interval. An authorized database operator sets the policy; worker environment caps must match exactly. No endpoint or service-role path for editing policy is added. Raising policy does not clear an existing daily trip latch.

## Local evidence

`budget-policy.test.cjs` executes the full original 0033 and 0179 SQL, reproduces the baseline counterexample, applies the proposal locally, and executes the unchanged actual helper with isolated SDK/clock/fetch wiring. No network-capable fetch is supplied. It asserts that the renamed function's PostgreSQL `prosrc` is byte-identical to the original.

**21/21 new cases pass**, plus baseline reproduction and default-disabled/body-preservation assertions:

- Different higher/lower worker caps fail closed, including stale preflight and an otherwise fitting first reservation.
- Six same-cap workers with stale reads admit only two 25,000-micro mocked fetches under a 50,000-micro cap. All six conservative reservations remain counted, preserving the existing rule.
- Original warning/trip thresholds fire once.
- One/two lost committed replies, malformed replies, a failure before SQL, HTTP 503, thrown fetch, unreadable preflight and zero-cost helper calls retain their intended behavior.
- Lowering policy between a lost committed reply and its retry denies the old-cap retry with no fetch; the first reservation remains counted.
- Missing policy, bad direct inputs and invalid policy values fail closed.
- anon/authenticated cannot use the public spend RPC. All three application roles, including service_role, cannot edit policy or call the renamed internal RPC directly.

**41/41 existing SQL/helper proof cases pass unchanged against current source.** The original suite intentionally characterizes the old mixed-cap limitation; the new suite separately proves the guard fixes that case. It was not silently rewritten to erase the baseline. Logs: `TEST_RESULTS.log`, `UNCHANGED_RESERVATION_PROOF.log`.

The source copy contains the exact helper/migrations/proof and a dependency link to already-installed TypeScript. `SOURCE_HASHES.json` records those files and the proposed SQL. The runner defaults to this copy; `PALATE_ROOT` may point to another checkout intentionally.

Reproduce without installs or services:

```sh
/opt/homebrew/bin/node outputs/palate-budget-policy/budget-policy.test.cjs /Users/kentonmcneal/Documents/Codex/2026-09-27/how-x20/work/pglite/node_modules/@electric-sql/pglite
```

## Independent review and integration checklist

**Not independently approved yet.** No second reviewer tool was available in this task. Main should assign independent review before integration, especially:

- Exact-cap matching and the deliberate disabled initial state/rollout plan.
- New table/function ownership, RLS and ACLs in the actual migration environment, including default/inherited privileges and the renamed function.
- Policy-row share lock versus reservation-row lock order and operator policy updates.
- Compatibility of the unchanged RPC signature and helper failure behavior; renamed-function dependencies outside the inspected source.
- Single application of the rename migration and rollback order. Restore the original public reservation entry point and grants only if intentionally accepting the earlier mixed-cap behavior again.

The installed Supabase CLI failed even on help because it tried to write outside the writable workspace to its telemetry file. No permission request or workaround outside the workspace was made. Therefore this is explicitly an unnumbered SQL draft; main should allocate a migration through its existing workflow after review. The CLI error did not block local PostgreSQL execution or testing.

## Remaining limits

- Single embedded PostgreSQL backend. The burst test schedules multiple worker promises with stale reads but does not prove lock contention/fairness across independent PostgreSQL server sessions. A multi-session harness is still needed for that claim.
- A stale/malicious legacy post-fetch caller or direct Google request bypasses this guard. Deployment inventory and provider restrictions remain necessary; no universal fleet or invoice guarantee is made.
- Service credentials can have other broad database privileges; this is a guard for the inspected helper path, not protection against a malicious service-role holder rewriting counters or using Google credentials directly.
- Lost threshold replies can still lose alerts; delivery/outbox design is unchanged.
- Conservative double reservations and retained failed-request costs can exhaust capacity early. Day attribution, old trip latches and pricing estimates are unchanged.
- Applying only this SQL draft with a zero cap would disable guarded paid operations. Nothing was applied to the repository or deployed system here.
