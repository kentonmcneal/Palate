# LLM admission Edge integration proposal — 2026-09-29

**DRAFT / RUN (offline):** scratch integration for the three model-request paths in two Edge functions. Pending independent integration review and rollout prerequisites. No spending authorization, active migration, deployment, repository edit, paid call, live request, or policy enabling occurred.

## Baseline and artifacts

Main's `0b6a783` was verified as HEAD. Copied baseline handler bytes match current source, including bounded usage validation, no SDK retries, confirmed cache/stamp writes, batch stops, and the null-to-empty-string cache sentinel. `SOURCE_HASHES.json` records those matches and all proposed hashes.

- `INTEGRATION.patch`: seven source paths; applies to the reviewed baseline. Scratch `git apply --check` passes.
- `source/`: all seven proposed files.
- `llm-admission-draft.sql`: unchanged, unnumbered copy of the author default-deny draft. **Excluded from the integration patch; not a migration or schema rollout.**
- `CONFIRMATION_DRAFT.sql`: new read-only confirmation RPC addendum, applied after the original draft in offline tests. Also excluded from the source patch and pending independent SQL review.
- The new `_shared/llm-admission.mjs` exactly matches `outputs/llm-admission-independent/admission.mjs`, incorporating `COMPATIBILITY_FIX.patch` (nullable/zero usage metadata). The original SQL is unchanged by that review; this integration adds the separately identified confirmation addendum following main's commit-boundary recommendation.
- Tests/logs and `SOURCES.md` retain reproduction and official source evidence. These scripts run from this shared workspace using existing dependencies; no installation is required.

## Proposed behavior

| Path | Integration | Failure/client behavior |
| --- | --- | --- |
| places-proxy blurb | `admittedCreate(..., "proxy_blurb")` | Cache hit/no-key/no-review gates remain. Denied or uncertain model admission returns HTTP 200 with null blurb and an explicit reason; existing mobile loader renders no blurb and does not retry. Valid paid result remains available if its cache update is unconfirmed. |
| places-proxy details classifier | `admittedCreate(..., "proxy_classify")` through existing classifier callback | Existing authentication and deterministic classification remain; denial/unknown result falls back to deterministic. Google logic, masks, prices and persistence are untouched. |
| classify-cuisine-backfill | `admittedCreate(..., "cuisine_backfill")` through existing counted callback | Each paid attempt needs its own receipt. Denial stops batch and exposes `admission_denied`; it does not stamp the restaurant as judged. Dispatched failure retains the existing failure-stamp path. Cache/stamp/legacy-ledger uncertainty still stops further calls. |
| operator backfill `--with-llm` | Explicitly disabled before client construction, with a second throwing callback | Even `--dry-run` plus a key/flag cannot pay. Deterministic operator mode remains. |
| Node eval `--with-llm` | Paid branch replaced by refusal | Deterministic evaluation remains; no SDK import/client survives. |
| mobile paid eval | Permanently unarmed, direct callback throws | Environment opt-ins cannot enable paid execution; direct provider fetch removed. |

The adapter generates one random attempt UUID and invokes the reviewed helper once. The helper serializes and hashes the request, requests one reservation through the Edge adapter, checks its complete receipt after fresh confirmation, and performs at most one raw provider HTTP invocation with fixed host/version/tier, redirect refusal and timeout. No SDK retry, model fallback, reserve retry, or paid retry repairs a settlement. Valid paid responses survive lost settlement acknowledgements; backfill still stops before another row when that acknowledgement is uncertain. Parser-facing content shape is checked before returning the message.

### Fresh confirmation before dispatch

The Edge adapter owns its database transport; it does not accept an arbitrary RPC callback. It sends reserve, confirmation, and settlement as separate raw HTTPS POST requests to the configured Supabase origin, with fixed RPC names, service credentials, no forwarded client headers/preferences, redirect refusal, a ten-second timeout, and request/header cache refusal. There is no SDK wrapper or retry in this transport.

After an admitted reserve response, the adapter awaits `confirm_llm_v1` in a **second HTTP request**. That read-only, service-only RPC requires READ COMMITTED and matches all nine receipt/request fields against an existing, unexpired, unsettled reservation. Only literal JSON true succeeds. The original helper then validates the entire reserve receipt and its original expiry before model dispatch. Confirmation does not extend expiry, reissue a reserve permit, change policy, mutate a debit, or refund anything.

This addresses the modeled rollback-config failure: a provisional reserve reply followed by rollback leaves no row for fresh confirmation, so all three paths deny model transport. A confirmation inside the same provisional transaction would incorrectly see its own row; the SQL controls explicitly demonstrate that distinction. The actual adapter performs separate HTTP requests instead of assuming any injected RPC callback commits.

Tradeoff: one extra database round trip; latency/failure can consume reserved capacity without obtaining a model result. Lost/false/malformed confirmation denies with no retries or refund. The read is not a new revocation protocol for already granted requests, a durable result cache, or a one-time dispatch token by itself. It is used only after this attempt's original successful reserve response; repeated reserve UUIDs still deny. Ordinary trusted infrastructure and independent committed-read semantics remain assumptions to validate in deployment.

**No positive policy is seeded.** Missing RPC, missing/disabled policy, invalid/lost admission reply, missing key, and denied caller produce zero model transport in the executed controls. A returned receipt must also pass the reviewed bound/identity/expiry checks. Full reservations remain charged on unknown outcomes and on successful observations; settlement never refunds this v1.

### Preserved bounded safeguards and interpretation

Legacy call/spend reads and meters remain *additional* stop conditions. They cannot authorize transport without the new receipt. Their fail-closed validation and legacy ledger ordering are preserved. `spent_usd`/`cap_usd` remain the legacy estimate/threshold, not the new policy's reserved capacity or an invoice balance. Existing `processed` counts attempted rows, including a denied attempt; the legacy pre-call meter can also count an attempt that never reaches transport. No paid-call count is inferred from those fields. `admission_denied` plus an unknown remaining estimate exposes the stop.

The null blurb cache sentinel, matched-row PATCH confirmation, paid-result HTTP 200 on cache uncertainty, abstention stamps, and one failed count per failed row remain. A policy denial leaves the row eligible because no classification occurred. `commit:false` still requires admission and consumes a permanent reserve; it is not a free trial. Existing dispatched-failure stamps under commit:false remain as before.

A new request/worker receives a new UUID: this proposal does not implement business-operation deduplication or result coalescing. Later paid retries must be separately admitted and consume another full reserve.

## Executed controls (RUN, offline only)

| Evidence | Result |
| --- | --- |
| `HANDLERS.log` | **50/50** actual-handler/helper + actual draft SQL and confirmation controls |
| `BYPASS.log` | **13/13** AST/source and disabled-callback checks across **597** first-party TS/TSX/JS/MJS files, including five injected direct-call patterns |
| `OPERATORS.log` | **2/2** actual operator top-level / eval main refusal controls; zero transport and zero operator client constructions |
| `INDEPENDENT_DESIGN.log` | **40/40** independent SQL/helper controls rerun with the integrated corrected helper |
| `AUTHOR_DESIGN.log` | **32/32** author SQL/helper controls rerun with the integrated corrected helper |
| `CONFIRMATION.log` | **16/16** new SQL identity/expiry/rollback/ACL/read-only controls |
| `TYPES.log` | **0 diagnostics**, strict adapter plus actual shared classifier types |
| `BYPASS_MUTANT.log` | Deliberately removing the receipt check: **11 failures / 39 passes**, as required |
| `CONFIRMATION_MUTANT.log` | Removing the confirmation result check: **8 failures / 42 passes** |

Handler controls use the real installed Supabase SDK for existing reads/writes and the actual raw-HTTP Edge admission adapter, with injected PostgREST-shaped responses. Reserve/confirm/settle calls execute the actual draft SQL/addendum in PGlite. All unconfigured network transport throws. The tests cover untouched SQL defaults, missing/disabled policies for each path, enabled receipts/action binding, malformed/lost/absent RPC replies, the global last-slot policy across paths, HTTP/transport/usage failures without hidden retries, settlement loss, persistence failures, null cache sentinel/repeated cache hit, parser failure/abstention stamps, commit:false, caller/key gates, legacy guard/ledger failures, and current mobile response consumption. They additionally cover provisional reserve rollback followed by fresh confirmation for all three paths, nonboolean confirmation, lost confirmation, exact request binding and absent transaction preferences. Two controls execute the authenticated details entry point with a synthetic Google response; no Google transport occurs.

The bypass scan overlays proposed files onto current first-party source. It rejects vendor SDK/endpoint literals and dot/computed `messages.create` references outside the admitted transport, and checks the exact three adapter action bindings. It excludes dependency/generated/native directories and CJS offline harnesses. This is an executable regression guard supplied as an artifact, **not yet wired into repository CI**. It is not a proof against obfuscated/generated URLs, arbitrary dynamic code, modified dependencies, old deployments or other applications using the provider account.

The operator runtime control executes the actual control flow with a deterministic classifier fixture; it does not certify evaluation accuracy. The cache trigger itself is unchanged: the previous persistence review executed it; this integration additionally asserts the outgoing null sentinel and repeat-read behavior.

### Reproduce

From the shared workspace root:

```sh
/opt/homebrew/bin/node outputs/llm-admission-integration/handler-controls.cjs outputs/llm-admission-integration/source
/opt/homebrew/bin/node outputs/llm-admission-integration/bypass-controls.cjs
/opt/homebrew/bin/node outputs/llm-admission-integration/operator-controls.cjs
/opt/homebrew/bin/node outputs/llm-admission-integration/type-controls.cjs
/opt/homebrew/bin/node outputs/llm-admission-integration/confirmation-controls.cjs
ADMISSION_HELPER=outputs/llm-admission-integration/source/supabase/functions/_shared/llm-admission.mjs /opt/homebrew/bin/node outputs/llm-admission-independent/controls.cjs
DRAFT_SQL="$PWD/outputs/llm-admission-integration/llm-admission-draft.sql" /opt/homebrew/bin/node work/llm-admission-integration/author-proof.cjs
```

Negative mutations are retained under `work/llm-admission-integration/mutant` (receipt check) and `work/llm-admission-integration/confirmation-mutant` (confirmation result check); running the same handler controls against either intentionally exits 1.

## Required unresolved rollout checks

1. **Fresh-request deployment contract still needs verification.** The modeled reserve-rollback gap now has a concrete guard and red/green controls. Actual deployed PostgREST must execute confirmation as a new committed-read transaction, without stale caching or a shared enclosing transaction. Its transaction configuration, routing, permissions and response behavior have not been invoked here. PGlite with rollback completed between synthetic HTTP calls is not a live independent-connection test. The new confirmation RPC and raw HTTP adapter require independent review before any rollout. **The draft no longer treats the reserve response alone as commit evidence**, but it does not certify arbitrary injected transports or deployed infrastructure.
2. **Pinned runtime not verified.** `deno` is unavailable in this environment; no remote Deno imports or exact Supabase 2.45.0 runtime were executed. Installed SDK is 2.110.7. Focused typing and Node-transpiled handler execution are not a full pinned Deno check or function boot proof.
3. **Concurrency remains unverified.** PGlite 0.5.8 uses one backend. Queued/last-slot controls are not competing-session lock tests. Real PostgreSQL barrier tests are still required for last-slot mixed actions, duplicate IDs, policy changes, rollback/connection loss, settlement overlap, and isolation rejection. Earlier real-Postgres shmget limitations were not bypassed here.
4. **No schema rollout.** Full migration chain, roles/default privileges, ACL/PostgREST exposure, and migration workflow remain outstanding. The earlier CLI telemetry-write restriction is not worked around. Draft SQL remains outside active migrations.
5. **No provider-account/invoice guarantee.** All *identified current first-party source paths* are proposed to be admitted or disabled, but the source has not been deployed, old workers are not retired, and other credentials/routes are not controlled. Historical opening liability, explicit budget authorization, tariff revalidation, policy expiry/caps, and fleet cutover must be settled before enabling anything. The conservative $0.72 bound remains conditional on the reviewed restricted model/tariff; it is not a tax/custom-contract/account-wide invoice ceiling.

Main should independently review this source patch, the new confirmation SQL, and the remaining deployed committed-read contract before integration. Keep policies disabled/zero. No cost permission is inferred from the historical ten-dollar constant, an API key, CLI flags, this review, or successful tests.
