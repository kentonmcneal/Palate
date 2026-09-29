# Independent admission review — 2026-09-29

**Disposition:** defensible restricted reservation prototype, with one reproduced P2 response-compatibility defect and a bounded helper correction. Not integration, spending, migration or deployment approval. No independently reproduced cap bypass within conforming reserve/settle calls. Actual route coverage, committed-transaction transport semantics and multi-session behavior remain unverified.

Reviewed HANDOFF.md, DESIGN.md, SOURCES.md, full draft SQL, admission.mjs, proof.cjs and source callsites. Repositories remained read-only. Only injected synthetic HTTP and in-memory PGlite were executed; public documentation was read without credentials. No active migration, live API or paid request.

## P2: documented usage metadata discards successful paid responses

Original admission.mjs:29–37 rejects `server_tool_use` and `output_tokens_details` regardless of values; it also rejects null cache breakdown, tier and geography. With complete numeric token counts and a valid text result, these documented metadata forms yield `status:'uncertain', message:null` and a terminal unknown settlement. The paid result is lost even though the reservation remains charged.

The current [official Anthropic SDK response schema](https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/src/resources/messages/messages.ts) declares nullable cache breakdown, inference geography, service tier, output details and server-tool usage. Output details decompose the already-inclusive output total; server usage records fetch/search counts. This is a schema compatibility reproduction, **not evidence that every live Haiku response emits these fields**. No live model was called.

`COMPATIBILITY_FIX.patch` changes only the scratch helper. It accepts absent/null metadata, explicit zero tool counts, and zero thinking details. Missing/null TTL breakdown prices all known cache writes at the higher one-hour rate. Null tier/geography uses the same restricted-request assumptions already used for absent metadata: exact first-party model and fixed standard-only request. Numeric token counts remain mandatory; null counts are not converted to zero. Unknown fields, positive tool/thinking counts, coerced values, inconsistent TTL totals and explicit unsupported tier/geography still become unknown. No reserve amount, SQL, retry, refund or request whitelist changes.

Independent oracle: input10 + output2×5 + cache-read10×0.1 + cache-write20×2 =61 micro-USD. Explicit equal TTL split instead yields ceil(10+10+1+12.5+20)=54. Each result, including unknown, still consumes720000 admission micro-USD and prevents another call under a720000 cap.

## Authorization, caps and atomicity

- **Defaults:** four policies disabled, all caps zero, approval/opening reconciliation unset. Missing gate/policy or unsupported profile/model/isolation denies. No positive spend authorization is inferred from this review.
- **Authority:** service_role can execute the two RPCs; anon/authenticated cannot. Independent executed checks cover both RPC denials, service reserve success, and denied direct DELETE/TRUNCATE/INSERT/schema creation. Public roles cannot alter authoritative caps. Actual deployment owner/default ACL/role membership and PostgREST schema exposure remain to be checked. Application user/admin/cron authorization must precede this service-only API; it is not implemented by the SQL.
- **Mixed callers:** all actions share a global policy and also obey their action policy. Callers supply no cap/day/cost. A trusted service caller can select another allowed action, but cannot evade the shared global cap. Compromised service/owner credentials are outside the claimed boundary.
- **Serialization:** every reservation locks the same gate before totals; policy locks use global-then-action order. READ COMMITTED plus VOLATILE function statements provides fresh snapshots after lock waiting. This is supported by [PostgreSQL row-lock semantics](https://www.postgresql.org/docs/17/explicit-locking.html) and [function volatility/snapshot documentation](https://www.postgresql.org/docs/17/xfunc-volatility.html). It is source reasoning, not an executed multi-session result. Settlement changes observations only, never the debit summed by admission.
- **Idempotency:** repeated reservation UUIDs never return a second permit, even identical payload. Repeated matching settlement is accepted; changed evidence/hash cannot replace it. Lost replies and unknown results retain full capacity. A fresh UUID is a fresh attempt; there is no business-operation exactly-once guarantee. Results/attempt identity must be persisted separately if restart deduplication is required.
- **Commit boundary:** an explicit local transaction can obtain an admitted receipt and then roll back, leaving zero debit; our control demonstrates that ordinary SQL property. The helper's injected RPC must return only after durable commit. A future adapter must not dispatch inside a surrounding rollback-able transaction or through PostgREST rollback preferences/configuration. Author docs acknowledge PostgREST parity is pending; the test does not establish that any active endpoint currently violates it.
- **Daily semantics:** caps govern admission day, not provider invoice day. Already granted receipts, clock skew/pause and completion after midnight remain as documented. A lowered/disabled policy cannot revoke a previously dispatched request. Full lifetime debit remains.

No SQL corrective patch is justified by these results. Before deployment, require separate-session barrier tests for last slot across different actions, duplicate UUID, policy update while gate waits, rollback/connection loss, settlement overlap and unsupported isolation. **PGlite0.5.8 has one backend; queued Promise.all is not lock-contention proof.**

## Independent $0.72 derivation and model boundary

The [official Haiku4.5 specifications](https://platform.claude.com/docs/en/models/haiku-4-5/overview) identify snapshot `claude-haiku-4-5-20251001`,200K context and64K output. Token rates per million: input$1, output$5, cache read$0.10, five-minute write$1.25, one-hour write$2.

Let I,R,W5,W1 be nonnegative disjoint input categories. Their sum is total input according to [prompt-cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). For this restricted model, sum≤200000 and O≤64000. Therefore in micro-USD:

`cost = I + 0.1R + 1.25W5 + 2W1 + 5O ≤ 2×200000 + 5×64000 =720000`.

Ceiling an individual fractional micro-USD cannot exceed this integer upper bound. Allowing full input plus full output separately overcounts overlapping context capacity; this is intentional. The bound does not depend on character-to-token estimates, cache hits or expected short prompts.

[Official pricing](https://platform.claude.com/docs/en/about-claude/pricing) limits first-party US inference premiums to4.6+ models; earlier models do not support that request parameter and use standard pricing. Do not add `inference_geo` to the Haiku4.5 request as a supposed fix. The helper fixes the first-party host and standard tier and excludes tools, batch, beta, thinking, arbitrary options, aliases and SDK retries. The proof remains conditional on the published tariff/model limits and provider behavior; it is not a taxes/custom-contract/provider-account invoice guarantee. Revalidate pricing before enabling any policy.

## Current bypass evidence — rollout blocker, already disclosed by author

Read-only working-tree source, not executed:

| Path | Direct call evidence |
|---|---|
| supabase/functions/places-proxy/index.ts | client45; blurb601; classifier callback685 |
| supabase/functions/classify-cuisine-backfill/index.ts | client183; direct create189 |
| supabase/scripts/backfill-classifier.ts | --with-llm flag41; client188; create binding189 |
| supabase/eval/run.ts | --with-llm flag44; client167; create binding168 |
| mobile/lib/__tests__/classifier-llm-eval.test.ts | dual opt-in24; direct vendor fetch36 |

Three Edge request paths and three operator/eval paths still bypass the scratch admission helper. Operator SDK clients also lack explicit maxRetries:0 at construction. Opt-in/dry-run/result-limit controls are not authoritative shared spend caps. Retire their paid modes or route through separately authorized central admission before an aggregate guarantee. No services were invoked to establish this. An enforced direct-call guard plus actual-handler offline tests is still needed; a source inventory alone is not that guard.

## Executed evidence and reproduction

- Author proof unchanged:32/32 (`AUTHOR.log`).
- Independent controls on original helper:32 pass,8 fail (`BASELINE.log`); all eight are the compatibility finding above.
- Same independent controls on corrected helper:40/40 (`FIXED.log`). Includes unknown/positive/coerced metadata controls, retained capacity, actual SQL settlements, mutation-after-serialization, extra ACL checks, rollback, missing gate/opening liability and wrong settlement hash.
- Author proof with only corrected helper substituted:32/32 (`AUTHOR_FIXED.log`).
- Test harness initially passed JSON null where SQL NULL was required for unknown settlement; corrected before the recorded final runs. This was a harness defect, not a production finding.

From the shared workspace:

```
/opt/homebrew/bin/node outputs/llm-admission-independent/controls.cjs
ADMISSION_HELPER=outputs/llm-admission-design/admission.mjs /opt/homebrew/bin/node outputs/llm-admission-independent/controls.cjs
/opt/homebrew/bin/node outputs/llm-admission-design/proof.cjs
DRAFT_SQL="$PWD/outputs/llm-admission-design/llm-admission-draft.sql" /opt/homebrew/bin/node work/llm-admission-independent/author-fixed.cjs
```

Second command intentionally exits1. Fixed helper copy and patch target the author scratch design, not a repository production file. Source hashes are recorded separately. No Deno runtime, live Anthropic response, deployed PostgREST, real multi-session PostgreSQL or full handler integration was verified. Valid usage is not proof of a semantically usable classifier result; existing content parsing must remain authoritative.
