# Independent LLM persistence review — 2026-09-29

**Recommendation:** accept the author persistence patch with the small additive correction in `ADDITIVE_FIX.patch`. The intended batch-stop and paid-result response behavior reproduces. One additional preexisting trigger interaction needs correction; it is not a regression introduced by the author patch.

## Scope and baseline

Reviewed `outputs/llm-persistence-fix/PERSISTENCE_FIX.patch` and `REVIEW.md` against copies of the uncommitted Palate handlers containing the bounded LLM fix and earlier independent additive fix. `BASE_MATCH.json` records their exact match to the author's baseline. `SOURCE_HASHES.json` records baseline, proposed, corrected, and trigger hashes. Only scratch/output files were written. No live requests, paid calls, repository changes, migration, deployment, secrets, or permission requests.

## LPI-R1 — P2: a null result refreshes stale cached text

The proxy parser permits a successful model response without a text block, producing `blurb: null`. The cache update writes that null together with a new timestamp. The latest `restaurants_preserve_enrichment` definition in migration 0181 uses `coalesce(new.editorial_blurb, old.editorial_blurb)`, so the old sentence survives while its timestamp becomes fresh. A subsequent request serves that stale sentence as a cache hit.

Reproduction uses the actual trigger function in embedded PostgreSQL (PGlite), an old sentence predating refreshed reviews, and a synthetic successful provider response with `content: []`. The author version returns null first, then returns the old sentence without another model call. This behavior exists in the preceding baseline too; the new matching-ID confirmation does not establish that the intended text was stored.

The additive correction stores `blurb ?? ""` in the cache. Empty string is already the no-blurb sentinel. The initial response remains the exact paid null result; the next cache read yields empty string, and the existing mobile loader renders null for both. Nonempty and already-empty results are unchanged. No schema or trigger changes are needed.

## Author behavior independently assessed

- Backfill requires an acknowledged matching row for success, abstention stamps, and failure stamps. Errors, throws, no rows, malformed/wrong IDs, and multiple rows stop the batch before another model call and expose `persistence_uncertain`. A failed row is counted once even when accounting and persistence both fail.
- Prior confirmed writes remain counted. `remaining_estimate` becomes unknown on uncertainty and reports more when a daily limit leaves fetched rows untouched. It is an estimate, not a completion guarantee.
- A successfully generated blurb remains HTTP 200 on an unconfirmed cache update, with `cache_write_confirmed: false` and `reason: "cache_write_unconfirmed"`. Empty/null results also retain successful response semantics. The added projection is part of the same PATCH.
- The current mobile loader invokes once, retains a nonempty paid sentence, and ignores the additional metadata. There is no new metadata-triggered client retry. Later navigation or later jobs can still retry.
- Applied-but-lost cache acknowledgement is reported as unconfirmed; a later read can discover the committed cache without another model call.
- Existing `commit: false` behavior is preserved. It still spends and records model usage; successful/abstention restaurant writes are skipped. Existing failure-stamp behavior means it is not a universal no-write dry run.

## Executed evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Author 80 controls on integrated preceding baseline | 47 pass / 33 fail | BASELINE.log |
| Author controls on proposed persistence patch | 80 pass | AUTHOR.log |
| Independent actual-handler/SDK/trigger controls on proposal | 12 pass / 1 fail (LPI-R1) | PROPOSED.log |
| Independent controls after additive correction | 13 pass | FIXED.log |
| Author controls after additive correction | 80 pass | AUTHOR_FIXED.log |
| Focused write-result typing | 0 diagnostics | WRITE_TYPES.log |
| Existing count typing control | 0 diagnostics | COUNT_TYPES.log |

The 13 independent controls cover the actual preservation trigger, valid empty/nonempty results, malformed/wrong/multiple write acknowledgements, projection/representation behavior, ledger-before-cache ordering, parse-failure counting, lost acknowledgement, null plus denied cache, commit-false abstentions, partial daily-limit completion, and the real mobile loader through the real installed Functions client into the handler. Transport is synthetic and unexpected fetches throw. These are offline controls, not deployed-service tests.

Reproduce from the workspace root:

```sh
/opt/homebrew/bin/node outputs/llm-persistence-independent/independent-controls.cjs work/llm-persistence-independent/proposed
/opt/homebrew/bin/node outputs/llm-persistence-independent/independent-controls.cjs work/llm-persistence-independent/fixed
/opt/homebrew/bin/node outputs/llm-persistence-fix/persistence-controls.cjs work/llm-persistence-independent/fixed
```

`harness.cjs` and `independent-controls.cjs` are included. They use existing local dependencies and read shared handler helpers from Palate. The copied corrected proxy is under `source/`.

## Limits and remaining gaps

Installed Supabase/PostgREST is 2.110.7, newer than the Edge pin 2.45.0; exact pinned runtime parity is unproven. Installed Anthropic 0.32.1 matches the pin. The current PostgREST SDK normalizes maybeSingle cardinality client-side; the mock returns PATCH row arrays accordingly. Focused compiler fixtures are not a complete Deno typecheck.

PGlite 0.5.8 executes the exact preservation function with a minimal restaurant table. Blurb text/timestamps use their relevant types; unrelated trigger fields use simplified fixtures. This is not validation of the complete migration chain, grants, live PostgREST, or concurrent database workers.

The fix stops the current batch only. It does not reserve future spending, establish an atomic dollar cap, prevent later jobs/reopens/concurrent workers from paying again, or resolve unknown accounting. Those remain the separate admission-design work. Matching-row confirmation is an acknowledgement, not an immutable freshness guarantee; concurrent review-refresh/cache races are outside this small patch. The cron HTTP caller has no body-flag monitor demonstrated here, so HTTP 200 alone must not be treated as an entirely healthy batch. No new mobile warning UI is provided for an unconfirmed cache write. No device/UI or account-wide privacy guarantee is made.

## Integration

Apply the author `PERSISTENCE_FIX.patch` after the already-integrated bounded and independent patches, then this directory's `ADDITIVE_FIX.patch`. The additive patch changes only the proxy cache value/comment. Backfill is unchanged from the author proposal. No ledger/worklog promotion is performed by this review.
