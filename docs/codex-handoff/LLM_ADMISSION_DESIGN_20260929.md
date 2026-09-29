# Bounded atomic LLM admission — scratch proposal

2026-09-29. **Not deployed, not integrated, not an active or numbered migration.** Governing Palate notes and both LLM reviews were read. Prior independent fixes for numeric coercion and nullable count narrowing remain relevant to the old handlers; this design replaces their admission mechanism, not their authorship/history. Repo/landing/Google/feed paths were not written. No CLI retry, HOME change, credentials, service call or paid API call.

## Status and guarantee boundary

Delivered executable draftSQL, a network-injected helper, and actualSQL/helper offline proof. Default authorization is zero. This establishes an independently reviewable candidate for a **database-owned reservation ceiling**, with conservative failure accounting. It is not yet protection for any current production request: existing handlers/operator paths still bypass it until separately integrated and old deployments retired.

The narrow cost bound assumes Anthropic honors its documented model/context/output limits and the reviewed first-party standard tariff. This is not a tax-inclusive invoice guarantee, arbitrary-provider guarantee, compromised-service-role defense or provider-account-wide enforcement. Public docs and arithmetic: SOURCES.md.

## Deliberate bounded choice: no refunds in v1

Each accepted request permanently consumes720,000micro-USD of admission capacity, even on success. Settlement records observed usage/cost but never releases capacity. No age-based expiry refund, cancellation refund, empty-output refund, HTTP-error refund, timeout refund or automatic reconciliation credit exists. Unknown outcomes remain charged across process death and later jobs.

This is less economical than settling down to usage, but removes dangerous “did the first paid attempt finish?” release/replay races. A$10new allowance permits at most13requests ($9.36reserved), not hundreds of small classifier calls. That is illustrative arithmetic, **not authorization to configure$10**. All four policy caps default0 and enabledfalse. If this throughput is unacceptable, design/review a tighter bound or settlement-release protocol separately; do not quietly lower the full-context reserve.

## Source-backed cost profile

Only `claude-haiku-4-5-20251001`, profile `haiku45-text-20260929`, first-party Messages, standard_only, text-only input. Reserve full documented200Kcontext at the highest of regular/cache-read/5m-cache-write/1h-cache-write prices, plus full64Koutput. Result$0.72. Input and output overlap within context, so separate maxima deliberately overcount. No character/token estimate, count-tokens call, expected-average prompt cost, cache-hit expectation, or response-dependent admission.

Request whitelist: at most4text system blocks, one user text message, optional temperature0–1 and5m/1h ephemeral cache settings, max_tokens1–64000. Reject model aliases, tools, server tools, image/document blocks, streaming, batches, thinking, compaction, beta/region/fast options and any other keys. Fixedhost/version/tier; redirects prohibited; one raw HTTP invocation with30-second abort, no SDK retry/fallback/continuation loop. A1MBbody limit is operational, explicitly not a token proof. Raw fetch and RPC are injected; the reference helper makes no default network call.

## Database ownership and transaction

Private-schema policies cover global `all` plus each allowed action: proxy_blurb, proxy_classify, cuisine_backfill. Each has enabled/approved_until and separate daily/lifetime dollar and call caps. Opening liability/call counts and opening-day counts are mandatory explicit inputs from an authorized cutover reconciliation; null refuses rather than assuming old costs were zero. Current incomplete ledger cannot by itself establish that opening liability. Leave disabled if it cannot be established, or obtain a separately defined new segregated budget scope; do not call the resulting ledger provider-account lifetime spend.

Service callers receive only reserve/settle EXECUTE. No table/schema policy access; PUBLIC,anon,authenticated,service_role direct permissions revoked; RLS enabled. Security-definer functions use empty search_path and qualified tables. Trusted migration/database owner retains administration responsibility. Before eventual rollout, verify real function ownership, role memberships, default privileges and PostgREST transaction behavior.

reserve_llm_v1:
1. Validate action, exact model/profile, UUID/hash/max_tokens. No caller-supplied dollar cap, cost or day accepted. Unsupported isolation level refuses; prototype targets READ COMMITTED.
2. Lock one permanent gate row FOR UPDATE. Missing row denies. Every admission uses it before reading totals; no per-process lock.
3. A previously reserved UUID always returns admittedfalse. It never reissues a dispatch capability, even for identical parameters. Different payload with same UUID also denies.
4. Share-lock global then action policies in fixed order. Missing/disabled/expired/zero/unreconciled policy denies. Policy changes conflict with these locks; they cannot retroactively cancel existing grants.
5. Compute UTCday after lock waits. Sum all permanent reservation debits, plus opening liabilities; check next full reserve and next call against every global/action daily/lifetime limit. Then insert the reservation and advance gate serial in the same transaction.
6. Return exact receipt after success, bound to UUID/action/hash/profile/model/max_tokens/720000, with timestamp and expiry at the earliest of10seconds,UTCmidnight,policy expiry.

No budget-totals read/RPC response is coerced into permissive zero. No usage value can lower a reservation. Amounts are exact integers/numericSQL; sums use numeric to avoid bigint overflow. Current small-volume ledger scans favor clarity; scaling/index/retention changes need separate review. Never purge reservation identity or debit history without durable aggregate/tombstone replacement.

**Concurrency reasoning:** under READ COMMITTED, every contender takes the same self-conflicting gate lock before its usage queries. A later holder sees committed earlier admissions through subsequent statement snapshots. The check and insert cannot interleave across conforming reserve callers. Rollback leaves no permit/debit. This is source-level reasoning grounded in PostgreSQL lock semantics, not an executed multi-session proof. Single-backend PGlite cannot establish lock waiting/contention. Unsupported isolation is rejected rather than guessing snapshot behavior.

## Unknown replies, dispatch and settlement

Helper freezes/serializes request bytes before awaiting; SHA256binds the receipt to dispatched bytes. It validates the entire response, including strict primitives, expiry and request identity. Any RPC error/exception/malformed/expired reply gives zero HTTP dispatch, **without refund**. No reserve retry. If someone explicitly repeats a committed UUID, SQL denies and its debit remains.

A successful helper invocation performs one raw HTTP call. Response/model/usage ambiguity becomes unknown. Only valid completed usage is submitted as observed. Settlement matches reservation ID/hash, accepts exact repeats, rejects changed evidence, and enforces one provider message ID per reservation globally. Unknown is terminal in this small version; manual reconciliation is separate. Observed amount uses exact arithmetic and ceiling to whole micro-USD; missing cache-duration breakdown is priced at1h. Observation errors/rejected settlement/lost acknowledgments cannot restore capacity. The returned settlement object may be retried independently with identical evidence; do not retry the paid operation to repair its observation.

Reservation UUID is the attempt identity, not a claim of business-result exactly-once. New UUID after cache/stamp failure is a new fully charged admission; same UUID denies, it does not recover a lost provider response. Persist business-operation IDs before dispatch if cross-restart deduplication is needed. Durable result caching/coalescing is not implemented by this draft. Existing cache/stamp errors must be surfaced honestly, without turning them into hidden paid retries.

## Daily semantics and clocks

Daily limits govern **DB admission day**, not provider billing day or arbitrary delayed physical dispatch day. Receipt expiry reduces delayed dispatch risk, but DBcommit and HTTP cannot form one atomic transaction. Local clock skew causes refusal when detectable; pause/clock changes after final check remain possible. An already-admitted request may complete after midnight. Lifetime reserves remain charged regardless, so this does not release budget. Do not claim exact provider-calendar-day invoice enforcement. No old holds reset at midnight; only daily filtering changes.

## Callsite integration plan — not yet applied

| Existing path | Required change | Preserved behavior / gap |
|---|---|---|
| places-proxy handleBlurb messages.create | invoke shared adapter with action proxy_blurb after auth/cache/no-reviews gates | cache-only/no-key paths remain free; admission denial returns null reason; no Google change |
| places-proxy classifyAndBuildRow classifyWithLLM callback | require admin; pass adapter action proxy_classify | deterministic fallback on denial/unknown; Google fetching unchanged |
| classify-cuisine-backfill createCounted callback | replace with adapter action cuisine_backfill | cron authorization remains; per-row reservation before dispatch; no commit:false exemption |
| shared llm-classifier | retain exact prompt/model/parse code; inject admission adapter | actual generated classifier request passes strict profile/offline SQL proof |
| supabase/scripts/backfill-classifier.ts | disable --with-llm or move through independently authorized central admission | --dry-run does NOT mean free; currently bypasses |
| supabase/eval/run.ts | disabled paid mode or separately budgeted central path | currently bypasses |
| mobile live classifier eval fetch | explicit opt-in remains, but must be disabled or centrally admitted before global guarantee | no service-role credentials in mobile; current direct fetch bypasses |

Edge adapter contract: generate/persist one attempt UUID, call admittedMessage, return message to existing parser only for statusresponse; otherwise throw a typed admission/unknown error for existing fallback. Treat settlementAcknowledgedfalse separately from model success; capacity remains charged, so no paid retry is necessary. Remove old read-before-call gates as authority; old count/llm_spend writes may remain clearly best-effort historical telemetry only, never decide admission or present complete invoice totals. Display reserved capacity, observed estimates and unknown counts distinctly.

All three Edge routes must share global policy; no independent action can evade the aggregate. Direct SDK clients should be absent in these handlers after integration. A source/AST guard should deny new direct vendor fetch/client callsites except the one shared transport and explicitly disabled operator fixtures. This guard and full actual-handler integration are outstanding; no all-routes-covered claim.

## Verification and rollout boundary

PROOF.log records32passing groups using actual draftSQL in installed PGlite0.5.8 and actual helper with synthetic HTTP. Includes defaults, opening liability, exact/insufficient/global/action caps, daily/lifetime call caps, repeated IDs, idempotent/conflicting settlements, malformed usage, unknown models, policy expiry/missing policy, day rollover with lifetime retention, cap reduction, isolation refusal, ACL/RLS, queued contenders, lost/malformed/expired replies, HTTP/timeout/usage failures, settlement failures, unsupported features, maximal price-category arithmetic, and actual repository classifier request/parse compatibility. Queued calls are single-backend serialization, not multi-session concurrency.

Two unsafe mutations are rejected by unchanged assertions: removing dollar cap comparisons and refunding unknown outcomes. Logs CAP_MUTANT/REFUND_MUTANT. A first failed mutant left the embedded engine open; that isolated test process was interrupted, and runner failure cleanup now exits deterministically. No repository state affected.

Required before any deployment: independent SQL/helper review; actual-handler integration and negative bypass tests for all3Edge routes; operator/eval retirement; historical liability/cutover plan; current pricing review; real multi-session PostgreSQL barrier tests (last slot, policy changes, duplicate ID, settlement overlap, isolation failures); full migration-chain/ACL/PostgREST checks; required CLI-created migration workflow. Existing telemetry/shmget limitations were not bypassed. No numbered migration created. Any positive policy cap needs explicit spending authorization; current draft remains disabled.
