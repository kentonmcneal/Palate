# Durable visit-write controls

**WORKING TREE / offline execution:** observed HEAD `06bd5f3`, with main's visit implementation and existing test changes uncommitted. No repository writes. Independent integration review remains with main.

`VISIT_WRITE_DURABLE.patch` adds only:

- `mobile/scripts/visit-write-account.test.cjs`
- `mobile/scripts/visit-write-account.README.md`

Run from repository root: `node --test mobile/scripts/visit-write-account.test.cjs`.

The runner resolves actual `mobile/lib` and installed `mobile/node_modules` from its own directory. It has no absolute paths, environment source overrides, or embedded production snapshots. The original 54 test bodies/assertions are retained; changes are dependency/source resolution, a five-second per-test timeout, a fallback fetch prohibition, and comments. Node runtime supplies Response/Headers; installed SDK and TypeScript are reused. No installation/network/environment-secret reads occur.

For the positive execution, the scratch mobile directory's `lib` and `node_modules` are read-only symlinks into the actual repository. Thus ACTUAL_REPO.log exercises current source rather than a copied production snapshot. HASHES.json identifies that source. The runner itself remains scratch-only. Actual package.json Jest patterns were checked using installed micromatch; they do not discover this scripts/*.cjs runner. No Jest/package configuration change is proposed.

| Evidence | Pass | Fail |
|---|---:|---:|
| Durable runner / actual repo source | 54 | 0 |
| Durable runner / original pre-fix source | 19 | 35 |
| Remove explicit Authorization | 49 | 5 |
| Compare account ID without generation identity | 42 | 12 |
| Remove visits continuation assertions | 40 | 14 |

All runs completed with zero cancelled tests. Mutations and baseline replay ran in separate scratch directories; they never changed repository files. All failure counts match the original packet. The original `outputs/visit-write-account-safety` evidence is preserved unchanged, and this packet contains fresh run logs. Patch apply-check passed against the repository.

The controls execute real installed Supabase/PostgREST transport code with injected synthetic fetch, mocked auth/restaurant/native boundaries and real source modules. They do not validate production RLS or device behavior. No new safety claim: old ownerless payloads first invoked under B, caller steps before these functions, and already-committed A requests remain the documented limits.
