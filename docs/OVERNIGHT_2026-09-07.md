# Overnight report — 2026-09-07

Everything below is measured. Where something could not be verified it says so.

---

## The headline

Four separate systems were reading data they could not see, and none of them
could tell. Three were found tonight. The pattern is worth naming because it
has now happened four times in this codebase:

> **PostgREST answers an RLS-blocked select with `200 []`, not an error. A read
> the app is not allowed to perform looks exactly like a user with no history.**

Previously: the friend embeds that returned null for the other party, and the
admin funnel that rendered zeroes over 6,825 rows. Tonight: the ranker's
negative-feedback loop, and the personal signal's skip/dismiss learning.

Any new cross-table read in this app should be assumed broken until a probe
proves otherwise.

---

## Finished

### A bug report now reaches somebody `LIVE`

No mail credential exists, but `ALERT_PUSH_TOKEN` does — the same route
`places-proxy` already uses for budget alerts, and deliberately independent of
`feature_flags.server_push`, which gates user-facing pushes and stays off. An
after-insert trigger calls a new `notify-feedback` function through `pg_net`,
with the secret read from Vault so nothing sensitive is committed. Plus an
unread count and list on the Admin screen, because the push can fail and that
one cannot.

Proved rather than asserted: `pg_net`'s response log shows response `424`,
status 200, `{"skipped":"no such row"}` — trigger fired, request delivered,
secret authenticated, row lookup ran and correctly found nothing because the
test row was already deleted. **No notification was sent to anyone's phone.**

### The ranker can see its own feedback `LIVE`

`loadUserRecCounters` and `personal-signal.ts` have both been reading
`analytics_events` since they were written, and both received `[]` every time.
The ranker's whole purpose there is to penalise places you already dismissed;
it had never seen a dismissal. Own-row SELECT policy, an index that could not
have existed while nothing could read, and a bounded query — it previously had
no user filter and no limit, because RLS made both moot and the bug invisible.

Proof asserts both halves: the founder reads exactly his own row count and zero
of anyone else's. anon still gets nothing.

### Passive capture can see where people actually eat `LIVE`

**A regression I shipped a few hours earlier.** Catalogue-first venue
resolution called `restaurants_near`, which filters
`recommendation_eligibility > 0`. Correct for a recommendation. Wrong here:
eligibility answers "should we suggest this?", passive capture asks "did you
eat here?"

258 chain rows carry eligibility 0, including **Chick-fil-A, the founder's
most-visited restaurant**. The benign failure was paying Google anyway. The bad
one: a stop at an ineligible venue with an eligible neighbour inside the 75m
radius resolves to the neighbour, silently, without ever asking Google.

`restaurants_near` takes `p_recommendable_only`, defaulting true so every
existing caller is untouched.

### Closed restaurants `LIVE`

`business_status` appeared nowhere in the repo — no field mask, no column, no
filter. Now requested on every path, stored, preserved by the 0104 trigger, and
gated both client-side and in `restaurants_near`.

**Null is not closed**, and that distinction is the whole risk: almost every
row is null today, so reading absence as closure would have emptied the app.
`CLOSED_TEMPORARILY` passes deliberately. Not backfilled — that is a paid pass
and the founder's call.

### Keep the data we pay for `LIVE`

`featured-lists-refresh` classified everything Google returned and upserted
only the eligible subset, then `continue`d past the upsert entirely when none
were eligible. A category returning twenty chain outlets was paid for, thrown
away in full, and paid for again next rebuild.

Also: the field mask omitted `places.addressComponents`, so
`neighborhoodFromPlace` fell back to parsing `formattedAddress` and produced a
coarser neighbourhood that then **overwrote a better one** — the preserve
trigger guards NULL, not a worse non-null value. 52 rows measured with a stored
neighborhood worse than the `addressComponents` in their own `google_raw`.

### The cache miss loop `LIVE`

Coverage recorded `result_count` as Google's raw count while `degradedNearby`
reads back through the eligibility filter, which strips ~45%. A cell wrote 20,
passed the `>= 15` coverage test, read back 8, failed the same threshold, paid
Google, and wrote 20 again. Billing every time, forever. The write now counts
what the read will return, and telemetry records `nearby:75` vs `nearby:3000`
so the fix is measurable at all.

**The 9% figure was misleading.** The read-through cache did not exist until
2026-09-02; the 30-day window averaged in 17 days with no cache. Since it
shipped: 335 Google, 109 cache — **24.6%**.

### Breadcrumbs, and the dead scorer

Breadcrumbs along the passive pipeline including which source answered — cache,
catalogue or Google — which is what turns "resolve returned nothing" into
something actionable.

`scoreMatch` deleted. **Only `scoreMatch`**: my own brief said the whole module
was dead and it was wrong. Thirteen non-test files import that file's display
helpers. 589 → 581 tests, exactly the eight deliberately removed.

---

## Not done, and why

**Sentry config plugin** — blocked. No DSN in `mobile/.env` and no org/project
slug anywhere. Not invented, not signed up for.

**The two larger cache changes** the investigation proposed — coverage as a
disc, radius out of the key. An adversarial verifier refuted both as trading
accuracy for cost without acknowledging it, and I agree on the evidence
presented. The structural finding underneath is real and still open:
`CACHE_MIN_RESULTS = 15` applied to a 75m radius, where Google's own maximum
return across 19 cells was **4**. That path has a permanently unreachable 0%
hit rate. It needs a design decision, not a patch.

**`business_status` backfill** — paid. Founder's call.

---

## Corrections to my own brief

Three, all in the direction of me being wrong:

1. **"Nothing tells you when the Google cap trips."** False. `places-proxy` has
   pushed to the founder's device at 80% and on trip since it was written.
2. **"`match-score.ts` is reachable only from its own tests."** False. Thirteen
   files import it. A true, narrow finding about one export got generalised
   into a false claim about a file.
3. **"The featured-lists cron is the cost driver."** False. Three clocks
   disagreed and the 18-hour client-side gate was binding; the cron never got a
   look in.

---

## Android

Assessed separately and the answer is **no, not now**.

Passive capture does not exist on Android in any form.
`expo-module.config.json` reads `"platforms": ["apple"]`; `git ls-files
mobile/modules` returns six files, four of them Swift. And it would not fail
cleanly — `passive-capture-intro.tsx` persists the opt-in and then tells the
user *"Update Palate to finish… it turns on once you update"*, which on Android
is permanently false. There is no `Platform.OS` gate anywhere in the passive
path.

The port is an architecture change, not a translation: no CLVisit, no OS
relaunch of a terminated app, and no way to hold a five-minute dwell timer
outside a foreground service with a permanent notification. Realistic cost 3–5
weeks of Kotlin plus 1–3 weeks of Play background-location review with real
rejection risk, landing on a detector permanently less reliable than iOS's.

`lib/next-step.ts:77` already says it: *"Without background location Palate is
a worse Beli — a place to type in restaurants by hand."*

---

## Who pays — analysis, no decision

**What the app holds** `LIVE`: 1,620 restaurants across 174 neighbourhoods and
104 cells — thin, not deep. Philadelphia 194, Memphis ~216, Hampton VA 102, DC
99. Roughly 15 venues per cell. Coverage: format 99%, rating 99%, price 81%,
cuisine 77%, hours 46%. The four qualitative columns built for vibe are
**entirely empty**. A complete record is 591 of 1,620 — 36%.

**Users**: 14 accounts, 55 visits, **3 distinct people have ever logged one**,
and one accounts for 35 of the 55.

**Restaurant-side data: none.** Zero tables matching owner, claim, merchant,
reservation, billing or payment. The only billing column in the schema is our
own Google spend.

- **Charge restaurants (OpenTable).** Needs owner identity, a claim and
  verification flow, a dashboard, per-cover attribution and billing. None
  exists. The nearest thing is `restaurant_overrides`, which has 0 rows.
  Supply-side density is the precondition and we do not have it in any metro.
- **Charge diners.** The honest question is what someone would pay for that the
  app does today. Wrapped is the candidate. A paywall on existing behaviour is
  not a product.
- **License the catalogue (Foursquare).** Coverage is far short of what a buyer
  needs, and — the possibly disqualifying part — redistributing data derived
  from the Google Places API has terms-of-service implications that need real
  legal reading before any engineering.

**Start measuring now**, in priority order:

1. `rec_restaurant_viewed` fires on data-load, not viewport visibility. Today's
   1,526 "views" do not mean seen. Move it to `onViewableItemsChanged`.
2. Add `rec_id` to rec events and a `visits.rec_id` column, threaded from the
   rec render to the log-visit call. **Without this, per-cover attribution is
   impossible in any timeframe** — it is the one instrument that decides
   whether charging restaurants is even testable.
3. `rec_to_visit_converted { rec_id, restaurant_id, hours_elapsed }`.
4. `restaurant_profile_opened { restaurant_id, surface }` — per-venue demand.
   Literally the number a restaurant would buy against.

Item 1 invalidates everything downstream, so it goes first.

---

## Still open

- Sentry, blocked on the founder
- The 75m cache design decision
- The four measurement items above
- `business_status` backfill, if approved
