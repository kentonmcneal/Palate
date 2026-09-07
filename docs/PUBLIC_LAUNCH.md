# Before the public App Store, and what happens after

Written 2026-09-07. Everything under "measured" was checked against the live
system, not estimated.

---

## Part 1 — What to improve before rolling out

### Measured healthy

| | |
|---|---|
| Crash reporting | Sentry DSN and auth token both present in EAS production. Source maps activate on the next build. |
| Scheduled jobs | 12 crons, **zero failures in seven days**. |
| Google spend | Hard cap 1,500/day, push alert at 80%, automatic degradation to catalogue-only. Never tripped; worst day ever 422. |
| LLM spend | `classify-cuisine-backfill` skips entirely with no API key and is capped at 500 calls/day in batches of 40. |
| Account deletion | In Settings, in-app. Guideline 5.1.1(v), a common rejection, already handled. |
| Eligibility gate | Structural. Every recommendation surface inherits it; the two ungated paths correctly show your own history. |

### The three real gaps

**1. Backups. This is the one I would not launch without.**
The Supabase free tier does not give point-in-time recovery. Today that is fine
— 14 accounts, 55 visits, all reconstructible. The day a stranger has logged
three months of meals, losing them is unrecoverable and unforgivable, and no
amount of care in the code substitutes for a restore point. **Pro is $25/month**
and buys daily backups plus PITR. Verify the current retention in the dashboard
before deciding; the tier terms change.

**2. Nobody is told when something breaks.**
Sentry receives crashes but nothing routes them anywhere. A crash at 8pm on a
Friday should reach a phone, not wait to be noticed. Sentry alert rules take ten
minutes and cost nothing on the free plan.

**3. There is no rollback runbook.**
An OTA reaches every install within two cold starts. That is the app's biggest
operational advantage and its sharpest edge, and the procedure for undoing a bad
one is currently "remember how". See Part 2.

### Blocking the submission itself

- **Sign in with Apple** — built (0.1.10), waiting on three account steps.
  Guideline 4.8 makes it a rejection, not a risk, because Google sign-in is
  offered and an emailed code cannot keep an address private.
- **Gmail** — a reviewer tapping Connect Gmail gets a 502 today. Guideline 2.1,
  non-functioning feature. Flag it off for the review build regardless: it
  cannot serve more than 100 users while the Google consent screen is
  unverified.
- **Demo account** — `palate.review1` needs visits in it. An empty account
  reviews badly.
- **Background location** — expect questions, not rejection. Have a short video
  of passive capture working and a note that location is never used for
  advertising.

---

## Part 2 — Operations for when growth is the only focus

The single most important operational fact: **most bugs here are fixable in ten
minutes without App Store review.** JS ships over the air. Only native changes
need a build. Design the response around that.

### The runbook

**A bad OTA is live.**
Republish the previous commit's bundle to all three runtimes — `scripts/ota.sh`
does every runtime in one command. Do not wait to find the root cause first;
restore the last good bundle, then diagnose. Expect two cold starts before it
takes effect, so tell people to force-quit twice if they are waiting on it.

**A crash spike.**
Sentry names the release. If it is a JS crash, it is an OTA fix. If it is
native, it is a build and a review, so the feature flag is the faster lever:
`feature_flags` is admin-editable from Profile → Admin and takes effect on the
next load, with no ship at all.

**An edge function is failing.**
Every function answers its own 401 to an unauthenticated call, which is a free
liveness check that costs nothing and proves the module loaded. `supabase
functions deploy` succeeding proves nothing on its own.

**Google spend runs away.**
It cannot, and this is already true rather than aspirational: a hard daily cap,
a per-account cap, and degradation to catalogue-only rather than failure.

**Someone loses data.**
Today there is no answer. See gap 1.

### What to add as headcount grows

- Sentry alert rules → phone (ten minutes, free)
- A weekly read of `rec_funnel_history` — the permanent quality record, so a
  ranking regression is visible before anyone complains
- An uptime check on `places-proxy` and `gmail-import` — the free-tier
  monitors are enough

---

## Part 3 — Growth

The honest position: **Beli makes you log. Palate notices.** That is the whole
wedge, and every growth motion should demonstrate it rather than describe it.

Ordered by leverage for a founder working alone.

**1. One metro at a time, deliberately.**
Cost scales with metros, not headcount — the catalogue is the expense and it is
shared. A hundred users in Memphis is nearly free; a hundred across forty cities
is forty catalogues. Density is also what makes the social layer work at all:
compatibility, friend visits and "somewhere your people go" are dead below a
threshold in one place. **Open by metro, not by waitlist position.**

**2. Wrapped is the viral artifact, and it already exists.**
It is the thing people post without being asked. It is also the only marketing
asset that improves as the product does. Make it beautiful before spending a
dollar on anything else.

**3. Time-to-value is one meal.**
Install it, go to dinner, get asked "were you at Acre?" Nobody else can tell
that story. It is a better demo than any screenshot, and it belongs in the App
Store subtitle and the first ten seconds of any video.

**4. The invite loop is built and unused.**
Code, share sheet, credit on signup — shipped, zero uses. Seed it deliberately
with twenty people who eat out constantly in one metro rather than opening
broadly.

**5. Content only Palate can write.**
Yelp knows what people rate. Palate knows **what people go back to.** "The
twenty Memphis restaurants people actually return to" is a piece of writing no
competitor can produce, drawn from `visits` rather than reviews. That is the
strongest organic channel available and it costs nothing but a query. Wait until
the numbers are real; publishing a return-rate computed from three people would
be the fabricated-statistics mistake again, in public.

**6. App Store listing.**
The category is crowded with logging apps. Lead the subtitle with the
difference, not the category.

---

## Part 4 — Monetization, and when each becomes possible

| option | possible at | why then |
|---|---|---|
| **Nothing** | now → ~500 active | Monetising a ranking you have not yet proved is how trust is spent before it is earned. |
| **Restaurant attribution** | **~500 active in ONE metro** | The strongest option and the only one that uses the asset nobody else has. `visits_7d` proves somebody who saw a recommendation *walked in* — Google and Yelp can prove a click. Priced on performance, not impressions. Needs density: a restaurant cares about verified visits in its own city, not a national total. |
| **Consumer subscription** | ~5,000 MAU, D30 retention above 30% | Beli is free, so a paid tier must be obviously more: unlimited history, group planning, city guides when travelling. Retention is the gate — a subscription on a product people drift from is a refund queue. |
| **Display ads** | ~2,000–3,000 MAU | Measured: at ~$2–8 eCPM and realistic usage, $1,000/month needs roughly that many actives. It also attacks the one thing that differentiates the feed. Do this last, if ever. |
| **Aggregate insights** | ~10,000 MAU across several metros | Real dining trends have real buyers. Needs scale and a careful privacy line, and should never involve individual data. |

**The answer to "when is monetisation possible": about 500 active users in a
single metro**, and the product to sell them is attribution, not attention.

One piece of engineering makes this safe, and it is not built: a **`promoted`
flag on the slate**. Inject a paid placement into the ranked list without
marking it and the feedback loop learns from it as though it were organic — the
model starts believing people like whoever paid. The slate schema is where that
flag belongs and it is one field. Do it before the first paid placement, not
after.
