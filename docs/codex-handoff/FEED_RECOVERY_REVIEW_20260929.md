# Independent feed loading/recovery review — 2026-09-29

**WORKING TREE: integrate the author's proposal with `FEED_INDEPENDENT_FIX.patch`.** The request/focus guards, visible refresh recovery and synchronous duplicate-read gate work as proposed. Two preexisting gaps remain in the touched path and are not detected by the author's 12 controls: returned auth errors/null identity and blocked-author inline comment previews. The additive patch fixes those in the feed component and extends the mounted suite. No shared component/library/backend changes.

Read current AGENTS/CLAUDE and the claims convention; inspected local status and the claims file. The claims script performs git fetch, so it was inspected, not executed. Explicit scratch-only authorization makes a repository claim unnecessary. No repository files, landing files, credentials, live services, permissions or dependencies were changed.

## Findings

### P2 — returned auth errors become successful feed content/empty state

`FeedTab.load` originally destructures only `data` from getUser. The actual `listFeed` helper also returns an empty array when its separate getUser yields no user, without checking that result's error. Thus an auth error returned as `{data:{user:null},error:...}` can produce the “first story” empty state and even start graph enrichment instead of exposing recovery. If listFeed returns rows while the parallel identity read fails, the proposal publishes those rows with null myId.

**WORKING TREE reproduction:** independent mounted controls fail for initial returned error, returned error during refresh, and confirmed null account. The author's suite inherits the global Jest getUser mock, which returns null for every test; its synthetic listFeed still supplies posts. It therefore proves ordering/presentation but does not prove account-valid publication.

**Correction:** after verifying request ownership, reject a returned auth error before publishing incoming rows. Previously loaded content remains alongside recovery on a transient error. An explicitly null account clears posts, myId, graph and the open comments target, then enters recovery rather than reporting a genuinely empty signed-in feed. This check precedes mutation-revision suppression, so a pending local mutation does not prevent clearing a confirmed absent account. The suite now explicitly supplies a valid account by default and overrides it in negative cases.

This is not a new authentication framework. The root still keys its Stack by session user ID or signed-out, and that remount remains the cross-account boundary. An independent keyed-replacement test demonstrates that the old mounted instance cannot publish its late read into the new instance. The full root/SDK/native lifecycle was not mounted together. A failed identity request is not itself evidence of sign-out; old cards are retained on error only under that root ownership contract.

### P2 — blocking leaves the user's inline comment previews on surviving posts

`removeUser` only filters events whose post author matches. Real FeedRow renders `event.topComments` directly. Blocking a commenter through CommentsSheet or blocking a post author therefore leaves their preview text/name under other users' posts. Advancing contentRevision protects this local state from an older snapshot, but the local state was never fully cleaned.

**WORKING TREE reproduction:** drive the actual FeedRow Post options → Block → confirmation handler with a successful mocked blockUser response. Another post still renders the blocked user's preview in the original proposal. The original author's block test calls the sheet callback directly and has no topComments fixture, so it cannot detect this.

**Correction:** remove authored posts and filter the user's previews from all remaining posts. Close a sheet whose parent post was removed. Do not decrement commentCount from the number of removed previews: previews contain only up to two comments, and real CommentsSheet calls its authoritative onCountChange before onBlockedUser. Subtracting again would corrupt that count. The independent test follows this ordering, retains count 7 and the safe preview, and resolves an older refresh to verify neither blocked content nor the old count returns.

Counts on other unopened posts may remain stale until refresh because this callback does not provide their authoritative totals. No count is fabricated. This fix also does not create persistent block/report tombstones; a later independently started stale backend read remains outside the revision-overlap guarantee.

## What the original proposal gets right

**WORKING TREE — source plus mounted execution:**

- A request sequence and focus lifetime own publication, errors, loading finalizers and asynchronous graph publication. Old focus results cannot release the current gate. Enrichment already started is invalidated on blur/new request.
- The synchronous pending ref coalesces callbacks before rerender. Blur/re-entry starts a new owned read while the abandoned transport may finish. A never-settling current read still needs blur/re-entry; no timeout was introduced.
- Like gate ownership survives focus changes. The existing optimistic helper/gate remains responsible for mutation behavior; a read overlapping a like does not overwrite optimistic state.
- Refresh failures retain cards and expose a recovery action even though loadView prioritizes content. Initial errors, loading and successful empty states remain distinct for a valid account.
- Comment-count/block/report completion increments contentRevision. Discarding the entire older feed snapshot is a conservative preservation policy, not a field-by-field merge. Other new posts in that snapshot wait for another refresh.
- The actual report menu handler calls onReportedEvent only after successful reportContent; the independent test follows the real menu chain and confirms an older refresh cannot restore that post. Existing comments race controls validate CommentsSheet separately.
- 44-point minimum action dimensions and accessibility props are present. No native tap-target, pixel layout, large-text or VoiceOver certification is inferred from renderer props.

## Executed controls

All runs use existing installed Node/Jest/React tools and disposable copied sources with mocked I/O.

| Candidate | Result |
|---|---|
| Repository baseline + exact author's 12 cases | **11 fail / 1 pass**, reproduced |
| Original proposal + exact author's 12 cases | **12 pass**, reproduced |
| Original proposal + explicit-account independent extensions | **4 fail / 14 pass / 18 total** |
| Proposal + additive fix + focused regressions | **46 pass / 5 suites** |

The 46 include all 18 mounted FeedTab cases, comments-sheet races, optimistic likes, feed-card formatting and type-scale tests. The six added cases cover returned auth error at initial/refresh reads, confirmed null account, account-key replacement, actual block-menu completion with previews/count ordering, and actual report-menu completion. These are component tests, not live authorization tests.

The initial scratch copy omitted theme.ts and could not import the component; theme.ts was copied before the recorded completed runs. No application code was changed to bypass that setup error. CommentsSheet presentation remains mocked in the FeedTab suite: its count/block callback order was checked in actual source and reproduced explicitly; a combined real-sheet-plus-screen integration is not claimed. Neither mutation transport cancellation nor already-dispatched mutation ownership is newly certified.

Focused TypeScript of feed.tsx and its imported production dependencies **passes (exit 0)**; see `TYPECHECK.log`. Jest transforms the test file; that is not a semantic TypeScript check of test code. The app-wide typecheck in the author's report remains separate author evidence.

## Integration artifacts and boundaries

Apply the author's `FEED_LOADING_RECOVERY.patch`, then this directory's `FEED_INDEPENDENT_FIX.patch`. The additive patch changes exactly:

- `mobile/app/(tabs)/feed.tsx`
- `mobile/lib/__tests__/feed-loading-races.test.tsx` (extends the author's new file; do not install twice)

Full combined component/test text is adjacent for inspection. `SOURCE_HASHES.json` pins the repository feed baseline. Original proposal snapshots are retained solely for reproducing the negative controls. Main owns final integration.

No LIVE or DEVICE evidence; no network, sign-in, service action, repository mutation, recommendation change or shared privacy-contract modification. This is bounded feed read recovery plus immediate local preview cleanup, not a general feed authorization or eventual-consistency certification.
