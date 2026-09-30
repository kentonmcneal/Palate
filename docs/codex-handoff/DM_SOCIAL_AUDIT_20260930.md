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

1. ~~`subscribeToThread` has no reconnect recovery.~~ **Fixed — see below.**
2. ~~`markRead` swallows every error.~~ **Fixed — see below.**
3. ~~`unreadTotal` returns 0 on error.~~ **Not a defect — I was wrong.** It has no
   caller at all and is deliberately allowlisted as dormant in
   `no-new-dead-exports.test.ts:40`, with the reason recorded at line 16. There is
   no global unread badge to be silently absent. The badge that exists is
   per-thread, rendered from `dm_threads_list` in `app/messages.tsx:74`.
4. ~~`app/profile/[id].tsx` not yet audited.~~ **Audited — see below.**
5. `lib/friends.ts` still exports `loadFriendsLeaderboard`, dead and allowlisted
   in `no-new-dead-exports.test.ts`.

## Limits

Offline and synthetic only. No deployment, no paid calls, no device run — Xcode
licence remains unaccepted, so none of this is verified on a phone. The tests
exercise the pure reconciliation functions, not the rendered ScrollView, realtime
transport, or RLS. Nothing here proves the server's participant-only policy.

## Fixed: a dropped subscription silently ate messages — `RUN`

`postgres_changes` delivers only what happens while the channel is connected.
Anything inserted between a drop and a reconnect is never pushed, and nothing
refetched it — `load()` ran on mount and threadId change only. So a brief loss of
signal **lost every message sent during the gap** until the screen was left and
re-entered, and the socket returning looked identical to never having lost it.

**Fix.** `subscribeToThread` now takes an `onResubscribed` callback and invokes it
on each `SUBSCRIBED` transition *after the first* — the first is the initial
connection, which `load()` already covers; every later one means there is a hole.
The screen then fetches `listMessagesSince(threadId, boundary)` and folds the
result through `mergeCatchUp`.

Two details carry the correctness:

- **The boundary comes from the server's clock, never ours.**
  `newestServerTimestamp` skips `pending` rows, because their `created_at` is the
  local clock and can run *ahead* of the database. Using one as the boundary
  would skip real messages and reopen the exact hole being closed. When nothing
  server-confirmed exists it returns null and the caller refetches the window
  rather than inventing an anchor.
- **The merge is idempotent.** `mergeCatchUp` folds each message through
  `applyIncoming`, inheriting both dedupe rules, because a flapping connection
  resubscribes several times before it settles and the same batch can arrive
  repeatedly. It also means one of my own messages returning in a catch-up
  consumes its pending row instead of duplicating it — the same race as the
  realtime echo, by the same mechanism.

A failed catch-up is swallowed deliberately: it must not break a live thread, the
next reconnect retries, and leaving the screen reloads from scratch.

**Evidence.** `lib/__tests__/dm-reconnect.test.ts`, 8 cases. Verified by breaking
each guard: a naive concat instead of the folded merge, and including pending rows
in the boundary — 4 tests fail for those two changes. Full suite 192 suites /
2,368 tests, 1 skipped; TypeScript clean.

**Limit.** Recovered messages are appended in fetch order, so a message from the
gap can land after an unacknowledged local send that is chronologically later.
Pending rows are by definition the newest local thing, so this is a display
ordering nuance rather than loss. No sort protocol was added — ordering across two
clocks is not something these tests could verify.

## Fixed: a failed read receipt left a conversation unread forever — `RUN`

The per-thread unread badge (`app/messages.tsx:74`) is rendered from
`dm_threads_list`, i.e. from the **server's** state. So whether a conversation
looks read depends entirely on `dm_mark_read` having landed. `markRead` was:

```ts
await supabase.rpc("dm_mark_read", { p_thread: threadId }).then(() => {}, () => {});
```

A no-op on both branches, and wrong twice over.

**`supabase.rpc()` resolves with `{ error }` — it does not reject** on a
server-side failure. So the rejection handler caught network faults while the
success handler discarded the error field entirely. A refused `dm_mark_read` was
indistinguishable from one that worked. This is the same shape as the push
drain's kill-switch read and the classifier's spend gate: the failure mode was
invisible because the error was thrown away at the point it was returned.

**And nothing retried.** One momentary fault left a thread you had just read
showing unread, permanently, unless you happened to open it again.

**Fix.** `markRead` returns whether the server accepted it, retries a bounded
three times with linear backoff, and reports a final failure through
`captureError` instead of swallowing it. If it still fails the badge correctly
stays unread — the server genuinely has not recorded the read — but there is now
a trace of why. `sleep` is injectable so the retry is tested without real delays.

**Evidence.** `lib/__tests__/dm-read-receipt.test.ts`, 9 cases, with the supabase
client and observability mocked (the `feed-loading-races` precedent). Verified by
restoring the shipped swallow-and-succeed implementation: **6 of 9 fail**,
including both "returns false when the RPC resolves with an error" — the case the
old code could not see at all — and every retry assertion. Full suite 193 suites
/ 2,377 tests, 1 skipped; TypeScript clean.

**Limit.** The retry covers a transient fault at the moment of reading. It does
not reconcile a receipt that fails while the app is being backgrounded or killed,
and there is no queue that survives a restart. Nothing here is verified against a
real server or on a device.

## Fixed: a bad deep-link made a false alarm on a watched RPC — `RUN`

`app/profile/[id].tsx` passed its route param straight to `ProfileBody` as
`id as string` — a cast asserting a shape nobody had checked. That matters because
of where the ids come from.

**Three of the four notification deep-links in `app/_layout.tsx` push
`` `/profile/${String(data.user_id ?? "")}` ``.** Only the fourth (`new_follower`,
line 345) guards with `data.user_id &&` first. So a push payload without
`user_id` navigates here with an **empty id**.

`ProfileBody`'s snapshot load has no empty-id guard — it guards the shared-places
load at line 62 and not the snapshot at line 99 — so
`get_friend_profile_snapshot("")` runs, Postgres rejects the invalid uuid, and
`captureError` fires with `at: "ProfileBody.snapshot"`.

That RPC is the one this project's own comment describes as having **"failed
silently for sixty-five migrations"**, watched precisely so a regression is never
missed again. A malformed push payload therefore manufactures a false alarm on the
single signal most likely to be believed — and the user sees "Couldn't load this
profile", which reads as the server being broken.

**Fix (screen boundary only).** `lib/profile-route.ts` validates before rendering:
the param is normalised (expo-router types it `string | string[]`, and a repeated
segment arrives as an array the old cast would have interpolated as `"a,b"`), and
checked against a uuid shape, because `profiles.id` is a uuid and anything else is
a 22P02 at the database rather than a profile that happens to be missing. An
unusable id renders "Profile unavailable" and **never spends a round trip**, so no
error is reported. The back button still works — it is the only way out of a modal.

Also added the missing `accessibilityRole`/`accessibilityLabel` on that back
button. It was a bare `←` glyph, which reads as "left arrow" or as nothing.

**Evidence.** `lib/__tests__/profile-route-id.test.ts`, 16 cases. Verified by
dropping the uuid check: 5 fail, including the literal strings `"undefined"` and
`"null"` that string interpolation produces. Full suite 194 suites / 2,393 tests,
1 skipped; TypeScript clean.

### Not fixed — Codex's files, reported not touched

- **`app/_layout.tsx`:** three deep-links should guard `data.user_id` the way the
  fourth already does, rather than relying on the screen to reject `""`. The
  screen guard prevents the false alarm; it does not make the navigation correct.
  A push with no `user_id` still opens a modal saying nothing is there.
- **`components/ProfileBody.tsx`:** the snapshot load would still call the RPC
  with an empty id if reached from anywhere other than this screen. Line 62
  already guards the shared-places load, so the pattern exists and was simply not
  applied at line 99.

Both are in Codex's live area (`components/` touched 09-30 01:07, `_layout.tsx`
carries their account-keyed root work), so they are recorded here rather than
edited.
