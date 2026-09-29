# Offline SQL privacy regressions

Run with an existing installation of the free @electric-sql/pglite module:

```sh
node scripts/security-sql/local-sql.test.cjs /absolute/path/to/node_modules/@electric-sql/pglite
```

No application dependency or network is needed by the runner. It loads the committed0183 migration, a minimal synthetic schema with real PostgreSQL roles/RLS, and the current group handler. Results print to stdout. PGlite is supplied externally to keep it out of mobile/production dependencies. The recorded run used0.5.8/PostgreSQL18.3.

See docs/codex-handoff/LOCAL_SQL_SECURITY_20260929.md for exact scope, negative controls and limitations. This does not replay the full migration chain, verify deployed privileges/auth, or test multi-session concurrency. Existing-data-preflight.sql is read-only and has not been run live. Do not deploy or run against real users within the current task.
