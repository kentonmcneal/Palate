# Overnight log — 2026-09-14

Ranked by what most deserves attention in the morning.

---

## Read this first

The notification system was not working, in three independent ways. I found the
first by accident — a routine health sweep — and the other two by pulling on it.

1. **The friend-visit push could not reach anybody.** §10d. The thing you asked
   for last night. 0162 fixed the wording and the dedupe correctly, then gated
   the recipient query on a column retired a hundred migrations ago. Your
   settings switch writes `push_social_activity`; the trigger read
   `push_friend_activity`. It was on for all nineteen accounts and delivered
   nothing. Fixed and verified end to end in 0170 — one visit now enqueues two
   notifications where it enqueued zero.

2. **The drain only worked about a third of the time.** §10. Over six hours it
   ran 69 times and succeeded 21. Twenty-seven runs reported "server_push
   disabled" while the flag was demonstrably enabled, and twenty-one returned
   `{"error":"[object Object]"}`. Both failure modes lied, in the direction of
   looking fine, which is why it survived. Reads now retry; failures now say
   what failed.

3. **A transient read error was destroying real notifications.** §10b. An
   unguarded profile lookup meant a timeout made everyone look tokenless, and
   those rows were retired permanently as "no push token". Proven: a user who
   received a push at 17:35 had their comment notification destroyed at 18:05
   with that reason.

4. **A privacy gate had been dropped from two broadcast paths.** §10f. Private
   profiles are supposed not to broadcast — 0057 says so explicitly. The
   friend-visit trigger lost that check in 0162, and **my own fix an hour
   earlier carried the omission forward**, because I rewrote from the version I
   was replacing instead of reading the one before it. notify-feed-post had it
   backwards entirely: it checked the recipient's visibility, never the
   poster's. Nothing leaked — the one private account has no followers — and
   both are closed now, verified by A/B on the same actor.

**The one thing I could not fix** is the cause underneath #2: PostgREST
returning 504 Gateway Timeout to the cron's calls. The database is idle (15 of
60 connections, no slow queries), so it is upstream. Worth raising with
Supabase. Everything I did there is mitigation.

**The same bug class, pointed at money** (§11a): the classifier's $10 ceiling
and the Google kill switch both failed OPEN on a read error — `?? 0` turning an
unreadable total into "nothing spent yet". Nothing has been spent and nothing
starts spending from this; `ANTHROPIC_API_KEY` is still unset. But that fix
needed to exist before you ever set it.

Also shipped: onboarding steps that lost their buttons at one notch above
default text size (§ below, audit #9), and a moderation mechanism behind your
published 24-hour SLA, which previously had none (audit #6).

---

## 1. I shipped a change today on a number I had been told not to trust, and reverted it

**What happened.** Earlier I moved unscored inbox entries from the Medium band
to Low, reasoning that Medium (36%) underperformed Low (45%) and therefore held
two populations. The audit that produced those figures had already flagged them
as invalid in its own disagreements section: they join `visit_resolved` to
`prompt_decisions`, and `visit_resolved` logs the **pre-demotion** band while
the digest acts on the **post-demotion** one. It said in as many words not to
quote the number. I quoted it.

**Re-derived** from `confirm_yes` / `confirm_corrected` / `confirm_no`, which
carry the band actually displayed, counting a correction as a capture because
the meal happened and only the name was wrong:

| band | captured | refused | precision |
|---|---|---|---|
| high | 12 | 13 | **48%** |
| unbanded | 3 | 6 | 33% |
| medium | 6 | 17 | 26% |
| low | 0 | 12 | **0%** |

Monotonic. The anomaly that justified the change does not exist. Reverted.

**Two things this surfaces that I did NOT act on, because 25 decisions is not
enough to decide at 3am:**

- **High runs at 48%, not 91%.** High is the only band that arrives pre-ticked,
  so one tap on Confirm writes a coin flip into the diary, the taste graph,
  Wrapped and the public profile. It may be that nothing should be pre-ticked.
- **Low has produced zero captures in twelve decisions.** If that holds,
  asking about low-band stops is pure cost.

---

## 2. Location-scoped learning had never recorded a single location

110 `prompt_decisions` rows. Every one has a null `lat` and `lng`.

Migration 0145 added those columns so a refusal would be evidence about a venue
**at a position** rather than about a brand. Its own comment predicted the
failure exactly: *"prompt_decisions.lat stays null forever and nothing is ever
learned about a spot."*

The realtime confirm screens do pass a position. But `REALTIME_PROMPTS_ENABLED`
is false, so those screens never run — and the digest, the only confirmation
path in production, was the one that dropped it. `ConfirmableEntry` did not
declare the coordinates, and `digest.tsx` passes entries through `as never`, so
nothing complained.

The data was present the entire way: `InboxEntry` carries them, `toDigestEntry`
spreads them, `DigestEntry` is `InboxEntry & {…}` so they are even typed at the
boundary. A cast erased them one line before use.

**Fixed and shipped.** This is what makes "the Panda Express across the Walmart
car park" learnable, which is the shape of the Winchester Road complaint.

---

## 3. A risk I introduced today and want flagged

Notification permission is now requested **provisionally**. That trades loud
delivery to ~40% of people for quiet delivery to ~100%.

The evening digest is the **only** confirmation path in production. Quiet
delivery means no banner and no sound — it lands in Notification Center. The
digest open rate is already thin (12 opens by 3 people in 7 days against 186
resolved venues), and provisional could reduce it further for new users.

The upgrade path exists — the full permission is asked for after a first
confirmed visit — but a new user has to get through the digest at least once to
reach it. **Worth watching, and reversible in one line.**

---

## 4. The detection funnel, measured rather than assumed

Last 7 days, 5 active users: **1,226 stops → 401 qualified → 186 resolved → 11
visits logged.**

Where it goes, with the reasons the code actually records:

- **`open-visit` 576** — a stop still in progress. Not a loss; the same stop
  reported repeatedly before it ends.
- **`dwell-too-long` 109** — over the 4-hour ceiling. I checked this expecting a
  bug and it is fine: those are homes, offices and long stays, not meals.
- **`no-venue-found` 211** — no food venue in range. Plausibly correct: shops,
  friends' houses, petrol stations.
- **`suppressed-duplicate` 115** — the same place detected again. Will rise now
  that dedupe is same-place-same-local-day rather than within-the-hour, which
  is the intended direction.

**The loss is not detection. It is confirmation.** Of 186 resolved venues, 20
were confirmed, 48 refused, and 41 expired unanswered. More entries expire than
get confirmed.

That points at two things, in order: attribution precision (48% at the band we
pre-tick), and whether people see the digest at all (see §3).

---

## 5. The cast that hid both of the above

`digest.tsx` called `confirmDigest(confirmed as never, skipped as never, …)`.
Both §2 and §4's telemetry gap lived behind that one line: the fields were
present on `DigestEntry`, declared on both sides, and erased at the boundary
because a cast to `never` tells the compiler not to check.

**Removing all three casts compiled clean on the first try.** They were never
needed for anything.

Swept the rest of the codebase: every other `as never` is on `router.push`, an
expo-router typed-routes workaround that hides no payload. This was the only
one erasing data. Guarded, and the guard was run against a restored cast.

---

## 6. Half the calibration data has never been written down

`confirm_yes` carried `dwell_min` and `candidate_count`. `confirm_no` carried
neither. **Neither carried `accuracy_m` at all.**

So all 48 refusals on record are featureless. Querying them returns
`candidate_count = null` for every one and zero rows in every accuracy bucket —
which reads like an absence of bad guesses rather than an absence of data, and
is exactly how you conclude the attribution is fine when it is 48%.

Both outcomes now emit one shape from one function, carrying accuracy and
whether the stop position travelled. This writes no new data by itself; it
means that in a week there will be something to calibrate *against*. `dwellFit`
is currently tuned on exactly one real case because one real case is all the
evidence that existed.

---

## 7. Two things I checked, expected to be bugs, and were not

Recorded because a night that only lists confirmed bugs is misleading about how
the time went.

- **`dwell-too-long` rejects 109 stops a week.** I expected a ceiling cutting
  off long dinners. It is 4 hours — those are homes, offices and long stays,
  not meals. Correct as written.
- **`rec_pool` looked like it recorded nothing** (`pool = ?` on all 221 rows).
  My query was wrong, not the telemetry: the key is `source`, and it records
  properly. **210 of 221 candidate pools come from the free catalogue** and
  only 11 needed Google, which is good cost behaviour. The recommendation
  instrumentation is in better shape than the capture instrumentation.

---

## 8. Today's mapper fix does bite

`regular_opening_hours` was missing from the shipped `RestaurantInput` mapper,
so the open-venue filter had never excluded anything. Now that it is carried,
it only helps for rows that actually have hours — **86% of eligible restaurants
do** (3,658 of 4,262), and 85% have `business_status`. So the fix is real
rather than theoretical.

---

## 9. What the recommendation numbers say

14 days, 5 users: **1,958 impressions → 13 clicks → 8 map opens → 2 saves.**

Impressions are deduped one-per-place-per-surface per 10 minutes, so 0.66% is
a real click-through rate and not inflated by re-renders. I checked that before
quoting it.

I did not act on this. It is a product question — what the cards say, what they
promise, whether tapping is even the intended action in a product whose thesis
is passive capture — and not something to redesign unattended.

---

## 10. The push drain is failing most of the time

This is the biggest thing I found, and I found it by accident — a routine
health sweep of the outbox, not by looking for it.

**The drain succeeds about a third of the time.** Over the six hours to 06:25
it ran 69 times: 21 worked, 27 reported `server_push disabled`, and 21 returned
HTTP 500 `{"error":"[object Object]"}`. The flag is `enabled = true` and has
been since 2026-09-02.

I checked that all three response shapes really are the same job rather than
assuming it: `ok + falseOff + err` comes to **exactly twelve in every full
hour**, which is the `*/5` schedule. Three shapes, one cron.

It is chronic, not a spike — every hour in the window looks the same. I cannot
see further back than six hours because pg_net prunes `net._http_response`.

### Why it went unnoticed for so long

Both failure modes lie, and they lie in the direction of looking fine.

- The kill-switch read **discarded its error**. `const { data: flag }` — a
  failed read leaves `flag === null`, and `!flag?.enabled` reports that as the
  switch being off. Twenty-seven runs asserted the switch was off while it was
  demonstrably on, in a 200 response, which no alert would ever fire on.
- `String(e)` on a PostgrestError — a plain object with no custom `toString` —
  produces the literal `"[object Object]"`. Twenty-one crashes were visible and
  undiagnosable at the same time.
- The expiry sweep discarded its error too. `.update()` **resolves** with
  `{ error }` rather than throwing, so a sweep that never ran looked exactly
  like one that did. That is the same rule I wrote into the audit prompt and
  have now been bitten by twice.

### What I have and have not fixed

Fixed and deployed: the reporting. `errText()` prefers message/code/details/
hint, the kill switch now distinguishes unreadable from missing from genuinely
off, and the sweep logs its error. **This changes no behaviour and fixes no
crash.** It is the prerequisite for diagnosing one — the root cause cannot be
read through `"[object Object]"`, and I was not willing to guess at it and call
that a fix.

Not fixed: the actual failure. I have hypotheses (transient PostgREST reads
failing from the edge runtime is the shape of it, since both the flag read and
the due query are plain reads and both fail) but no evidence, and this CLI has
no `functions logs` subcommand, so the response body is my only channel. The
next failing run carries a real message. I deliberately did not trigger the
drain by hand to force one: it is an outward-facing send, and the cron does it
every five minutes anyway.

### What this cost

This is very likely the real reason friend-visit pushes have not been arriving.
The quota bug below is real and worth fixing on its own, but a drain that only
works a third of the time is the larger part of the answer, and I would not
have believed the quota numbers if I had not found this too.

## 10a. The root cause, as far as I got it

Once the drain could report properly, the first real failure read
`{"error":"Gateway Timeout"}`. That is supabase-js receiving a **504 from
PostgREST** — a bare message with empty code/details/hint, which is exactly the
shape supabase-js produces for a non-JSON error response.

**It is not the database.** I checked rather than assumed: 15 of 60 connections
in use, no query running longer than a moment, `statement_timeout` at 2 min,
and the hot tables are trivial (push_outbox 45 live rows, feature_flags 7). The
instance is idle. The timeout is upstream of Postgres, in the edge-runtime to
PostgREST path.

**I cannot tell whether this affects other functions**, and I want to be exact
about why rather than imply send-push is special. The only other cron running
often enough to compare is `classify-cuisine-backfill`, which has a perfect
record of 36/36 — but it returns at its `ANTHROPIC_API_KEY` check on line 73,
*before it ever touches the database*. Its success rate is evidence of nothing.
send-push is simply the only scheduled job currently exercising that path.

That matters, because the user-facing functions — places-proxy, group-recs,
notify-feed-post, delete-account — all hit the database on every call. If the
flakiness is platform-wide rather than specific to this one function, users have
been hitting it too. **I have no way to check**: `proxy_calls` records
(user_id, action, called_at) and no status, so it is a rate-limit ledger and not
an error log. There is no telemetry for edge-function failures anywhere. That
gap is worth closing, and it is a bigger change than I should make unattended.

**For you:** the 504s themselves are the one thing here I could not fix or
explain, and they are worth raising with Supabase. Everything below is
mitigation, not a cure.

### What I did about it

All four of the drain's reads now go through `retryRead` — 3 tries, 250ms
linear backoff. A cron that runs every five minutes and abandons the run on the
first 504 is barely retrying at all, since each tick starts from scratch with
the same odds; retrying inside the run turns three independent coin flips into
one much better one. Reads only: a write that timed out may well have been
applied. Permissions and schema errors fail fast instead of being retried into a
slower identical failure.

`retryRead` takes a thunk, not a query builder, because a PostgREST builder is
a thenable that settles once — passing one would re-await the same failure
forever, a retry loop that cannot retry. There is a test for exactly that.

## 10b. The unguarded read that was destroying notifications

This is the worst thing I found tonight, and it follows directly from the 504s.

The profile lookup discarded its error. A failed read yields `profiles === null`,
so the token map is empty, so **every row in the batch** falls into the tokenless
branch — which retires them permanently with `attempts = MAX_ATTEMPTS` and the
error `"no push token"`. A transient timeout was being written down as a
confident, terminal, false fact about the recipient.

Proven, not inferred. User `a6d005d3` received a push successfully at
**17:35:09** on 2026-09-13, and their `post_comment` notification at **18:05:56**
was retired thirty minutes later as "no push token". They had a token the whole
time — I checked their full outbox history rather than just their current
profile, because a token present *now* would not have proved it was present
*then*. Two real notifications were destroyed: a comment on a post and a like
on a comment.

At roughly a third of runs failing, an unguarded read on that path is a steady
shredder of real pushes. It now aborts the run and retries on the next tick.

The 24h quota tally was unguarded in the same way, with a milder failure: on a
failed read every count is zero, so every daily ceiling silently stops applying
and a rate-limited user gets precisely the firehose the caps exist to prevent.

## 10c. What the instrumentation caught, and what it did not

After the retry went in, the drain ran 06:45, 06:50, 06:55 clean and then
returned this at 07:00:

```
{"error":"server_push unreadable","detail":"Gateway Timeout"}
```

Three things at once, and all three are the point of having done the
instrumentation first:

- **The step label works.** It is the KILL-SWITCH READ that times out — the
  first fatal PostgREST call in the run. Not the due query, not the profile
  read.
- **It survived all three retries.** So the 504 is not a momentary blip; it
  persists across a 250ms and a 500ms backoff.
- **It no longer lies.** That exact failure, this morning, returned HTTP 200
  `{"skipped":"server_push disabled"}`. Twenty-seven times.

**Do not read the success rate as fixed.** Since the retry: 3 good, 1 bad, on
four samples. The baseline was 21 good and 48 bad over six hours. Four samples
against a 30% baseline is suggestive and nothing more — I am not going to
convert it into a percentage and imply I measured something I did not.

A failed tick now costs five minutes, not a lost notification: nothing is
marked, nothing is retired, and the next tick picks the rows up. That is the
part that actually matters, and it is true regardless of how the rate settles.

**I did not tune the retry further**, though it was tempting. I do not know how
long a 504 takes to come back, so I cannot size a backoff without guessing, and
three attempts already risk approaching pg_net's 30s ceiling. Guessing at
numbers and calling it a fix is what produced the original bug. The 504s want
Supabase's attention, not more of mine.

## 11. Announcements were starving the social loop

Separate defect, same sweep. Over nine days the outbox delivered **sixteen
"someone joined Palate" pushes and exactly one "someone you follow ate
somewhere"**, with ten of the latter dropped. The two most recent drops each
had three sent pushes in the preceding 24h, all three `user_joined`.

Eight of the ten drops were *not* this, and I checked before claiming
otherwise: they have `prior_sent = 0` and expired while `server_push` was off,
which the pre-flag sweep does deliberately so that flipping the switch does not
deliver a week of backlog. Working as designed. Only the last two are the bug.

`user_joined` is the only type that fans out to the whole user base on a single
event, so its volume grows as (signups x users) while every other type grows
with the recipient's own graph. In a shared daily budget it is structurally
guaranteed to crowd out everything else, and strictly more so as the app grows
— the exact opposite of what a launch needs.

Fixed: announcements get their own ceiling of one a day; surplus is dropped
rather than deferred; and a scarce slot now goes to the row that dies soonest
rather than the one that arrived first, so a 72h announcement no longer
outranks a 12h friend visit. Logic extracted to `_shared/push-quota.ts` with
twelve tests.

**The test was wrong first.** My reproduction case passed with the bug
reintroduced, because it hand-placed counts in a named bucket instead of
routing them through `classOf` — it was asserting its own setup. Rewired to
build the tally the way `send-push` does, then re-verified it fails when
announcements are collapsed back into the shared bucket. That is twice this
week I have written a test that asserted a null rather than a claim.

## 10d. The friend-visit notification could not reach anybody

The thing you actually asked for last night, and it was dead. I found it by
reading the LIVE function definition rather than the migration that wrote it.

0162 — written last night to satisfy "one notification when they confirm,
saying Allyson just ate at a new spot" — got the dedupe and the vague body
right. Both are preserved. Its recipient query had two faults:

**The wrong toggle.** 0055 gated this on `push_friend_activity`. 0057 replaced
that with `push_social_activity` and migrated the values across. 0093 kept the
new column. 0162 rewrote the function and silently reverted to the old one.
Measured: `push_social_activity` is default TRUE and true for all 19 accounts;
`push_friend_activity` is default FALSE and false for all 19. So the WHERE
matched nobody.

The sharpest way to say it: **the settings switch was wired to a column the
trigger did not read.** `lib/friend-push.ts` reads and writes
`push_social_activity`, and its own header lists "a friend's visit" as one of
the three events it governs. It was on for all nineteen people and delivered
nothing. Turning it off would have changed nothing either.

**The wrong graph.** It read `public.friendships`, which 0116 retired in favour
of follows and left "unread, so this is reversible for one release".
friendships: 3 rows, 1 accepted, newest 2026-09-05. follows: 15 rows, newest
2026-09-13. Every other social trigger and notify-feed-post had moved. This one
had not, so even with the right toggle it fanned out over a dead table.

Fixed in 0170. Audience is now followers, matching the rest of the social layer
— which is a one-way relationship, and exactly why 0162's vagueness is kept:
the push says somewhere new, never where.

**Verified end to end, not by reading.** Inserting one real visit takes
friend_visit rows from 11 to 13 with the right title, body and per-day key.
Before, zero. The test ran inside a transaction I rolled back, then I re-read
both tables to confirm the count returned to 11 and no visit survived — a
verification that wakes you at 2am is not a verification I should run.

The first version of the migration's proof failed on its own documentation:
the body explains why `push_friend_activity` is retired, so naming it in a
comment tripped the check looking for it. Strips comments now. That is the
third time tonight a check I wrote asserted the wrong thing, and the second
time this week a guard tripped on its own prose.

## 10e. Shipped, and the numbers as they actually stand

**OTA published** to all four live runtimes (0.1.10 / 0.1.9 / 0.1.8 / 0.1.7),
group b2e39164 on 0.1.10. Carries the onboarding scroll fixes. Verified
afterwards that app.json was restored to 0.1.10, no lock file survived and the
tree is clean — that script rewrites the version three times and a stray commit
mid-loop is a known way to silently mis-set a future build's runtime. Remember
it takes two launches to apply: one to download, the next to run.

Server-side work needed no OTA and is already live.

**Drain, since the retry:** 5 good, 1 bad, against a baseline of 21 good / 48
bad. Six samples is still six samples — but five-or-better out of six is about
a 1% outcome at the old 30% rate, so this is now evidence of improvement rather
than just encouraging. The single failure was the labelled one at 07:00.

**Friend-visit reach, checked precisely.** My migration's proof counted
eligible followers WITHOUT the timezone condition the trigger actually applies,
which is a looser test than the thing it was asserting. I went back and ran
both: 3 either way, because all three eligible followers have a timezone. So
the claim stands, but it stood by luck rather than by construction. The
end-to-end test enqueued 2 rather than 3 because that particular actor has two
followers, not three — the numbers are consistent, and I checked rather than
letting two different figures sit in the log unexplained.

## 12a. Also checked, also not a bug

Four things I went after in this stretch and did not find anything wrong with.
Recording them so nobody spends the morning re-deriving them.

- **Winchester Road is fully explained and fixed**, by last night's own commit,
  which I read rather than re-deriving. `dessert_shop` was missing from
  `RESTAURANT_TYPES`, so Insomnia Cookies classified as `not_a_restaurant` —
  which passive capture treats as not-a-dining-stop and filters BEFORE ranking.
  It was never a candidate rather than ranked low. 0163 repaired the rows, and I
  confirmed against the live catalogue: all four Insomnia Cookies rows now read
  `national_chain`, which `isLoggableVenue` admits deliberately.

- **A Chili's on Winchester Road is flagged `airport`**, which excludes it from
  capture, and I was ready to call that a misclassification of the same family.
  It is not: Memphis International Airport is itself on Winchester Road. Swept
  all 43 captive-venue exclusions for rows with no airport or hotel signal in
  name or address — exactly one borderline case (Social Oak, `lounge_gated`,
  primary_type `restaurant`), and no hotel misclassifications at all.

- **The comment and like notification toggles work.** `enqueue_social_push`
  gates on `push_post_likes` / `push_post_comments` (both default true), plus
  self-notification, block, token and quiet-hours checks, and both are wired
  into settings. This is the one part of last night's notification work that
  was correct end to end.

- **Two "below the line" audit items are genuinely done**: ProfileBody now uses
  `captureError` rather than swallowing into `console.warn`, and next-step gates
  the forwarding CTA on `FORWARDING_LIVE` as well as `GMAIL_OAUTH_ENABLED`.

- **Trigger functions are executable by anon**, all fourteen of them, which
  looked alarming for about a minute. Postgres refuses a direct call outright
  ("trigger functions can only be called as triggers", 0A000), so it is not
  reachable, and it is the project-wide default rather than anything new. I
  tested the call rather than reasoning about it, and did not churn a migration
  to "harden" something inert.

## 10f. A privacy gate had been dropped from two paths — one of them by me

Found by asking a different question: which profile columns does the client
write as preferences, and does anything server-side actually read each one?
That is the 0170 bug stated generally, and it turned up something worse.

0057's contract: what arrives on YOUR phone is the notification toggle; what
you BROADCAST is `profile_visibility`. "A private profile joins quietly, its
Wrapped is not announced, and its visits do not reach friends."

**The friend-visit trigger had lost it.** 0057 and 0093 both read the actor's
visibility and returned early on 'private'. 0162 dropped the check. **0170 —
mine, an hour earlier — reproduced 0162's body faithfully, including the
omission.** I based the rewrite on the version I was replacing instead of
reading the one before it, which is precisely the mistake 0162 made. Restored
in 0171.

**notify-feed-post had never implemented it, and had it backwards.** It never
read the poster's visibility at all (it selected only display_name and email
for them), so a private account's feed post was pushed to every follower. It
*did* read `profile_visibility` — on the RECIPIENT, filtering out followers
whose own profile is private. Wrong in both directions: visibility governs what
you SHOW, never what you may hear, so it silenced private accounts' own
notifications while doing nothing about the person broadcasting. It also meant
`push_social_activity`, the actual preference, was never checked on that path.

**Nothing leaked.** One private account, and it currently has zero followers.
Both gates now close before it has anything to stop, rather than after.

**Verified as an A/B on the same actor with the same followers**, changing only
the flag: public enqueues 2, private enqueues 0. I flipped a real person's
privacy setting to run that, inside a transaction, and re-read the table
afterwards to confirm 18 public / 1 private, the outbox back to 11, and no
visit rows surviving.

### Correctly NOT gated, so nobody "fixes" them later

`enqueue_social_push` (comment and like notifications) and
`enqueue_comeback_pushes` do not check visibility, and should not. A comment on
your post is correspondence addressed to you, not a broadcast of the author's
activity, and the comeback nudge is a push TO you about yourself. The four that
should gate — join, join-on-insert, wrapped, follow — all still do; friend_visit
was the only one that had lost it, which is why nothing else caught the change.

0171 now asserts every property the three rewrites established — the toggle,
the graph, the block check, the vague body, the per-day dedupe and the privacy
gate — so the next person to touch that function cannot quietly drop one, which
two consecutive rewrites already did.

## 11a. The same bug, but pointed at money

Having found that a discarded read error in send-push was destroying
notifications, I swept for the pattern. It is in the spend guards, and there it
does not cost notifications.

**The classifier's $10 ceiling was failing OPEN.** All three gates in
`classify-cuisine-backfill` read with the error discarded:

```
const { data: spentRaw } = await admin.rpc("llm_spend_total_usd", ...)
let spentUsd = Number(spentRaw ?? 0)
if (spentUsd >= LLM_LIFETIME_CAP_USD) return skipped
```

A failed read is null, `?? 0` turns that into "nothing spent yet", and the gate
opens. Same for the daily cap and the lifetime call cap. The ceiling was not
enforced by the ceiling — it was enforced by the read happening to succeed. The
in-loop recheck uses a locally accumulated total, so a run whose opening read
failed starts from $0 and can spend the entire ceiling again on top of whatever
was already spent, once per failure, on a cron that fires every ten minutes.

**Nothing has been spent and nothing starts spending from this.**
`ANTHROPIC_API_KEY` is still unset, and the function returns at that check,
which sits ahead of every gate I touched. This is the fix that needs to be in
place *before* you ever set that key — which, as agreed, is the thing that
starts the backfill.

**The Google kill switch was failing open too**, and that one is live:

```
const { data } = await admin.from("google_usage_counter").select("tripped")...
return data?.tripped === true;      // a failed read reads as "not tripped"
```

Both now read with retries and return "spend nothing" on a read failure. The
distinction that mattered: a MISSING ROW is not an error — the counter row is
created on the day's first call, so no row legitimately means no spend yet and
must stay open. Only a real read failure closes the gate.

**Scope, honestly.** `tripped` has never been true on any recorded day, so this
fail-open has not yet cost a cent. It is a hole that would have opened at
exactly the moment it mattered — when the cap was finally reached. And I
checked whether billable calls had been going uncounted rather than assuming:
`google_usage_counter.billable_calls` and the summed `api_usage_daily` google
rows are two independent counters, and they agree **exactly** on all eight
recorded days. Nothing has been lost.

That last result also cuts against my own theory. places-proxy hits the
database on every request and its metering is perfect over eight days, so
edge-to-PostgREST is not broadly broken. Whatever the 504s are, they look
specific to the cron invocation path rather than to every function — which
weakens the "users are hitting this too" worry I raised above. I am leaving both
the worry and this correction in, because I could not settle it either way.

### Not done

A failed Google reservation still lets the call proceed uncounted rather than
degrading the response. Correct reservation semantics would degrade, but that
means restructuring three call sites with different fallbacks each, on the paid
hot path. Not an unattended change.

## 12. Checked, not a bug

- **Three users have a push token but no timezone**, and have never had a
  single push enqueued — `next_sendable_at(null, …)` returns NULL and every
  enqueue site skips them. I was about to write this up as a new finding before
  checking: it was already found and fixed on 2026-09-13, and the docstring on
  `syncTimezone()` describes these same three accounts. It is wired into
  `_layout.tsx`, guarded by a test, and shipped. Those three simply have not
  relaunched the app since. Verify the artifact, not the intent.

## 13. Not done, and why

- **Personalised novelty appetite ("weekend warrior").** Computable, but at 66
  visits with 13 repeats total it would be fitting noise. The brief I was given
  says to compute-and-log rather than rank on it; I did not start it because
  half-built telemetry is worse than none.
- **Pre-resolution deduplication.** 115 duplicate suppressions happen *after*
  resolution, so the lookup is already spent. Deduping by position before
  resolving would save them, but most resolutions are free catalogue hits, the
  payoff is small, and it is the hot path. Not an unattended change.
