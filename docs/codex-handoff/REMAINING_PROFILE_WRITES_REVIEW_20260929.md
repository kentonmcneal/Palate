# Independent review — remaining profile writes

Evidence: SOURCE REVIEW + LOCAL EXECUTION ONLY, 2026-09-29. Reviewed Darwin's saved proposed patch, all 11 proposed files, account-generation/root contracts, installed Supabase 2.110.7 authorization/logout paths, and delete-account endpoint source. No repository writes, live requests, or credentials. The saved proposal—not concurrently changing main—is the reviewed implementation.

## Decision

Keep the profile/account targeting and picker protections, but resolve R1 before claiming that late account deletion cannot sign out a replacement account. Independently reran all 92 tests successfully; their sign-out mock does not model the failing SDK await. Explicit destructive-operation Authorization headers survived the installed SDK's deferred token resolution in both RPC and Edge controls.

## R1 — P1: deletion completion can still sign out B

Location: proposed `mobile/app/settings.tsx:198–201`; existing `mobile/lib/auth.ts:76–78`; installed `@supabase/auth-js/src/GoTrueClient.ts:3986–4037`.

The pre-call generation check only establishes that A is current before entering `signOut()`. Installed signOut awaits initialization/session loading, calls `admin.signOut(accessToken, scope)`, then removes the current stored session without comparing its identity/generation. This app supplies no custom auth lock; the SDK's default path is lockless. The navigation check after logout cannot repair the removed session.

**Executed counterexample:** real installed client + in-memory storage + injected fetch only: sign in synthetic A; begin A logout and hold its HTTP response; sign in synthetic B and assert B is the persisted session; release A logout; assert the persisted session is now null. The outgoing logout used A's token, so pinning logout's request token alone does not solve local B removal. See `signout-race.cjs` and `.log`.

**Required fix:** make deletion-triggered session cleanup participate in an application-wide account-transition coordinator. All session-replacing paths (including OTP/OAuth/deep-link/session restoration paths that can run concurrently) must share the same coordination; acquire it, recheck the captured generation, and complete cleanup before allowing replacement authentication. Alternatively implement a carefully reviewed conditional cleanup architecture that cannot remove a replacement session. Another generation check before or after ordinary SDK signOut, `scope: 'local'`, or only pinning the HTTP JWT is insufficient. Do not assume adding an SDK lock serializes every sign-in API without inspecting those paths.

**Required regression:** keep the mounted delete-success test, but use a deferred real SDK logout or a faithful deferred session-removal fake. Attempt B replacement while A cleanup is pending; after both settle B must remain signed in (or replacement must wait until cleanup is complete and then establish B). Cover replacement during pre-session-read and during logout network await. Existing immediate mock bypasses both windows.

Darwin report finding 3 should remove the unconditional statement that late A deletion cannot sign out B until this is fixed.

## R2 — P2, separate follow-up: friend-push rollback is not serialized

Location: proposed `mobile/app/settings.tsx:290`.

The new catch avoids an unhandled rejection but rolls back to `!v`, not a confirmed persisted value. Starting enabled: disable then enable while the first request remains pending; both writes fail, with disable failure first and enable failure last. Final UI is disabled although neither write changed the enabled database value. Out-of-order successful writes are also an existing overlap risk. This is separate from account targeting and should not block acceptance of those protections.

Minimal fix: synchronous pending ref/disabled switch per preference; retain a confirmed value and reconcile ambiguous failures rather than treating `!v` as persisted truth. Gate delayed completion by captured account generation. Add overlapping-success and two-failure component controls. This finding is source-derived; I did not run an additional mounted test for this schedule.

## Privacy ordering: accepted improvement, bounded claim

`edit-profile.tsx:173–198` prevents same-mounted-editor overlap with a synchronous ref and suppresses displayed audience while saving. The initial-read revision and account checks are appropriate. On failure, a successful read is a snapshot: it can precede the original write's delayed commit. The report already acknowledges this. Preserve that limitation and avoid calling the displayed reconciliation value a guaranteed final audience. Strong final-state confirmation needs server operation/revision ordering; repeated client reads or a timeout alone do not prove it.

Profile updates also request no returned row/count. An error-free zero-row UPDATE does not prove persistence. This is a pre-existing contract limitation, not evidence of cross-account write access. A returned row with checked identity/value would improve positive confirmation, subject to the actual SELECT policy. No deployed RLS was tested.

## Existing endpoint issue discovered during authorization review — outside this patch

`supabase/functions/delete-account/index.ts:48–61` paginates by increasing offset while deleting the preceding page. With 250 objects: delete original 0–99; offset 100 now selects original 200–249; stop on the short page, leaving original 100–199. A listing error also breaks the loop and proceeds instead of failing closed. These are pre-existing backend defects, not regressions introduced by Darwin. They mean the “every photo” deletion promise is not established by the reviewed client patch.

Follow-up: repeatedly list offset 0 after each deletion; throw on listing error; test >200 objects and listing failure. I reviewed this source only; no storage calls were made. Nested folder handling and upload-vs-delete concurrency need separate endpoint review before a comprehensive erasure claim.

## What passed review

- Generation tokens capture initiating identity before deferred getUser; A→B→A is rejected through token identity, while same-account refresh preserves the generation.
- Eight remaining writers pin the target profile to the captured account. Account replacement cannot turn the intended target into B merely because getUser resolves as B.
- Both native picker entry points capture before permission/picker awaits and carry that token into upload. Checks prevent stale later stages; already-issued upload can still leave an A-owned orphan, as reported.
- Destructive confirmation captures at alert creation. JWT is passed explicitly to both RPC and Edge invocation. Installed transport controls show delayed SDK resolution returning B does not replace explicit A Authorization. Endpoint source verifies the supplied JWT and derives uid from it.
- Avatar copy accurately reflects the public-by-URL source contract. No deployed policy proof is implied.

## Independent execution evidence

- `jest.log`: **5 suites / 92 tests passed**, exit 0, actual installed Jest with Darwin scratch proposed tree.
- `mirror-check.json`: **11/11** saved proposed files byte-identical to the executed mirror, with SHA-256 hashes.
- `sdk-header-proof.log`: **2/2** installed SDK RPC/Edge explicit-A-header controls passed, fake transport only.
- `signout-race.log`: **1 reproduced failing safety property**, actual installed auth SDK 2.110.7; synthetic A logout removes newly established B.
- No independent TypeScript rerun; Darwin's saved typecheck evidence remains author evidence. No device, deployed RLS, production Edge, or end-to-end erasure validation.

No application patch supplied: R1 needs coordinated auth changes beyond the proposed settings callback. A cosmetic extra token check would leave the reproduced defect intact. This report and runnable regression are the actionable output for integration.
