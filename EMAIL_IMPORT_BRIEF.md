# Palate — Email import: build it out (autonomous brief)

**Paste this as the opening prompt of a Claude Code session opened from
`~/Claude Code/Palate`.** Read `SESSION_PROMPT.md` first for the repo boundary,
the peer check and the permission split.

---

## Why this matters

Palate's hardest problem is the cold start. Recommendations need visits, Palate
Match needs 5+ visits on both sides, and Wrapped needs a week of them — so a new
user's first session is a set of empty screens asking them to come back later.
As of 2026-09-02, **2 of 13 accounts have ever logged a visit**.

Email import inverts that. Instead of asking someone to generate months of data,
it reads months they already generated: connect Gmail, and arrive with a taste
graph, a real Wrapped and working matches on day one.

**It is also the only path in the product with a genuine per-user marginal
cost.** That shapes the whole brief: the first workstream is measuring the cost
without incurring it.

---

## 0. Constraints specific to right now

- **Build 30 is in Beta App Review.** Do not touch `app.json`, add a native
  module, or bump the version.
- **Stay JS-only** so everything ships as `eas update` to runtime 0.1.7.
  Additive SQL migrations are fine. Next migration number: **0066**.
- **Do not publish the OTA.** Leave it staged and say so in `SPRINT_LOG.md`.
- **Do not run a real import.** See §1 — the estimator exists so nobody has to
  spend money to find out what spending would cost.

---

## 1. What already exists (verified 2026-09-02)

`supabase/functions/gmail-import/index.ts` is written and deployed:

- OAuth, token storage in `gmail_tokens`, Gmail search restricted to a list of
  **13 known receipt senders** (OpenTable, Resy, DoorDash, Uber Eats, Grubhub,
  Caviar, Yelp, Tock, SevenRooms, Square…)
- **90 days on first scan, 30 days after.** It never reaches "two years of
  receipts" — an earlier estimate of mine said it did, and that was wrong.
- `placeIdForName()` checks the local `restaurants` table by name **first**
  (804 distinct names today) and only falls through to a Google
  `places:searchText` call on a miss, with a field mask of `places.id` alone.
- Every Google call is metered: `budgetSpent()` before, `bump_google_usage` and
  `record_api_usage('gmail_place_lookup')` after, sharing the same 1,500/day cap
  as everything else.

**No import has ever run.** There is not a single `gmail_place_lookup` row in
`api_usage_daily`. The whole path is unexercised, and the OAuth redirect fix
(reversed client id) ships in build 30 and has never run on a device.

Estimated cost per new user, from the structure: **10–25 Google lookups** on a
first import, falling as the shared name cache warms. W1 replaces that estimate
with a measurement.

---

## 2. The work

### W1 — The dry-run estimator (do this first, it costs nothing)

Add a `"preview"` action to `gmail-import` that does everything a real import
does **except call Google or write visits**:

- authenticate, run the same Gmail query, parse the same senders
- report: messages matched, receipts parsed, unique restaurant names, how many
  already resolve against the local `restaurants` table, and **how many would
  need a paid lookup**
- return the unresolved names, so the parser's blind spots are visible

Surface it in the app as the step before connecting: *"We found 34 receipts
across 21 restaurants. 6 need a lookup."* Then the user — and the founder —
decide with a real number instead of a guess.

This is the whole reason the brief is orderable: **it answers the cost question
without incurring the cost.** Nothing downstream should be built until it has
run once.

### W2 — Parser coverage and correctness

Thirteen senders is a good start and certainly incomplete. Toast, Seamless,
Postmates, Chowbus, ChowNow, Slice, Olo-powered brand emails, Apple/Google Pay
receipts, Square variants.

- Extract parsing into a pure module with **fixtures per sender**, so adding one
  is a test, not a deploy-and-hope. Use redacted real emails; never commit a
  real message id or address.
- A parser that returns the wrong restaurant name is worse than one that returns
  nothing: it spends a paid lookup and writes a false visit. **Prefer null over
  a guess**, and test that explicitly.

### W3 — Review before commit

An import currently writes visits directly. It should propose them.

- A review screen: every parsed receipt with date, restaurant and source, all
  checked by default, with a one-tap "not me / wrong place" on each.
- Only confirmed rows become visits. This is the same principle as the passive
  confirm prompt — the app proposes, the person decides — and it is what keeps
  a parser bug from silently poisoning someone's taste graph.

### W4 — Label imports honestly, everywhere

`visits` already has `import_source` and `import_external_id`. Use them, and
make sure `import_external_id` genuinely prevents the same receipt becoming two
visits across repeat scans.

**Receipts are a biased sample** — delivery and chains over-represented,
walk-ins invisible. That bias must not silently distort the product:

- Wrapped and the taste graph should be able to distinguish imported from lived
  visits.
- Consider down-weighting imported visits in the taste vector, and **write the
  decision down either way**. Silently treating a year of DoorDash as equivalent
  to a year of going out would make every recommendation worse while looking
  like it made them better.

### W5 — Encrypt the refresh tokens (do not skip)

`gmail_tokens.refresh_token` is stored in plaintext. A refresh token is
long-lived read access to somebody's email. This was already on the ship
checklist and it is a prerequisite for scheduling any import cron.

Encrypt at rest (pgsodium/Vault or an edge-function-held key), rotate what is
already stored, and confirm RLS denies all client access to that table.

### W6 — The cron stays written and unscheduled

Migration 0051 has it commented out. **Leave it that way.** Enabling it starts
recurring spend across every connected account, which is the founder's decision
and needs W1's number first.

---

## 3. Hard stops — ask, do not decide

- **Running a real import**, on any account including the founder's. W1 makes
  this unnecessary until he chooses.
- Scheduling the import cron, raising `GOOGLE_DAILY_CALL_CAP`, widening the scan
  window past 90 days, or adding senders that would obviously multiply lookups.
- Requesting any Gmail scope beyond the current read-only one.
- Storing message bodies. Parse, extract, discard — the privacy policy says we
  read receipts, not that we keep mail.

---

## 4. Definition of done

- `npx tsc --noEmit` clean, `npm test` green, no regression below **187 tests**.
- Parser fixtures per supported sender, including negative cases where the right
  answer is null.
- W1 has been run once against a real inbox **by the founder**, and the actual
  `gmail_place_lookup` count is recorded in `SPRINT_LOG.md`. Estimates get
  replaced by the number.
- Every commit JS-only and OTA-shippable; nothing touching `app.json`.
- `SPRINT_LOG.md` updated with what shipped, what is staged, and anything
  unverified — especially anything needing a device.
