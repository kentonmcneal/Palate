# Passive rating initiating-account guard — READY for independent review

WORKING TREE / scratch-only author proposal. RATE_VISIT_ACCOUNT.patch changes rateVisit in mobile/lib/visits.ts and adds a mounted regression plus portable offline helper/SDK controls. No repository edits, credentials, external calls, schema changes, installs, deployment or paid operations. Read-only patch application check passes on current main. HASHES.json binds the baseline/candidate and unchanged account/digest dependencies.

## Confirmed defect and bounded fix

The original rateVisit builds an update filtered only by visit ID, using SDK-selected authorization at dispatch. It neither captures/verifies the initiating account nor rejects a stale response before invalidating personal signal. The digest screen guards its call boundary, but cannot guard the awaits inside a helper already entered.

The correction follows existing saveVisit/account-write contracts:

1. Capture accountWriteSession before any await.
2. Verify its authenticated user via requireAccountWriteUser; obtain the matching initiating authorization via accountWriteAuthorization; reassert generation before query construction.
3. Update the requested visit using both id and existing user_id filters, with the explicit initiating Authorization header.
4. Reassert account generation after the awaited response, before accepting errors or invalidating personal signal.

A→B, A→B→A and signed-out transitions are distinct. A request already sent with A's authorization cannot be unsent; its stale completion rejects without invalidating B's cache. No claim of durable cancellation or protection from a newly invoked stale caller under a fresh account is made. Server RLS remains necessary. Baseline evidence establishes wrong-session dispatch/stale invalidation, not a demonstrated server authorization bypass.

## Executed controls

HELPER.log: **14/14 pass** using actual visits/account-write/username-gate source and installed @supabase/supabase-js **2.110.7**, with synthetic auth results and injected fetch only. The real SDK dispatches A's explicit header even when its access-token provider returns synthetic B. Request assertions cover PATCH, owner/visit filters and exact rating body. Deferred getUser/getSession controls reject B/ABA/null before dispatch; signed-out/mismatched identity controls reject; delayed HTTP completion rejects after account replacement. Ordinary server errors, legacy missing-column tolerance and zero-row-unknown response semantics are also tested.

BASELINE.log: the same helper controls on original source give **11 failures / 3 passes**. These are overlapping controls for the ownership defect, not eleven separate bugs.

MOUNTED.log: **52/52 tests across four suites pass**, including four new actual digest→actual rateVisit cases, existing digest-screen safety/independent controls and confirmDigest controls. React/react-test-renderer19.2.3 is Palate's installed matching runtime. New mounted cases verify owner-bound rating and normal completion, then B/ABA/null while rating is pending: no stale invalidation, next entry, removal, decision or haptic. The screen, confirmDigest, rating implementation and account helpers are real copied source; auth/query transport, focus/navigation, storage and other visit dependencies are controlled boundaries. No React Native device claim.

MOUNTED_BASELINE.log: original rateVisit fails all four new mounted controls. TYPES.log: copied mobile app no-emit TypeScript exits0. Source restored to the corrected candidate after the negative run. No full app-suite/build claim.

## Resolution semantics deliberately unchanged

- The missing-column message tolerance remains. A response reporting `column overall_rating does not exist` still resolves void for the current account and invalidates personal signal. It does NOT establish a stored rating. The existing regex is broad and the compatibility behavior is not redesigned here.
- No returned rows or affected-row count are requested. A successful 204 can mean zero matched/authorized rows. Resolving void is not a durability/row-existence acknowledgement. This patch does not add select/count dependencies or assume deployed policy/schema changes.
- Ordinary reported errors reject, with no invalidation. A stale account rejects before accepting even an otherwise successful/tolerated response.
- confirmDigest swallows optional rating failure to preserve the already-saved visit. Its screen cache records completion of a helper call; it is not proof of durable rating. No new saved-rating UI claim is introduced.
- Token verification adds the same authentication lookups used by the existing write contract. A transient auth failure can now reject the optional rating while leaving the diary visit intact. No live auth validation was performed.

## Integration and commands

Main/independent reviewer should review the bounded correction before applying RATE_VISIT_ACCOUNT.patch. Only rateVisit changes in the existing source file; all other visit logic remains byte-identical. There are no package/config changes.

From mobile after applying:

    node scripts/rate-visit-account-controls.cjs .
    node node_modules/jest/bin/jest.js --runInBand --watchman=false lib/__tests__/digest-rating-account.test.tsx lib/__tests__/digest-screen-safety.test.tsx lib/__tests__/digest-screen-independent.test.tsx lib/__tests__/digest-confirm.test.ts
    node node_modules/typescript/bin/tsc --noEmit

Before applying, the portable helper runner also accepts a second argument for a copied visits.ts override. Existing dependencies only. All tokens/URLs in that harness are synthetic and every SDK HTTP request goes to its injected responder. There is no live database/RLS, native lifecycle, notification, or device proof.
