# Overnight prompt — 2026-09-06

Paste everything below the line into a fresh Claude Code session in
`~/Claude Code/Palate`.

---

Work autonomously through the list below. I am asleep and will read your
report in the morning. Do not wait for me on anything: if a task is blocked,
say so precisely, skip it, and move to the next.

## Ground rules

Read `CLAUDE.md` first and follow it exactly. In particular:

- **Never spend money.** No paid Google Places calls, no LLM API calls, no
  provisioning. `ANTHROPIC_API_KEY` is deliberately unset — leave it unset. If
  a task looks like it needs a paid call, stop that task and write up what it
  would cost.
- **EAS build, update and submit are pre-authorised.** `supabase db push` and
  `functions deploy` are pre-authorised. Nothing else is.
- **Every claim carries an evidence label** — `COMMITTED`, `WORKING TREE`,
  `LIVE`, `DEVICE`, `INFERENCE`. A conclusion without one is incomplete.
  "The source looks right" is not evidence. Invoke the thing.
- **Do not flip `feature_flags.server_push`.** The founder does that himself.
- Use the throwaway-probe pattern for live SQL: a
  `supabase/migrations/9999_probe.sql` whose `do $$` block ends in
  `raise exception 'PROBE%', report;`, then delete it. Remember a probe push
  applies every pending migration first, so never leave an unapproved
  migration in the folder.
- Migration proof blocks must survive an EMPTY database — CI rebuilds from
  scratch. Guard seed-dependent assertions with an early `return` and a
  `raise notice`; keep the auth/security assertions unguarded.
- `npx tsc --noEmit` and `npx jest` from `mobile/` must both pass before every
  commit. 589 tests pass right now; that number should only go up.
- Commit each task separately with a real message explaining *why*, not what.

## Already done tonight — do not redo

- Featured lists moved to Home and set to a 90-day refresh. The cron audit is
  **finished**: the cron was never the cost driver. Three clocks disagreed
  (`is_fresh` 36h, `refresh_city` on-demand 18h, cron 6 days) and the 18-hour
  on-demand gate was binding, so any user opening the app 18 hours after a
  rebuild paid for another. All three are 90 days now (migration 0124).
- Passive venue resolution now asks our own catalogue before Google.
- Home is catalogue-first; search is local-first; `scoreTaste` reads
  `cuisine_type`; Home ranks on `finalScore`; open-now gate is live.
- 0.1.9 (build 32) is uploaded to App Store Connect and processing.

## The work, in order

### 1. Nothing tells the founder when a tester reports a bug

`mobile/lib/feedback.ts` writes a row to `public.feedback` and a screenshot to
a private bucket. Nothing notifies anyone; reports accumulate in a table
somebody has to remember to query.

Decide the delivery route by what actually exists, in this order:

1. Check whether `RESEND_API_KEY` (or equivalent) is already a Supabase
   function secret — `npx supabase secrets list`. If it is, write a small edge
   function that sends the founder an email, and fire it from an `after insert`
   trigger on `public.feedback` via `pg_net`, the way the existing crons call
   functions.
2. If there is no mail credential, do **not** invent one and do not ask him to
   create an account. Fall back to: an `after insert` trigger that enqueues
   into `public.push_outbox` addressed to the admin profile. Note in your
   report that this only actually delivers once `server_push` is on, and that
   the row is queued and waiting either way.
3. Either way, add an unread count the founder can see without querying:
   extend the existing admin surface (Profile → Admin) with "N new reports"
   and a list. This is the part that works with no external dependency at all,
   so build it regardless of which route above you take.

Rate-limit whatever you build: one notification per report, never a digest
loop that can fire repeatedly for the same row.

**Acceptance:** insert a test row as a probe, prove the trigger fired (the
outbox row or the function invocation exists), then delete the test row. Prove
a non-admin cannot read `public.feedback`.

### 2. The Google cap does not survive fifty testers

Global cap is 1,500 billable calls/day; per-user is 120. Fifty testers is a
potential 6,000, so the per-user cap stops protecting the budget and roughly
thirteen heavy users could trip it for everyone. Tripping is not a bill, it is
a silent app-wide outage during dinner service.

Three things, none of which cost anything:

1. **Re-measure.** Several changes shipped today that should cut per-user
   spend a long way. Query `api_usage_daily` and `google_usage_counter` and
   report the last seven days by action, so we can see the effect of
   catalogue-first Home and catalogue-first venue resolution. Note honestly
   that the sample is short.
2. **Make tripping loud.** When `google_usage_counter.tripped` flips, nobody
   learns about it. Add an alert on the same route you built in task 1.
   Also add a `warned` threshold hit at 70% of the cap so there is warning
   before an outage rather than after.
3. **Raise the nearby cache hit rate.** It is 104 hits against 1,053 misses
   over 30 days — about 9%, which is poor. Read `mobile/lib/nearby-cache.ts`
   and the server-side cell logic in `places-proxy`. Work out why the hit rate
   is so low (cell size too small? TTL too short? key includes the radius?)
   and fix the cause you can actually demonstrate. Do not guess: prove the
   cause with real coordinates from `api_usage_daily` or the cache table
   before changing anything.

**Do not raise the global cap.** The cap is the safety net; the fix is fewer
calls, not a higher ceiling.

### 3. Breadcrumbs through the passive pipeline

`breadcrumb()` is exported from `mobile/lib/observability.ts` and has zero call
sites. Sentry is currently a no-op (no DSN), so this is groundwork — but it is
the difference between "it broke" and "it broke after resolve returned
nothing".

Add breadcrumbs along the real path: detected → qualified (with the reason when
it fails) → resolved (with the source: cache, catalogue or Google) → notified →
confirmed. Keep them cheap and never let one throw. Do not add breadcrumbs
anywhere else in the app tonight; this one pipeline is where they pay.

### 4. Delete the dead second scorer

`mobile/lib/match-score.ts` is a complete parallel scoring implementation with
different weights, reachable only from its own tests. Two scorers that disagree
is how the next regression gets in.

Before deleting: `grep` every export and prove each has no non-test caller.
Delete the module and its test file. If some export turns out to be used, keep
only that and delete the rest, and say which survived and why.

**Acceptance:** `tsc` and the full suite pass, and the test count drops only by
the tests you deliberately removed.

### 5. We can recommend a permanently closed restaurant

`business_status` appears nowhere in the repo — no field mask requests it, no
column holds it, nothing filters on it. Google returns it on the same Nearby
and Details responses we already pay for, so capturing it is free.

1. Add a `business_status` column to `public.restaurants` (migration).
2. Add it to the field masks and to `googleToRestaurantRow` in
   `supabase/functions/_shared/classifier.ts`, so new and refreshed rows carry
   it. Make sure the enrichment-preserving trigger from 0104 does not wipe it.
3. Filter on it: `CLOSED_PERMANENTLY` must never be recommended. Put the gate
   in `mobile/lib/recommendation/eligibility.ts` so every surface inherits it,
   the way the food gate works.
4. **Do not backfill.** That would be a paid pass over the catalogue. Report
   what a backfill would cost and leave it for the founder to approve.

**Acceptance:** a unit test proving a `CLOSED_PERMANENTLY` row is excluded, and
a null `business_status` is not — absent must never mean closed.

### 6. Drive the marginal cost structurally toward zero

The economics: Google cost is per-PLACE, not per-user. Once a restaurant is in
the catalogue every future resolution of it is free, for everybody, forever.
A hundred users in one metro is nearly free; a hundred users in a hundred
cities is not. So the work is coverage, not rationing.

Three things, all free:

1. **Do not pay to resolve a stop we are going to discard.** Read the
   confidence scoring in `mobile/lib/passive-confidence.ts` and the order of
   operations in `resolveVenue`. If a stop is going to land in the low band and
   be shown as an ambiguous "which one?", establish whether we needed the paid
   lookup at all, or whether the catalogue answer would have served. Do not
   introduce a hard "skip low-confidence stops" rule that silently loses real
   meals — the fix is ordering and reuse, not refusal. Show the numbers behind
   whatever you change.
2. **Measure catalogue coverage properly.** Add a probe that answers: for the
   stops we resolved in the last 30 days, what share had a catalogue answer
   within the resolve radius? That is the number that predicts the marginal
   cost of the next user, and right now nobody knows it. Report it.
3. **The cache**, as described in task 2 above.

### 7. Own the data

Every place we resolve once should be ours permanently. This is the same move
Foursquare made — the places database stopped being a cost and became the
asset — and the catalogue is already accumulating it by accident. Make it
deliberate.

- Audit whether we persist EVERYTHING we pay for. When `places-proxy` fetches
  20 nearby restaurants and the client uses three, are the other seventeen
  written to `public.restaurants`, or discarded? If they are discarded we are
  paying for data and throwing it away, which is the single cheapest thing to
  fix on this whole list.
- Check the same for the `details` action and for featured-lists text search.
- Verify the enrichment-preserving trigger from 0104 cannot be defeated by a
  later cheap upsert overwriting expensive fields.
- Report catalogue growth over the last 30 days: rows added, and how many came
  from each path.

Do not add any new paid fetching to "improve coverage". This task is about
keeping what we already buy.

### 8. Who pays — ANALYSIS ONLY, decide nothing

This is a business model question and it is the founder's to answer. Do not
choose, do not build, do not add a payments dependency, do not sign up for
anything.

Produce a short written analysis in the report covering:

- What the app's own data can already support. Query it: how many restaurants
  do we hold, in how many metros, with what classification coverage? A
  restaurant-side product needs supply-side density; say honestly whether we
  have it anywhere.
- For each of the three models — charge restaurants (the OpenTable answer),
  charge diners a subscription, license or syndicate the catalogue (the
  Foursquare answer) — what would have to be TRUE technically before it could
  ship, and roughly what building it would involve. Be concrete about the
  engineering, not the market.
- What we would need to start measuring NOW to make that decision later with
  evidence rather than instinct. Some of it is probably one analytics event
  away, and adding those events tonight is in scope.

Keep it under a page. The founder wants the shape of the decision, not a
business plan.

### 9. Sentry config plugin — probably blocked

Check whether `EXPO_PUBLIC_SENTRY_DSN` has appeared in `mobile/.env`, and
whether a Sentry org/project slug is anywhere in the repo or in
`npx eas env:list`. If both exist, add the `@sentry/react-native/expo` config
plugin to `app.json`, wire source-map upload for OTAs as well as builds, and
build. If either is missing, **skip this and say so** — do not invent slugs and
do not sign up for anything.

## When you finish

Publish an OTA to all three runtimes (0.1.9, 0.1.8, 0.1.7) for anything that is
JS-only, restoring `app.json` to 0.1.9 afterwards. Anything native needs a new
build and a version bump; do not bump the version for JS-only work.

Then write me a report at `docs/OVERNIGHT_2026-09-07.md` with:

- what you finished, with the evidence label for each claim
- the catalogue coverage number from task 6 and the persistence audit from
  task 7, which together are the answer to "what does the next user cost"
- the who-pays analysis from task 8, kept short
- what you skipped and exactly why
- anything you found that I have not asked about, especially anything that
  costs money or leaks data
- the seven-day Google numbers from task 2, and whether you now believe fifty
  testers is safe

Be honest in that report about anything you could not verify. I would rather
read "I could not prove this" than a confident sentence that turns out to be
wrong.
