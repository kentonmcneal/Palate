# R2 profile notification preference races — 2026-09-29

**WORKING TREE / copied-source implementation and local execution:** `profile-push-preferences.patch` fixes the three profile-backed notification controls in Settings. It is additive to main's current remaining-writes + auth-cleanup implementation. All six existing/new patch paths matched the captured repository baseline at final comparison. No repository files, live services, permissions, dependencies, flags or records were changed.

## Behavior

**WORKING TREE:** Activity, Likes and Comments each have an independent synchronous operation gate and a disabled switch while saving. A repeated native callback before React commits cannot submit another write. Different preferences can proceed independently because each writer changes only its own column. No optimistic inversion or `!v` rollback remains.

**WORKING TREE:** initial values are unknown. Loading/error states do not render an On/Off switch, so neither a default true nor a default false is presented as saved state. Failed reads show “Unknown” and an explicit Retry action. Retry clears the displayed value while reading, rejects duplicate callbacks synchronously, and does not resubmit a mutation. Accessibility values preserve Loading/Unknown through the existing row label wrapper.

**WORKING TREE:** after either successful or failed UPDATE, the control reads back its field. Successful UPDATE without returned row/count is not treated as persistence proof. A mismatched readback, write error or failed reconciliation does not guess the saved value. A successful reconciliation displays the returned snapshot and explicitly says the earlier change may still finish; Retry remains available. That uncertainty is retained for the mounted control, including after further reads.

**WORKING TREE:** every read/write carries the initiating account-generation token. Completions check both mount lifetime and that generation. Account notifications cause the three controls to remount under the new generation, discarding old displayed values; A's pending read cannot overwrite B's newer mutation. Retained callbacks after unmount/account replacement cannot submit work or start reconciliation. Initial loading cannot race a same-control mutation because no switch is offered until its read completes. A revision check also rejects completions from invalidated effect lifetimes.

## Strict readers and compatibility

**WORKING TREE:** added `readFriendActivityPushEnabled(token)` and `readSocialPushPref(which, token)`. They execute the existing initiating-account authorization helper, query the explicit profile ID, check generation after the await, reject returned errors/missing or mismatched rows, and require an actual boolean column. False remains false; null/missing/non-boolean is unknown/error.

Existing `isFriendActivityPushEnabled()` and `getSocialPushPrefs()` retain their previous best-effort behavior for other consumers. Comments now identify those functions as unsuitable for authoritative settings state. Existing preference writers are unchanged, including their account targeting. No package/auth/client/schema changes are needed.

**WORKING TREE source basis for corrected comments:** `push_social_activity` is a receive preference, default true in migration 0057; 0170 replaces the retired `push_friend_activity` usage, and 0171 separates sender visibility. Follow/message receive paths use the social-activity field in 0129/0130. `push_post_likes` and `push_post_comments` are separate default-true receive preferences in 0148. Removed the contradictory claim that friend activity's switch broadcasts the recipient's movements or still uses the retired default-false column. Settings copy distinguishes receipt preferences from profile visibility and avoids guaranteeing queued-push cancellation or delivery. This is repository SQL evidence, not inspection of deployed flags or notification delivery.

## Scope and preservation

Changed paths in the output patch only:

1. `mobile/app/settings.tsx` — notification state/controls and small local preference components; existing notification controls outside these three are unchanged.
2. `mobile/lib/friend-push.ts` — strict read and accurate comments.
3. `mobile/lib/social-notifications.ts` — strict read and accurate comments.
4. `mobile/lib/__tests__/profile-settings-boundary.test.tsx` — adds the auth-subscription stub required by the real settings component; existing assertions remain.
5. New `mobile/lib/__tests__/push-preferences-mounted.test.tsx`.
6. New `mobile/lib/__tests__/push-preferences-readers.test.ts`.

**WORKING TREE / local check:** deleteHistory, deleteAccount and ordinary Sign out handler bodies are byte-identical to the captured auth-cleanup baseline. `signOutForAccount(token)` and replacement-account navigation checks remain intact. Auth queue, account-write helpers, visibility UI, other screens and server functions are untouched. Complete changed copies are in `source/`; hashes are in `MANIFEST.json`.

## Validation

**WORKING TREE / local execution: 133 tests pass in four suites; scratch mobile TypeScript check passes.** Breakdown:

- **32 mounted preference cases:** all three controls cover initial unknown→actual false; attempted two-direction overlap; duplicate identical callbacks; two failed writes separated by reconciliation (the attempted overlap is rejected); initial read failure and retry reset; failed mutation + failed reconciliation; zero-row-shaped success with contrary readback; delayed A initial read versus newer B mutation; pending/retained callbacks after unmount; same-mounted-screen account replacement. Additional cases cover signed-out reset/next-account reload and concurrent operations on different preferences.
- **28 real-helper cases:** actual copied reader and account-generation modules execute against synthetic Supabase query/auth results. Verify exact column/account targeting, false preservation, returned error, missing row, wrong identity, null/missing/non-boolean field, account replacement during query, mismatched authentication before query, and compatibility of legacy fallbacks.
- **73 existing settings/account-writer cases:** pass without weakening assertions.

**WORKING TREE / negative controls:** original three production files with the new mounted tests produce **32 failures / 0 passes**. The tests' legacy-helper mocks let the old screen run; failures expose its defaults, missing recovery/readback and overlap/lifetime behavior, not missing new production APIs. Separately removing the proposed synchronous pending/phase checks makes **all three duplicate-identical-callback cases fail** (29 unrelated cases skipped). Restored proposed source afterward.

Logs: `TESTS.log`, `TYPECHECK.log` (empty on success), `BASELINE_MOUNTED_NEGATIVE.log`, `SYNCHRONOUS_GATE_NEGATIVE.log`. Patch apply-check passes against captured baseline. Tests use the installed matching React/react-test-renderer 19.2.3 pair and real component hooks/effects; native widgets, router and services are mocked. Helper tests execute application helpers, not a real backend/SDK request. No credentials, push delivery or paid endpoints were used.

## Limits

**INFERENCE / unverified:** physical Switch behavior, VoiceOver output, backend RLS, actual notification delivery and on-device persistence. No device/build claim is made.

**WORKING TREE:** a read after an ambiguous write failure is a snapshot, not a final ordering guarantee. An earlier request can commit later; other devices/editors can also change the field. Client serialization protects these controls' overlapping submissions, not database-wide ordering. The warning deliberately remains visible rather than treating a retry or timeout as proof. Strong final-state guarantees require server operation/version ordering, outside this scope.

**WORKING TREE:** a zero-row UPDATE cannot be distinguished from “requested value was already present” when readback matches; the UI displays the observed field, not a claim about rows affected. Initial/read failure leaves no actionable toggle until a successful read. Read retries never replay writes. No profile reset or server reconciliation loop was added.

## Reproduction

Apply to a copied mobile source tree with installed dependencies, then run:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js --runInBand --runTestsByPath lib/__tests__/push-preferences-mounted.test.tsx lib/__tests__/push-preferences-readers.test.ts lib/__tests__/profile-settings-boundary.test.tsx lib/__tests__/remaining-profile-writes.test.ts
/opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The supplied workspace `jest.config.json` reproduces the local mirror run. Main should independently review the patch and run its usual integration checks before committing.
