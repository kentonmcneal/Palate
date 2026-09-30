# Direct-message audit — 2026-09-30

Claude session, claimed 07:31Z. Scope chosen to avoid Codex's live front (passive
capture, onboarding, settings, digest, visits tab). These paths had **no test
coverage** and predate every account-binding / stale-read / both-way-block pass
applied elsewhere: `lib/messages.ts` last touched 09-06, `app/thread/[id].tsx`
09-13, `lib/friends.ts` 09-05.

## Fixed: an optimistic send could appear twice — `RUN`

Sending is optimistic. The row is appended as `pending-<ts>` and renamed when
`dm_send` returns. The realtime handler deduped on the **server id**:

```ts
if (prev.some((x) => x.id === m.id)) return prev; // our own echo
```

That only recognises the echo if `dm_send` has already answered. The echo and the
response are two independent round trips and either can win. When the echo won,
the list still held `pending-…`, nothing matched, the echo was appended — and then
the optimistic row was renamed to the same id. **Two rows, one message, both
carrying the real id.**

It is worst precisely where optimism earns its keep: a slow connection is what
makes the echo beat the response.

**Fix.** Reconciliation moved out of the component into pure, exported helpers in
`lib/messages.ts` — `applyIncoming`, `reconcileSent`, `dropOptimistic`. Identity is
no longer the server id alone: a `pending` row is matched by (mine + identical
body), which both sides know without a schema change. The echo replaces the
pending row **in place**, so an acknowledged message does not jump position.

**Evidence.** `lib/__tests__/dm-merge.test.ts`, 11 cases. Verified by restoring the
shipped logic: the echo-first case and the in-place case both fail, and the
response-first case still passes — the exact asymmetry predicted from reading.
Full suite 191 suites / 2,360 tests, 1 skipped; TypeScript clean.

Negative controls included, because a body-based match can over-reach: two
identical messages genuinely sent twice both survive once acknowledged (only a
`pending` row may be consumed); the other person's identical text cannot consume
my pending row; and an unknown viewer matches nothing.

## Fixed: `sender_id` was empty for a fast sender — `RUN`

The optimistic row used `me ?? ""`, and `me` comes from an async `getUser()`. A
send before that resolved wrote an empty `sender_id`, which drives **both** the
mine-or-theirs styling and the new echo match. The id is now resolved before the
row is built (`whoAmI()`), and held in a ref as well as state — the realtime
effect's deps are `[threadId, isNew]`, so reading state inside it would pin
whatever `me` was when the channel opened and the match would never fire.
Re-subscribing on `me` would tear down a live socket instead.

## Found, NOT fixed — next in this area

Scoped out deliberately; each needs its own batch and evidence.

1. **`subscribeToThread` has no reconnect recovery.** It subscribes to `INSERT`
   only, and nothing refetches on resubscribe. A brief network drop silently
   loses every message sent during the gap until the screen is left and
   re-entered. `load()` runs on mount and threadId change only. This is the
   largest remaining defect on this surface.
2. **`markRead` swallows every error** (`.then(() => {}, () => {})`), so a failed
   read receipt is invisible and the unread badge stays wrong.
3. **`unreadTotal` returns 0 on error**, so a persistent failure is
   indistinguishable from an empty inbox — the badge simply never appears.
4. **`app/profile/[id].tsx` (45 lines, untouched since 09-05) not yet audited.**
5. `lib/friends.ts` still exports `loadFriendsLeaderboard`, dead and allowlisted
   in `no-new-dead-exports.test.ts`.

## Limits

Offline and synthetic only. No deployment, no paid calls, no device run — Xcode
licence remains unaccepted, so none of this is verified on a phone. The tests
exercise the pure reconciliation functions, not the rendered ScrollView, realtime
transport, or RLS. Nothing here proves the server's participant-only policy.
