# Independent durable LLM admission test review — 2026-09-29

**WORKING TREE / offline RUN: approve the completed author proposal for integration, with the reviewed one-line `.next` exclusion supplied as an additive tooling correction. No blocking production defect found.** Reread the final author REPORT.md and verified its hash, patch hash and all seven production integration hashes are unchanged from the executed review. REPORT.md is the completed author artifact; my earlier filename-specific hold and attribution to a user requirement were mistaken and are withdrawn.

## Scope and identity

Reviewed the 16-file LLM_ADMISSION_DURABLE_TESTS.patch, REPORT.md, README, all six suite entry points, aggregate and legacy entry points, harness/runtime, workflow/package changes and both SQL fixtures. Applied the patch only to a scratch copy of current Palate at df7a268 with main's uncommitted admission integration. No production source was overlaid from the author's older copy.

All seven current production integration files match both the author's SOURCE_IDENTITY.json and the original independently reviewed integration SOURCE_HASHES.json byte-for-byte. All 16 patched files match the author FILES.json. CAPTURE.json and FINAL_IDENTITY.json bind the reviewed versions. Source was rechecked after all scratch mutations were restored.

Both bundled SQL fixtures match all three canonical sources byte-for-byte: the integration artifact, independent integration review artifact, and current main docs/codex-handoff copies:

- Reservation draft: cc0ec83604ecdaa085e4153f58347b1ff6dc64b4d02322f8aa2c31604cd9387f
- Confirmation draft: 93b4ecb36733ec0e9275880774b0dddd071647c6ad35ac92886618e680363d5a
- Preserved legacy harness: 1a38e0a2e4ee2f7516dbeed94f426420988bea0e88bde9b1bae6c0d11419d1d6, identical to the current repository original.

IDENTITY.json records the comparisons. Fixtures remain unnumbered test snapshots outside migrations; no positive production policy is added.

## Actual test behavior

The shared runtime selects one complete root using its positional argument or its own installed path. createRequire resolves TypeScript and the Supabase SDK through that root's mobile/package.json. PGlite is loaded from the explicit PGLITE_MODULE path, or through the selected root only when no explicit path is supplied. An invalid explicit path fails rather than falling back, installing, or skipping SQL cases.

The handler harness reads and transpiles the actual selected Edge handlers, adapter, admission helper and classifier dependencies. It exposes two internal proxy functions for direct coverage and also exercises actual authenticated details, blurb and cron entry handlers. Installed Supabase SDK requests use an injected transport; VM fetch calls use synthetic model/database responses. Deno environment values are synthetic. Unexpected imports/hosts throw, Google is stubbed, and no credential file is loaded. Operator tests evaluate the actual disabled top-level/callback paths and assert zero provider calls/client construction.

The aggregate uses process.execPath and a shell-free argument array, forwards the selected source root and environment, preflights PGlite, and propagates nonzero child status or signal termination. The legacy entry forwards to this aggregate. The former SDK-era suite is retained as an archive, not misrepresented as having executed against the new adapter. A green full suite represents the new 123-case set, not the old 93 cases plus 123.

The workflow adds only the three source/operator/type guards after the existing dependency-install step. It adds no installation or SQL provisioning step. Full PGlite coverage remains an explicit local command. No package dependency or lockfile changes were introduced.

## Independent RUN evidence

All runs used existing Node26.8.2, TypeScript6.0.3, Supabase SDK2.110.7 and PGlite0.5.8. PGLITE_MODULE was explicitly:

`/Users/kentonmcneal/Documents/Codex/2026-09-27/how-x20/work/pglite/node_modules/@electric-sql/pglite`

| Suite | Reproduced result |
| --- | --- |
| AST/source guards |13 passing controls, five synthetic AST bypass patterns |
| Actual disabled operator/eval entries |2 passing; zero provider calls/client construction |
| Focused adapter/classifier types |0 diagnostics |
| Actual-handler/SQL suite |50 passing |
| Confirmation SQL suite |16 passing |
| Independent adversarial handler/SQL suite |42 passing |
| Total counted cases |123 passing |

SUITES.log records the initial rerun. FULL_NETWORK_DENIED.log records a second full run with a separate preload that refuses real fetch, HTTP/HTTPS requests, TCP connection and TLS connection entry points. Synthetic VM transports remain available. This is supplemental offline enforcement, not an arbitrary-code sandbox. The legacy forwarding entry also passes all suites with this preload.

Fifteen independent execution/portability cases are recorded in INDEPENDENT_RESULTS.json and PORTABILITY.json:

1. Full suite from unrelated /private/tmp, source path containing spaces, explicit PGlite and real-network denial: exit0.
2. Missing explicit PGlite: exit1 before any aggregate success, with no install/skip.
3. Legacy forwarding entry: exit0 with full-suite success.
4. Missing selected production classifier: exit1.
5. Child exits7: aggregate exits7, no aggregate success.
6. Child receives SIGTERM: aggregate exits1, no aggregate success.
7. Remove the adapter's literal-true confirmation gate: aggregate exits1.
8. Run handlers on that same mutation:42 pass/8 expected failures, including rollback and malformed confirmation replies.
9. Remove only SQL expiry enforcement:41 pass/1 expected failure, the exact-matching expired-identity case.
10. Inject a direct provider endpoint into the selected source: exit1 identifies that source file.
11. Invoke original runner with a separate alternate source root: full suite passes.
12. Delete classifier only in the alternate root: exit1, no fallback to the intact runner root.
13. Remove alternate root's mobile dependencies: exit1, no fallback to the runner's installed dependencies.
14. Run package guards from unrelated CWD via --prefix: exit0.
15. Run package full suite with forwarded alternate root: exit0.

All destructive negative-control mutations were confined to our scratch files and restored. The original16proposal files match the author manifest; the final scratch guard now additionally contains the reviewed `.next` exclusion, separately hashed in FINAL_IDENTITY.json. Supplied independent.py and portability.py record the reproduction logic; they assume the existing scratch layout and dependencies and do not install anything.

## Additive generated-directory correction

The author reports597first-party files. Our clean source copy scans508. A read-only comparison identifies the89difference as generated landing/.next files; the current guard does not exclude .next even though it excludes dist/build and several other generated paths. Thus597is a count of scanned files, not exclusively first-party source. The production source coverage is unchanged. EXCLUDE_NEXT.patch adds `.next` to the existing directory-exclusion list; it changes only the bypass test runner, with no landing edits.

Independent execution places a synthetic vendor endpoint under a scratch `synthetic-build/.next/` directory: the original guard fails, the corrected guard passes13/13, and the same endpoint placed in an ordinary production-source directory still fails. After removing both synthetic files, the final combined suite passes123cases plus focused types. NEXT_RESULTS.json and FINAL_COMBINED_SUITES.log record this additional validation. The final source scan is508files. This corrects generated-artifact false positives without changing admission behavior or expanding the AST guard's stated security scope.

## Remaining limits

- PGlite provides one backend. These runs do not establish multi-session lock contention, real PostgREST transaction/caching behavior, deployed ownership/ACLs, or migration-chain compatibility.
- Node-transpiled handlers plus installed Supabase2.110.7 do not establish pinned Deno/Supabase2.45.0 boot parity. CI's Node20 was not run here, nor was the workflow executed on GitHub.
- SQL snapshots match today; a future approved migration must be explicitly bound to these tests. Present tests do not automatically compare a future migration to fixture bytes.
- The test set retains the independent expiry negative control but is not the separate original32/40design proof suites. It does not freshly prove pricing bounds or every SQL policy/settlement edge case.
- AST checks are bounded to the listed first-party code extensions and recognizable patterns; they do not certify arbitrary obfuscation, dependencies, old deployments, all credentials or provider invoices.
- Positive fixture policy rows exist only in fresh in-memory databases. No cap, paid call, schema rollout or deployment is authorized by these results.

No repository writes, installs, real API calls, credentials, live SQL or deployment occurred. The only additive patch is EXCLUDE_NEXT.patch; apply it after the author patch. Final signoff is bounded to these exact files and offline evidence, not deployment, schema rollout, paid-policy activation or an account-wide spending guarantee.
