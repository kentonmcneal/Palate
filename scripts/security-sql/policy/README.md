# Reviewed Google reservation policy draft

This SQL is deliberately outside `supabase/migrations`. It is not applied, deployed, or an authorized paid allowance. The installed migration CLI is blocked on an out-of-scope telemetry write; its alternate executable has no migration command. Follow the normal migration workflow when that tooling is available.

The draft starts at zero, refusing all guarded admissions. A database-owned cap must match the worker cap exactly. Existing reservation algorithm, conservative failed-request accounting and once-only threshold flags remain unchanged. No application/service-role policy-write permission is granted. A future cap change cannot cancel a request already admitted.

Run both durable offline runners from the repository root, supplying an installed PGlite package path:

```sh
node scripts/security-sql/policy/budget-policy.test.cjs /absolute/path/to/@electric-sql/pglite
node scripts/security-sql/policy/independent.test.cjs /absolute/path/to/@electric-sql/pglite
```

These execute original repository migrations and the draft on synthetic PostgreSQL roles/data. All helper fetches are mocked. The first suite reproduces mixed-cap baseline behavior before testing21 policy cases. The second checks11 independent ACL/compatibility groups, including explicit default grants and unchanged routine identity. Neither proves multi-session contention or production rollout.

Before any future deployment: inventory OID-bound callers, custom roles, migration owner and deployed helper adoption; verify real multi-session policy UPDATE contention and actual PostgREST schema-cache behavior. Keep zero unless separately authorized to enable a paid cap. Full limits and review evidence are in the two GOOGLE_POLICY review documents under docs/codex-handoff.
