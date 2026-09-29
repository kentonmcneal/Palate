# Independent Palate LLM budget patch review

2026-09-29. **Recommendation: the bounded mitigation is reasonable with the supplied additive correction, but it is not a hard spending ceiling.** Main owns the integration decision. No deployment/SQL/device verification or new spending authorization is implied.

Evidence convention: **COMMITTED** = source verified at repository HEAD256e0d7; **WORKING TREE / offline RUN** = copied proposal and synthetic executed controls; **INFERENCE** = unexecuted deployment/database consequences. All execution here was offline with synthetic credentials and injected transports. Repositories remained read-only. Feed and Google policy/helper/mask paths were not edited or exercised. No migrations, installations, paid calls, real credentials or deployment.

## Findings requiring correction before treating this as the reviewed proposal

### LBI-1 — P2: malformed spend totals still open the money gate

**WORKING TREE / offline RUN:** author-proposed `supabase/functions/classify-cuisine-backfill/index.ts:133–136` applies `Number()` before narrowing the response type. With otherwise successful actual Supabase SDK transport responses, `false`, `[]`, `[0]`, a space and a tab become zero; `true` becomes one. All six permit model dispatch. They contradict the nearby fail-closed comment. This is an incompletely closed preexisting coercion gap, not a claim that current SQL normally returns these types or an unauthenticated caller can choose the RPC response.

The additive patch accepts a finite nonnegative number or a decimal numeric string, rejecting booleans, arrays, objects and whitespace. Actual controls preserve valid 0, "0", "0.001" and9.99 admission. Negative, null, empty and nonnumeric values remain denied. SQL returns a numeric aggregate; the patch does not alter its value or schema.

### LBI-2 — P2: changed count guard loses nullable type narrowing

**WORKING TREE / offline RUN:** author-proposed backfill lines148–156 replaces `typeof lifetimeCalls !== "number"` with `Number.isSafeInteger(...)`. The latter is a runtime predicate, not a TypeScript type guard. The later `lifetimeCalls >= LLM_LIFETIME_CAP_CALLS` produces TS18047 because SDK `count` is number|null. Runtime null denial itself works; this is a strict typechecking regression.

`count-typecheck.cjs` extracts the actual gate and checks it against the installed Supabase query's actual count type: proposed1diagnostic, fixed0. Additive correction retains `typeof` plus safe-integer/nonnegative validation. This focused check is not a full Deno typecheck or proof of deployment failure.

`ADDITIVE_FIX.patch` changes only this backfill file and must be applied **after** the author's `BOUNDED_FIX.patch`. It passes read-only `git apply --check` against the author's proposed tree. `source/` contains its complete corrected backfill file. No changes to the proxy are included in this additive patch.

## Confirmed behavior of the bounded mitigation

**WORKING TREE / offline RUN:** actual handler execution through installed Supabase and Anthropic SDK request/response code confirms:

- A resolved permission error or lost-response exception from the meter denies model dispatch; no retry of the non-idempotent meter occurs in these controls.
- A resolved ledger error or lost ledger response stops the current batch after the first model response and leaves `accounting_uncertain:true`; the insert is not retried.
- A successful model response with invalid JSON, empty content or a nontext content block still produces a cost-ledger row using returned usage. The parser can fail without hiding this known cost.
- Missing/malformed/negative/fractional required token usage stops the batch without fabricating a zero cost. Cache read/write counts survive the actual SDK response and are included separately in the existing estimate:1000input+100output+2000cache-read+3000cache-write yields$0.00545 under the code's price constants. This verifies arithmetic against those constants, not current billing prices.
- The installed Anthropic SDK0.32.1 makes one transport attempt with the proposal's maxRetries0 for injected HTTP500 and connection failure. The author's independent retry control also confirms default retries make three HTTP attempts for one invocation. Neither test claims all failed attempts are billed.
- Sequential lifetime2999 admits one further call and stops; absent daily rows normalize to valid zero via actual maybeSingle; malformed/unreadable daily data and missing HEAD count deny spending.
- Successful empty blurbs are timestamp-cached and the second authorized open does not regenerate. Detail classification without admin cannot dispatch; denied metering preserves its deterministic fallback.
- Actual proxy HTTP auth routing is exercised for blurb: missing auth and rejected synthetic JWT deny before metering/model use. Backfill requires the cron secret. Details helper is exercised directly; no Google-backed details HTTP request is made.

No new general fail-open path was found in the finally-based accounting flow. `accountingUncertain` remains true through meter/model/ledger uncertainty and becomes false only after an error-free usage insert response. That is a **batch-local flag**, not durable admission state.

## Confirmed remaining defects — not safety passes

The suite contains five explicitly labelled REMAINING controls that reproduce these defects. Passing those controls means the limitation is still present.

1. **P1, concurrent admission:** two actual handlers reading daily499 each dispatch one call; the synthetic backend counter becomes501. Read-before-increment is not conditional reservation. Backfill and proxy use separate daily policies, and lifetime-row-count checks race too. No process-local lock can enforce a shared Edge ceiling.
2. **P1, next-call overshoot:** starting at recorded$9.9999 admits a response whose estimated$0.0015 crosses$10. There is no upper-bound reservation for the next request; prices/model aliases are hand maintained and input fields are not collectively token bounded. No invoice or account-wide ceiling is established.
3. **P1, uncertainty does not survive as a durable hold:** a later invocation can spend again after ledger failure. The reproduced case combines returned ledger error with a failed restaurant stamp; two invocations make two model calls and store no ledger rows. Successful stamps may avoid that restaurant, but do not impose a global hold for unknown cost. Backfill final responses remain HTTP200 with the uncertainty flag; status-only cron monitoring will not establish healthy accounting.
4. **P2, proxy cache write error is swallowed:** proposed proxy lines609–615 awaits the update but ignores its returned error. Injected denied empty-generation cache writes return HTTP200 twice and dispatch twice. Empty-success caching is only effective when the write succeeds. For empty text, the actual cached/returned value is `""`, not necessarily null as the author report says. Proxy calls also still write no dollar ledger at all.
5. **P2, abstention stamp error is swallowed:** proposed backfill lines251–253 increments `abstained`, ignores a returned stamp error and reports `failed:0`. A later invocation can pay for the same row again; both paid responses are correctly ledgered. This is inaccurate write-result reporting and repeat-spend exposure, not a new unledgered charge introduced by the proposal. Failure-stamp writes similarly ignore resolved errors. Successful classification update errors are checked already.

Items4–5 are preexisting persistence gaps outside the two minimal additive corrections. They are **not** cured by the empty-blurb mitigation or the accounting finally block. If main requires every persistence failure to be visible before integration, add checked cache/stamp writes with tests. Do not casually turn paid-result responses into retryable errors: external retries may cause another paid call while the cache is absent. A durable attempt/reservation design is the stronger follow-up.

**COMMITTED / source-inspected:** direct Anthropic clients in `supabase/scripts/backfill-classifier.ts` and `supabase/eval/run.ts`, and the explicitly gated mobile live-eval fetch, remain outside the Edge backfill's dollar gate. None was invoked. `commit:false` is not a no-cost backfill mode: model calls/accounting still occur. The $10 action-specific aggregate is not a provider-account invoice; proxy, operator paths and unknown outcomes are omitted. UTC-midnight batch boundaries also retain a captured backfill meter day. These facts must remain explicit in any future policy.

## Tests and exact dependency limits

**WORKING TREE / offline RUN:**

- Author's17proposed handler controls rerun successfully; unchanged17also pass on the additive correction. Their three REMAINING assertions are not guarantees.
- New real-SDK suite: author proposal **41passed/6failed**, with all failures being malformed-total denial assertions. Additive correction: **47passed/0failed**, including five REMAINING defect controls.
- Author's2Anthropic retry controls pass unchanged.
- Actual extracted count gate: **TS18047 before, zero diagnostics after**.
- Both repository handler sources match the author's committed-baseline SHA256s; proposed sources and all six listed dependency/migration/SDK hashes match. `BASE_MATCH.log` and `SOURCE_HASHES.json` preserve this evidence.

The new suite uses installed **Anthropic0.32.1**, matching the Edge npm pin, and **Supabase/PostgREST2.110.7**, newer than the Edge esm.sh2.45.0 pin. No2.45.0 installation was made. Therefore it proves actual installed SDK serialization/error/HEAD/maybeSingle behavior under injected HTTP, **not exact pinned Supabase runtime parity**. Supabase auth is configured with no persistence/refresh for these synthetic clients. All database/model requests are restricted to injected local functions; global/VM fetch rejects unconfigured calls. No SQL runs or real backend acknowledgment is proven.

The original handler tests substitute SDK boundaries; the new controls instead instantiate the real installed clients and only substitute transports. The concurrent fixture is still a simulated backend, not multi-session PostgreSQL. No full Edge/Deno typecheck, mobile build, RLS/ACL runtime, live cron, provider price verification, device verification or hard-ceiling approval is claimed.

Reproduction from the shared workspace:

    /opt/homebrew/bin/node outputs/llm-budget-independent/real-sdk-controls.cjs outputs/llm-budget-audit/proposed
    /opt/homebrew/bin/node outputs/llm-budget-independent/real-sdk-controls.cjs work/llm-budget-independent/fixed

The first intentionally fails six denial assertions. To rerun after applying the two patches, pass the copied combined source root in the second command. `count-typecheck.cjs ROOT SCRATCH_FILE.ts` reproduces the focused static check. Scratch stays under work/llm-budget-independent.

## Atomic policy remains separate

**INFERENCE/design requirement:** a hard ceiling needs DB-owned conditional admission shared by all spenders, bounded request/model/pricing assumptions, durable conservative holds on ambiguous outcomes, and idempotent settlement. Disable hidden retries or separately reserve them; do not refund uncertain dispatches. Reconcile uncertain outcomes without allowing later workers to forget them. Define the cross-action and operator policy deliberately. Existing `record_api_usage` SQL is an increment returning void, not a budget authorization.

No atomic schema draft/migration was created in this review. Follow the required Supabase CLI migration workflow and use separately authorized offline database/ACL/concurrency tests for that design. Google's policy/helper and feed scope remain untouched.

Applied the Supabase skill. Public RPC documentation shows the data/error response contract: https://supabase.com/docs/reference/javascript/rpc . Changelog markdown fetch was unsupported by the browser tool; inspected the public HTML changelog instead: https://supabase.com/changelog . No release item was used to claim compatibility for the pinned Edge SDK. Local installed source and offline controls are the decisive evidence here.
