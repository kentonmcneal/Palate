# Independent auth-cleanup review — 2026-09-29

**WORKING TREE / local execution: no additional blocking R1 defect found in the supplied additive patch.** The queue protects replacement B during every tested cleanup await window, including SDK storage removal and subscriber completion. Recommend retaining the queue and its public-helper boundary. This is bounded evidence for current application replacement paths, not a cross-process auth guarantee.

## Baseline and apply order

**WORKING TREE:** reviewed `remaining-profile-writes.patch` followed by `auth-cleanup-additive.patch`, applied in that order in an isolated captured-baseline mirror. The live repository changed while being read and already contained some integration changes, so applying both patches directly to a fresh current-source copy initially failed. Restored only scratch files from the supplied captured baselines, applied both patches successfully, and ran that exact combined proposal. No repository changes or permissions were requested. Input patch hashes are in `REVIEW_INPUTS.json`.

## R1 correctness

**WORKING TREE / local execution:** deletion keeps the original account token and initiating Authorization header. Cleanup checks that token before entering the SDK session read and again after the read, then holds the queue until public `signOut()` finishes. If B is queued first, B's persistence and notification finish before stale A cleanup evaluates. If cleanup is first, B cannot submit credentials while A removal/notification is pending. A→B→A invalidates the retained token. Settings' navigation checks current signed-out state after cleanup.

**WORKING TREE:** the queue uses ordinary promises and public SDK methods only. There is no private lock access, SDK monkey-patching, private storage-key deletion or direct mutation of an SDK session. Rejection releases subsequent queue work without disguising the originating helper's error. A permanently unresolved SDK operation can hold the queue; releasing it on an arbitrary timeout would recreate the race.

## Current replacement-path inventory

**WORKING TREE source inspection:** one `createClient` in `mobile/lib/supabase.ts`; credential calls occur in `mobile/lib/auth.ts`:

- `sendMagicLink` → queued `signInWithOtp` (sends email; does not itself establish the usual session).
- `verifyEmailCode` → queued `verifyOtp`.
- Google/Apple → queued `signInWithIdToken`; provider UI remains outside the queue.
- Settings and waitlist logout → shared queued `signOut`; account-deletion cleanup → `signOutForAccount` with initiating generation.

**WORKING TREE:** no implemented `setSession`, `exchangeCodeForSession`, password/anonymous/OAuth credential submission, identity-link call, or second application Supabase client was found. Google browser completion hands its token to the existing queued helper. `finishSignIn` handles post-auth routing/referral work, not SDK credentials. `detectSessionInUrl:false` is configured. There is no implemented `/auth-callback` route; a URL string in the email helper does not implement session ingestion. This review does not certify a magic-link deep-link flow.

**WORKING TREE:** initial restoration and SDK-managed refresh remain outside the application queue. Credential helpers await public `getSession()` before submission; installed SDK public reads await initialization. The queue does not replace SDK-internal refresh safeguards. Future session-writing entry points must join the helper boundary.

## Callback/deadlock assessment

**WORKING TREE source inspection:** RootLayout, CaptureWarning and People auth subscribers are synchronous. Root advances `setUsernameGateAccount` before launching push/timezone work; those promises are fire-and-forget, not returned/awaited by the subscriber. No subscriber awaits a queued transition, and no queued operation calls another queued operation. The installed SDK awaits subscribers, so the warning in `auth-transition.ts` is necessary.

**WORKING TREE / local execution:** an added test deliberately delays an async `SIGNED_OUT` subscriber and verifies replacement submission waits until that subscriber resolves. Another uses the current fire-and-forget public-session-read pattern and completes without deadlock. These execute installed SDK notification behavior; they do not mount the complete root component or invoke notification services.

## Executed controls

**WORKING TREE / local execution: 24/24 installed-SDK cases pass.** Independently reran supplied 17 controls, then added seven:

1. B credential storage write delayed: A cleanup waits, then skips B.
2. Delayed `SIGNED_OUT` subscriber: B submission waits for notification completion.
3. Fire-and-forget subscriber reads: no deadlock.
4. Previously signed-out token cannot log out B.
5–7. A's post-deletion logout returns 401, 403 or 404: installed SDK still clears A before queued B is established.

**WORKING TREE / local execution negative control:** replacing only the scratch queue with direct operation execution produces **18 failures / 6 passes** across the same 24 cases. The queue is necessary for these ordering guarantees; it is not simply redundant token checking. Original queue restored afterward.

Versions actually executed: `@supabase/supabase-js` and `@supabase/auth-js` **2.110.7**. Tests use real public SDK operations, actual proposed helpers/generation module, asynchronous Map storage and an injected synthetic fetch. No SDK internals are patched. No live request, token provider, device, credentials or production storage is involved.

Logs: `SDK_REGRESSION.log`, `ADDITIONAL.log`, `QUEUE_BYPASS_NEGATIVE.log`. Added reproducible script: `additional-sdk-controls.cjs` (uses the supplied harness with independent scenarios).

## Remaining limits

**INFERENCE / unverified:** real AsyncStorage/native scheduling, provider/browser redirects, process death, automatic refresh timers, multi-process clients and all initialization races. The harness disables automatic refresh and separately exercises the supplied explicit delayed `refreshSession` case. It establishes A after initialization; startup restoration ordering is source-reviewed rather than exhaustively race-tested. Same-account token refresh intentionally does not advance the account-ID generation; do not describe that token as identifying every distinct JWT session.

**WORKING TREE:** late referral/navigation continuations after sign-in, friend-push overlap and server deletion completeness remain separate. The settings mounted test mocks `signOutForAccount`; it cannot prove SDK cleanup correctness. The real installed-SDK controls supply that missing layer, but this review did not rerun the author's five-suite mounted integration set or a full app build/typecheck. No implementation fix is proposed beyond the supplied patch; additional tests and this report are the deliverables.

Reproduce with `PALATE_TEST_ROOT` pointing at the combined proposal and `PALATE_MODULES` at the installed mobile node_modules:

```sh
/opt/homebrew/bin/node --test scripts/test-auth-transitions.cjs
/opt/homebrew/bin/node --test /Users/kentonmcneal/Documents/Codex/2026-09-27/how-x20/outputs/palate-auth-independent/additional-sdk-controls.cjs
```
