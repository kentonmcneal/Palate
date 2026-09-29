# LLM cache and completion-stamp write confirmation

2026-09-29. **WORKING TREE / offline RUN:** minimal copied-source proposal, tested but not independently approved or integrated. Repository unchanged. No services, credentials, paid calls, deployments, installations, migrations or Google/feed edits.

## Apply order and scope

1. `outputs/llm-budget-audit/BOUNDED_FIX.patch`
2. `outputs/llm-budget-independent/ADDITIVE_FIX.patch`
3. This directory's `PERSISTENCE_FIX.patch`

The third patch changes only `supabase/functions/classify-cuisine-backfill/index.ts` and the LLM blurb block of `supabase/functions/places-proxy/index.ts`. Full replacements are under `source/`; `SOURCE_HASHES.json` identifies the exact combined base and final bytes. Read-only `git apply --check` passes against the combined base. Do not apply these complete files over unrelated intervening proxy changes.

No admission caps, cost constants, SDK retry settings, Google policy/masks/helpers, feed logic, classifier/parser or SQL schema changed. The test script is delivered beside this report for main to retain/run; it is not added to a repository package script automatically.

## Behavior

**Proxy blurb:** preserve the exact successful model result and return HTTP200 even if caching is denied, throws, matches no row, returns an unexpected row ID, or loses its acknowledgment. The response is:

    { blurb: <the paid result>, cache_write_confirmed: false, reason: "cache_write_unconfirmed" }

There is no top-level error and no automatic retry. A confirmed write returns `cache_write_confirmed:true`; a valid cached read also returns true. Empty successful text remains a valid cacheable result. The field deliberately means *confirmation*: a lost acknowledgment may follow an actually applied write, so false does not assert that nothing was stored.

The current `mobile/lib/restaurant-blurb.ts` loader uses the blurb and ignores the extra fields. Actual-loader controls confirm a nonempty partial result is retained and an empty result remains null for presentation, with one Functions invocation and no retry. Other unmodified clients may ignore the new status; this is an honest response contract, not a new mobile error presentation.

**Backfill:** use one checked restaurant-write helper for the paid-failure stamp, abstention stamp and classification update (which includes the completion stamp). It requests only the row ID in the PATCH representation and requires an error-free matching ID. `.select("id").maybeSingle()` modifies that same PATCH; it is not a second write or an application retry.

On an unconfirmed restaurant write:

- Set `persistence_uncertain:true` and stop before the next model call in this invocation.
- Count the affected row as failed exactly once. Paid-parser/accounting failure already reaches the outer failed counter, so a failed cleanup stamp does not double-count it.
- Retain earlier confirmed `written` counts, charged ledger rows and successful results. A failed later row does not erase earlier work.
- Keep `accounting_uncertain` independent. A successfully ledgered model response with a failed restaurant stamp has known accounting but unconfirmed restaurant persistence. If both writes are unconfirmed, both flags are true.
- Return the existing HTTP200 batch summary with its partial counts. `remaining_estimate` is `"unknown"` when accounting or restaurant persistence is unconfirmed, rather than incorrectly claiming no remaining work. Otherwise an early stop with fetched rows left returns `"more"`.

`abstained` counts model abstentions; `failed` now also includes an abstention whose stamp was unconfirmed. They are not mutually exclusive totals. A successful abstention continues the batch. Existing `commit:false` success semantics remain: it still pays/meters/ledgers the classification but does not write successful classification/abstention rows. Existing paid-failure stamping behavior under commit:false is not redesigned here.

The previous classification update checked returned errors but continued spending on later rows. It now uses the same confirmed-row helper and stops as well: a systemic restaurant-write failure should not keep spending on results the batch cannot confirm it retained.

## Verification

**WORKING TREE / offline RUN:**

- `persistence-controls.cjs`: **80/80 controls pass** on the final copy.
- On the combined pre-fix base: **47pass/33fail**. These include both reproduced unsafe behavior and deliberately new response-contract assertions; they are not33distinct bugs.
- Five persistence fault models: returned permission error, transport rejection, zero matched rows, wrong returned ID, and write-applied-then-acknowledgment-lost.
- Each is tested against empty/nonempty blurb responses and backfill abstention, parser failure and successful classification. Tests assert one model dispatch and one PATCH, HTTP200 partial response, truthful flags, correct known-cost ledger, and no next-row model call.
- Additional controls cover previous success followed by failure, both ledger/stamp uncertainty, successful stamp continuation, successful empty cache/read reuse, commit:false success, auth denial, missing/malformed admission values, independent cache-token accounting, and actual SDK retries.
- The preceding independent review's unresolved concurrency/next-call overshoot/later-invocation uncertainty controls remain present and reproduce those limits. A passing limitation control does not mean the cap is safe.
- Two controls run the actual mobile loader with a real installed Supabase Functions client and injected HTTP200 partial response. Neither retries.
- Focused actual-source extraction of the persistence expressions against a concrete installed Supabase client type: zero TypeScript diagnostics (`WRITE_TYPES.log`). The preceding nullable-count check remains zero (`COUNT_TYPES.log`). These are **not a whole Deno/Edge typecheck**. A first fixture using generic ReturnType rather than a concrete client produced SDK generic `never` types; the final fixture instantiates the concrete type to match the backfill's factory inference. It does not claim the newer SDK's broad generic signature equals the pinned Edge signature.
- Read-only patch applicability check passes.

Native Node: `/opt/homebrew/bin/node`. Real installed Anthropic0.32.1 matches the Edge pin. Real installed Supabase/PostgREST2.110.7 is newer than Edge2.45.0; exact pinned Supabase/Deno parity is unverified. No installation was made. SDK HTTP is wholly injected; all uninjected global/VM fetch calls throw. SQL, actual PostgREST row permissions, live cron, deployment and device behavior were not exercised.

Reproduce from the shared workspace:

    /opt/homebrew/bin/node outputs/llm-persistence-fix/persistence-controls.cjs work/llm-persistence-fix/fixed
    /opt/homebrew/bin/node outputs/llm-persistence-fix/persistence-controls.cjs work/llm-persistence-fix/base

The second intentionally fails the33new behavior/contract assertions. After integration, pass the reviewed combined source root to the first command. Tests fall back to unchanged shared classifier/retry modules in the read-only Palate repository.

## Limits for main/independent review

**No durable hold is added.** The stop flag exists only in the current backfill invocation. Later cron runs, other workers, or reopening a blurb can still spend when no durable cache/stamp exists. A write may have applied despite an unconfirmed response; this patch does not retry it, refund accounting, or repeat the model call to resolve uncertainty.

The hard ceiling remains unresolved: read-before-call concurrency, unreserved next-call cost, model/input/pricing assumptions, unledgered proxy/operator paths, and unknown costs across invocations. HTTP200 prevents this patch from newly presenting a successful paid generation as a transport failure; it cannot guarantee that an external client will never retry. Status-only cron monitoring must inspect the new and existing flags to detect partial failure.

The response contract gains `cache_write_confirmed`, `persistence_uncertain`, and the `"unknown"` value for `remaining_estimate`. No consumer of `remaining_estimate` was found in the inspected mobile and operator TypeScript paths, but main should check external automation expectations. Existing no-model responses (e.g. budget denial/no reviews) retain their prior shape.

Requesting the row representation is confirmed with the installed SDK and mocked HTTP, not actual service-role SQL/ACL execution. Main should review the exact patch and run its Edge checks before integration. No schema/migration changes are necessary for this patch; any future atomic admission design remains a separate required workflow.
