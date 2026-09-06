# The learning loop — 2026-09-06

What "the algorithm keeps improving to personal user tastes on every
interaction" means in this codebase now, what it does not mean, and the
numbers behind both. Every claim carries an evidence label.

---

## The short version

Before today the ranker had never received a single piece of feedback.
`COMMITTED` at `2ba206a^`:

- Home fired **no events**: not an impression, a tap, a save, or a directions
  tap. The surface that ranks on `finalScore` was the one surface the ranker
  could never hear back from.
- Discover's "impressions" fired for the whole pre-rank candidate array the
  moment the data loaded. 1,526 "views" that never meant seen.
- A table of signed event weights was written into `props` and read by
  nothing. `loadUserRecCounters`, "the ranker's negative-feedback loop", had
  zero callers.
- A "Not interested" tap wrote to `prompt_decisions`, the passive-capture
  cooldown table, so rejecting a recommendation suppressed the confirmation
  prompt at that place for six hours.

As of the OTA published today, every gesture on a recommended place is
recorded with enough context to be attributed, and each one changes that
place's rank by a bounded, decaying, explainable amount. The three Home rows
rotate instead of freezing. The third row steps outside the pattern on
purpose and says so. `LIVE` for anyone on 0.1.7, 0.1.8 or 0.1.9 after their
next launch.

It is not TikTok. Nothing is fitted. The reasons are arithmetic and they are
at the end.

---

## The rule that settles every design question

Three independent designs were produced and two syntheses judged them
(workflow `wf_5461eeba-fe1`). They disagreed on constants and agreed on one
rule, which the skeptic among them stated best:

> Implicit signal is **place-scoped**. A click, a directions tap, a save, a
> pass, an ignored card changes the ORDER of that one place, by a bounded and
> decaying amount, and never touches the taste graph or the displayed
> "% match". Only things a person says in words or with their feet — a
> confirmed visit, a rating, "Not interested" with a reason — may generalise
> to places they have never seen.

Why: the founder's real top ten around Memphis is ten American places in a
three-point band. Let a click on one of them nudge "American" in the graph
and the ranker trains on its own output: show American, get American clicks,
learn American, freeze harder. At n = 14 accounts nobody could detect that
happening. So it is forbidden structurally rather than tuned:
`feedback-loop.test.ts` asserts that passes on every American place but one
leave that one's `finalScore` **bit-identical** (`toBe`, not a tolerance),
and that the displayed % never moves. `COMMITTED`.

---

## What shipped, with evidence

### 1. Instrumentation truth — `2ba206a` `LIVE`

`lib/recommendation-events.ts` rewritten. Every `rec_*` event carries
`surface`, one `request_id` per ranking pass, `rank` in that pass, `slot`
(`exploit` | `explore`), the `matchScore` and `finalScore` the card showed,
the active `mood`, and a `session_id` minted on each foreground.

- An **impression** is now measured: a card at least half on screen for half
  a second, against the ScrollView it lives in (`components/Impressions.tsx`,
  React Native has no IntersectionObserver), once per place per surface per
  ten minutes. Five unit tests on the visibility arithmetic.
- Home rows fire impression, click, save, Apple Maps, Google Maps.
- Discover cards fire the same, plus the Stretch tab and the stretch pick are
  tagged `slot: "explore"`.
- The detail page fires save and directions, **attributed to the
  recommendation it was opened from** when there was one (`rememberRecTouch`
  / `recContextFor`, thirty-minute memory).
- The `prompt_decisions` cross-write is gone. The dead `dismiss()`, the dead
  weight table, `trackImpressions`-on-load and `loadUserRecCounters` are gone.

### 2. The ledger — `b9baf79` `LIVE`, behind `feature_flags.rec_feedback_loop`

`lib/recommendation/feedback.ts`, pure, shared by the harness and production.

| gesture | finalScore points | cap | half-life |
|---|---|---|---|
| ignored day (shown, nothing taken that day) | −2.5 | 4 days → −10 | 14 d |
| opened the detail page | +1.5 | 2 → +3 | 14 d |
| asked for directions | +3 | 1 | 30 d |
| saved | +3 | 1 (freshest) | 60 d |
| "Try another" | −3 | 2 → −6 | 14 d |
| clamp on the sum | | [−10, +6] | |

"Ignored day" counts **once per place per local day** however many times the
app was opened — an afternoon of app-switching is one pass, not five. A day
with a click, save or directions on that place is not a pass. A real visit
wipes the passes before it: you went, so the shows were not rejections.

The adjustment lives in `scoring.ts` beside the gem and café terms. It is not
in `compatibility.ts`, so the cached % cannot jitter because someone
scrolled. `makeGraphId` therefore ignores it.

**Sizing was measured, and the first size was wrong.** Uncapped, Acre ranks
102.8 with the American cluster under it at 92–96, and each cluster member
takes its own pass penalty as it gets its turn. With the designs' −2 × 3 cap
Acre sat in slot one on **27 of 30 simulated ignored days**: the whole
cluster settles at the clamp and the raw order comes straight back. A score
penalty alone cannot rotate a three-row list. So there is also a shortlist
**rule**, like the cuisine cap: a place ignored three days running sits out
until those passes decay (`isResting`). Thirty simulated ignored days now
show **26 distinct places, nothing more than 8 times** (`COMMITTED`,
`feedback-loop.test.ts` prints it).

`finalScore` lost its 99 ceiling on the way. It is an ordering key that is
never displayed, and the cap had flattened the top of the pool into ties
that swallowed the penalty.

### 3. The explore row — `b9baf79` `LIVE`

`lib/recommendation/shortlist.ts`. When the pattern is narrow — the top
cuisine is 40% or more of visits (the founder: 16/35), or the two exploit rows
share a cuisine — the third Home row is a deliberate step outside it: the
best-ranked place in a cuisine under 5% of the person's visits, adjacent to
something they do eat (`isStretch`), open, within 4 km, never something they
said no to, not on a pass, not seen this month. Drawn from the top three with
a seed of user + local date, so it holds still all day and changes tomorrow.
Labelled **SOMETHING DIFFERENT**; its events carry `slot: "explore"` so its
outcomes can be read apart from the rows the model was sure about.

On the real pool it fires 11 of 30 ignored days (the eligible pool within
4 km is about a dozen places, and each gets its day before the month turns),
never American, never leaves a day with one cuisine. Off while a mood chip is
active and while the graph is thin.

The hero's unlogged `Math.random() < 0.07` swap is deleted rather than
extended. Exploration nobody can read is pure cost. (The hero itself,
`RightNowHero`, is rendered nowhere — dead since Featured Lists took Home.)

### 4. Two explicit-signal fixes — `b9baf79` `LIVE`

Both are Class A and allowed to move the %:

- A **not_for_me visit never cost that place a point**. The per-place
  sentiment map was loaded and then skipped in `computePersonalDelta` ("safe
  to skip", said the comment). Now `+6 × (loved − not_for_me)`, clamped
  [−12, +6], keyed by `google_place_id`.
- A **save reached region and subregion but never `cuisine_type`**, the
  best-populated cuisine column (77% of rows) and the one `scoreTaste`
  weights 0.35. `cuisineTypeAspirational` now blends in at the same 0.2
  visit-equivalents.

### 5. Cold start leans instead of building a wall — `225d4e5` `LIVE`

`affinityOf` normalises by the person's own top bucket, so three visits to
three cuisines gave each of them 1.0 and everything else exactly 0. The taste
term now shrinks toward neutral by evidence, trust = m/(m+5): at 3 visits a
match reads 0.69 and a miss 0.31; at 35 it is 0.94 / 0.06, so the founder's
harness moves by about two points (84.0 / 56.4 / 47.3 → 81.9 / 56.4 / 50.0)
and good > unknown > poor holds at every size. While the graph is thin the
Home cuisine cap is 1 (three rows, three answers) and the explore row is off.

### 6. Reading it — migration 0136 `LIVE`

- `feature_flags.rec_feedback_loop` = **on**. Off means the app reads no
  feedback rows and ranks exactly as before. It is a kill switch, not a
  launch gate, which is why it shipped on. Flip it from the flags table.
- The 180-day analytics prune keeps `rec_*` events for **730 days**. They
  were the only rows that could ever justify a learned ranker and they were
  being deleted on a schedule.
- `rec_funnel(p_days)`: admin only, aggregates only, on the 0123 pattern.
  Per surface × slot × rank: verified impressions, clicks, saves, directions,
  try-another, not-interested, and **confirmed visits within seven days of an
  impression at that place** — computed at read time from the events, no
  second store, no cron. The migration's proof block inserts probe rows,
  invokes it as the admin (plpgsql parses `return query` at runtime), checks
  the click landed in its group, and checks the prune keeps a 400-day-old rec
  event while dropping a 400-day-old ordinary one. The push succeeded, so
  every one of those held.
- **Profile → Admin** shows the last 28 days per surface — seen / taken /
  went / people — and the explore slot on its own line.

### 7. The harness — `b34eafb` `COMMITTED`

589 → **655 tests**. New: fold semantics and bounds (`feedback.test.ts`),
non-generalisation, rotation, coverage and the save-at-lunch case on the real
pool (`feedback-loop.test.ts`), the explore slot's eligibility, determinism
and collapse guard (`shortlist.test.ts`), cold start (`cold-start.test.ts`),
and the held-out visits below.

---

## The held-out number, and what it says

`founder-visit-places.json` is the founder's 35 visits with place ids, pulled
from the live database, so a leave-one-out replay exists for the first time:
build the graph from everything except one visited place, rank the pool,
record where the place he actually went lands.

Only **four** of his 29 places are inside the 200-row Memphis pool. Four
reciprocal ranks are a smoke check, not a measurement, and the test asserts
only that at least one lands in the top thirty.

Baseline: **178, 6, 27, 178** of 200. MRR 0.054. The two at 178 are Italian
(Josephine Estelle, eaten twice, 4.4★, open, at the search point) and
Mexican. Both are cuisines he has eaten — but with that one place removed the
graph had never seen the cuisine, and the taste term reads never-eaten as a
poor fit. For a person whose 28 typed visits span nine cuisines, that is the
wrong reading.

I tried the obvious fix — a floor that reads never-eaten as neutral in
proportion to the person's own first-visit rate — and **reverted it**: it
lifted every never-eaten cuisine together, so the held-out ranks did not move
(168 vs 178), and it put never-eaten above unclassified on the real pool,
breaking the good > unknown > poor ordering the taste term exists to produce.
The finding is real, the number is now in the harness where it cannot be
forgotten, and the fix is not a constant. It needs a second palate in the
pool and an honest way to separate "never tried" from "tried and passed".
That is the most important open question in the ranker.

---

## What is deliberately not built, with the gate for each

All three designs and both syntheses agreed on this list. The arithmetic:
14 accounts, 55 visits, 35 of them one person, one metro, a 200-place
eligible pool, three Home rows, and — until today — zero verified impressions.

| not built | why not now | gate |
|---|---|---|
| any fitted model (logistic re-ranker, per-user weights, bandit over W) | ~10 positives per parameter → ~100 attributed visits; at ~1,200 impressions/month and ~2% visit rate that is months, and 64% of the labels would be one person | ≥ 2,000 labelled impressions from ≥ 30 users, ≥ 100 attributed visits, no user above 30% |
| collaborative filtering | 55 visits over 1,620 items is an empty matrix; the co-visit graph is a star around the founder | never at one metro |
| implicit → attribute generalisation | the collapse mechanism above; undetectable at this n | ≥ 500 impressions per user AND explore-slot outcomes showing attribute-level CTR differs from base rate |
| position prior as a weight | cannot be estimated below ~400 impressions per position | ≥ 400 at any single position; rank is logged now |
| slot habit (weekday lunch vs weekend dinner) | 35 visits into 4 buckets is a whisper | ≥ 40 held-out visits in the pool |
| detail dwell, decision-window multipliers, mood as a weight | noise on a three-row surface; mood is about tonight | logged as columns, weight 0 |
| A/B tests | 14 users cannot resolve a 20% lift | before/after on visits-within-7d, with the flag as the "before" |
| LLM re-ranking | cost rule, no eval, and volume is the bottleneck, not representation | — |

"Improves on every interaction" is delivered in the honest sense: every
click, save, directions tap, pass and ignored day changes the next ranking by
a bounded, decayed, explainable amount, and the frozen 88–91 cluster at the
top of the real pool visibly rotates. It is not delivered in the sense of a
model retraining on the interaction, and a design that pretended otherwise
would fit one palate and look brilliant in replay.

---

## What to watch, and the only two knobs

From Profile → Admin (or `select * from rec_funnel(28)`), weekly, for sixty
days, without touching constants:

1. **Went within 7 days per 100 seen.** The objective. Never measured before
   today; the first four weeks are the baseline. Expect 1–3%.
2. **Not-interested per 100 seen.** Should fall; it is the user saying
   "wrong".
3. **Explore taken-rate versus slot-3 exploit taken-rate** on days the
   explore row did not fire. Same slot, so position is not the confound.
4. **Repeat rate**: share of impressions that are a fourth-plus ignored show
   of a place. Target under 20%.

Exactly two constants may move in that window, each on a stated trigger:
`FEEDBACK.untaken` if the repeat rate stays above 20% or Home stops
rotating; the explore trigger (`EXPLORE_TOP_SHARE` 0.40) if explore
taken-rate sits below a quarter of exploit for sixty days. Anything else
needs a hypothesis and an expected direction written down before the harness
runs.

---

## Also today, from the earlier message `LIVE`

Update groups `fd6bc617` (0.1.9), `6df93653` (0.1.8), `00468c82` (0.1.7):

- "Bbq" and "BBQ" were the cuisine slug and the dish slug title-cased two
  ways; chips dedupe on a normalised key and acronyms stay upper-case.
- "Surprise me" removed: with the catalogue fallback it returned the same
  list as Anything.
- "Tacos" folds into "Mexican" when Mexican is on the row.
- Google's rating leads the subline on Home and Discover, in saffron.
- Colour: the mood chip fills with its cuisine's hue when selected; a
  photo-less Home pick gets a monogram tile in it; a Discover card carries a
  rail of it down its edge; the cuisine word is set in it; the active Discover
  tab is brand red.
- The hairline above the first Home pick is gone; the divider sits only
  between picks.
- Nearby on Discover has the mood chips, applied before the cut to thirty so
  "Thai" means the closest Thai.

---

## Still yours

- `feature_flags.server_push`, `direct_messages` — untouched.
- Sentry DSN and slugs; DMARC; Beta App Review for 0.1.9.
- `business_status` and `ANTHROPIC_API_KEY` backfills — paid, not run.
- The held-out finding above, when there is a second palate to test against.
