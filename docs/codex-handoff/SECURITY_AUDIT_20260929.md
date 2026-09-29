# Palate security audit — offline source review

Evidence: COMMITTED source observed at `8cea049` (latest migration 0182). Repository files were read only. No real credentials, DB, HTTP, push, email, paid calls, or deployments. Proposed files exist only in this task's output directory.

## Actionable findings

### SEC-01 [P1] A forged own feed event reads another user's hidden visit

`supabase/migrations/0007_social_layer.sql:139` admits INSERT when `auth.uid()=user_id` only. Migration 0072 adds `visit_id` as an ordinary foreign key, with no ownership check. The latest `list_feed` at `0148_comment_threads_and_notifications.sql:199` admits the caller's own events, then joins the linked visit as definer at line 273. An authenticated A can reuse a known B visit ID (e.g. remembered from when it was visible), insert an A event referencing it, and read B's current visited_at, meal_type, photo_url and restaurant location through list_feed even after B hides it. UUID secrecy is not authorization. This is a source-proven authorization gap; not a live exploit result.

Proposed repair: require ownership at insert; make can_view_feed_event reject inconsistent links; use it in list_feed and the direct SELECT policy so pre-existing forged links are also hidden.

### SEC-02 [P1] Blocked callers bypass the profile wrapper via older RPCs

The current `friend_taste_features` body remains the 0080 definition (line 51), with no block check; its batch RPC delegates to it. A blocked caller can still obtain a public-profile target's public visit history, meal timestamps and restaurant coordinates. The current `shared_places` from 0073 line 117 also lacks blocks and returns intersection venues/counts for public targets across a block. Blocking through the normal RPC removes follows but does not close the public-profile branches.

Proposed repair: block check in friend_taste_features; shared_places uses the existing can_view_feed_author gate. This preserves owner access to their complete taste ledger.

### SEC-03 [P1] Mutual follow overrides private profile in shared/ranked readers

`shared_places` (0073:136) and `top_ranked_places` (0069:40) admit `are_friends OR public`. A private target with retained reciprocal follows therefore exposes shared venues/counts and ranked venues even though the main profile wrapper correctly hides their content. Changing profile visibility does not remove follows.

Proposed repair: use can_view_feed_author, which admits public or friends-only-with-mutual and rejects private/blocked targets. No change to self taste or solo recommendations.

### SEC-04 [P1] friends_cities aggregates hidden visits

`0180_friends_in_cities.sql:94–107` reads visits as definer without `v.is_public`. Two hidden visits disclose their city, count and month to mutual followers; a newer hidden visit can also alter the reported month of an otherwise public city. The migration explicitly claims to expose only the same rows as the feed, which is false for this query. It also lacks an explicit block check; direct own-row block insertion can leave reciprocal follows intact.

Proposed repair: filter public visits before aggregation and check blocks independently of follows.

### SEC-05 [P2] Inaccessible posts accept likes

`0007_social_layer.sql:171` checks only that the inserted like's user is the caller. Later migrations tighten SELECT but do not replace this INSERT policy. A caller retaining an inaccessible post ID can mutate its like count; the 0148 after-insert trigger can enqueue a notification for private/friends-only/hidden posts when no block exists. The foreign key checks existence, not visibility.

Proposed repair: also require can_view_feed_event(feed_event_id) in INSERT policy.

### SEC-06 [P2] Replies can reference comments on another inaccessible post

0148 adds parent_id as a plain self-FK (line 33); the 0146 INSERT policy validates only the new comment's feed_event_id. An attacker can put a comment on an accessible/own post and set parent_id to a known comment on a different hidden post. The 0148 notification trigger (line 393) looks up that parent's owner as definer and sends the attacker's snippet as a reply. No constraint ties parent to the same post or enforces one reply level.

Proposed repair: a BEFORE trigger enforces same-post, top-level, unblocked parent, with a uniform invalid-target error before notification triggers execute.

### SEC-07 [P1] Notification recipients do not match content visibility

`notify-feed-post/index.ts` filters only private poster and recipient preferences; it does not require reciprocal follows for friends-only posters, check blocks, or check linked visit visibility. Given an authenticated owner request and enabled server_push, it serializes event payload to one-way followers. The 0171 `enqueue_friend_visit_push` trigger likewise admits every follower of a friends-only actor and runs even for hidden visits (0055 attaches it after every insert). Its vague message still discloses that the person just ate somewhere.

Proposed repair: edge route validates linked visit ownership/publicity, reciprocal follows when needed, and bidirectional blocks with fail-closed reads. Explicit JWT passed to getUser with a project API key. SQL trigger filters hidden visits and restricts friends-only recipients. No feature flag is enabled. Push delivery remains mocked/unverified; the existing old auth-client construction could itself fail before delivery on a deployed SDK, so the edge disclosure is conditional on reaching the authenticated path. The SQL trigger gap does not depend on that route.

### SEC-08 [P1] group-recs trusts follow edges as a substitute for checking blocks

`group-recs/index.ts:105–133` checks follow reciprocity and profile visibility, then service-role reads visits without ever checking blocked_users. The normal block_user RPC removes follows, but the allowed `blocks manage own` direct-table policy (0035:33) can create a block without doing that cleanup. A block with retained follows therefore leaves this reader accessible. The mocked original handler returns 200 and reads visits for that fixture.

Proposed repair: explicitly check both block directions before profile construction; fail closed if authorization reads fail. This proposal deliberately preserves group scoring from the complete ledger: the product explicitly uses private visits for recommendations, and deriving a score is not by itself a proven unauthorized raw-history disclosure.

## Profile/friends contract findings (separate from server authorization defects)

### CONTRACT-01 [P2] Other-user count links show the caller's graph

Observed in `mobile/components/ProfileBody.tsx:265/273/281`: count buttons route with `user=targetId`. `mobile/app/follows.tsx:39–60` parses user but never uses it; `mobile/lib/friends.ts:118` sends only p_kind; `list_follows` (0116:140) derives its owner solely from auth.uid(). Thus A tapping B's follower/friend count sees A's own lists. Follow/unfollow buttons operate A's relationships, not B's.

This is a navigation/identity-contract bug, not a disclosure of B's private list or authority to mutate B's follows. Main owns the owner-only navigation fix; this proposal does not modify ProfileBody, follows, me, or OwnProfileConnections. Mounted regression: viewing B must not offer owner-list navigation; viewing A must open each own list; manually supplying `user=B` must not present A's data as B's.

Owner-only UI is not a new database privacy guarantee: the existing `follows: readable by signed in` SELECT policy (0116:40) intentionally makes graph edges readable to signed-in users, and follow_counts(target) returns counts for any signed-in caller. Do not describe the navigation change as making other people's connection graph private.

### CONTRACT-02 [P2] Private/friends copy promises a different privacy contract

`mobile/app/edit-profile.tsx:298–299` says accepted friends / nothing visible. The actual contract is mutual follows, with no acceptance request, and hidden *content*, not disappearance. The guarded 0118 snapshot returns an unblocked signed-in viewer the private target's id, display name, avatar, username, visibility, relationship state, and follower/following/friend counts. Email, persona, places/counts, bio, school, city and social handles are null in its unauthorized-content branch. 0155 closes direct execution of the unguarded helper.

Correct the copy to disclose retained identity and connections; do not remove those deliberate fields just to match the old promise. The server findings above remain genuine bugs because they expose protected content beyond that minimal identity contract. `profile-contract-copy.patch` supplies wording only. Regression: compare private/friends descriptions with a fixture of the actual snapshot branch; private mode must not claim total invisibility, and friends must explicitly mean mutual following.

### CONTRACT-03 [P2] PALATE FRIENDS labels recommendations as mutual relationships

`ProfileColumns.tsx:43/98` calls loadCompatiblePeople(3) but labels its results PALATE FRIENDS. `compatible_people` (0089:64) selects public, unblocked candidates based on overlap without requiring mutual following. ProfileBody renders these columns only for the owner (line 395), so this is not another person's analytics leak. Rename the section TASTE MATCHES (included in the copy patch), retaining the distinct mutual-follow Friends label elsewhere. Regression: a recommended stranger must render under TASTE MATCHES and must not acquire friend-only actions/state from appearing here.

## Proposed artifacts

- `profile-contract-copy.patch`: copy-only edits to edit-profile and ProfileColumns; no navigation changes.
- `edge-authorization.patch`: applies only to group-recs and notify-feed-post. Applicability checked offline with git apply --check.
- `security-readers.proposed.sql`: unexecuted review candidate for main to place in an additive migration. No historical migrations edited. Covers SEC-01 through SEC-07.
- `edge-authorization.test.cjs`: runs real transpiled handlers against mocked SDK/query/storage and push boundaries. No real fetch is available.
- `SQL-regression-cases.md`: exact local DB matrix, not executed here. SQL proposals are not claimed runtime-valid or deployed.

Run proposed handler tests from the output directory with existing Node/TypeScript:

```bash
/opt/homebrew/bin/node edge-authorization.test.cjs '/Users/kentonmcneal/Claude Code/Palate' "$PWD"
```

26 cases passed for the proposed handlers: valid and invalid auth, both block directions with retained follows, private/one-way friends rejection, authorization read failures, allowed recipients/members, hidden/forged linked visit refusal, foreign event ownership, and disabled push switch. Original source fails blocked-group negative control (200 instead of 403). Mock results demonstrate handler control flow, not SQL RLS/grants, deployed SDK auth behavior, real notification delivery, or live exploitability.

This is a targeted review, not a declaration that all other routes are secure. No absence-of-vulnerability claim is made for the remaining server surface. Already queued notifications and atomicity across concurrent privacy changes need a separate delivery-time review.
