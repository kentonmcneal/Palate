# Independent People patch review — 2026-09-29

**WORKING TREE — two actionable privacy-state bugs reproduced and fixed in the output copy.** Apply `INDEPENDENT_REVIEW.patch` on top of the current uncommitted People changes; it is a delta, not the original People replacement patch. It changes only:

- `mobile/app/people.tsx`
- `mobile/lib/__tests__/people-interactions.test.tsx`

Repository files were read only. No permissions requested, installs, live API calls, deployment, SQL changes, or edits to follows/ProfileBody/root/username. The prior report is preserved as `REVIEW_PRIOR.md`. Full proposed files are also provided under this output directory's `mobile/` path.

## Findings

### P2 — successful privacy reads are discarded when a sibling request fails

**WORKING TREE, mounted reproduction.** Baseline `people.tsx:135–137` and the equivalent directory branch couple `readHidden()` and the data request with `Promise.all`, then remember hidden IDs only after both succeed. When search rejects but the block RPC succeeds, an already displayed blocked person remains visible and actionable. This occurs whether the block response resolves before or after the search failure. The same coupling affects directory refresh, including previously published named error messages.

Reproduction: mount Alice and Bob; change `hidden_user_ids` to return Alice; invoke the **actual** `searchUsers` helper with an RPC error. The screen displays “Search unavailable” while retaining Alice's old directory tile. A second deterministic ordering resolves privacy after the error and yields the same failure. The directory reproduction invokes the **actual** `browseProfiles` helper and retains Alice's named mutation error after its RPC fails.

Fix: attach guarded privacy publication directly to the privacy promise. Continue awaiting both before publishing new data rows. Account/focus/request guards still reject obsolete privacy replies. A valid privacy result can retire an old identity independently of whether the paired data operation succeeds.

### P2 — mutation errors retain or resurrect hidden identities

**WORKING TREE, mounted reproduction.** Baseline `people.tsx:100–107` filters directory, compatible and search rows, but omits the ID-keyed `mutationErrors`. Baseline `people.tsx:199–200` also publishes a named error after a block has already been learned.

Reproduction A: fail Follow Alice, then learn Alice is hidden during a successful search. Her tile disappears, but “Couldn't confirm the change for Alice” remains. Reproduction B: start a follow, learn the block, then reject the pending mutation. The error restores her name even though the rows were removed.

Fix: prune named errors when remembering hidden IDs; suppress late mutation-error publication for a now-hidden ID. Unblocked users retain their normal error and reconciliation behavior.

**WORKING TREE scope:** these are stale client display/action defects involving previously received identity, not proof of a new SQL authorization bypass. Migration 0184's server filter remains necessary and is not changed here.

## Real helper and server-contract review

**WORKING TREE, source inspection plus mounted helper controls:**

- `friends.ts::searchUsers` trims input, permits two characters locally, throws RPC errors and returns `data ?? []`. SQL 0184 requires three trimmed characters. People's three-character guard correctly respects the server boundary. New failure tests run the actual helper, not a mocked rejection at the screen boundary.
- `social.ts::browseProfiles` throws RPC errors. Its actual implementation is exercised in the directory failure test.
- `friends.ts::listFollowing` calls `list_follows({p_kind:"following"})` and maps flat snake-case rows into `friend`, `youFollow`, `followsYou`. A new mounted control uses this real mapper and the real `unfollowUser`, including the `follows_you` return value. People correctly interprets that as not following and reconciles against the server list.
- `followUser` returns `following` or `mutual` for a successful follow; `unfollowUser` returns `none` or `follows_you`. The screen's state mapping matches those semantics. Successful follow also schedules analytics inside the helper; this review does not alter that helper or claim to cancel already dispatched mutations/analytics.
- `loadCompatiblePeople` throws RPC errors. `loadPalateMatches` throws batch errors, can return `{}` for no IDs, and represents unauthorized pairs as not-ready. `needsDiscoveryPrompt` returns false for absent user/data and silently treats a returned profile-query error without data as no prompt. The screen does not make visibility writes.
- `hidden_user_ids` in migration 0035 unions both block directions. The strict screen reader rejects errors, non-arrays and malformed IDs instead of using the permissive moderation fallback.
- SQL 0184 adds the two-way block predicate, preserves exact-email/name/handle search behavior and the 20-row limit, and returns limited identity without email. Its existence makes the old screen comment about missing server block filtering obsolete; the patch updates that comment to describe defense in depth.

**USER-REPORTED, not independently executed here:** main's 20 PGlite checks pass. This review read SQL 0184 but did not rerun those database tests or invoke deployed RPCs. No LIVE or DEVICE claim is made.

## Auth, concurrency and mount controls

**WORKING TREE, mounted tests:** retained baseline coverage for late initial session restoration, signed-out state, same-account token refresh, account A→B→A, reverse-order search/directory/enrichment results, duplicate mutation taps, per-row gates, ambiguous mutation reconciliation, failed reconciliation retry, focus changes, and unmount cleanup.

Added a complete unmount/remount control: old search responses, the old auth callback and an old captured follow handler cannot change the new mount or dispatch a follow. Added controls proving late privacy success from a failed superseded query or old account cannot filter the current screen. These pass with the fix, so decoupling privacy publication has not removed the stale-request checks.

## Verification

**WORKING TREE — executed with installed native Node/Jest in `work/palate-people-independent`, using copied source and a read-only dependency link.** Fetch is forbidden by the mounted suite.

- Baseline plus the first seven new cases: **5 failed, 36 passed, 41 total**. The five failures reproduce the two findings; remount and real-helper controls pass. See `INDEPENDENT_BASELINE.log`.
- Final People suite, including two additional stale-privacy controls: **43/43 passed**. See `INDEPENDENT_PATCHED.log`.
- Final combined People + unchanged root-account-boundary suites: **47/47 passed, two suites**. Root was only run as a control, never edited. See `INDEPENDENT_COMBINED.log`.
- Full copied mobile TypeScript `--noEmit`: **passed**. Its normal config excludes test files; Jest transformed and executed the changed TSX tests. See `INDEPENDENT_TYPECHECK.log` (empty on success).
- `git apply --check` against the current repository: **passed**. Neither targeted repository file changed during review; baseline/proposed SHA-256 values are in `INDEPENDENT_HASHES.json`. Repository HEAD observed: `a4feb73`.

The snapshot contains 34 existing People cases; nine new cases produce the final 43. The combined count reflects the four root cases present in the copied working tree, rather than assuming an earlier reported count.

## Limits

**INFERENCE / not verified:** no physical-device behavior, actual Supabase auth transport timing, deployed grants/RLS, full app Jest suite, or SQL deployment was tested. Existing auth/mock tests prove local request ownership, not cancellation or rollback of a mutation already sent to the server. Blocks are revalidated on focus, refresh and search; this patch does not add a realtime block subscription. Main should run its full integration gate and apply SQL 0184 through its existing review process.
