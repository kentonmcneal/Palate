# Remaining profile writes and settings — tested proposed patch

Evidence: SOURCE REVIEW + LOCAL EXECUTION ONLY. No live database, auth, storage, Edge Function, paid operation, or repository write. Proposed source and tests live under `proposed/`; apply `remaining-profile-writes.patch` from the Palate repository root. No root, username gate, observability, pricing, or worklog edits.

Reviewed starting with committed account-boundary fix `0a2c5ad`. Main advanced to `854cd8c7075755a1dfcc0ec7c1fb5eb86fc3d7c7` during this work; every existing file touched by this patch still matches its captured baseline byte-for-byte. `git apply --check` passed against that current repository. `source-manifest.json` records baseline and proposed hashes.

## Actionable findings and included fixes

1. **P1 — A's profile input can mutate B after deferred auth.** Baseline `mobile/lib/profile.ts:57,82,154,211,246`, `social.ts:104`, `friend-push.ts:36`, and `social-notifications.ts:35` choose the write target from `getUser()` after awaiting it. A initiates a write, account changes to B, auth returns B, and the code writes A's demographics, visibility, taste/quiz, social fields, preferences, or avatar to B's own row. RLS does not stop a correctly authenticated B write to B. Root unmount does not cancel the promise. Fix captures the existing account-generation token at entry, checks after auth, and pins the row to that account. A→B→A also invalidates the old operation. Neutral `account-write.ts` names reuse the existing root-maintained token without introducing another account clock.

2. **P1 — Native avatar picker survives account replacement.** Baseline `edit-profile.tsx:79` and `onboarding/profile-setup.tsx:37`: A opens the picker, root switches to B and unmounts A's screen, the picker resolves, and its retained callback starts `uploadAvatar` under B. Merely fixing the helper's default token is insufficient because that helper starts after the switch. Both screens now capture before the permission/picker awaits and pass the captured token through upload. The uploader checks after file fetch, binary read, storage upload, and profile update; storage path and row remain A-owned.

3. **P1 — Retained destructive confirmations can delete B's data/account.** Baseline `settings.tsx:142–184`: A opens the native alert; it outlives A's screen; confirming after B signs in invokes an implicit-caller history RPC or delete-account function as B. The confirmation now captures A's generation when opened and validates it before submission. New `account-settings.ts` also captures and explicitly supplies A's JWT: an account guard alone cannot control deferred SDK authorization resolution. Late A deletion success/error cannot sign out B, navigate B, or display A's error on B. Same-account confirmations still work.

4. **P1 — Privacy controls can display a more restrictive audience than the stored value.** Baseline `edit-profile.tsx:133`: optimistic `public` then `private` calls can finish server-side in reverse order, leaving UI private and database public. A lost reply followed by rollback can likewise show old/private while a public change committed. The patch serializes presses within the mounted editor using a synchronous ref; audience selection/copy is unconfirmed while saving. On failure it reads the persisted value rather than blindly rolling back. If that read fails, audience is unknown and further writes are blocked until reload. A revision prevents an older initial profile read from overwriting a newer privacy read/write.

5. **P2 — Avatar privacy promise contradicts the source contract.** Baseline `onboarding/profile-setup.tsx:164` promises photos are never shared outside friends. Migration `0167_storage_not_enumerable.sql:22–38` explicitly retains a public avatar bucket readable by URL; `0184_search_respects_blocks.sql:18` includes avatar identity in search. This is misleading consent copy, not a newly discovered backend policy bypass. The existing picker helper now says the photo is part of public identity and visible to anyone with its link. Storage/privacy policy remains unchanged.

## Exact local validation

**Jest: 5 suites, 92/92 tests passed**, using `/opt/homebrew/bin/node`, installed Jest and React renderer, and a scratch mirror containing the proposed source:

- `remaining-profile-writes.test.ts`: **52 passed**. Eight writers each tested for deferred A→B, A→B→A, sign-out, auth/account mismatch, and same-account refresh (40); avatar account replacement during file fetch, binary read, and storage upload (3); friend-push error propagation (1); both destructive helpers reject B/A→B→A/mismatched session and explicitly attach initiating JWT (8).
- `profile-settings-boundary.test.tsx`: **21 mounted tests passed**. Both actual avatar screens: picker A→B and A→B→A after actual unmount, stale permission result, current-token positive case (8). Both destructive actions: retained confirmations after A→B/A→B→A and current-account positive case (6). Old deletion success and deferred error handling (2). Privacy same-tick overlap/pending state, uncertain committed change, reconciliation failure/reload, and late initial snapshot (4). Avatar consent copy (1).
- Existing `profile-write-account.test.ts`: **8 passed**.
- Existing `root-account-boundary.test.tsx`: **4 passed**.
- Existing `username-gate.test.ts`: **7 passed**.

**Negative control:** the same 73 new tests with the original seven production files restored in the scratch mirror yielded **57 failed, 16 passed**. This count includes expected API/UI contract assertion failures, not 57 separate security findings. The new account helper modules remained in that negative-control mirror because the original source has no corresponding modules. See `baseline-red.log`.

**Installed SDK proof: 2/2 passed.** `sdk-header-proof.cjs` uses actual installed Supabase clients, synthetic A/B tokens and an injected fetch that only records calls. For both RPC and Edge invocation, the request begins with A, SDK access-token resolution waits, the account moves to B, and token resolution returns B. The recorded outgoing Authorization still names A. No network request is performed. See `sdk-header-proof.log`.

**TypeScript:** scratch mobile project `tsc --noEmit --incremental false` exited 0; project configuration excludes tests, which were executed by Jest instead. See `tsc.log` (empty on success).

**Patch validation:** `git apply --check` exited 0 against current main source. Patch contains seven modified production files, two new production helpers, and two new regression suites.

## Practical limits

- These are local source/behavior proofs. They do not establish deployed RLS, storage rules, JWT validation, native alert behavior on a device, or live endpoint behavior.
- Account generations depend on the committed root calling `setUsernameGateAccount` synchronously on auth changes. The patch intentionally reuses that single source of identity; it does not rename or modify root/gate code.
- Already submitted A operations cannot be recalled. Profile rows/storage paths are pinned to A; destructive requests explicitly retain A's authorization. A storage upload that completes after replacement can leave an A-owned orphan because the profile update is refused. No cleanup under a replacement account is attempted.
- Privacy serialization is local to a mounted editor, not a server-wide lock or a guarantee against another device/editor changing visibility. Server error reconciliation reports the latest successful read; it cannot establish ordering of arbitrarily delayed backend commits. Fully solving those broader cases requires server revision/idempotency semantics. This patch removes the concrete same-screen overlapping-write and blind-rollback defects.
- Screens are mounted via TypeScript-transpiled real source with native dependencies and service operations mocked; these are React component tests, not iOS end-to-end tests.

## Reproduction

Use the existing mobile Jest configuration with these test paths after applying the patch:

```
lib/__tests__/remaining-profile-writes.test.ts
lib/__tests__/profile-settings-boundary.test.tsx
lib/__tests__/profile-write-account.test.ts
lib/__tests__/root-account-boundary.test.tsx
lib/__tests__/username-gate.test.ts
```

The saved `jest.config.json` points to this task's scratch mirror and isolated output cache. `jest.log`, `baseline-red.log`, `sdk-header-proof.log`, `tsc.log`, and the source manifest provide the exact local evidence.
