# Palate — work for while you're out

**Paste this as the opening prompt of a Claude Code session opened from
`~/Claude Code/Palate`.** Read `SESSION_PROMPT.md` first for the repo boundary,
the peer check and the permission split.

Everything here is **$0 marginal spend** and **needs no decision and no device**.
Take the reasonable reading, write the decision in `SPRINT_LOG.md`, keep moving.

---

## 0. Constraints specific to right now

- **Build 30 is in Beta App Review.** Do not touch `app.json`, add a native
  module, or bump the version.
- **Stay JS-only** so this ships as `eas update` to runtime 0.1.7. Additive SQL
  is fine. Next migration: **0066**.
- **Do not publish the OTA.** Leave it staged; say so in the log.
- **Do not run a real Gmail import**, on any account. The `preview` action
  exists so the cost can be known before it is paid.
- No spending, no flag flips, no Apple submissions, no messaging users.

---

## 1. The competitive read this work comes from

Four facts, and every workstream below traces to one of them.

**Swarm is the cautionary tale, and it is the closest analog.** Foursquare had
check-ins and a social graph, moved to automatic detection, and collapsed.
Passive logging removed the *ritual* — the moment where you did something and it
was yours. Palate is walking the same road with better technology, and it has
the same exposure: if the app logs everything invisibly, there is no moment of
authorship and no reason to come back. **The confirm prompt is the ritual. It
should feel like authorship, not like dismissing a notification.**

**Letterboxd is the success case.** Ranked lists as identity, niche-first,
patient. It beat nobody and won anyway. Palate now has a ranked list
(`/rankings`) and it is buried behind a button in Settings.

**Beli's weakness is the one thing we structurally beat.** Their ranked list
costs users manual labour forever; passive capture produces the same artifact
for free. That advantage only exists if our ranked list is visible and good.

**Our weakness is the cold start**, and 2 of 13 accounts have ever logged a
visit. Email import is the answer and is half-built. Everything else here is
about making the first ten minutes worth staying for.

---

## 2. The work, in order

### W1 — Encrypt the Gmail refresh tokens (security; do this first, carefully)

`gmail_tokens.refresh_token` is stored in **plaintext**. A refresh token is
long-lived read access to somebody's email. It is already on the ship checklist
and it blocks scheduling any import cron.

- Encrypt at rest — pgsodium/Vault, or a key held only by the edge function.
- Migrate the existing rows, and **verify a round-trip decrypt before dropping
  the plaintext column.** This is the one piece of work tonight that is not
  purely additive: an unrecoverable token means a user silently loses their
  connection with no error to explain it.
- Confirm RLS denies all client access to that table (it should already).
- If anything about the round trip is uncertain, **stop and write it up** rather
  than dropping the old column. A reversible half-step beats a clean-looking
  irreversible one.

### W2 — Give group recommendations a screen

The `group-recs` edge function is deployed, `lib/group-recs.ts` exists, and
**nothing in the app calls either.** It is dead code with a deployment.

- "Eating together" entry from the Feed or People tab: pick 2–4 friends, use
  current location, show the picks.
- Show the **per-person scores under each pick** — "Marcus 82 · Dana 74 ·
  You 79". The transparency is the feature: a group pick people can audit is a
  group pick people accept, and it makes the app the neutral party in a decision
  that is usually social friction.
- Handle the two honest empty states with the copy already in
  `groupEmptyReason()`: `no_cached_coverage` (we have not explored here — this
  is deliberate, the function never calls Google) and `all_vetoed`.
- Explain the veto where it happens. "Nothing here works for everyone" is a
  better answer than a bad recommendation, and saying why is what makes it
  land.

### W3 — Make the visit moment feel like authorship (the Swarm lesson)

Right now confirming a visit ends in a rate-items screen. The photo prompt and
the one-question comparison are there. What is missing is the **reward** — the
sense that logging *did* something.

- After a confirm, show what changed: "That is your 4th Thai meal this month",
  "Your top spot just changed", "3 more and your Wrapped unlocks".
- All computable from data already stored. No new tables.
- Keep it to one line. This is a beat, not a screen.

The test to hold it to: does logging a meal now feel like an act, or like
clearing a notification? Swarm lost because it became the latter.

### W4 — Put the ranked list where identity lives (the Letterboxd lesson)

`/rankings` is reachable only from a button in Settings, which is where features
go to be forgotten.

- Surface the top 5 inline on the Profile tab, with "see all".
- Show it on **other people's** profiles too, subject to the existing visibility
  rules — a ranked list you can look at is the single most interesting thing on
  a stranger's profile, and it is what makes the People directory worth opening.
- Make it shareable, reusing the `MatchShareCard` pattern (`ViewShot` canvas, so
  `CanvasText`, no font scaling).

### W5 — Make the first ten minutes teach

A new account sees empty recommendation cards, an empty Wrapped and a People
directory of strangers with no data. That is the actual first-run experience and
it explains a lot about 2-of-13.

- Home with no visits should teach the **one** action that unblocks everything,
  not render empty shelves.
- Wrapped with no data should say what it will look like and what it needs,
  concretely ("log 3 meals this week").
- If Gmail is connected but nothing imported, point at `/import-review`.

### W6 — Put the activation funnel on the debug screen

Reconstructing it took four SQL queries. It should take five seconds, because it
is how anyone will know whether any of this worked:

```
detected -> qualified -> resolved -> notified -> confirmed -> logged
```

Read from `analytics_events` for the current user. Add suppression reasons
(`recently_dismissed`, `min_gap`, `duplicate_recent`, `rate_limit`) with counts —
`recently_dismissed` was 4 of 7 suppressions on 2026-09-02 and is the number
most likely to be silently eating prompts.

---

## 3. Do not

- Touch `app.json`, add a native module, publish an OTA, or submit to Apple.
- Flip `server_push` or `discovery_pings`.
- Run a real Gmail import or invoke `featured-lists-refresh`.
- Drop the plaintext token column without a verified round-trip decrypt.
- Widen any search radius or raise `GOOGLE_DAILY_CALL_CAP`.
- Add a phone-number field.

---

## 4. Definition of done

- `npx tsc --noEmit` clean, `npm test` green, **no regression below 205 tests**.
- Tests for any pure logic added.
- Migrations `--dry-run` checked before applying; additive only.
- Every commit JS-only and OTA-shippable.
- `SPRINT_LOG.md` updated: what shipped, what is staged, what you could not
  verify — especially anything needing a device.
- If W1 cannot be completed safely, say so plainly and leave the plaintext
  column in place. Half-encrypted credentials are worse than unencrypted ones.
