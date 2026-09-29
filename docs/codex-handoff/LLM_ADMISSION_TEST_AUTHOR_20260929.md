# Durable offline LLM admission tests — 2026-09-29

**WORKING TREE proposal / RUN evidence:** `LLM_ADMISSION_DURABLE_TESTS.patch` is a
separate 16-file test/tooling patch. It applies cleanly against Palate main at
`df7a268ed428c284e0e6ad84ef475fc533094703` with its current admission source changes.
No repo file was edited. No API, live database, provider, deployment, dependency
installation, or production policy change was performed.

## Integration

Apply after/alongside main's seven-file admission integration. Those seven files
are absent from this patch; all seven scratch copies matched the reviewed source
exactly (`SOURCE_IDENTITY.json`). Main remains owner of production integration.
The complete proposed files are also under `source/`; `FILES.json` records hashes.

- Adds `supabase/scripts/test-llm-admission-bypasses.cjs` and portable handler,
  confirmation, adversarial, operator, type, and aggregate entry points.
- Computes default root from script location; optional positional root selects
  the complete source tree and its existing mobile dependencies. No overlays,
  developer paths, output-folder imports, or fallback to the author's checkout.
- Loads existing PGlite through explicit `PGLITE_MODULE` or mobile resolution;
  missing dependency fails, never installs or skips. Tests use fresh memory only.
- Adds `mobile` scripts `test:llm-admission:guards` and `test:llm-admission`.
  Adds the guards command to the existing mobile build-verification job after
  dependency installation. No new install step, lockfile, or paid command.
  Full SQL tests are intentionally an explicit local command until CI has an
  independently approved existing PGlite provisioning strategy.
- Replaces the old spend-guard entry with a forwarding wrapper to the full suite.
  Preserves its original bytes as `llm-admission/history/test-llm-spend-guards.cjs.txt`.
  This avoids executing the incompatible SDK-era mocks while retaining evidence.
- Preserves both SQL drafts byte-for-byte as clearly labelled test fixtures outside
  migrations. No positive production policy is included. Synthetic enabled policy
  rows exist only within fresh in-memory test databases.
- Removes adversarial runner writes to its own directory; facts print to stdout.
  `llm-admission/README.md` documents commands, fixture provenance, and boundaries.

## Executed results

All executions used existing Node **26.8.2**, TypeScript **6.0.3**, Supabase SDK
**2.110.7**, and PGlite **0.5.8**. No versions were installed or changed.

| Suite | Actual result |
| --- | --- |
| Source bypass guard | 13/13; 597 first-party files; five injected AST patterns |
| Actual operator/eval controls | 2/2; zero provider calls/client constructions |
| Focused adapter/classifier types | zero diagnostics |
| Actual-handler + SQL controls | 50/50 |
| Confirmation SQL controls | 16/16 |
| Independent adversarial controls | 42/42 |

**123 passing assertions/cases across the five counted suites**, plus strict types.
See `SUITES.log` for named cases. The same full suite passed after relocation,
through the legacy forwarding entry, through an explicit alternate source root,
and through the npm full-suite command with forwarded root.

`PORTABILITY_RESULTS.json` records ten execution checks, all with expected outcomes:

1. Default root, invoked from unrelated `/private/tmp`, source directory contains spaces.
2. Historical entry forwards and executes all suites successfully.
3. Invalid explicit PGlite path fails with instructions, without silent fallback/skip.
4. Package guards command passes from unrelated working directory.
5. Bypass inserted only in explicitly selected alternate tree is rejected.
6. Explicit alternate tree passes all suites without mutation.
7. Deleting the alternate tree's classifier fails; no source fallback occurs.
8. Removing the literal-true confirmation gate: 42 pass / **8 expected failures**.
9. Removing only SQL expiry enforcement: 41 pass / **1 expected failure**, exact
   matching expired identity (not an identity-mismatch false positive).
10. Package full-suite command forwards the root and passes all suites.

The patch passes read-only `git apply --check` on current main. Every proposed
file was scanned for hardcoded developer paths or scratch-output imports; none.
The historical harness preservation was byte-compared against the original.
`FILES.json` binds the proposed files, including SQL fixtures and archive.

## Evidence boundaries

These are actual Node-transpiled handler executions with injected HTTP and actual
SQL in one in-memory PostgreSQL-compatible backend. They do not establish live
PostgREST commit/caching semantics, multi-backend locking/contention, Deno boot
parity, the complete migration chain, deployment state, retirement of old workers,
account-wide spend, or pricing correctness. The tested installed Supabase SDK is
not the handlers' pinned Deno SDK. CI uses Node20; that runtime was not executed
here. The new CI guard step was run locally via its package command, not on CI.

The fixture snapshots prove their own SQL behavior, not a future/live migration.
An eventual approved migration must be bound explicitly to these tests. AST
inventory remains bounded to TS/TSX/JS/MJS first-party source, excluding CJS test
harnesses, generated/native trees and dependencies; it is not a sandbox or proof
against arbitrary obfuscation. The portable test runners do not broaden production
admission policy or authorize any rollout.
