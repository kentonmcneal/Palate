# Launch readiness — 2026-09-06

Everything here was measured, not estimated. Where a number could not be
verified from this machine it says so.

---

## Where we actually are

**The app works.** Passive capture runs end to end, the recommendation engine
is materially better than it was yesterday, and the social layer is complete.
Two things stand between here and heavy testing, and only one of them is work
an agent can do.

| | state |
|---|---|
| Build 0.1.9 | building (`df9b7cb4`), carries the native departure fix |
| Error monitoring | **blind** — Sentry has no DSN, all 30 `captureError` calls are no-ops |
| Analytics | working as of today (`capture_funnel` RPC + `app_opened`) |
| Cost controls | armed, never tripped, peak day 385 of a 1,500 cap |
| Database | 25 MB of a 500 MB ceiling, 14 of 50,000 MAU |

**Estimate: 2 to 3 days.** Roughly three hours of that is yours and cannot be
delegated (Sentry account, DNS, App Store Connect). The rest is mine.

---

## The passive capture funnel, measured over 30 days

This is the number that answers "does the core feature work". It comes from
6,825 telemetry rows the app could not read until today.

```
detected 668 → qualified 238 → resolved 83 → notified 20 → yes 10 / no 13 → logged 9
```

Read it correctly: 288 of the 351 "unqualified" are `open-visit`, a stop with
no departure yet, which is reprocessed when the departure lands. Not a loss.

The real losses, and what was done about each:

| loss | n | status |
|---|---|---|
| `no-venue-found` | 92 | Home/work suppression never fired; fixed 2026-09-05 |
| Departure stamped the wrong coordinate | — | fixed in 0.1.9 (native) |
| `dwell-too-long` | 32 | partly caused by the departure bug inflating dwell; fixed |
| `low-accuracy` | 24 | correct behaviour |
| notification suppressed | 64 | mostly correct (duplicate, rate limit, quiet hours) |

---

## Blockers before heavy testing

### 1. Error monitoring is blind — YOURS, ~20 minutes

`mobile/lib/observability.ts` resolves the DSN from `EXPO_PUBLIC_SENTRY_DSN`,
then `Constants.expoConfig.extra.sentryDsn`, then `""`. None of the three is
set, so `initObservability()` logs "no SENTRY_DSN" and returns. Every
`captureError` in the app is a no-op today.

1. sentry.io → create a project, platform **React Native**
2. Copy the DSN. Put it in `mobile/.env` as `EXPO_PUBLIC_SENTRY_DSN=...`
3. Set the same value as an EAS environment variable on the production profile
4. Sentry → Settings → Auth Tokens → create one with `project:releases`
5. **Send me the org slug and project slug** (not the token)

Then I add the `@sentry/react-native/expo` config plugin, wire source-map
upload, and build. Without the plugin every stack trace reads
`index.ios.bundle:1:284412`.

There is a second half most people miss: the config plugin uploads source maps
for the **binary's** bundle. You ship OTAs constantly, and each one replaces
that bundle with a different one whose maps were never uploaded — so the code
testers are actually running is exactly the code Sentry cannot read. The OTA
upload step has to be wired too, or monitoring silently degrades to useless a
day after each build.

### 2. Build 0.1.9 to TestFlight — YOURS, ~10 minutes plus Apple's review

`eas submit` uploads it. The **Beta App Review** step in App Store Connect is
yours, or external testers never receive it. Uploading alone leaves it at
"Ready to Submit".

### 3. Nothing tells you when a tester reports a bug — MINE, ~1 hour

`lib/feedback.ts` writes a real row to `public.feedback` and a screenshot to a
private bucket. Nothing notifies you. Bug reports accumulate in a table you
have to remember to query. A database webhook to email or Slack fixes it.

### 4. Google cap arithmetic at 50 testers — MINE, needs re-measuring

Global cap 1,500 billable calls/day, resets UTC. Per-user cap 120/day.
50 × 120 = 6,000, which is 4× the global cap — so the per-user cap stops
protecting the budget and roughly 13 heavy users could trip it for everyone.
Tripping is not a bill, it is a **silent app-wide outage during dinner
service**.

Today's catalogue-first change should cut this a lot: Home no longer makes a
Google call at all in a covered city. It needs re-measuring after a few days
of real use before inviting 50 people.

---

## Tomorrow, in order

### Free, mine

1. **Wire the Sentry config plugin and OTA source maps** — blocked on your slugs
2. **Feedback notification** — database webhook on `public.feedback`
3. **Re-measure Google spend** with catalogue-first live; adjust caps
4. **`featured_lists_refresh_nightly` audit** — it is the single biggest
   spender (377 of 1,053 billable calls in 30 days, 284 of them on one day)
   and the cron is nightly. Confirm the per-city weekly gate is really holding
   and consider halving the cities.
5. **Delete the dead second scorer** — `lib/match-score.ts` is a complete
   parallel scoring implementation with different weights, reachable only from
   its own tests. It is how the next regression gets in.
6. **`business_status`** — appears nowhere in the repo. No field mask requests
   it, no column holds it, nothing filters on it. We can recommend a
   permanently closed restaurant and would never know.

### Free, yours

7. **DNS: `palate.app` has no A and no MX record** (verified live). Consequences:
   `hello@palate.app` bounced silently and was the only support address in the
   app (now pointed at the feedback form); `app.json` declares
   `applinks:palate.app` so universal links are dead; share cards advertise a
   domain that does not resolve.
8. **DMARC** — `_dmarc.your-palate.com` is NXDOMAIN. SPF and DKIM are correct
   on `send.your-palate.com`. Login is email-OTP only, so deliverability is
   the login path. Add `v=DMARC1; p=none; rua=mailto:...` to start.
9. **Privacy policy and terms** point at `palate-zm29.vercel.app`. They work,
   but that is what a tester taps and what goes in App Store Connect.

### Paid, cheap, high value

10. **`ANTHROPIC_API_KEY` → the cuisine backfill.** ~$1.20 to $1.50 one time.
    Takes null cuisine from 376 of 1,620 rows to roughly 64. The function,
    prompt, abstention bar and cron all exist and have been inert.
    **Order matters:** this had to wait until `scoreTaste` read `cuisine_type`,
    which shipped today. It is now worth doing.

11. **Acclaim tags, hand-matched** — $0 in API spend, about a day of clerical
    work. `gems.ts` scores michelin +12, james-beard +10, bib-gourmand +8 and
    nothing writes those tags. Published lists are free.

### Paid, decide later

12. **Review and editorial enrichment** — ~$34 one time for the recommendable
    catalogue (Google Place Details at the atmosphere tier plus Haiku). Buys
    vibe and occasion tags, which currently come from rules that infer occasion
    from cuisine. Worth doing **after** there is a way to tell whether it
    worked.
13. **Nightly freshness sweep** — ~$20/month for a full catalogue rotation
    every 37 days. Removes the worst failure a dining app has: sending someone
    to a restaurant that closed. Measure the defect rate for ~$1.70 first.

### Not worth doing

Collaborative filtering in any form, and learning or A/B testing the scoring
weights. Fourteen accounts and about fifty visits, thirty-five of them from one
person. Eight free parameters against thirty-five outcomes from one palate is a
guaranteed overfit that will look like a win in replay.

---

## What monitoring actually needs to exist

| layer | state | gap |
|---|---|---|
| Crash reporting | Sentry installed, **no DSN** | blocker |
| Source maps | no config plugin | traces unreadable |
| OTA source maps | not wired | degrades a day after each build |
| Global error boundary | exists, `_layout.tsx` | ok |
| Unhandled rejection net | exists | ok |
| Breadcrumbs | `breadcrumb()` exported, **zero call sites** | the passive pipeline is where a trail would pay |
| Product analytics | `analytics_events`, 6,852 rows | readable as of today |
| Funnel denominator | `app_opened` added today | ok |
| Feedback alerting | writes to a table | nothing notifies you |
| Cost alerting | kill switch trips at 1,500/day | trips silently, nobody is told |

The two worth adding beyond Sentry: **breadcrumbs through the passive pipeline**
(detected → qualified → resolved → notified), which turns a Sentry event from
"it broke" into "it broke after resolve returned nothing", and **an alert when
the Google kill switch trips**, because right now that is an outage nobody
learns about until a tester complains.

---

## Costs, measured

### What you are paying now

| item | cost | evidence |
|---|---|---|
| EAS / Expo | **$19/mo** | your figure |
| Apple Developer Program | **$99/yr** ≈ $8.25/mo | required for TestFlight |
| Supabase | **$0** | Free tier. 25 MB of 500 MB, 14 of 50,000 MAU |
| Vercel | **$0** | Hobby, personal account, 4 projects |
| Google Places | **likely $0**, see below | 1,053 billable calls in 30 days |
| Anthropic API | **$0** | key not set, all LLM paths inert |
| Resend (email/OTP) | free tier | low volume, confirm in dashboard |
| Domain registration | whatever you pay | `your-palate.com` |

**Excluding your Claude subscription: about $27/month, and $19 of it is EAS.**

### Google Places, the only variable one

Thirty days, from `api_usage_daily`:

```
nearby                       675
featured_lists_text_search   377
search                         1
                           -----
TOTAL BILLABLE              1053     (plus 104 served from cache)
```

At list price (~$32 per 1,000 for these SKUs) that is about **$34/month**.
In practice Google's per-SKU monthly free allowance almost certainly covers
both SKUs at these volumes, so the real bill is probably **$0**.

**Confirm this in the Google Cloud console rather than trusting the estimate** —
it is the one number here I cannot verify from this machine, and the free
allowance changed in 2025.

The kill switch has never tripped. Peak day was 385 of 1,500.

### Two things to watch

- **Supabase is at the Free tier's two-project limit** (Palate and
  gre-mastery). A third project forces a paid plan at $25/mo.
- **Vercel Hobby prohibits commercial use.** The moment Palate is a business
  rather than a personal project, that is $20/mo for Pro. Worth knowing before
  it matters rather than after.

---

## Honest risks

1. **Nobody has watched passive capture work on a phone in this session.** The
   funnel numbers say it works. Two of us reading Swift is not the same as one
   person eating a meal and getting the prompt. Build 0.1.9 needs a real dinner
   before fifty people get it.
2. **The 0.1.9 runtime split.** Anyone on 0.1.8 keeps working but stops
   receiving OTAs for the 0.1.9 line. I have been publishing to all three
   runtimes; that continues until testers have moved over.
3. **The recommendation changes shipped today are measured against one
   palate** — yours, 35 visits, one city. They are correct in the sense that
   the ordering invariant now holds and closed restaurants sink. They are not
   validated across users, because there are not enough users to validate
   across.
