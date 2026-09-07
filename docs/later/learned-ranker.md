# Later: a learned ranker

**Parked 2026-09-07.** Approved in principle by the founder; not started on
purpose. It is a week of engineering gated on data that does not exist yet, and
building the trainer now means maintaining dead code for months.

## The idea

Replace the hand-weighted scorer with a model trained on what people actually
did: given (person, place, context), predict whether they went. `visits_7d` in
`rec_funnel_weekly` is already the label — a confirmed visit within seven days
of seeing the recommendation.

Not an LLM. This is a small model on tabular features and it trains in a
scheduled job for free. The cost is engineering time, not compute, and a
fine-tuned LLM would be slower, dearer and worse at it.

## Why not now

The app's entire history of decisions, measured 2026-09-07:

| signal | count |
|---|---|
| impressions | 5,303 |
| clicks | 21 |
| saves | 1 |
| dismissals | 3 |
| directions opened | 0 |

Learning to rank needs thousands to tens of thousands of labelled decisions.
Twenty-one clicks would fit noise and call it taste, and three active users
means it would learn one person's palate and present it as a model.

## What is already built for it

All of this went in on 2026-09-06/07 and needs nothing further:

- **`rec_slate`** (`lib/recommendation/slate.ts`) — one row per ranking pass
  carrying the candidates that LOST, keyed by the same `request_id` the
  impressions use. Without it a model can only re-order winners and learns to
  agree with the current scorer.
- **`rec_funnel_weekly`** (migrations 0140/0142) — the permanent baseline. A
  learned ranker is worth nothing without a number to beat, and the number has
  to have been recorded while it was happening.
- **`visits_7d`** — the ground-truth label, already computed per week.
- **The taste graph** is derivable server-side from `visits` joined to
  `restaurants`, so no feature store is needed first.

## What would earn it back

- **~30 users with 5+ visits in one metro** (same threshold as
  [palate-neighbours](palate-neighbours.md)), AND
- **~2,000 decision events** — clicks, saves, directions, dismissals — not
  impressions. At today's rate that is years; at 200 active users it is weeks.

Check both with `rec_funnel_history(52)` before starting.

## What would kill it

If the hand-weighted scorer, once ratings arrive from the backlog card, already
ranks held-out visits well. The current baseline is MRR 0.054 on four usable
data points — too few to mean anything, which is itself the reason to wait.

## Rough shape when the time comes

Features from the graph the app already computes: cuisine affinity, price
proximity, distance, hour-of-day fit, open-now, friend visits, gem signals.
Label from `visits_7d`. Logistic regression or a small GBDT, trained offline,
weights shipped as a table the scorer reads — no new service, no inference
cost, and the existing scorer stays as the fallback and the control arm.
