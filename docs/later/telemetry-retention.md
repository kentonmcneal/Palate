# Impression retention, and a rollup instead of a delete

**Parked 2026-09-07.** Not built, on purpose: changing retention is a deletion
policy, and that is the founder's call, not a session's.

## The idea

Cut `rec_restaurant_viewed` retention from **730 days to 180**, matching every
other analytics event, and roll impressions up into monthly counts before the
prune runs so the funnel keeps its history as aggregates rather than raw rows.

Decision events (`rec_restaurant_clicked`, `rec_restaurant_saved`,
`rec_maps_opened`, `rec_recommendation_dismissed`, `rec_try_another`) keep the
full 730 days under either policy. Those are the rows with signal in them and
there are **55 of them in the entire history of the app**.

## Why it exists

Migration 0133 prunes analytics at 180 days. 0136 carved out `rec_*` and gave
it 730, reasoning that those are the only rows that could ever train a learned
ranker.

But `FEEDBACK_WINDOW_DAYS = 60` in `lib/recommendation/feedback.ts`. The
recommender reads sixty days and stops. So the app holds two years of the
least informative event it writes to feed a model that looks at two months of
it, and `rec_restaurant_viewed` is **71% of every row ever written**.

## The numbers (measured 2026-09-07 against the live database)

`analytics_events` costs 471 bytes a row including indexes. The heaviest
account generates 84 events a day, 71% of them impressions.

| | impressions kept | rows held | storage per heavy user |
|---|---|---|---|
| today | 730 days | ~48,000 | **~23 MB** |
| this idea | 180 days | ~15,000 | **~7 MB** |

Against a 500 MB free tier, after leaving room for a ten-metro catalogue:
roughly **17 sustained-active users today, roughly 57 after**. At a more
typical 15 events a day it is about 100 today and 300 after.

## Why it is safe to do whenever

It **deletes zero rows on the day it ships**. The oldest event in the database
is 129 days old, so a 180-day policy is a change that first bites in about two
months. A 90-day policy would delete 2,184 rows today, which is why it is not
the proposal.

## What would earn it back

Any of:
- A second genuinely heavy user. The projection above is one person's usage
  extrapolated, and two data points beat one.
- Database size crossing ~150 MB, which is the point where the trajectory
  stops being theoretical.
- A decision to open TestFlight to more than ~15 people who will actually use
  it.

## What would kill it

Committing to train a ranker that needs raw impression history longer than six
months. If that happens, build the rollup anyway and keep raw rows only for
users who opted into it. See [palate-neighbours](palate-neighbours.md) for why
that is not close: cross-user learning needs users, and there are six active
accounts.

## Rough shape

One migration. Replace the prune function's single statement with three:
insert monthly aggregates into a new `rec_impressions_monthly`
(user_id, month, surface, count), then delete impressions older than 180 days,
then everything else on its existing schedule. `pg_cron` already runs
`prune_analytics_events` weekly, so there is no new job and no new cost.
