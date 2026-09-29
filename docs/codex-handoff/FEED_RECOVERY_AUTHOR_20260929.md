# Feed read ownership and recovery

WORKING TREE evidence: proposed, not integrated. Scope is exactly `mobile/app/(tabs)/feed.tsx` and one new mounted test file. No repository writes, services, dependencies, profile/auth/push/recommendation implementation changes, or worklog edits.

## Concrete defects and corrections

1. **Out-of-order focus reads replace newer posts.** Leave/re-enter while the first read is pending; let the second finish, then the first. Previously the first snapshot wins. A focus lifetime plus request sequence now owns publication, errors, loading finalizers, and asynchronous graph enrichment. Leaving focus invalidates reads without releasing pending like ownership.
2. **Refresh failure has no visible recovery with existing posts.** `loadView` intentionally selects content before error, so the old error-only branch never renders. The feed now retains cards alongside an explicit recovery card: “Couldn't refresh your feed,” an explanation that the displayed posts were already loaded, and a labeled Try again button. Empty initial failures use distinct wording. Retry clears the prior error and displays loading rather than suggesting the feed is empty.
3. **Duplicate refresh/retry callbacks overlap requests.** A synchronous request ref gates dispatch before rerender. A blur/re-entry can start a new owned read while the abandoned transport finishes; ordinary repeated callbacks cannot.
4. **An older refresh can restore blocked posts or replace a newer comment count.** Completed removal/count callbacks advance a content revision; snapshots started before those callbacks are discarded. Existing like revision/in-flight checks and row-level gates remain intact.

## Presentation

The recovery card uses Palate's existing paper/white surface hierarchy, soft border, type tokens and restrained red-tint action. No borrowed screen or new visual assets. Recovery and empty/navigation actions have 44-point minimum height; Board/People/Find people have button roles, day headings have header roles, and loading/error regions supply polite live-region semantics. Empty primary CTA now uses the existing AA-oriented primary fill rather than the accent red. This is a bounded recovery improvement, not a feed redesign or full accessibility certification.

## Validation

Executed with `/opt/homebrew/bin/node`, existing installed dependencies, copied source, mocked services:

- **12 mounted FeedTab cases pass.** Actual screen, FeedRow rendering, hooks and optimistic-like helper execute. Router focus is driven by a mocked effect lifetime; transport, enrichment boundaries, CommentsSheet, avatar/map/art and heart presentation are mocked.
- **Baseline negative control: 11 fail, 1 pass** with the identical suite against the original feed. Some failures are absent recovery UI assertions, others are stale content/counter or unexpected dispatch assertions; this is not eleven distinct security defects.
- **40 tests pass across five focused suites:** new feed cases, existing comments races, optimistic likes, feed-card formatting and typography scale.
- Copied mobile TypeScript `--noEmit` passes.
- `git apply --check` passes against current main source at packaging time. Source SHA-256 values included.

Exact new cases:
1. Old focus success cannot replace the newer focus snapshot or start extra enrichment.
2. Old failure cannot release the newer read gate or publish a refresh error.
3. Refresh failure retains cards, exposes button semantics, and retry recovers.
4. Initial retry clears error, stays loading, coalesces duplicate callbacks, then renders true empty success.
5. Load settling after blur cannot publish/start enrichment.
6. Load settling after destruction cannot start enrichment.
7. Same-tick refresh invokes one read.
8. Block completion survives an older refresh snapshot.
9. Sheet count survives an older refresh snapshot.
10. Same-row like gate survives blur/refocus; stale refresh cannot replace optimistic state.
11. Enrichment already started on an older focus cannot assemble/publish its late graph.
12. Current pull spinner remains active until success/failure settlement.

Reproduce after application, from mobile:

```sh
/opt/homebrew/bin/node node_modules/jest/bin/jest.js lib/__tests__/feed-loading-races.test.tsx lib/__tests__/optimistic-like.test.ts lib/__tests__/comments-sheet-races.test.tsx lib/__tests__/feed-card.test.ts lib/__tests__/type-scale.test.ts --runInBand
/opt/homebrew/bin/node node_modules/typescript/bin/tsc --noEmit
```

## Boundaries and tradeoffs

- No LIVE or DEVICE evidence. Native focus/router behavior, VoiceOver announcements, touch layout and large-text rendering still need device review. Test rendering establishes state and props, not pixels.
- Reads are invalidated, not cancelled. Previously issued transport/enrichment work can finish. A never-settling read stays gated until blur/re-entry; no new transport timeout policy introduced.
- A content/like mutation during a refresh discards that entire snapshot, preserving local state. Other new posts in it wait for the next refresh/focus. This deliberately extends the existing conservative like policy rather than inventing a merge that guesses server ordering.
- Revision guards protect overlap, not eventual consistency in a later independently initiated server read. No persistent client block/report tombstone or realtime privacy subscription added.
- List remains the existing latest-60 contract. No fake end-of-feed message or unsupported pagination introduced.
- Root account remount and backend privacy contracts remain external dependencies; no new claims about authorization or previously dispatched mutations.
- Governing CLAUDE/AGENTS, claims and complete latest worklog were reviewed. The claims script includes a remote `git fetch`; local status/log/claims were inspected instead, honoring the explicit no-live/no-repository-write boundary.

Packaging check: current main HEAD `a72d662`; feed baseline remained unchanged from initial read. Patch applies without context changes.
