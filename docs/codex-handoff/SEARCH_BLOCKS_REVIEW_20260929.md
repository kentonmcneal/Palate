# search_users bidirectional-block fix

**COMMITTED source / LOCAL EXECUTION of scratch candidate.** Latest search_users definition found is 0081_revoke_public_on_directory_fns.sql. Its security-definer query does not check blocks, while browse_profiles already filters both directions. No repository writes, dependencies installed, credentials, cloud calls, or live SQL executions.

## Proposal

Integrate `search-users-blocks.proposed.sql` as an additive migration. It adds only:

```sql
and not public.is_blocked_either_way(auth.uid(), p.id)
```

The real existing 0108 helper reads both block directions as security definer. This is required for incoming blocks because authenticated raw blocked_users RLS exposes only the caller's own blocker rows. The filter is inside the query before LIMIT 20. Revoke PUBLIC and anon explicitly, then grant authenticated execution, preserving 0081's client ACL.

Preserved: signed-in requirement, exclusion of self, trimmed minimum length three, case-insensitive exact email matching without returning email, display-name substring and username-prefix matching, five-column bare-identity output, SQL STABLE/security-definer/search_path properties, and original unordered 20-result cap. Friends/private accounts remain discoverable as bare identities when unblocked; this patch does not introduce a public-only directory policy. SQL LIKE wildcards retain existing behavior, but cannot evade the block filter.

## Verification

**20/20 cases pass on PostgreSQL 18.3 / PGlite 0.5.8.** Three baseline cases comprise two bidirectional-disclosure reproductions and an unblocked result snapshot; seventeen candidate cases establish:

- Each direction and reciprocal blocks exclude display-name, username-prefix and exact-email matches.
- A hidden incoming block still excludes its author despite raw block-table RLS returning zero rows.
- Unrelated users' blocks do not hide results from the caller; a blocked target is not globally banned for other viewers.
- Unblocked output matches baseline exactly, including private/friends bare identities and no email output.
- Exact-email case/whitespace handling, email-prefix refusal, display substring, username prefix, short/empty/NULL queries and self-exclusion are unchanged.
- Anonymous execute denied; authenticated role with no subject receives no rows.
- Wildcard search cannot bypass either direction; deleting an outgoing block restores visibility.
- With 25 matching blocked rows plus 25 matching allowed rows, the result contains 20 allowed rows: filtering precedes the cap.
- Function remains STABLE, security definer, search_path public.

Exact test names/results and tested SQL hash: `results.json`; console log: `run.log`.

## Fixture limits

`fixture.sql` contains only the real readers' needed profile columns, auth users, and block relation, a local JWT-subject auth.uid implementation, non-owner authenticated/anon roles and service-role BYPASSRLS. Profile-own/blocker-own RLS and explicit grants model the relevant policies. It loads the actual 0108 block helper and extracted original 0081 search function. Tests switch actual PostgreSQL roles, not just auth.uid, and run inside rollback-isolated transactions.

This is not the full migration chain, deployed ACL/default-privilege inventory, Supabase Auth or PostgREST integration, native People UI, query-plan/performance benchmark, or concurrent block-change proof. It makes no claim about LIVE state. Matching results have no ORDER BY in the existing function; the patch intentionally preserves that behavior.

```sh
/opt/homebrew/bin/node outputs/palate-search-users/search-users.test.cjs "$PWD/work/pglite/node_modules/@electric-sql/pglite"
```

All SQL source and fixture files needed by that runner are beside it; the PGlite dependency remains in workspace scratch, outside repository dependencies.

## Main integration
Integrated as0184_search_respects_blocks.sql; durable runner scripts/security-sql/search/search-users.test.cjs reads that migration directly. Main rerun20 passed,0 failed; results/hash print to stdout. No live application.
