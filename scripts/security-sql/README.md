# Offline SQL privacy regressions

Run with an existing installation of the free @electric-sql/pglite module:

```sh
node scripts/security-sql/local-sql.test.cjs /absolute/path/to/node_modules/@electric-sql/pglite
```

No application dependency or network is needed by the runner. It loads the committed0183 migration, a minimal synthetic schema with real PostgreSQL roles/RLS, and the current group handler. Results print to stdout. PGlite is supplied externally to keep it out of mobile/production dependencies. The recorded run used0.5.8/PostgreSQL18.3.

See docs/codex-handoff/LOCAL_SQL_SECURITY_20260929.md for exact scope, negative controls and limitations. This does not replay the full migration chain, verify deployed privileges/auth, or test multi-session concurrency. Existing-data-preflight.sql is read-only and has not been run live. Do not deploy or run against real users within the current task.

## Google budget SQL/helper suite

```sh
node scripts/security-sql/budget-sql.test.cjs /absolute/path/to/node_modules/@electric-sql/pglite
```

Executes original0033/0179 counter migrations and the current helper with mocked transport/clock. No network-capable fetch. Includes characterized limits (different caller caps, legacy callers and lost alerts), not just success cases. See GOOGLE_BUDGET_SQL_PROOF_20260929.md.

## Search block regression

```sh
node scripts/security-sql/search/search-users.test.cjs /absolute/path/to/node_modules/@electric-sql/pglite
```

Runs actual0184 against a synthetic identity/block schema.20 cases reproduce old disclosure and check corrected matching/ACL behavior. No live calls.
