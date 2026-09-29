# Offline LLM admission regression checks

These runners supersede `../test-llm-spend-guards.cjs`, whose SDK-era transport
mock cannot exercise admission. That command now forwards to the full suite.
Its original bytes are retained in `history/test-llm-spend-guards.cjs.txt` for
historical review, not as an executable current check.

Run from the mobile directory using existing dependencies:

```sh
npm run test:llm-admission:guards
PGLITE_MODULE="/path/to/existing/@electric-sql/pglite" npm run test:llm-admission
```

The guard command runs the AST bypass inventory, disabled operator callbacks,
and adapter type check; it requires only the existing mobile TypeScript package.
The mobile build-verification job runs this command after its existing dependency
step. The full suite additionally uses the existing mobile Supabase SDK and an
existing PGlite module. It does not install anything, skip missing SQL tests, or
fall back to remote storage. `PGLITE_MODULE` may name a module directory or CommonJS
entry, resolved relative to the calling directory. Without it, resolution is
from mobile's installed dependencies. No new dependency or lockfile is proposed.

Every executable accepts one optional positional source root:

```sh
node supabase/scripts/test-llm-admission-bypasses.cjs "/path/to/complete/source tree"
PGLITE_MODULE="/path/to/existing/@electric-sql/pglite" \
  node supabase/scripts/test-llm-admission.cjs "/path/to/complete/source tree"
```

The default root is derived from the script location, independent of the current
working directory. The selected tree supplies all production source and mobile
dependencies; there is no source overlay or fallback into another checkout.
Pass a complete integrated tree, including `supabase/eval/cases.json`. To forward
a root through npm, use `npm run test:llm-admission -- "/path/to/source tree"`.
For individual suites use the corresponding `test-llm-admission-{bypasses,
operators,types,handlers,confirmation,adversarial}.cjs` entry. Tests print evidence
to stdout/stderr and never write facts or snapshots into the source tree.

## What is tested

- 13 bypass controls: first-party TS/TSX/JS/MJS AST inventory; five injected
  vendor/direct-create patterns; exact action bindings; confirmation adapter;
  disabled operator/mobile callbacks. Counts of inventoried files can change.
- Two actual operator entry controls: paid flags refuse before client creation
  or provider transport. Deterministic classification is stubbed for this test.
- Strict adapter/classifier type checking (not a Deno deployment check).
- 50 actual Node-transpiled handler cases: default deny; missing/disabled policy;
  uncertain/malformed reserve; shared capacity; permanent reservation; provider,
  persistence, and settlement failures; cache semantics; auth and confirmation.
- 16 confirmation SQL cases: exact identity, expiry, ACLs, isolation and rollback.
- 42 independent adversarial cases: real service-role SQL, raw HTTP confirmation
  faults, original receipt expiry after confirmation, preflight preservation and
  exact matching expired identity. Positive fixtures run only in fresh memory.

All provider/Google/HTTP transports are injected. The fixtures create a new
in-memory PGlite database without credentials or a persistent data directory.
No environment Supabase URL or key is consumed. Global uninjected fetch throws.
The source tests are not an arbitrary-code sandbox: review test changes as code.

## SQL provenance and limitations

`llm-admission-draft.sql` and `CONFIRMATION_DRAFT.sql` are the reviewed unnumbered
2026-09-29 admission design snapshots, copied unchanged from the integration and
independent-review artifacts. They are **test fixtures**, outside active migrations.
Their untouched policies are disabled/zero. Tests temporarily enable synthetic
policies only in their isolated in-memory database. No production policy, rollout,
or migration is authorized by this suite. When a migration is eventually approved,
explicitly bind these tests to that reviewed migration; these snapshots do not
prove the repository's migration chain or deployed schema matches.

The adversarial runner accepts `CONFIRM_SQL=/path/to/scratch.sql` solely for SQL
negative controls; the default remains the bundled fixture. Removing the expiry
predicate must fail the exact-matching expired-identity case. Removing the
adapter's literal-true confirmation gate must fail handler cases.

PGlite is a **single backend**. This does not prove multi-backend contention,
PostgREST commit/cache configuration, the pinned Deno/Supabase runtime, production
pricing, account-wide spending, retirement of old workers, or device behavior.
AST scanning excludes dependencies/generated/native trees and CJS test harnesses;
it does not detect every obfuscated endpoint or dynamic program. The full SQL
suite is an explicit local check, not silently claimed as part of CI: the existing
CI gains only the dependency-free-with-respect-to-PGlite source guards.
