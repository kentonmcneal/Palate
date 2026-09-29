# Palate LLM spending audit — 2026-09-29

## Decision / handoff

**COMMITTED source at 256e0d7; offline executed evidence only. Do not sign off a hard LLM spending ceiling.** Existing admission is read-before-call, not reservation. This audit supplies a bounded copied-source mitigation, not a complete budget system. No repository edits, ledger/worklog edits, migrations, deployment, credentials, real service calls, or purchases. Landing, Google helper/policy, and feed are untouched.

Read governing CLAUDE.md, AGENTS.md, CODEX_HANDOFF.md, claims, pre-commit hook, worklog, and workspace CLAUDE_CODE_HANDOFF.md. Claims check reports codex/handoff-priorities, clean source, tip256e0d7. Applied Supabase skill; user's offline-only scope overrides live verification suggestions. No schema change or migration file was created; required CLI migration workflow remains for a future database design. Existing reported shmget/CLI telemetry blocks were not bypassed or retried.

## Findings, ordered by impact

**LLM-R1 — P1: no atomic admission, and dollars are checked without reserving the next call.** `classify-cuisine-backfill/index.ts:99–146,188–203` reads daily usage, lifetime cost, and lifetime ledger-row count separately. Each worker then uses its own snapshot. Actual-handler test runs two concurrent requests from usage499: both dispatch, exceeding500. From $9.9999, one response with1000input/100output adds$0.0015 and crosses$10. The proxy similarly separates its daily300 read from its increment (`places-proxy/index.ts:201–219`). An atomic increment alone does not conditionally admit a call. Proposed patch does not fix this. A process-local lock cannot fix independent Edge workers.

**LLM-R2 — P1: failed accounting can authorize continuing spend.** Backfill daily increment at203 ignores resolved RPC errors; dollar insert at219 ignores resolved insert errors. Proxy increment219 likewise ignores errors. Baseline executes two model calls despite each backfill meter/ledger write returning an error. Proposed patch checks returned errors, refuses dispatch after an unconfirmed increment, and stops the current batch after any unknown accounting result. Lost acknowledgments are not retried. This does not durably block a later invocation.

**LLM-R3 — P1: paid failures escape lifetime dollar/call accounting.** Backfill's dollar insert follows `classifyWithLLM`, whose actual parser can throw *after* the SDK returns usage (`_shared/llm-classifier.ts:344–367`). Invalid JSON yields two paid responses but zero ledger rows in baseline. Missing usage becomes zero-dollar records. Transport uncertainty also skips the ledger. Proposed finally block records valid returned usage even on parse failure; absent/invalid usage stops the batch and reports `accounting_uncertain:true`, without inventing a zero charge. Unknown amounts still need a durable conservative reservation/reconciliation mechanism; a later cron invocation can run again. The existing failure stamp and partial processing remain; this proposal is not a durable reconciliation mechanism.

**LLM-R4 — P1: proxy and operator paths bypass the backfill dollar cap.** Blurb599 and details676 call Anthropic without any `llm_spend` insert or lifetime dollar admission. Proxy has a separate daily call cap. The $10 gate is scoped to `llm_cuisine_backfill`; `admin_llm_spend_usd()` aggregates ledger records and therefore omits proxy costs. Key presence enables proxy enrichment, not a separate dollar authorization. Do not describe the admin total as an invoice or account-wide ceiling. Outside Edge Functions, `supabase/scripts/backfill-classifier.ts:180–189` and `supabase/eval/run.ts:159–168` create SDK clients directly. `--dry-run --with-llm` in the former still pays; default row limit is all. `mobile/lib/__tests__/classifier-llm-eval.test.ts:23–46` uses direct fetch under explicit RUN_LLM_EVAL/key gates. These are operator/eval paths, not unauthenticated app bypasses. They must remain explicitly spending-authorized or join a future centralized admission policy. None was executed here.

**LLM-R5 — P2: SDK retries are outside the call counter.** Both Edge clients omit maxRetries. Installed official @anthropic-ai/sdk0.32.1 (same version pinned by Edge imports) defaults to2 retries in core.js124 and retries transport/errors in289–319,377–425. Actual installed SDK plus injected500 transport makes3 attempts for one messages.create; maxRetries0 makes1. This proves attempt multiplication, not that each HTTP500 is billed. Proposed Edge constructors set maxRetries0; local operator scripts remain separate gaps.

**LLM-R6 — P2: lifetime3000-call check is batch-entry only.** Starting2999 ledger rows with two candidate rows produces two paid calls. Proposed loop checks processed+lifetimeCalls before each attempt. Concurrent invocations and historical unledgered failures remain unbounded by this local correction.

**LLM-R7 — P2: empty successful blurbs are not cached despite the comment.** Only truthy blurb text writes generated_at (`places-proxy:609`). Two opens with empty successful output produce two paid calls. Proposed patch stores a null blurb plus generation timestamp on successful empty output. Failed cache writes can still allow repetition; atomic cross-request generation coalescing remains absent. Moves no-reviews exit before metering so it does not consume a call slot.

**LLM-R8 — P2 / latent bypass:** classifyAndBuildRow permits useLLM:true without admin, bypassing both counter read and write. All current application call sites pass admin; this is a helper-contract gap, not an observed current HTTP bypass. Actual helper control shows baseline dispatch without admin; proposal requires admin. Malformed existing daily counts also now fail closed. Missing daily row remains valid zero.

## Delivered bounded patch

`BOUNDED_FIX.patch` changes only:
- supabase/functions/classify-cuisine-backfill/index.ts
- supabase/functions/places-proxy/index.ts

Includes R2/R3/R5/R6/R7/R8 mitigations and corrects misleading hard-ceiling comments. Full baseline/proposed copies and SHA256 fingerprints supplied. Main should independently review and apply; nothing integrated. Paid call failure may now stop a batch sooner, and retries no longer hide transient model failures. Details retains deterministic fallback; blurb error returns through existing handler path. No Google admission/mask/price logic changed.

## Executed evidence

Run from this workspace with `/opt/homebrew/bin/node`:
- `outputs/llm-budget-audit/handler-controls.cjs baseline`:17/17 **baseline observation controls** passed. These assert reproduced defects; they are not17 passing safety guarantees.
- Same script `proposed`:17/17 proposed controls passed. Three explicitly named REMAINING controls still assert overlapping admission, dollar overshoot, and proxy ledger omission.
- `outputs/llm-budget-audit/sdk-controls.cjs`:2/2 installed SDK retry controls passed (3attempts default,1attempt explicit0).

Handlers and local classifier/parser/retry dependencies are transpiled from actual source into a VM. Only Deno serve/env, Supabase boundary and Anthropic transport are substituted. Synthetic environment contains no user credentials. VM fetch and Google spender throw; imports are allowlisted. Backfill invokes the captured actual HTTP handler. Proxy tests call actual handleBlurb/classifyAndBuildRow; proxy HTTP auth routing is source-inspected, not exercised. Genuine success and read-denial controls retain behavior. SDK test uses its real request pipeline with injected synthetic responses, no network.

These tests do not execute SQL, PostgREST, Deno deployment, or multi-session PostgreSQL; the concurrent-handler reproduction is shared mocked stale-read state. It demonstrates handler admission lacks serialization, not database behavior. No whole-app tsc, native test, invoice verification, or current-price verification claimed. TypeScript transpilation succeeds; a standalone full Deno typecheck was not run. Hand-maintained prices/model aliases and cache-write pricing deserve separate official pricing review before a dollar-reservation design.

## Required next design, separate from this patch

Use a DB-owned, default-deny policy and atomic conditional reservation shared by every admitted external LLM attempt. Bound model, prompt/input size, output limit, and price assumptions before choosing a conservative charge. Reserve before dispatch; ambiguous reservation reply denies dispatch without refund. Keep uncertain paid outcomes reserved across process death/retry; reconcile only on authoritative usage with idempotent settlement. Disable hidden retries or reserve each attempt. Define lifetime/daily action and shared account caps explicitly, and account for old deployments/operator paths. Do not repurpose Google's table/policy without review. CLI-created migration plus offline SQL/ACL/integration tests and eventual authorized multi-session verification are still required. Current patch cannot turn the present $10 estimate into a guaranteed ceiling.

Final integration check: read-only `git apply --check` against Palate succeeded; repository status remains clean. No tool/approval/usage blocker occurred during this bounded audit. Outstanding atomic-policy design is substantive unfinished protection, not a tool failure.
