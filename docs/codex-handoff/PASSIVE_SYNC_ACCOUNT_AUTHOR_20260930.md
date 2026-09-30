# Initiating-account passive sync — READY for independent review

**WORKING TREE / offline author proposal.** PASSIVE_SYNC_ACCOUNT.patch changes passive-inbox-sync.ts, the restore/read guard in passive-confirm.ts, three existing test setups/assertions and a new portable node:test runner. Source still matched main at packaging (`b6a2c62ecc19d3cd57a5b5b603862f2b492eb972`); read-only git apply --check passed. Hashes in HASHES.json. Apply additive patch only, not snapshots.

## Contract and API

`mirrorInbox(entries)` captures the existing account-generation token immediately on invocation. It validates getUser and getSession through account-write.ts, then uses the initiating user_id and explicit Authorization header for upsert, empty-inbox delete and prune. Checks after responses prevent stale upsert completion from initiating prune. Failed upsert responses also stop prune. Best-effort void/error swallowing remains the public contract; no success acknowledgement is invented.

`hydrateInboxIfEmpty(localCount, token = accountWriteSession())` accepts an optional caller-captured token. Existing direct callers still capture at invocation; restore passes the token captured before its first queue wait. The read pins Authorization and user_id and returns null for stale/error/missing credentials, including A→B→A. Same-account refresh preserves the generation and remains valid. The token is neither a credential nor a capture-owner field.

`restoreInboxFromServer()` checks before work, inside/after queued reads, after hydration, immediately before local commit, after its awaited write, after queue completion and before returning a success count. Its guarded read also checks after getItem and after expiry persistence before launching an expiry mirror. Existing revision/emptiness validation and serialization remain intact. There is no new auth subscription, account clock, local storage namespace or owner migration.

## Executed evidence

Actual installed **@supabase/supabase-js2.110.7** and PostgREST/fetch wrapper with injected synthetic transport; actual account-write/username-gate, sync and restore code. Auth responses and local AsyncStorage are mocks. Global network fetch throws; no real backend/auth/notification operation occurs.

- **47/47 controls pass**, zero cancelled/skipped. Mirror/empty-delete/hydration getUser and getSession races under B, ABA and sign-out; deferred SDK token acquisition; upsert/read response races; same-account refresh; missing/mismatched/error credentials; upsert-error no-prune; payload whitelist; restore waits before read/after hydration/inside commit read; commit queued behind another read; already-started write and signed-out admission.
- Actual SDK pinning tested on each request family, including prune's own deferred SDK access-token lookup. Requests already handed to the SDK can still dispatch, but tested headers remain **Bearer token-A**, with initiating user_id A. Late hydration results are discarded and no later prune begins after invalidation.
- **No-header mutation:4 failures**, explicitly observing token-B in synthetic transport. **No queued-commit guard mutation:3 failures**. **Baseline selected races:18 failures**, zero cancelled; subsets were selected to avoid waiting for stages absent from baseline. Mutation logs contain intentional negative evidence.
- Existing passive regression suites: **316/316 pass,21 suites**. Three test fixtures now establish `test-owner` before testing storage, and two hydrate assertions include the caller token. All storage failure/concurrency assertions retained.
- Focused strict TypeScript for source/imports and all three adjusted test files: **pass, exit0**. No full app suite/build claim.

The new runner is proposed at `mobile/scripts/passive-sync-account.test.cjs`, outside Jest discovery. From mobile after applying:

```sh
/opt/homebrew/bin/node --test scripts/passive-sync-account.test.cjs
```

For the output packet before integration:

```sh
PALATE_MOBILE='/Users/kentonmcneal/Claude Code/Palate/mobile' /opt/homebrew/bin/node --test outputs/passive-sync-account/controls.cjs
```

SOURCE_ROOT optionally supplies a copied lib source root. The durable runner defaults to repository-relative mobile dependencies/source; no installation or absolute developer path is required in the proposed repo script.

## Explicit unresolved boundaries

1. **Ownerless capture/global inbox is not fixed.** These checks protect the account present when the operation begins. Old A data first passed into mirrorInbox while B is current is still ownerless input; this patch cannot establish its capture owner. Likewise mirror calls launched later from existing global queued mutations start in that later context. No field is added that silently labels existing records as owned. No adoption/quarantine migration is performed; separate coordinated capture-owner containment remains required.
2. **Already-sent A requests may commit after switching.** Pinning prevents tested credential substitution; it does not cancel A's in-flight write or retract its effects. Same-account token refresh keeps the originally captured Authorization; token expiry may make a request fail best-effort rather than switching credentials.
3. **Already-started local storage write can land after switching.** One control explicitly pauses setItem, changes account, then allows the global write to finish. It lands, but restore returns0 and suppresses its subsequent reporting/schedule call. This is not rollback or complete local isolation; owner-scoped storage is needed.
4. **Queued/in-progress scheduling and telemetry are not account-bound by this patch.** Restore checks before starting them and after scheduling returns, but an already-queued scheduler/started analytics operation cannot be recalled here. Existing global inbox consumers/OS notifications remain outside this security layer.
5. **Mirror ordering, multi-device conflicts, legacy server provenance and durable tombstones remain unresolved.** A later fresh restore or restart can still accept a stale mirror; existing revision guard protects only in-flight local-update races. Existing user_id/RLS association does not prove capture-time origin.
6. No live RLS/JWT enforcement, production configuration, native capture, physical device, cold auth restore or real notification behavior was invoked. SDK transport evidence is synthetic and version-specific.

No repo/ledger/worklog edits, permissions, installs, paid operations or deployments. Supabase skill guidance was applied to the credential/request boundary using installed code and mocked transport; no service verification is claimed. Independent review is required before integration.
