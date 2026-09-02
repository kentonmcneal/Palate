# Palate — work that needs nobody awake

**Paste this as the opening prompt of a Claude Code session opened from
`~/Claude Code/Palate`.** Read `SESSION_PROMPT.md` first for the repo boundary,
the peer check, and the permission split.

Everything here is **$0 marginal spend** and **needs no decision from the
founder**. He is asleep. Do not queue up questions; take the reasonable reading,
write the decision in `SPRINT_LOG.md`, and keep moving.

---

## 0. Two constraints that are specific to tonight

**Build 30 is in Beta App Review.** Do not touch `app.json`, do not add a native
module, do not bump the version. A native change now means the review in flight
is for a binary that no longer matches the branch.

**Stay JS-only.** Every commit tonight should be shippable as `eas update` to
runtime 0.1.7. This is not a style preference — 9 of 13 users are dormant and
will not install anything, so an OTA is the only delivery mechanism that reaches
them once they take build 30. Additive SQL migrations are fine; native modules
are not.

**Do not publish the OTA tonight.** Build 30 is under review; pushing new
user-facing behaviour to a binary being reviewed is needlessly muddy. Leave it
staged and say so in the log.

---

## 1. Verified state (2026-09-02, ~04:00)

- `main` pushed, worktree clean, **168 tests**, `tsc` clean.
- Migrations applied through **0060**. Next number: **0061**.
- `places-proxy` and `send-push` deployed. `server_push` and `discovery_pings`
  both **OFF** — leave them off, flipping them is his call.
- Build 30 submitted, in review. Builds 26–29 were never installed by anyone.
- 13 accounts, of which **5 are the founder's own or test accounts**. Real
  testers: 7. Two accounts have ever logged a visit; one is the review account.

The activation funnel, from `analytics_events`:

```
signed in            10
started onboarding    6      <-- four people vanish here
finished onboarding   4
granted location      3
ever detected         1      <-- and two of three vanish here
ever logged           1
```

---

## 2. The work, in order

### W1 — Why do four people sign in and never start onboarding?

**This is the highest-value thing on the list and it is an investigation, not a
feature.** Four of ten signed-in users never fired `onboarding_started`.

The leading hypothesis: the invite-only waitlist gate. New signups land as
`approval_status = 'pending'` and get routed to `/waitlist`. Everyone is
`approved` now, but they were approved *after* they hit that wall, and they
never came back. If that is what happened, the gate is costing more than it
protects at this size.

- Reconstruct it from `analytics_events` timestamps versus
  `profiles.approval_status` history if recoverable.
- Read the routing in `app/_layout.tsx` — the approval gate short-circuits
  before onboarding.
- If confirmed: make approval non-blocking (let them into a limited app), or
  notify on approval so the person knows to come back. **Do not silently remove
  the waitlist** — that is a product decision. Write up what you find with the
  evidence, implement the least-invasive fix, and flag it clearly.

### W2 — Pairwise ranked rating

His own strategy docs call this the #1 post-launch item, and it is the one place
Palate beats Beli structurally: their ranked list costs users manual work
forever, and passive capture produces the same artifact for free.

- After a visit, occasionally ask **one** comparison — "Better than X?" One
  question, never a queue.
- Elo or merge-insertion over pairwise results. Migration **0061** for
  `visit_rankings`.
- Ordered list on the profile.
- **Unit-test the ranking math.** It fails silently and invisibly if wrong,
  which is the worst failure mode in a paid product.

### W3 — First and last name

Several testers render as email prefixes — `briebreezy.collabs`, `itayzit`,
`gd` — because nothing ever asked them for a name, and the People directory
looks like a database dump because of it.

Add `first_name` / `last_name` alongside `display_name`, backfill
`display_name` from them when present, and ask in profile setup and Settings.
**Do not add phone number** — that is sensitive PII with consent implications
and he has not decided to collect it.

### W4 — The shareable match card

`computePalateMatch()` already produces the number and the reasons. What is
missing is a card worth posting: two avatars, the big number, three shared
cuisines, one divergence line. Reuse the `SharePalateCard` pattern — note those
are `ViewShot` canvases, so text uses `CanvasText` and must not scale.

Cheapest user acquisition available, and it is design work rather than
engineering.

### W5 — Profile depth and directory filters

All from data already stored: visit history and top places on a profile,
"you've both been to N of the same places" (the strongest compatibility signal
we have), and filters on the People directory by school and city.

### W6 — Small debts

- **Feed posts don't link to places.** `top_restaurant` is a bare name string
  from the `generate_weekly_wrapped` SQL function. Thread a `google_place_id`
  through that function, the payload and the renderer.
- **Batch the People/friends match RPC** — one round trip per person today.
- **Wrapped depth** — more cards from data already collected.

### W7 — Group recommendations (only if the above are done)

Needs a server-side edge function: computing it on the client means shipping
other users' taste vectors to a device. Caller's JWT, friendship check per
member, returns ranked restaurants plus per-person scores, never vectors.

**Aggregate by MINIMAX, not mean** — averaging picks the blandest option, and
"best restaurant for everybody" means nobody has a bad night. Veto pass first:
drop anything below ~30 for any member. Show per-person scores under the pick.

Candidates must come through the read-through cache; a cold area costs one
Google call and that is the only paid path in this document. If it cannot be
done from cache, stop and write it up.

---

## 3. Do not

- Touch `app.json`, add a native module, or bump the version.
- Publish an OTA.
- Flip `server_push` or `discovery_pings`.
- Submit anything to Apple.
- Widen a search radius, raise `GOOGLE_DAILY_CALL_CAP`, or invoke
  `featured-lists-refresh`.
- Add a phone-number field.
- Message any user, or send any push.
- Remove the waitlist gate without flagging it as a product decision.

---

## 4. Definition of done

- `npx tsc --noEmit` clean, `npm test` green, **no regression below 168 tests**.
- New tests for every piece of pure logic, especially W2's ranking math.
- Migrations written, `--dry-run` checked, applied. Additive only.
- Every commit JS-only and OTA-shippable.
- `SPRINT_LOG.md` updated at the top: what shipped, what you decided and why,
  what is staged but unpublished, and what you could **not** verify.
- Anything needing a physical device is reported as unverified, not implied to
  work.
