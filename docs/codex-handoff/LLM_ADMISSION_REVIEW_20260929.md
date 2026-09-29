# Independent LLM admission integration review — 2026-09-29

**Approve the captured source integration and confirmation design for main's review/integration, with policies disabled/zero and schema rollout still blocked. No production correction patch is justified by the reproduced cases. This is not authorization to migrate, enable spending, deploy, or claim a provider-account hard ceiling.**

Reviewed `INTEGRATION.patch`, `CONFIRMATION_DRAFT.sql`, original reservation SQL, both new helpers, all three Edge call paths, all three disabled operator/eval paths, and supplied tests. Author patch/SQL/seven source files remained unchanged at final hash verification (`CAPTURE.json`). Read-only patch applicability against current Palate passes. All repository files remained untouched; tests used scratch source, synthetic inputs, injected HTTP and in-memory PGlite. No credentials, live service, paid call or migration.

## Confirmation protocol: findings

1. **Fresh request is meaningful under the stated transport contract.** The adapter owns raw RPC transport, awaits reserve, then sends a second POST to confirm. It forwards no caller headers or `Prefer` transaction settings; HTTPS origin validation, redirect refusal, no-store settings and fixed RPC names are present. The helper validates the original receipt again after confirmation, including local expiry. A provisional reserve reply followed by rollback therefore cannot pass confirmation in the modeled new transaction.
2. **Identity and expiry are bound.** SQL checks UUID, action, request hash, profile, model, max_tokens, admitted timestamp, expiry timestamp and720000reserved micro-USD, plus existing/unsettled/unexpired row. Null fields fail rather than default. Confirmation never changes timestamps, debit or policy. Repeated confirmation is a read, not a new dispatch permit.
3. **Authorization remains service-only.** Function execution is revoked from PUBLIC/anon/authenticated and granted to service_role. Security-definer search_path is empty; table reference is qualified. Actual-role SQL controls pass. Existing user/cron authentication remains outside this service API and is exercised by handler controls. Real migration owner, role inheritance/default privileges and PostgREST exposure still require deployment verification.
4. **No refund or extra capability.** Already-settled rows cannot confirm. Lost/missing/malformed/false confirmation produces no model call and retains any committed debit. Duplicate reservation UUIDs still cannot acquire a second initial permit. Fresh UUIDs remain new attempts; there is no business-operation exactly-once guarantee.
5. **Policy changes are not retroactive revocation.** Confirmation does not recheck enabled/caps. This agrees with the documented model: a granted reservation remains valid until its original short expiry unless settled. It is not a kill switch for in-flight work. Permanent capacity remains charged regardless of later policy changes.

The [official PostgREST transaction documentation](https://raw.githubusercontent.com/PostgREST/postgrest/main/docs/references/transactions.rst) says each API request runs in a transaction, default isolation is READ COMMITTED, POST on a STABLE function is READ ONLY, and configured transaction-end behavior can roll back. We independently executed confirmation in a new READ ONLY transaction and rolled that read back: the previously committed reserve survived. The deployed runtime/configuration was not called. The HTML docs returned429; the official project's documentation source supplied the evidence.

[PostgreSQL's function-volatility documentation](https://www.postgresql.org/docs/current/xfunc-volatility.html) supports statement-snapshot reasoning. A STABLE confirmation read in a genuinely new request sees that request's snapshot; it cannot establish commit if invoked inside the original reservation transaction. The author's SQL control demonstrates that distinction. No PGlite result here establishes separate-session contention or actual HTTP transaction boundaries.

## Actual-handler adversarial results

The independent runner uses actual proposed entry handlers and actual raw-fetch adapter. Existing database reads/writes use installed Supabase2.110.7 with an injected transport; reserve/confirm/settle execute actual draft SQL as **service_role**, not just database owner. Google is a synthetic fixture for details, never a request to Google.

For **each** of blurb, authenticated details classifier and cron backfill:

- Enabled positive control makes exactly one model invocation and retains720000micro-USD.
- Confirmation HTTP404, HTTP500, empty204, invalid JSON and literalfalse all deny model transport.
- Reserve transaction returns a provisional admitted receipt then rolls back; subsequent confirmation denies and no row/debit survives.
- Settlement between reserve and confirm denies dispatch while retaining the debit.
- Valid confirmation followed by local time beyond original expiry denies in the actual helper; confirmation does not renew the receipt.
- Refusal leaves no classifier/blurb PATCH stamp; backfill stops after one failed attempted row. Blurb returns HTTP200/null with admission-denied reason; details uses its existing deterministic fallback.

Additional executed controls cover all nine null confirmation parameters, exact matching expired identity, READ ONLY confirmation, unauthorized details/cron, oversized preflight and malformed cached row types. No retries occur in the tested admission/confirmation paths.

**Coverage correction, not a production bug:** the author's original expiry test changed the stored expiry but used the old receipt. Identity mismatch alone could satisfy it even with the expiry predicate missing. Our new test supplies matching timestamps for an expired row. Removing only `r.expires_at>clock_timestamp()` causes that test to fail:41pass/1fail. Unmodified SQL passes42/42. The new test is supplied in `adversarial-controls.cjs`; no SQL weakening or source workaround is proposed.

## Main-requested preflight challenge: safe eligibility, conservative diagnostics

Actual backfill results for (a) name exceeding1MB serialized request size and (b) `types` incorrectly stored as a string:

| Observation | Result |
|---|---|
| HTTP / attempted rows |200; processed1, failed1, written0, abstained0 |
| Reserve / confirmation / model |0 /0 /0 |
| Restaurant stamp or classification writes |0; all rows retain null llm_backfill_at |
| Legacy spend ledger inserts |0 |
| Legacy pre-call meter |1 attempt |
| Response flags |admission_denied:false, accounting_uncertain:true, persistence_uncertain:false, remaining_estimate:"unknown" |
| Reported legacy spend estimate |0 |

`encodeRequest` can throw before `onState`, as main identified. The implementation's `lastDispatched=false` reset and guarded stamp prevent falsely marking the row after these pre-dispatch failures. A malformed `types` value fails even earlier, in classifier request construction, with the same safe row outcome. Finally/cost validation stops the batch rather than inventing zero-token usage or a spend-ledger record. **No false-judged-stamp bug was reproduced.**

Diagnostic limitation: the response does not distinguish known preflight rejection from genuinely uncertain paid accounting. Its uncertainty flag conservatively stops work and the report already defines processed/meter counts as attempts. It is not proof that a paid call occurred. A future typed preflight reason could improve operator diagnostics, but no money/eligibility fix is required for this integration. This review does not add a broad error-state redesign.

Oversized blurb similarly performs zero reservations/model/cache writes and returns existing generic HTTP500 with “Unsupported LLM request; no admission attempted.” That may cause external retries of a nonpaying failure, but no paid response is discarded in this case. Successful paid-result/cache-failure and lost-settlement behavior remain covered by the50author-handler controls. Full synthetic response records are in `PREFLIGHT_FACTS.json`.

## Route and operator bypass review

Exact reviewed source paths:

- `supabase/functions/_shared/llm-admission-edge.ts` and `llm-admission.mjs`: sole adapter/provider transport, fresh confirmation, no SDK retries.
- `supabase/functions/places-proxy/index.ts`: blurb and classifier each bind their fixed action; pre-existing auth/cache/no-key/no-reviews/deterministic gates remain. No direct Anthropic client survives.
- `supabase/functions/classify-cuisine-backfill/index.ts`: per-attempt cuisine_backfill admission; denied requests stop without restaurant stamp; dispatched uncertainty retains debit and existing stop logic. commit:false still requires admission.
- `supabase/scripts/backfill-classifier.ts`: --with-llm throws before Supabase client construction, plus getLLMCreate itself throws; no vendor client survives.
- `supabase/eval/run.ts`: paid branch refuses; deterministic evaluation remains.
- `mobile/lib/__tests__/classifier-llm-eval.test.ts`: permanently unarmed; underlying callback also throws, so invoking the skipped body cannot pay.

Reran AST/direct-call scan across597first-party TS/TSX/JS/MJS files with proposed overlay:13/13, including five injected bypass patterns. Actual operator top-level/eval refusal:2/2, zero model transport and zero operator-client constructions. This identifies the current known paths; the guard is not yet wired into repository CI and is not an arbitrary-code sandbox. It excludes dependencies/generated/native directories/CJS harnesses, cannot prove absence of obfuscated endpoints, and says nothing about old deployments or other account credentials.

## Recorded validation

| Suite | Result |
|---|---|
| Independent actual-handler/SQL adversarial controls |42/42 |
| Expiry predicate deletion negative control |41pass/1expectedfail |
| Author actual-handler suite rerun |50/50 |
| Author confirmation SQL suite rerun |16/16 |
| Overlay bypass guard |13/13;597files;5negative patterns |
| Actual operator/eval controls |2/2;0transport/0clients |
| Focused adapter/classifier type check |0diagnostics |
| Final source/patch/SQL identity and applicability |pass |

Independent harness changes only add injectable raw response/clock faults; source under test is the unchanged proposed source. Copied operator/type runners initially assumed source beside themselves; scratch runner paths were corrected before final runs. These are test relocation changes, not application fixes.

## Boundaries that still block enabling/rollout

- Keep every policy disabled/zero. The unchanged draft's $0.72 bound and prior tariff analysis remain conditional on exact pinned first-party model/profile; this review does not authorize positive caps or infer historical liability from incomplete telemetry.
- No active/numbered migration supplied or executed. Full migration-chain/owner/default-ACL/PostgREST configuration and required schema workflow remain outstanding.
- **PGlite0.5.8 is one backend.** Synthetic transaction rollback between injected requests is not multi-session committed-read, lock contention, fleet behavior or deployed proxy-cache proof. Real barrier tests and deployment transport checks remain necessary.
- Exact pinned Deno/Supabase2.45.0 runtime not executed; Node-transpiled handlers and installed2.110.7 SDK are not function boot/deployment parity.
- No durable provider-result cache/coalescing, cross-restart business idempotency, retroactive permit revocation, tax/custom-contract invoice proof or old-worker retirement is added.

Main may integrate the bounded source proposal after its review, preserving disabled/missing-policy refusal. Main must keep schema rollout and positive spending blocked until the separate prerequisites are met. No corrective production patch is needed; the useful additive artifact is the adversarial regression suite.
