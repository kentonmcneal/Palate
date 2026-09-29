# Independent Google budget and pricing proof

Evidence: **COMMITTED** migration 0179 read from the repository; **WORKING TREE / LOCAL EXECUTION** for the updated helper, masks, and tests. HEAD at completion was `01ff738`; pricing edits were uncommitted. No repository writes, installations, paid requests, cloud database/API calls, or actual notifications. Public Google documentation was read to verify the pricing correction. Source hashes and exact case results are in `results.json`.

## Results

**41/41 local PostgreSQL/helper cases pass.** The full original 0179 migration was executed, including its embedded DO self-tests and probe cleanup. PostgreSQL version: 18.3, PGlite 0.5.8. All SQL statements in the helper adapter autocommit; a simulated lost response occurs after the actual reservation statement successfully committed. SQL failures roll back their statement. This is more than a JavaScript increment model.

**18/18 existing focused Jest cases pass** across `google-spend-offline.test.ts` and `google-field-pricing.test.ts`, including the added unknown/inherited-SKU test. Logs: `run.log`, `jest.log`.

No new SQL change is necessary for the helper's conservative reservation admission rule on the tested valid inputs. This is not proof of live deployment or multi-backend concurrency.

## Pricing review

No new blocker found in the reviewed rates/mask declarations. Current global first-paid-tier prices imply 20,000 micros for Details Enterprise, 35,000 for Text/Nearby Search Enterprise, and 25,000 for Details Enterprise + Atmosphere. Rating, priceLevel and regularOpeningHours require Enterprise; reviews/atmosphere fields require the higher tier. Sources independently read: [Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing) and [field/SKU mapping](https://developers.google.com/maps/documentation/places/web-service/data-fields).

The AST suite checks six current paid mask variants across the three named spender files, both reclassify branches, the declared micro-dollar table, and Gmail's IDs-only exception. Known current fields match their assigned tier. Unknown field expressions and added unknown fields fail those assertions. `hasOwnProperty` plus the early safe-integer/nonnegative check rejects unknown and inherited SKU properties; actual SQL-backed cases also verify retired Pro names make no meter read, reservation or fetch.

This is a **static contract for enumerated current callers**, not a runtime mask classifier or an invoice audit. It does not automatically discover a new spender file, aliases of spendGoogle, or future pricing changes. A new spender must be added to the inventory; a runtime caller can still lie about its mask while supplying a known SKU. The inspected callers use fixed local masks, so no new user-controlled-mask exploit was demonstrated. No invoice-confirmation claim is made.

## Exact budget semantics exercised

- Full migration self-tests run successfully and remove their 2999-01-01 probe row.
- Actual SQL returns each statement's own integer total/count, weighted by cost; warning crosses at 80%, trip at cap, each flag once. SQL intentionally retains over-cap reservations: the helper, not the RPC, denies Google fetch from a returned total above cap.
- Missing row starts fresh. Caller-supplied days have independent totals/flags. Zero, negative and NULL micros cost zero in the raw SQL but still increment count. Raw NULL cap returns unknown alert flags; zero/negative cap still reserves/trips. These are not valid helper inputs.
- Bigint cap-arithmetic overflow, call-count overflow and NULL day fail atomically. A real injected PostgreSQL update-trigger exception rolls back both reservation attempts, including new-row creation; no fetch occurs.
- Anonymous/authenticated roles cannot call the service RPC, see counter rows under RLS, or insert counters. service_role can reserve. Table privileges are explicit fixture grants, not an audit of deployed grants/default privileges.
- Exact-cap confirmed reservation admits one fetch, then refuses further calls. Injected stale preflight cannot admit a confirmed over-cap total. Four current paid SKUs reserve their current 20k/35k/35k/25k estimates through SQL.
- One lost committed response can reserve twice but fetch once. Two lost committed responses retain both reservations and fetch zero times. A lost fitting reservation followed by an over-cap retry fetches zero times. Malformed committed replies never authorize fetch. A failure before SQL followed by a successful retry reserves once.
- Thrown fetch and HTTP 503 both retain their committed reservation; the helper does not retry fetch. An unreadable preflight makes no reservation or fetch.
- Retry crossing UTC midnight keeps both reservations on the captured admission day. Midnight after preflight but before capture uses the new admission day. A full old-day preflight just before midnight may conservatively refuse even after time rolls over.
- Lower cap closes admissions without needing the old tripped flag. Higher cap does not reset a persisted old trip. Free SKU still increments count at zero spend and is refused when the helper's gate is tripped; the separate Gmail exception remains outside this helper.
- Missing spend RPC and pre-0179 schema without spend_micros both fail closed in the new helper.
- The old bump_google_usage RPC remains callable, changes counts/flags, and does not increase spend_micros. Its old warning can consume the flag before the dollar warning. It can trip the shared flag while dollar spend is zero.

## Concrete limitations / integration decisions

1. **Alerts can be lost permanently for the day.** The case with cap 25,000 and first committed reply lost consumes both SQL flags. Retry reserves 50,000 and returns both flags false; no Google call and no alert occur. Spend safety holds, but exactly-once flags do not guarantee notification delivery. If delivery is required, use durable alert state/outbox or an independently retryable notification mechanism. The migration alone does not provide that.
2. **Raised caps stay closed after trip.** A $1 tripped row remains refused by a new $2 helper because preflight honors the stored tripped flag. Lowering to an already-crossed 80% threshold does not emit a retroactive warning. These tests characterize existing semantics; no reset/change was applied.
3. **Cap consistency is a fleet assumption.** The RPC accepts each caller's cap; it does not store/enforce one authoritative cap. Two sequential helper instances with stale preflight observations and different caps can admit a total above the smaller cap. This is a local deterministic counterexample to a universal smaller-cap claim, not a concurrent-server benchmark. Updating one deployment's environment does not centrally update other workers' cap arguments.
4. **Old deployments remain outside the dollar guarantee.** The retained legacy RPC does not account dollars, and old fetch-before-meter callers are not converted by applying 0179. Compatible schema rollout is verified locally; fleet-wide adoption is not.
5. **Admission-day accounting is not Google's billing-day accounting.** Retries/fetches can cross midnight while charging the captured day. This is intentional conservative admission attribution, not a verified provider billing convention.
6. **Single embedded backend only.** No claim of simultaneous independent PostgreSQL backends, lock contention/fairness, transaction isolation under competing sessions, PostgREST/JWT correctness, or deployed versions. The source uses row locking and increments atomically, but a real multi-session PostgreSQL harness is needed to prove the concurrency schedule itself.

## Fixture/reproduction

`budget-sql.test.cjs` creates local roles, applies the complete 0033 counter migration, applies the 0104 RPC execute revocation relevant to this fixture, grants table access explicitly, and applies the complete original 0179 migration. RLS and function execution are real PostgreSQL. The helper runs its real transpiled source with only transport, time and SDK wiring mocked. No network-capable fetch is exposed. Unlike the privacy fixture, this uses the original full counter table definition rather than a hand-minimized table.

```sh
/opt/homebrew/bin/node outputs/palate-budget-proof/budget-sql.test.cjs "$PWD/work/pglite/node_modules/@electric-sql/pglite"
/opt/homebrew/bin/node '/Users/kentonmcneal/Claude Code/Palate/mobile/node_modules/jest/bin/jest.js' --config "$PWD/outputs/palate-budget-proof/jest.config.json" --runInBand --watchman=false --runTestsByPath '/Users/kentonmcneal/Claude Code/Palate/mobile/lib/__tests__/google-spend-offline.test.ts' '/Users/kentonmcneal/Claude Code/Palate/mobile/lib/__tests__/google-field-pricing.test.ts'
```

`PALATE_ROOT` optionally changes the source repository. The runner uses current source and records its SHA-256; compare hashes when reproducing after main edits. `tested-0179.sql` and `tested-google-spend.ts` preserve the reviewed snapshots for reference, not as a new migration proposal.

## Main integration
Durable runner is scripts/security-sql/budget-sql.test.cjs; it resolves the checkout automatically and prints counts/source hashes to stdout. Main rerun:41 passed,0 failed against integrated source. Earlier output paths refer to the worker's historical evidence. No deployed verification.
