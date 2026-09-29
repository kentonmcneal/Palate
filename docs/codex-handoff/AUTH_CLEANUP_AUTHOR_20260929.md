# R1 implementation: coordinated session cleanup

Evidence: PROPOSED SOURCE + LOCAL EXECUTION, 2026-09-29. No repository edits, service calls, secrets, dependency installs, observability changes, or deployment.

## Apply order

1. Darwin's original `palate-remaining-writes/remaining-profile-writes.patch`.
2. This directory's **auth-cleanup-additive.patch**. Do not land the original account-deletion completion claim alone.
3. Independently, `../palate-delete-pagination/delete-pagination.patch` fixes the separate endpoint bug. It has no dependency on either mobile patch.

The additive patch changes six paths: `mobile/lib/auth.ts`, new `mobile/lib/auth-transition.ts`, `mobile/app/settings.tsx`, `mobile/app/waitlist.tsx`, the proposed `mobile/lib/__tests__/profile-settings-boundary.test.tsx` mock, and new `scripts/test-auth-transitions.cjs`. Eight writer/picker/privacy changes remain intact. Baselines, proposed files, and SHA-256 manifest accompany the patch. Both patches passed `git apply --check` against isolated captured baselines.

## Architecture and correctness argument

A single promise queue wraps every current application credential submission and logout, holding its slot until the public SDK operation finishes, including storage writes and auth notifications. Failed operations release the queue without swallowing their error. There is no SDK monkey-patch, direct storage deletion, private API, or assumed SDK lock.

Deletion passes its original generation token to `signOutForAccount(token)`. Inside the queue this checks the generation **before reading the session**, awaits public `getSession`, checks both generation and session user ID again, then awaits the complete public signOut. If a replacement is already queued ahead, it finishes first and the generation rejects cleanup. If cleanup is first, replacement credentials cannot be submitted until removal and notifications finish. The remaining signed-out navigation check avoids navigating an already established B session. Ordinary sign-out shares this queue; its two screen callers check current signed-out state before navigation and handle SDK errors.

The queue covers cleanup only after the delete response, not the server deletion request itself. A sign-in during server deletion remains possible; the existing stale completion guard then skips cleanup. Explicit A authorization on the destructive request is retained.

## Actual replacement-path inventory (source-reviewed)

- **Email:** `app/sign-in.tsx` calls `verifyEmailCode`; `lib/auth.ts` submits `verifyOtp` inside the queue. `sendMagicLink`'s `signInWithOtp` is also queued, though its email-send flow does not establish a session.
- **Google:** native/browser provider response yields an ID token, then the screen calls `signInWithGoogleIdToken`; SDK `signInWithIdToken` is queued. The provider prompt stays outside the queue.
- **Apple:** native prompt and nonce creation precede `signInWithAppleIdToken`; SDK credential submission is queued.
- **Deep links/callback:** Google uses `WebBrowser.maybeCompleteAuthSession` and the hook response above. `finishSignIn` parses referral query data only. There is **no implemented auth-callback route**, `setSession`, or `exchangeCodeForSession` call in current mobile source; the email helper's `/auth-callback` URL does not itself implement token ingestion. `detectSessionInUrl: false` prevents SDK URL auto-ingestion. This patch does not invent or repair a magic-link callback flow.
- **Startup restoration:** the single client initializes itself. Credential submissions await public getSession before replacing a session; the SDK's getSession awaits initialization. Root's restore read is guarded by authRevision and does not write SDK credentials.
- **Auth notifications:** root updates the generation synchronously. Root, CaptureWarning, and people subscribers do not await queued auth transitions. No recursive queue entry is introduced.
- **Refresh:** existing SDK-managed refresh remains outside the application queue. Installed 2.110.7 has refresh commit checks; an executed delayed-A-refresh control confirms it cannot restore A after cleanup and B establishment in that schedule. This is not a claim to solve every SDK-internal refresh/storage race.
- **Other entry points:** repository mobile-source searches found one createClient and no other direct credential replacement calls outside lib/auth.ts. Settings and waitlist are the ordinary logout callers. Future callback, setSession, or sign-in paths must join this same queue.

## Executed controls

- **17/17 real installed SDK controls pass**, `auth-tests.log`: OTP/Google/Apple each tested with replacement queued before cleanup, during pre-logout session read, during logout response wait, and during asynchronous storage removal (12); failed credential recovery, A→B→A invalidation, ordinary logout ordering, failed logout recovery, and in-flight old refresh (5). Uses actual proposed helpers with installed Supabase 2.110.7, in-memory storage and injected fetch only.
- **Negative control:** bypass only the queue while retaining checks/helpers/tests: **13 fail / 4 pass**, `negative-control.log`. Thus the important controls depend on serialization, not just the extra generation check.
- **Existing combined tests: 5 suites / 92 pass**, `jest.log`. The mounted test mock now exports signOutForAccount; actual await-window proof is provided by the real SDK controls above.
- **Mobile tsc --noEmit --incremental false: exit 0**, `tsc.log` (empty on success). Scratch tree includes original proposal plus this correction; no reinstall.

After integration, run the Node controls from repository root with `/opt/homebrew/bin/node --test scripts/test-auth-transitions.cjs`, and the existing five Jest suites. The script defaults to the repo's installed mobile dependencies; PALATE_TEST_ROOT/PALATE_MODULES are optional scratch overrides.

## Limits and integration notes

This is a single-JS-process mobile coordinator, not a cross-tab or multi-process lock. A future direct SDK session replacement would bypass it; preserve the auth helper boundary. An unresolved SDK operation holds the queue; deliberately do not release on an arbitrary timer while that operation can still clear/write storage. No native device, real credential provider, or deployed backend was exercised. The queue does not fix unrelated late post-sign-in referral/navigation continuations.

Privacy reconciliation still reports a snapshot and cannot establish ordering against a delayed backend commit. Friend-push overlap remains the separate P2 from the independent review. Endpoint erasure completeness beyond flat pagination/list-error handling remains separate. No broader privacy or deletion guarantee is made.
