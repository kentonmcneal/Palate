# Passive inbox display — independent review

**WORKING TREE / offline: approve with BACK_GUARD.patch.** Reviewed the final READY REPORT.md and additive PASSIVE_INBOX_DISPLAY.patch. No repository writes. Exact reviewed and corrected hashes are in HASHES.json.

## P2: retained Back can navigate another screen/session

The proposed back() checks only life.current. A callback retained across blur can still call router.back() and pop the newer route; likewise it navigates after the account clock changes but before React replaces the keyed child. Both are reproduced against the actual proposed component. The baseline screen already had an unguarded Back action; this is a remaining gap in the proposed navigation ownership guard, not a newly introduced account-data leak.

BACK_GUARD.patch additionally checks focus and exact account snapshot equality. Snapshot equality deliberately allows the current signed-out screen to go Back (isAccountWriteSession alone rejects null-account tokens). Existing one-shot/lifetime invalidation remains. The correction adds no UI behavior beyond rejecting obsolete navigation callbacks.

## Executed checks

- Original proposal: five independent mounted controls produce **2 failures, 3 passes** (DRAFT.log). Both failures are the stale Back cases above.
- Corrected proposal combined with Darwin sync: **76/76 tests, six suites pass**, exit0 (FINAL.log): 22 author mounted, 10 result-reader, 39 existing storage/concurrency regressions and 5 independent mounted controls.
- Independent passing controls additionally prove current signed-out Back works, unavailable→empty retry produces verified-empty copy, and an old rejected read cannot release the newer request lock and admit a duplicate read.
- Actual installed React/react-test-renderer19.2.3 mounts the production native screen component. Native host primitives, focus/router, account invalidation notification and display read boundary are mocked; this is not physical native UI/device evidence. Strict-reader suites separately execute actual storage/queue code with mocked AsyncStorage.
- The final READY screen/tests are byte-identical to the tested author copy, apart from the supplied one-line Back correction. Combined passive-confirm includes Darwin guarded read/restore and the display result wrapper. No replacing shared-file snapshots is proposed.

DURABLE_TESTS.patch contains the five independent cases and test boundary setup, for integration at mobile/lib/__tests__/passive-inbox-display-independent.test.tsx. Harness setup is adapted from the author; scenarios/assertions are independent. No installation, real network, auth, native notification or paid operation was used. The author's typecheck and mutation runs were inspected, not independently rerun; no full-app verification claim.

## Other reviewed behavior

Only ready plus empty entries renders Nothing to confirm. Loading and unavailable stay distinct, with generic retry copy. Cached rows remain visible but disabled and their retained callbacks lose verified membership as soon as reload begins. Duplicate reload admission happens synchronously before the await. Per-request ticket and layout lifetime prevent stale success/error/finally effects. Focus refreshes on return; blur invalidates prior work. Account-generation keyed sessions clear old React state; same-account invalidation retains it. Source inspection confirms RootLayout advances the clock before personal-signal invalidation for auth events.

The additive result wrapper catches existing strict read/expiry persistence failures; legacy getInbox fallback remains unchanged. No broad parser rewrite or persistence behavior change is added. Existing serialized read/revision controls pass in combination with the approved sync patch.

## Limits and coordination

Global ownerless storage remains unresolved: a new B read may return old ownerless bytes. UI generation guards establish request ownership, not capture ownership. Strict reader expiry effects are still existing shared side effects; this display wrapper neither cancels nor account-binds them. Already-started storage work can complete. Cached freshness is checked on focus/refresh, not continuously. Actual native navigation timing, accessibility/layout and physical device behavior were not exercised.

No direct Mendel agent messaging tool was available; the shared COORDINATION.md records the finding and proposed correction. Final report was reread after it arrived; no approval was issued against an unfinished packet. Main should apply the author patch additively, then BACK_GUARD.patch and optionally DURABLE_TESTS.patch; preserve integrated Darwin hunks.
