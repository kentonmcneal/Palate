# Pre-release audit — findings

Produced 2026-09-13 by a cold multi-agent run of `docs/RELEASE_AUDIT.md`:
10 independent auditors, one per dimension, none given any context from the
session that commissioned it. Every finding below survived an adversarial
skeptic instructed to kill it. 41 agents, 0 errors.

Some of these are already fixed — see the commits following this file's date.
Nothing here has been edited; it is the report as written.

---

# Palate — Final Pre-Release Audit

## Status as of 2026-09-14

Every item below was re-checked against the LIVE database and the shipped code,
not against notes — three of them had been recorded as done by someone and one
of those was wrong, so the check was worth doing.

| # | Item | State |
|---|---|---|
| 1 | Photos enumerable / survive deletion | fixed (0167 + delete-account fn) |
| 2 | Privacy policy describes a different app | fixed |
| 3 | Sign in with Apple dead on arrival | **one dashboard step, yours** — see PUBLIC_LAUNCH.md |
| 4 | Two ACLs reset themselves | fixed, and the systemic half now asserted |
| 5 | Global Google counter / mintable city key | fixed (per-user meter present) |
| 6 | 24h moderation SLA with no mechanism | fixed (0169) |
| 7 | Four hand-rolled mappers | fixed — one shared `toInput`, harness imports it |
| 8 | Digest pre-ticks a band it should not | fixed, all three parts |
| 9 | Onboarding loses its buttons | fixed |
| 10 | Share links lead to a beta | **blocked** — no App Store URL exists yet |
| 11 | Degraded search reads as "does not exist" | fixed |
| 12 | Two UTC bucketing bugs | fixed (both on `local_date`) |
| 13 | Five below-the-line items | all five fixed |

**Two remain, and neither is code.** #3 is a Supabase dashboard toggle plus the
bundle id — smaller than this document implies, because the app uses the native
`id_token` flow, not web OAuth, so no Apple private key is involved and no
rebuild is needed. #10 cannot be done until an App Store listing exists; a
guard now fails the build if only ONE of the two invite destinations is
migrated, which is the expensive way to get launch day wrong.

### What doing #4 properly turned up

#4's last line asked for "one systemic fix with a permanent assertion, not nine
tickets". Taking that literally — enumerating `pg_proc` instead of pinning five
names — immediately found **`are_friends(a, b)`**: SECURITY DEFINER, no guard of
any kind, EXECUTE held by `anon`, answering "are these two people friends?" for
any pair to anyone holding the key that ships inside the app.

It was not new. `docs/REVIEW_2026-09-05.md` had already called it "a friendship
oracle for any signed-in user" nine days earlier. It survived because the check
that would have caught it listed five functions by name and this was not one of
them. Closed in 0172; the enumeration now lives in `supabase/tests/smoke.sql`
alongside the deny-list, and was verified to trip by re-granting the hole inside
a rolled-back transaction.

---

## Verdict

**Not yet — but the gate is four items long and none of them is a rewrite.** Sign in with Apple is disabled server-side while the app renders Apple's own button as the top sign-in control, so the reviewer's first tap returns `provider_disabled`; the published privacy policy omits the race/ethnicity data the app collects; two Postgres ACLs let any anon or signed-in caller write shared data; and the invite links in the shipping binary point at a TestFlight beta. Three of those four are config or copy changes, not code. Everything else on this list can ship and be fixed in the first two weeks.

## Shortest path to yes

Sequenced, because two of these have ordering constraints:

1. **Clean `supabase/migrations/` first.** Parallel audit sessions left at least eight untracked probe files behind — `0000_dimc_rls.sql`, `0000_probe_passive_gps.sql`, `0000_sec_probe.sql`, `0152_aaa_skepticprobe.sql`, `0152_probe_passive.sql`, `0153_dimb_probe.sql`, `01530_dimB_probe.sql`, `0160_dimb_delcheck.sql`. The next `supabase db push` applies the first one and aborts. Two separate auditors lost ~15 probe attempts to this. Delete them before anything below.
2. **Enable the Apple provider** in Supabase Auth (Services ID, Team ID, Key ID, .p8) and add `app.palate.ios` to the authorized client ids. Zero code change.
3. **One migration** revoking the two reset ACLs (§4) plus the assertion loop already patterned at `0144_revoke_internal_helpers.sql:55-65`, extended over every `*_unguarded` function and every view in `public`.
4. **One documentation pass** over `landing/app/privacy/page.tsx` and `APP_STORE.md` so both describe the app that exists (§1, §2).
5. **After** App Store Connect assigns the ID: swap `mobile/lib/invite.ts:19` and `mobile/lib/referrals.ts:17` and the landing hero. Doing this before approval produces a 404 instead of a working beta page — `itunes.apple.com/lookup?id=6765514102` currently returns `resultCount: 0`.

---

## Ranked by expected harm at mass release

### 1. Photos are world-enumerable and survive account deletion — and the policy says neither

One root cause, three symptoms. `avatars` and `visit-photos` are public buckets whose read policy keys only on `bucket_id`; `storage.objects` has no FK to `auth.users`; and a repo-wide grep for `storage.*.remove(` returns **zero hits**, so nothing anywhere deletes an object — not on visit delete (`visits.ts:365` touches only the row), not on account delete (`0001_baseline.sql:348-355` drops visits, location_events, prompt_decisions, weekly_wrapped, profiles, auth.users, and nothing else).

The exposure is worse than "a stable URL for people who already have it": the anon key shipped in the binary can call `object/list` and enumerate user-UUID folders, then filenames, sizes and timestamps. That makes the live sentence in the privacy policy — "Profile photos, meal photos, and feedback screenshots live in access-controlled storage" — **false today**, for live users, independent of the deletion defect. The deletion half is Guideline 5.1.1(v) and is currently prospective only (avatars n=2, visit-photos n=0, both belonging to live accounts).

Fix in `delete_my_account` (definer-side delete from `storage.objects` for the owner prefix), not in `settings.tsx` — a client-side list-and-remove is skippable by force-quitting mid-flow. Tighten both read policies to `to authenticated` in the same migration. This was already written up in `docs/REVIEW_2026-09-05.md:281` and is unfixed at HEAD.

### 2. The privacy policy and `APP_STORE.md` describe a different app

Same root cause as #1, wider blast radius. The code collects and the published documents deny or omit:

- **`race_ethnicity` and `gender_identity`** (`demographics.tsx:76-77`, backed by `0019_demographics.sql:14-15`) — absent from the live policy's "What we collect" list (`landing/app/privacy/page.tsx:58-81`), and `APP_STORE.md` §3 affirmatively lists "Sensitive info (race, religion, sexuality)" under *do not collect*. Special-category data with no disclosure in the policy Apple links from the listing. This is the least forgivable category.
- **Photos** — five upload call sites (`profile.ts:254`, `visits.ts:341`, `feedback.ts:43`, `onboarding/profile-setup.tsx:55`, plus one more), including one during first-run onboarding; declared as not collected.
- **Analytics linked to identity** — `analytics.ts:52` sets `user_id`, declared "we anonymize."
- **Name, social handles** (`social.ts:120-136`), **Expo push token** (`0014:47`), **Sentry crash data** — undeclared entirely.
- **`passive-inbox-sync.ts:11-20`** states "raw location does not leave the device until somebody has said 'yes, I ate there'." Since commit `176830e`, `mirrorInbox` spreads the whole `InboxEntry` — including `stopLat`/`stopLng` set at `passive-confirm.ts:427` — into `passive_inbox.payload`. The header is false in the tree; not yet in the field (0 of 18 live rows carry the key).

The cheapest answer on the sensitive-info item is to **delete the race/gender fields** if the cohort feature is not actually shipping. Declaring them and keeping them invites questions at review.

Caveat with teeth: the repo can prove the answers it *instructs* you to enter are wrong. Nobody could read App Store Connect's actual stored answers. The code-versus-published-policy contradiction stands regardless.

### 3. Sign in with Apple is dead on arrival

`GET /auth/v1/settings` → `"apple": false`. `POST /auth/v1/token?grant_type=id_token` with an Apple-issuer JWT → `400 provider_disabled`. Meanwhile `sign-in.tsx:229-240` renders `AppleAuthenticationButton` whenever `isAvailableAsync()` resolves, `app.json` sets `usesAppleSignIn: true`, and the failure surfaces as an alert at `sign-in.tsx:81`.

Ranked below two leaks because it destroys no data and Google and email OTP both work — the accurate claim is 100% of *Apple-button taps* fail, not 100% of users. But it is Apple's own control, rendered above Google on every iOS 13+ device, and Guideline 4.8 is the stated reason it exists (`lib/auth.ts:52-57` says so). The reviewer taps it first. Nothing ships until this flips.

### 4. Two ACLs reset themselves, and the pattern will recur

Not two bugs — one mechanism. **`DROP` + `CREATE` on a view or function resets its ACL to the Supabase default, and the recreating migration re-granted what an earlier migration had carefully revoked.**

- **`featured_lists_for_city`** is `security_invoker = off` and anon still holds INSERT/UPDATE/DELETE. Proven over real HTTP with the shipped anon key, unauthenticated: POST to the view returned `23502 null value in column "city_label" of relation featured_lists_cache` — the write reached the **base table**. The identical POST to the base table returned `42501`. In-database as `authenticated`: `UPDATE via view rows=451`, `DELETE via view rows=451`. Cause: `0104_review_security_batch.sql:16-18` revoked only SELECT; `0124_featured_lists_quarterly.sql:26` recreated the view and re-seeded the defaults.
- **`get_friend_profile_snapshot_unguarded`** still holds EXECUTE for `authenticated`, so blocking does not block: a blocked user POSTs one JSON body and keeps reading the blocker's palate identity, top restaurant, visit counts, school, city, Instagram and TikTok. `0108_blocks_cut_both_ways.sql:32` revoked it correctly; `0117` and `0118` each dropped and recreated it, and `0118:144` re-revoked from `public, anon` only.

The unverified queue reports the same shape at scale — nine SECURITY DEFINER functions still EXECUTE-granted to `anon` or `PUBLIC` answering HTTP 200, and **all eight** views in `public` running as definer. Treat that as one systemic fix with a permanent assertion, not nine tickets.

### 5. One global Google counter, and a mintable city key

Two findings, one design: the budget is a single shared 1500/day counter, and `featured-lists-refresh`'s `refresh_city` path has no per-user cap while any authenticated caller can mint fresh cache keys on demand.

- **Attack path:** signups are open; `featured_lists_mark_city_active` accepts any key matching `gps:-?\d+\.\d,-?\d+\.\d` (~6.5M keys) and never validates lat/lng against it; `featured-lists-refresh/index.ts:158-161` checks only that a bearer resolves to a user. Each refresh costs 15–45 Text Searches (15 categories at `index.ts:118-132` × `MAX_PAGES=3`, early break at `TOP_N`), measured ~22. So **~34–100 requests from one throwaway account** exhausts the day.
- **No attacker needed:** the key is a 0.1° (~11km) cell, so normal travel manufactures cells. Nine cells cover Memphis alone (~200 billable calls), three cover Newport News (~66). 21 of 28 registered cities are `gps:` cells, and `city_label` is literally "Nearby" for all of them, so adjacent cells buy near-duplicate lists off overlapping 30km circles.

Money is **bounded** — see §Disagreements. The real harm is that one account's spend degrades `search` to `{places: [], degraded: true}` for everyone until UTC midnight. Cheapest structural fix is reverse-geocoding the cell to a real locality key; cheapest safe fix is per-user metering via `proxy_calls`, ~10 lines.

### 6. A published 24-hour moderation SLA with no mechanism behind it

`content_reports` has 0 rows, **no trigger** (compare `feedback_notify` at `0125:53`, which does `net.http_post`), no SELECT policy for users, and no admin screen — `admin.tsx` renders waitlist, push queue, crashes and rec funnel, nothing for reports. The only reader is a local service-role script, `export-feedback.ts:127`. Meanwhile `feed.tsx:265` promises "We'll review this within 24 hours" and the live Terms promise removal and termination on the same clock. The one in-app suspension path is inert: `_layout.tsx:493` unconditionally bounces `/waitlist` back to `/(tabs)`.

The App Store framing here is overcorrected in both directions — see §Disagreements. What this actually is: **a legal commitment with no implementation.** One genuine Guideline 1.2 exposure sits nearby and was missed by the auditor who filed this: `mobile/app/thread/[id].tsx` has no report or block control anywhere in the DM thread UI.

### 7. Four hand-rolled mappers, each dropping different fields

`RestaurantInput` is constructed independently in four places and no two agree:

- `candidates.ts:147-173` maps 22 fields and omits `regular_opening_hours`, so `venueOpenAt()` always returns null and `shortlist.ts:108`'s open-venue filter is a no-op. Home's explore row picks a closed restaurant in **20 of 150** simulated loads (0 of 150 with hours carried), concentrated at 08:30 and 22:30.
- `RecommendationsCard.tsx:111-130` carries hours but omits `tags`, `vibe`, `primary_type` and `types`, so `hasAesthetic()` and `tagSignal()` — up to +16 of a roughly [-25,+32] `gemAdjustment` — are permanently 0 on the main screen. Iris (`ChIJFayoMbCAf4gRhA5pKcn807w`, tags `["comfort","upscale","date-night","hidden-gem"]`) scores gem 32 / final 105 with tags and 16 / 89 without. The gems-first policy the product is built on runs at half strength on Home.
- `discover.tsx:968` drops seven fields.
- **`ranking-harness.test.ts:72-92` defines a fifth mapper that carries everything**, which is why the repo's own "no closed restaurant in the top ten" guard has been green for the entire life of the feature. Same fixture, same scorer, same clock: `poolAsInputs` → 0 closed in top 10; `candidates.toInput` → 2 (Eggs Up Grill, The Salad Station).

Fix the mappers; then make the harness import the shipped one so the guard can fail. Note the pre-existing question the code can't answer: `classifier.ts:801-802` derives `hidden-gem` from the same rating × review-count that `qualityQuadrant` already scores, so passing tags through may double-count quality. Pick a direction deliberately — today Home and the candidates path disagree by up to 16 points on the same restaurant.

### 8. The digest pre-ticks a band it should not, and one tap writes it all

`passive-digest.ts:112` sets `preChecked: band === "high" || band === "medium"`; `digest.tsx:62` seeds the checked set from it. Medium is the largest band (108 of 262). Since `REALTIME_PROMPTS_ENABLED` is false, the digest is the **only** confirmation path in production, and wrong entries land in the diary, the taste graph, Wrapped and the public profile. The spec's own framing is that sections 2 and 3 are upside, not obligation. One-line fix: `band === "high"`, and fix the notification count rather than the tick.

Two secondary defects found while checking this, both worth the same commit: `digest-confirm.ts:96` writes the `wrong_place` decision against the *corrected* place id rather than the mis-guessed one, poisoning demotion for a venue the user just confirmed; and `visit_resolved` logs `resolved.confidenceBand` instead of `entry.confidenceBand`, which makes the entire calibration dataset un-analysable.

### 9. Onboarding's mandatory permission screen loses its buttons

`app/onboarding/permission.tsx:104` is a `justifyContent: "space-between"` column with no ScrollView, and RN's Yoga default is `flexShrink: 0` (`yoga/style/Style.h:46`), so the footer is pushed off-screen. At default text size this is total loss on iPhone SE only. **At 1.118 — one notch on the ordinary Display & Text Size slider, no accessibility setting involved — both buttons are entirely below the visible edge on SE, 13 mini and iPhone 15.** At 1.353 the 15 Pro Max loses them too. Around a third of iOS users run larger-than-default text.

Not permanently bricking: force-quitting recovers, because `profile-setup.tsx:78` already called `markUsernameClaimed`. But nothing signals that, and the user silently skips the location prompt plus the email and privacy steps. The fix already exists in-repo and its comment explains the bug — `passive-capture-intro.tsx:190-213` ("the six bullets simply drew straight over the 'Not now' button, which is what a tester photographed"). It was never applied to the onboarding funnel. Same shape at `why-location.tsx:37`, `welcome.tsx:43`, `privacy.tsx:47`, `profile-setup.tsx:163`, `claim-username.tsx:101`.

### 10. Every share link leads to a beta or a waitlist

`invite.ts:19` = `https://testflight.apple.com/join/GYadZcZw`, on the invite card on every Profile. `referrals.ts:17` = `https://palate-zm29.vercel.app/`, used by settings, Home, Wrapped, compatibility and FirstVisitCelebration — a live page reading "Coming soon · iOS … Join waitlist", whose rendered HTML contains no `apps.apple`/`itunes` link at all. At public release the entire word-of-mouth loop is dead. It is a launch-day sequencing item, not a code defect, and it is currently *blocked* — there is no App Store URL in existence to point at yet.

### 11. Degraded search reads as "this restaurant does not exist"

`places-proxy/index.ts:431-433` returns HTTP **200** with `{places: [], degraded: true}` when the budget trips. `places.ts:96-103` destructures only `places` and throws the flag away — while the degrade-aware sibling sits four lines above it at `places.ts:61-67` and is already used by `passive-pipeline.ts:553`. So `add.tsx:127-131` says "Nothing by that name in our list yet. Tap Search to look it up." above a button that will return `[]` all day, and `discover.tsx:613` says "No matches." Worse: `discover.tsx:566` gates the free local-suggestion list on `searchResults === null`, so a degraded search actively *replaces* the catalogue matches the user could still have tapped. `USER_CAP_PER_DAY = 120` counts map panning too, so a heavy map user can strand their own account on a rolling 24h window today, on the current beta.

### 12. Two UTC bucketing bugs, both latent

`board_leaders` (`0119_board.sql:39-41`) truncates week and month in a UTC session, so a Sunday 17:00–24:00 Pacific visit is credited to next week — on the Board's opt-in "This week" tab only; 0 of 63 production visits are currently misbucketed. `friends_leaderboard` has the identical defect and is dead code. `enqueue_comeback_pushes` (`0110:98-99`) formats `to_char(fav.last_at, 'FMDay')` in UTC, so a Saturday dinner becomes "Not since Sunday" — armed (cron active at `0 23 * * *`, `server_push` true) but zero rows ever enqueued.

Both fixes are the pattern `0151_wrapped_local_week.sql` already established: bucket on `coalesce(local_date, (visited_at at time zone 'UTC')::date)`. Do **not** use `profiles.timezone` for the push fix — it is NULL on 11 of 18 profiles and wrong for a visit logged while travelling. The lateral subquery selects `max(v.visited_at)` and will need `local_date` carried through.

### 13. Below the line — real, small, do them in the first sprint

- **Pre-auth analytics blocked by RLS** since 2026-09-05. `0110:135-144` looped over every INSERT policy and recreated one `to authenticated`, breaking the contract documented at `0012:17`. Note the mechanism: `.insert()` *resolves* with `{error}`, so `analytics.ts:56`'s catch never fires — line 51 simply ignores the return. "Log inside the catch" would not surface it.
- **`ProfileBody.tsx:86-88`** swallows every snapshot failure into `console.warn` — the only such catch left in `app/` or `components/` — and renders a bare "Profile not found." with no retry. `console.warn` is not `captureError`, so a server-side regression of `get_friend_profile_snapshot` would look app-wide like mass account deletion **with no Sentry event**. This is the one RPC `CLAUDE.md` documents as having failed silently for 65 migrations.
- **White on `#E0473C` is 4.09:1** (`theme.ts:14`, `Button.tsx:66/72`) — every primary button in the app fails WCAG AA. `theme.ts:16` already defines `redText: "#C13A2F"` at 5.37:1 and documents it for exactly this. Repointing the button fill to it fixes the whole class with a near-invisible hue shift.
- **Home's cold-start CTA routes to a screen with no buttons.** `next-step.ts:129-139` gates "Get my forwarding address" → `/import-email` on `GMAIL_OAUTH_ENABLED` but never on `FORWARDING_LIVE` (false at `receipt-forwarding.ts:49`), so both cards render null. The guard already exists one file over at `settings.tsx:546`. Affects the ideal-path minority only (granted location + notifications, zero visits), and the back arrow escapes.
- **`restaurant_overrides` lets any signed-in user rewrite any restaurant's cuisine for everyone** (`0027:72-76` checks only `auth.uid() = user_id`). Confirmed live against an unconnected restaurant. Worse than "first-writer-wins": the app upserts with `onConflict` but no UPDATE policy exists, so once any row exists for a (restaurant, field) pair the "Wrong cuisine? Tap to fix" control errors for *everyone including its author*. The comment at `0030:13-15` claiming otherwise is factually wrong. Blast radius is display metadata (detail screen, Discover suggestions, similar-restaurants, group-recs, feed payloads), not the ranking core — the engine's scoring functions do no DB reads at all.

---

## Where the auditors disagreed

**Does `featured-lists-refresh` bypass the Google kill switch?** The RLS auditor said yes ("the same request that defaces the app also spends money," implying uncapped). The money verifier read `featured-lists-refresh/index.ts:60` and `:411-414` and found `googleTextSearch` calls `isTripped()` before every request and bumps `bump_google_usage` against the same `GOOGLE_DAILY_CALL_CAP`. **The verifier is right** — it cites the specific call sites; the auditor inferred from an out-of-date premise. Consequence: spend is capped at one day's budget and self-heals at UTC midnight. **Your stored note that "the remaining gap is featured-lists-refresh, which calls Google directly outside the kill switch" is now stale — update it.** The harm is shared availability, not a runaway bill.

**Is the Discover stretch card fixed by carrying opening hours?** One auditor's headline was "the stretch card recommends a closed restaurant in 30 of 42 time slots" and offered a one-line mapper fix. The engine verifier re-ran it and got an **identical pick in 42 of 42 slots** either way, because that card ranks by *lowest* compatibility and consults no context at all. **The verifier is right** — a controlled A/B on the same fixture beats a correlation. This matters practically: the one-line fix would have been shipped, the 30/42 number would not have moved, and the real cause (the stretch slot is designed to pick the worst match, and `right-now.ts` sorts ascending while the Discover tab sorts descending — the two comments contradict each other) would have gone untouched. That contradiction is a product decision only you can settle.

**Is medium-band confirmation really 36% correct?** The probe joined `analytics_events(visit_resolved)` to `prompt_decisions`, but the analytics event logs the **pre-demotion** band while the digest pre-ticks off the **post-demotion** band. An unknown share of the "medium refusals" were never pre-ticked. **The verifier is right; do not quote 36% anywhere.** The fix is correct regardless, on spec grounds. Re-measure off `confirm_yes`/`confirm_no`, which carry the band actually displayed, and count `wrong_place` as a capture rather than a refusal.

**Is the moderation gap a Guideline 1.2 rejection risk?** The auditor said it is the single most common rejection reason for an app with a public feed. The verifier established that every affordance Apple actually inspects is present — report on posts, comments and profiles; server-enforced bidirectional blocking (`0116` deletes follows both ways, `0130:112,117` gates DM send); a blocked-accounts screen; published contact info — and that this same architecture already passed review. **The verifier is right, and the correction cuts both ways:** the review risk is lower than claimed, but the *legal* exposure is higher, because the 24-hour promise is in the published Terms with nothing behind it. The one live 1.2 risk is the missing report/block in the DM thread, which the original auditor did not cite.

**Does permission.tsx lose both buttons at default text size?** The auditor said yes on iPhone 15; the verifier computed it loses only 15pt off the bottom of "Skip for now." **The verifier is right — and found it worse overall**, because one ordinary slider notch (1.118, not an accessibility setting) kills both buttons on SE, 13 mini *and* iPhone 15. Same conclusion, better trigger, much larger population.

**Do 100% of users fail to sign in?** No — Google and email OTP work. The accurate claim is 100% of Apple-button taps. The verifier's narrowing is correct and does not change the severity.

## What the refutations tell you about the auditors

The mechanisms are trustworthy; the reach and arithmetic are not. Every "here is the file and the line" claim survived. What died, died for four repeatable reasons:

1. **Reachability was not checked before severity was assigned.** Three of seven refutations are "nothing navigates there" — the waitlist screen twice, `isApproved()`, and `friends_leaderboard` inside a surviving finding. `grep` for `router.push|replace|href` targeting a route costs seconds and would have killed all four.
2. **A pre-fix tree was read.** Commit `029a2dc` deleted the waitlist check 23 minutes before the audit prompt was written.
3. **Aggregates were divided by headcount.** The "cap binds at 122 users" finding collapsed because 744 of 1,276 calls are per-*city* on a 90-day TTL, and the 13-day window straddled commit `7843c04`. The per-cell cost figure was similarly off by ~50% (~32 claimed, ~22 measured, 15–45 by code).
4. **Published metrics were read without checking what the event means.** The 36% band figure, the "4 of 6 declined the Always dialog" finding (which counted calls to `requestAlways()`, not dialogs), and the `digest_scheduled` funnel (which counts reschedules) all fail this way.

Under-calling is rarer but present: photo call sites (5, not 3), storage bucket enumerability, the text-scale trigger. **Net: trust the line numbers, re-derive every percentage.**

## What nobody checked, and what it would take

- **Nothing was run on a device or simulator. Ten dimensions out of ten.** Every layout, routing and permission claim is code-level inference. Local iOS builds fail from `~/Claude Code/` because of the space in the path. The single highest-value hour left in this audit: build to an iPhone SE simulator, sign in with a fresh Apple ID, and walk sign-in → welcome → permission at default text size and at one slider notch up. That settles findings 3, 9, and the onboarding-bypass question at once.
- **App Store Connect.** The actual stored privacy-label answers, the age-rating questionnaire, the real Support/Privacy URLs on the listing, review status, TestFlight group capacity. `APP_STORE.md` is the only artifact of intent and may not match what was typed. Needs a screenshot of App Privacy + App Information.
- **Supabase Auth config.** Email templates (does the sign-in mail contain a magic link or only the code?), the hosted rate limits (`config.toml`'s `email_sent = 2` governs the local stack only), the redirect allow-list. Needs `SUPABASE_ACCESS_TOKEN` or dashboard screenshots.
- **Whether `EXPO_PUBLIC_SENTRY_DSN` is set in the production EAS environment.** `observability.ts` no-ops without it; the variable is not in `mobile/.env` and no `eas` CLI is installed. This decides whether Crash Data needs declaring *and* whether §13's observability gap is real. One `eas env:list --environment production`.
- **A real authenticated JWT over PostgREST.** Every `authenticated`-role RLS result came from in-database `set local role` impersonation, which is not byte-identical to a PostgREST request. Each is separately corroborated by a grant fact, but a throwaway account's token would close it.
- **Whether the Google kill switch has ever fired.** `tripped` is false on all 14 days read; peak was 385/1500. By this repo's own rule, a guard nobody has seen fail is not a guard. Free to test: call `bump_google_usage` with `p_cap := 1` in a rolled-back transaction and assert `crossed_trip`.
- **Whether commit `176830e` (the `stopLat` mirror) has shipped to any device.** 0 of 18 `passive_inbox` rows carry the key, which is consistent with "committed, never shipped" but is not proof. `eas update:list` and `eas build:list` are free and read-only and settle it. Also unconfirmed: whether the nightly `prune_passive_inbox` cron from `0132` actually exists on the remote — if not, the 7-day bound on server-held coordinates does not exist either.
- **The Google Cloud billing report.** All per-call prices are inferred from field-mask-to-SKU mapping. The $52.50/day figure assumes Enterprise Text Search rates and ignores the monthly free allotment.
