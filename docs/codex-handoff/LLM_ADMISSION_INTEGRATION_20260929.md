# Local LLM admission integration — 2026-09-29

WORKING TREE source, reviewed offline. No LIVE policy/control verification, migration or deployment. All SQL stays in docs/test fixtures outside active migrations; defaults disabled with zero caps. Missing RPCs deny model transport. Existing credentials are not spending authorization.

## Behavior
Three known Edge paths (blurb, details classification, cuisine backfill) use one transport adapter. Every call requires a database reservation followed by a separate uncached confirmation request that sees the same committed, unexpired identity. Provider invocation has no SDK retry, redirect, model alias or optional billing feature. Paid operator/evaluation shortcuts refuse even with old environment opt-ins. Existing deterministic fallback/cache behavior remains; admitted successful responses survive settlement acknowledgement failure. Backfill stops on uncertain accounting/persistence and does not mark denied/preflight rows as judged.

The private ledger design serializes reservations and permanently debits720000micro-USD per admitted call, retaining capacity on failure, timeout, lost response or settlement uncertainty. Settlement records evidence without refund. This intentionally sacrifices capacity rather than estimating unknown input tokens from characters. The conditional0.72USD bound applies only to the specified first-party model/tariff/profile; it is not invoice/tax/custom-contract proof or authorization. Historical opening liability must be reconciled, not assumedzero. Policies remain disabled/zero.

## Evidence and remaining requirements
Main executed50actualhandler +42independentadversarial cases on integrated source, then full durable123-case suite plus focusedtyping. Entire mobile suite154suites/1686passed/1skipped andTypeScript pass. All transport synthetic. Durable source guards are wired into the existing CI job; that workflow has not run remotely. Full SQL suite uses explicit existing PGLITE_MODULE and is a separate localcommand, not automatically certifiedbyCI.

PGlite is onebackend. Real concurrent sessions, PostgREST committed-read/cache configuration, full migration chain/owner/ACL, pinnedDeno+Supabase2.45runtime, oldworkerretirement and liveprovideraccountcoverage remain unverified. CLI-required migration creation is blocked by its telemetry write permission; no alternate-numberedmigration or environment bypass was used. Native device and deployment verification remain outside this window.

Legacy93-case SDK-era evidence is historical, not added to123currentcases. Its exactharness is archived and oldentry forwards tocurrentfullsuite. Reproduction andlimits: supabase/scripts/llm-admission/README.md. SQLcanonicaldrafts and testfixtures match byte-for-byte; no active migrations are implied.

## Rollback
Revert this local integration commit as one batch, preserving baseline and bounded safeguards0b6a783. Reverting restores direct model paths and removes central-admission refusal; do not interpret rollback as spending authorization. Nothing was deployed. Keep newpolicy disabled and no paidcalls during any later integration. Recoverytag codex-baseline-20260928 remains unchanged.
