# Palate — Product Strategy Review

*A code-grounded assessment of what will make Palate succeed as the food diary + discovery layer that replaces "ask TikTok where to eat."*

---

## The strategic frame

You've chosen a model with one unforgiving consequence: **no consumer monetization means engagement and viral growth are not "nice to have" — they are the entire business.** If the data is the asset, then the only things that matter are (1) how many people log, (2) how often they come back, and (3) how many people each user brings. Everything below is judged against those three.

The good news: the *hard* part is already built well. You have a real logging loop, a genuinely strong reflection loop (Wrapped), a clever cold-start lever (Gmail import), and a differentiated dataset (menu-item-level sentiment) that Beli does not have. The gap is not the foundation — it's that **the retention and virality layers that turn the foundation into a flywheel are mostly stubs or dead code.**

There are three flywheels you need spinning. Today only one turns.

1. **The habit flywheel** (log → reflect → log again). *Mostly built.*
2. **The social/viral flywheel** (log → share → friend joins → both log). *Largely stubbed.*
3. **The data flywheel** (more logs → better recs → more logs, and the aggregate becomes the moat). *The thesis, but the code doesn't exist yet.*

---

## What's already strong (don't rebuild these)

- **Daily logging loop.** Home as a "decision engine" (`mobile/app/(tabs)/index.tsx`), GPS "Check now" auto-detect, confetti + `VisitCelebration` / `FirstVisitCelebration` on log. This is well-designed and is the action everything depends on.
- **Weekly Wrapped.** Fully wired: Sunday cron (`0017_sunday_wrapped_cron.sql`) → `generate-weekly-wrapped` → push → auto-playing story (`wrapped-story.tsx`). This is your single best engagement engine. Lean into it.
- **Streaks.** Real consecutive-day logic with a forgiveness window (`lib/streak.ts`) and milestone confetti.
- **Gmail auto-import.** Scans receipt senders and backfills 90 days of visits (`gmail-import` + `lib/gmail.ts`). This is the most powerful onboarding lever you have — it solves the empty-diary problem instantly.
- **The dataset.** Menu-item-level loved/ok/not-for-me (`0023_menu_items.sql`), aspirational signal (wishlist + `aspiration_tags`), and a derived taxonomy (`0013`) Google doesn't expose. This is genuinely differentiated.

---

## The critical gaps, prioritized

### TIER 1 — Fix now (these directly cap retention and growth)

**1. Re-engagement is nearly nonexistent. The only push is Sunday Wrapped.**
There is no streak-at-risk reminder, no "a friend just logged," no daily nudge (`lib/notifications.ts` only schedules the Sunday local reminder). For a habit app, this is the #1 retention hole — you've built a streak system and then given the user no reason to open the app to protect it.
*Do:* daily "your streak is at risk" push in the evening if not logged; "friend X logged a place near you" push; "you were at [detected place] — log it?" These are the difference between a 15% and a 40% D7.

**2. The referral loop has no incentive and is buried.**
Link generation exists (`lib/referrals.ts`) but lives only in Settings, with no reward, no incentive copy, and no in-flow prompt. `postMilestone` / `postMilestoneAndNotify` (`lib/feed.ts`) are **defined but never called** — dead code. Your viral ambition currently has no working engine.
*Do:* surface "invite a friend" at the highest-emotion moments (after first visit, after Wrapped, on a milestone). Give a reason to invite that fits a no-monetization model — e.g., "see how your palate compares to [friend]," unlock a compatibility score, or co-built lists. Social comparison is your reward currency, not discounts.

**3. Celebration moments aren't connected to sharing.**
`FirstVisitCelebration`, milestone confetti, and Wrapped all fire — but none has a "Share this" CTA, even though you've built beautiful 9:16 share cards (`SharePalateCard`, `VisitShareCard`, `WrappedStoryCard`). You're manufacturing pride and then not letting people broadcast it.
*Do:* every celebration ends with a one-tap share to Stories. Wrapped especially — that's your Spotify-Wrapped viral moment and it should be impossible to finish without being offered the share card.

### TIER 2 — Build next (these are required to be the *discovery* destination)

**4. There is no TikTok-style discovery surface. Discovery is utilitarian.**
This is the big one for your stated goal. Today, discovery answers "what should I eat right now" (`Discover` tab, `RightNowHero`). TikTok's pull is the opposite: **passive, photo/video-forward, endlessly scrollable, entertainment-first browsing** that happens to be about restaurants. You have none of that loop. The feed (`feed.tsx`) is friends-only and low-density — mostly auto `visit_logged` lines and a heart.
*Do:* build a vertical, media-forward discovery feed of real places — visit photos, short clips, "why people like it," compatibility score overlaid. Seed it with your existing visit photos and editorial blurbs. This is the surface that makes Palate the place people *open when bored*, which is the precondition for replacing TikTok.

**5. The core thesis — "people with your palate loved this" — isn't built.**
Scoring is pure per-user frequency matching across three *divergent* scorers (`recommendation/compatibility.ts`, `palate-match-score.ts`, `match-score.ts`), consumed inconsistently (`restaurant-ranking.ts` still uses the legacy one). There is **no collaborative filtering**; `palate/palateCompatibility.ts` is explicitly a scaffold. The aggregated taste data you're betting the company on has no code path that exploits it.
*Do:* (a) unify on one scorer. (b) Build the first aggregate signal: "users whose palate overlaps yours rated this dish 'loved'." Even a crude cohort lookup beats TikTok because it's *personalized to taste*, which TikTok cannot do. This is also what makes the data a moat instead of a spreadsheet.

**6. Time-to-value is multiple sessions, and the onboarding quiz is wasted.**
Onboarding is appropriately low-friction (`onboarding/quiz.tsx`, ~60s), but the starter recs are hardcoded brand strings (`lib/starter-quiz.ts` → "McDonald's, Subway, Starbucks") and the `quiz_persona` is **never fed into the scorer**. Real recs need 3–12 logged visits (`taste-graph.ts`). So a mass-engagement app makes new users wait days for value.
*Do:* wire the quiz persona into `computeTasteVector` as a prior so session-one recs are real and local; replace hardcoded brand strings with live nearby places that match the persona.

### TIER 3 — Strengthen the moat (latent value you've collected but don't use)

**7. Inventory isn't owned; the moat is enrichment + aggregate taste.**
Restaurants are fetched live per request from Google Places — coverage, freshness, and cost all depend on Google. Your defensible layer is the classifier enrichment (`_shared/classifier.ts`, v1.3.1 + LLM fallback) and the pooled taste data. Both are replicable *until* you have scale and the aggregate engine (#5).
*Do:* treat the classifier and the cohort taste-graph as the crown jewels. The faster you reach data density in a few cities, the harder you are to copy.

**8. Demographics, `cultural_context`, and `aspiration_tags` are collected and unused.**
You're capturing the exact signals needed for "people like you" cohorts (`0019_demographics.sql`) with zero consuming code.
*Do:* either use them (cohort recs, "popular with [your demo] nearby") or stop collecting them — unused PII is pure liability under a data-value strategy.

---

## Specifically on "become the TikTok of restaurants"

TikTok wins discovery because it is **content-first, passive, and infinite** — you don't go there with intent, you get pulled in. Palate today is **utility-first and intent-driven**. To own the discovery behavior you need to add the content layer without losing the diary:

- **A browsable media feed of places** (Tier 2, #4) is the non-negotiable foundation.
- **The "send a restaurant to a friend" primitive.** Right now people screenshot TikToks and text them. Make Palate the better rail: shareable place cards and collaborative lists ("our date-night list") that pull both people back in. This is the single most TikTok-displacing feature and it fits your no-monetization model perfectly — it's pure network growth.
- **UGC: photos and short clips on visits.** You already capture `photo_url`; extend to short video and surface it publicly. Your users are already documenting meals — give that content a home so it stops going to TikTok.
- **Taste-personalized ranking** (Tier 2, #5) is your unfair advantage over TikTok, which can rank by virality but not by *your* palate.

---

## Suggested 30 / 60 / 90

- **30 days (retention):** streak-at-risk + friend-activity notifications; share CTA on every celebration and on Wrapped; wire the dead milestone feed events. *Goal: lift D7/D30.*
- **60 days (virality):** real incentivized invite at high-emotion moments; collaborative lists + "send a place" primitive; palate-compatibility-between-friends score. *Goal: lift K-factor above 0.5.*
- **90 days (discovery + moat):** media-forward discovery feed; unify scorers and ship the first "people with your palate loved this" cohort signal; wire the quiz persona into session-one recs. *Goal: make Palate the app people open when deciding *or* when bored.*

---

## Instrument these or you're flying blind

Under a data-value model, you must be able to prove engagement to whoever the data is valuable to. Track from day one: **D1/D7/D30 retention, logs per active user per week, streak survival curves, K-factor (invites sent → accepted → activated), Wrapped open + share rate, and time-to-first-real-recommendation.** Most of these have no instrumentation in the current code.

---

*Bottom line: the foundation is strong and the dataset is genuinely differentiated. The work that remains is not more diary features — it's the notification, sharing, and aggregate-taste machinery that converts a well-built logging app into a self-propelling network. Those are exactly the systems currently sitting as stubs and dead code.*
