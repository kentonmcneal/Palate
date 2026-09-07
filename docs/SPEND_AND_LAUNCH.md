# Spend, scale, and what is left before launch

Measured 2026-09-06 against the live project. Every number here came from the
database or the API console, not an estimate, unless it says otherwise.

---

## What you are actually paying today

| | now | when it starts costing |
|---|---|---|
| **Google Places** | **$0** | ~5,000 calls per SKU per month. You used **1,198 in 30 days** (789 Nearby, 377 featured-list Text Search). |
| **Supabase** | **$0** (free tier) | 500 MB database, 5 GB bandwidth, or 50,000 MAU. You are at **26.7 MB** and **14 accounts**. |
| **Expo EAS** | your monthly plan | already recurring; OTA updates are included, builds are what the plan buys |
| **Apple Developer** | $99/year | already recurring |
| **Domain** (your-palate.com) | ~$12/year | already recurring |
| **Resend** (login emails) | $0 | 3,000 emails/month |
| **Expo push** | $0 | unlimited |
| **Vercel** (landing site) | $0 | hobby tier |
| **Sentry** | $0 | not set up at all, see below |

**So the app itself costs you nothing to run right now.** Your fixed costs are
the Apple developer account, the domain, and your Expo plan. Everything that
could scale into money is still inside a free tier.

### One-time vs recurring

**One-time**
- Apple Developer enrolment (done)
- Google Cloud project + Places API setup (done)
- Supabase project (done)
- CASA security assessment for Gmail scanning: **$540 to $675**, if you decide
  to verify the restricted scope (see `docs/later/` and the Gmail section)
- A name change, if you do one: new domain, new sender domain, new DNS and
  DMARC, App Store name, every string in the app

**Recurring**
- Apple Developer: $99/year
- Domain: ~$12/year
- Expo EAS: your plan, monthly
- Supabase Pro: **$25/month, not yet needed** but worth buying before real
  users for the daily backups and point-in-time recovery alone
- Google Places: variable, currently $0 (see below)
- CASA re-assessment: annual, if you go the Gmail route

---

## The one number that scales: Google Places

Daily calls, last two weeks:

```
09-06  82     09-01  40     08-27   0
09-05 422 *   08-31  47     08-26   0
09-04 158 *   08-30  56     08-25   8
09-03  46     08-29  53     08-24   7
09-02 147 *   08-28  25
```

The starred days are catalogue and featured-list rebuilds, not users. **A
normal day with you plus a couple of testers is 40 to 60 calls.** Your global
kill switch trips at 1,500/day and has never fired; your worst day ever was
422.

**The economics that matter: Google charges per PLACE, not per USER.** Once a
restaurant is in your catalogue, every future person who sees it, walks past
it, or has it resolved from a GPS stop is free, forever. That is why:

- 100 users in Memphis is nearly free. The catalogue is already built.
- 100 users in 100 cities is not. Each new metro is a fresh catalogue.

So the cost driver is **metros, not headcount**, and that is a thing you
control by who you invite.

### What is already protecting you

- A hard global cap of 1,500 billable calls/day, with a push alert to your
  phone at 80% and on trip.
- Catalogue-first everywhere: Home, search, and passive venue resolution all
  ask your own database before they ask Google.
- A nearby cache with a 75 m floor and radius-aware keys.
- Featured lists refresh every 90 days, not every 18 hours.

### The gap before 50 testers — closed 2026-09-06

The per-user limit is 120 calls/day plus a burst limit, against a 1,500 global
cap. Fifty testers is a theoretical 6,000, so **roughly thirteen heavy users
could trip the shared cap**, and tripping is not a bill, it is a silent
app-wide outage at dinner time.

**Correction to an earlier version of this doc:** it said the per-user budget
still needed building and would take a day. It already existed. What did not
exist was a graceful landing: hitting your own cap returned 429, a hard
failure, while the code to answer from our own catalogue sat right there
serving the global kill switch. Now `nearby`, `details` and `search` all treat
"this account is over its cap" the same as "the shared budget is spent" —
cached rows and a `degraded` flag. The cap still stops one account spending
everyone's budget; it no longer breaks that person's screen to do it.

Reading the source and believing it is what produced the wrong entry. The cap
was in `places-proxy` and had been for weeks.

### Six more ways to scale without spending

1. **Invite by metro.** Only open TestFlight to people in metros the catalogue
   already covers (Memphis, Philadelphia, DC, Hampton). A fifth metro becomes
   a decision you make, not a surprise.
2. **Never backfill on a whim.** The `business_status` backfill and a full
   reclassify are batch spends. Both are still unrun, correctly.
3. **Keep the 90-day featured refresh.** It was three clocks disagreeing and
   an 18-hour gate that actually bound; that is fixed and should stay fixed.
4. **Watch `discovery_pings`.** It is ON. Confirm it is earning its calls.
5. **Persist everything you buy.** When a Nearby call returns 20 places and
   the screen uses 3, all 20 are now written to the catalogue. Keep it that
   way; it is the cheapest thing on this list.
6. **Prune on schedule.** Analytics events prune at 180 days (730 for the
   recommendation events, which are the only rows that could ever train a
   model). Eleven cron jobs are running; none of them cost money.

---

## Storage: what grows, and what that costs

Measured 2026-09-07 against the live database.

**Total today: 28 MB of a 500 MB free tier**, across 14 accounts (3 of them
genuinely active) and a 1,719-restaurant catalogue.

| table | size | rows | grows with |
|---|---|---|---|
| `restaurants` | 6.2 MB | 1,719 | **metros**, not users (shared catalogue) |
| `analytics_events` | 3.5 MB | 7,388 | **usage**, per person per day |
| `restaurant_rating_snapshots` | 568 kB | 4,296 | catalogue size |
| `visits` | 104 kB | 55 | meals eaten, kept forever |
| everything else | < 250 kB each | | |

### The thing people expect to be the problem is not

**Visits are the data we keep forever, and they are negligible.** Somebody
eating out four times a week logs about 208 visits a year. At the marginal
row size that is well under a megabyte per person per decade. Ten years of a
heavy user's actual dining history costs less than one of today's cities.

**Telemetry is what grows, and it is disposable.** `analytics_events` is
471 bytes a row including indexes, and the heaviest account on the app
generates **84 events a day**. 71% of every row ever written is a single
event: `rec_restaurant_viewed`, an impression logged when a card is more than
half visible for half a second.

### The retention rule is mismatched with what reads it

Migration 0133 prunes analytics at 180 days. 0136 then carved out `rec_*` and
gave it **730 days**, on the reasoning that those are the only rows that could
ever train a learned ranker.

But `FEEDBACK_WINDOW_DAYS = 60`. The recommender reads sixty days and stops.
So we are keeping two years of impressions to feed a model that looks at two
months, and impressions are 71% of the volume and the least informative row we
write.

Per heavy user at steady state:

| | impressions kept | rows held | storage |
|---|---|---|---|
| today | 730 days | ~48,000 | **~23 MB** |
| impressions at 180 days | 180 days | ~15,000 | **~7 MB** |

Decision events (clicked, saved, directions opened, dismissed) stay at 730
days under either policy. They are the rows with signal in them and there are
55 of them in the entire history of the app.

**Effect on the free tier**, after leaving room for a ten-metro catalogue:
roughly **18 heavy users today, roughly 60 with the change.** For users at a
more typical 15 events a day it is closer to 100 today and 300 after.

### What I would do

1. **Cut impression retention to 180 days**, matching every other event. It
   deletes **zero rows today** (the oldest event on the app is 129 days old),
   so it is a policy change that takes effect in two months, not a deletion.
2. **Roll impressions up before pruning**, so the funnel keeps its history as
   monthly counts rather than raw rows. One row per user per month instead of
   1,800.
3. When the free tier does run out, **Supabase Pro is $25/month and raises the
   ceiling to 8 GB**, about sixteen times the headroom. That is the real
   answer to "what if we grow": this is a $25 problem, not an architecture
   problem, and the retention change decides whether you meet it at 20 users
   or at 300.

Neither 1 nor 2 is done. Both are cheap and neither costs money to run.

---

## How close is launch

**The app is ready. The operations around it are not.** Honest read: two to
three days, and most of it is your time, not mine.

### The one blocker I would not launch without

**Sentry is blind.** There is no DSN in the environment, so all thirty-odd
`captureError` calls are no-ops and every `breadcrumb` goes nowhere. If you
put this in front of fifty people tomorrow and it crashes for one of them,
you will learn about it from a text message, not from a stack trace. This is
ten minutes of your time: make a Sentry account, create a React Native
project, paste the DSN and the org/project slugs, and I will wire the config
plugin and source maps in an hour.

### The rest of the list

| | whose | how long |
|---|---|---|
| Sentry DSN + slugs | yours | 10 min, then 1 hr mine |
| Beta App Review submit for 0.1.9 | yours | 5 min, then Apple's day or two |
| DMARC + root SPF on your-palate.com | yours | 15 min of DNS |
| Google consent screen: publish for Gmail | yours | 10 min, decision below |
| Turn `server_push` on when you are ready | yours | 1 min |
| First stranger actually uses the app | both | the real test |

That last row is the one I would take most seriously. **Three people have ever
logged a visit, and one of them is 64% of all the data.** Every ranking
decision, every piece of copy, and every threshold in this app has been tuned
against one palate. The most valuable thing you can do this week is get five
people who are not you to use it for seven days.

### Gmail, decided or not

The code is finished and deployed. `gmail-import` is ACTIVE, tokens are
encrypted, the review screen exists, and the nightly cron is written but
unscheduled. **Zero people have ever connected an account, including you.**

The blocker is Google, not code. `gmail.readonly` is a restricted scope:
- Testing mode expires refresh tokens weekly, which kills the nightly cron.
- "In production, unverified" gives you 100 users for the lifetime of the
  project, behind a "Google has not verified this app" screen.
- Full verification needs a CASA Tier 2 assessment, about $675 and six weeks.

**My recommendation:** publish the consent screen as In production now, cap
Gmail connections at about 60 testers to keep headroom, start the CASA
submission so the six-week clock runs during beta, and **connect your own
Gmail first** so we can see one import end to end before anyone else tries.

---

## On changing the name to Tally

I would not, and the reason is not sentiment.

**The name is crowded.** There is already an app called plainly
[Tally](https://apps.apple.com/us/app/tally/id6741104620) on the App Store,
plus [Tally Meals](https://apps.apple.com/us/app/tally-meals/id1477824139),
[Waste Tally for Restaurants](https://apps.apple.com/us/app/waste-tally-for-restaurants/id6739500752),
[Tally AI expense tracker](https://apps.apple.com/us/app/tally-ai-expense-budget-log/id6755501884),
[Tally.It](https://apps.apple.com/us/app/tally-it/id6749854746),
[Tally on Google Play](https://play.google.com/store/apps/details?id=com.codedmark.tally),
and [tallybudget.app](https://www.tallybudget.app/). Two of those are already
in food and restaurants. Apple requires a unique App Store name, so you would
be shipping as "Tally: something", and a search for "Tally" would put you
below several budgeting apps.

**The word points at your competitor's product, not yours.** A tally is a
count. Beli is the app that counts and ranks. Your whole thesis is that the
app notices what you eat and learns your *taste*, and "Palate" says exactly
that in one word. Renaming to Tally would be adopting the vocabulary of the
thing you are trying to be better than.

**The switching cost is larger than it looks.** Not just the App Store name:
a new domain, a new sender domain and a whole new SPF/DKIM/DMARC setup (you
have not finished the current one), the TestFlight link, the wordmark, and
the fact that "Palate" is a noun woven through the product. Your Palate, palate
compatibility, the Palate identity system, `palate_identity` in the database.
That is a week of work and a rewrite of the vocabulary the app teaches.

**The fair case for changing:** "Palate" gets misspelled as "palette" and
misread as precious. If that is what is bothering you, the fix is a tagline
that does the explaining, not a new word. And if you do want a new name, now
is the moment, before external testers learn one. But pick something that is
free on the App Store and says taste, not counting.

---

## Ideas parked for later

Already done, at [`docs/later/`](later/README.md): the credit-card scan,
user-to-user palate neighbours, ratings that move other people's rankings, and
the earlier parked ideas. Each entry says what would earn it back, so a future
session does not rediscover them as new or build them too early.
