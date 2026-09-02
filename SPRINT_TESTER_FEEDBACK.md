# Palate — Tester Feedback Sprint (autonomous brief)

**Paste this whole file as the opening prompt of a fresh Claude Code session in
`~/Claude Code/Palate`.** Screenshots referenced below will be attached by the
user in the same message.

---

## 0. Your mandate

You are working autonomously through a batch of real tester feedback from the
first 3 TestFlight users. Work the **mobile app only** (`mobile/`) plus the
Supabase migrations/functions it needs. **Do not touch `landing/`** unless a
change is a hard App Store requirement.

**Operating rules**

- Read `CLAUDE.md` first and obey it — especially the spending policy. EAS
  build/update/submit are pre-authorized. Paid API calls (Google Places, LLM
  classifier, email) beyond normal local dev are NOT — stop and ask.
- Work in priority order (P0 → P3 below). Land each workstream as its own
  commit with a message that says what changed and why. Do not batch unrelated
  fixes into one commit.
- Before every commit: `npx tsc --noEmit` and `npm test` in `mobile/`. Add unit
  tests for any pure logic you write (there is a real test suite in
  `mobile/lib/__tests__/` and `mobile/lib/recommendation/__tests__/`).
- **Verify, don't assume.** Every claim in §1 below was verified against the
  source on 2026-09-02, but re-read the file before you change it.
- Where a fix needs a product decision that materially changes the result,
  implement the recommended default stated here, note the assumption in the
  commit message, and keep moving. Do not stop and wait unless it costs money
  or is irreversible.
- When all P0+P1 work is done, type-check, test, then run one EAS build and
  report what's in it. Don't ship incrementally — batch.
- Keep a running `SPRINT_LOG.md` at the repo root: one line per item, status,
  and anything you deliberately deferred.

---

## 1. Ground truth already established (don't re-derive)

I traced these before writing the brief. Confirmed root causes:

**Domino's leaked into recommendations (feedback #2).** The hard chain gate
`isRecIneligible()` lives in `mobile/lib/recommendation/gems.ts:67` and is only
called from `mobile/lib/recommendation/candidates.ts:59`. Two other surfaces
build recommendations without it:

- `mobile/components/StretchPick.tsx:46` filters on
  `(r.recommendation_eligibility ?? 1) > 0` only — a null-eligibility Domino's
  passes straight through. This is the exact "Stretch your palate → Domino's
  Pizza, 31% match" screenshot.
- `mobile/lib/palate-persona.ts:353` (`getPersonaRecommendations`, which powers
  "Places you'll probably like" via `mobile/components/RecommendationsCard.tsx`)
  applies **no eligibility gate at all**.
- `mobile/app/(tabs)/discover.tsx:138` uses the same weak
  `recommendation_eligibility > 0` filter.

The place-detail screen already renders "National chain — not surfaced in
discovery" for Domino's, which is why the app contradicts itself.

**Rec rows aren't tappable (feedback #10).** `RecommendationsCard.tsx` renders
only Save + Apple/Google Maps `Pressable`s (lines ~225–242); there is no
`router.push('/restaurant/[place_id]')`. `StretchPick.tsx:69` does have it —
that's why one is tappable and the other isn't.

**No screenshot listener exists (feedback #11).** `expo-screen-capture`'s
`addScreenshotListener` appears nowhere in the codebase. `mobile/app/feedback.tsx`
+ `mobile/lib/feedback.ts` accept an optional `screenshotUri` but nothing ever
triggers them from a screenshot.

**Notifications are local-only, with no actions.** `mobile/lib/notifications.ts`
schedules local notifications; `registerPushToken()` (line 108) does write an
Expo push token to `profiles.push_token`, so a server-push path exists but is
unused. No `setNotificationCategoryAsync` / `categoryIdentifier` anywhere — that
is why nothing is actionable from the lock screen. The only response handler is
`mobile/app/_layout.tsx:240`.

**Duplicate confirm notifications (feedback #7).** `addToInbox()` in
`mobile/lib/passive-confirm.ts:104` dedupes by `place_id` within a 1-hour
window, but `scheduleConfirmNotification()` (line ~137) is not gated by that
same check, and the pipeline can emit the same place from multiple detection
sources. The lock-screen screenshot shows Kobe ×2 and Nashmi ×3.

**Design tokens** are already mid-reskin toward OpenTable/Airbnb in
`mobile/theme.ts` — light ground `#F6F6F6`, white cards, restrained ember red
`#E0473C`, Inter-only (Fraunces serif already dropped). The palette is not the
problem; layout, hierarchy, and density are. See §W6.

There is already an admin place blacklist: `supabase/migrations/0044_admin_place_blacklist.sql`.
Next migration number is **0052**.

---

## 2. Workstreams

### P0 — Correctness. These are visible bugs. Land first, one commit each.

#### W1. Kill national chains everywhere (feedback #2)

Chains add zero discovery value. The gate exists; it's just not enforced on
every surface.

1. Create `mobile/lib/recommendation/eligibility.ts` exporting a single
   `filterRecommendable(list)` helper wrapping `isRecIneligible()` + the
   cafe/gem rule from `candidates.ts:59-60`. Route **every** recommendation
   surface through it: `StretchPick.tsx`, `palate-persona.ts:getPersonaRecommendations`,
   `discover.tsx`, `RecommendationsCard.tsx`, `RightNowHero.tsx`,
   `featured-lists.ts`, `similar-restaurants.ts`, `recs-from-saves.ts`.
   Grep for `recommendation_eligibility` and replace every raw check.
2. `isRecIneligible()` currently relies on `chain_name` being populated, which
   is unreliable for unclassified places. Add a hard-coded
   `NATIONAL_CHAINS` brand-name matcher (normalized, punctuation-stripped,
   prefix-matched) covering the obvious set — Domino's, Pizza Hut, Papa John's,
   Little Caesars, McDonald's, Burger King, Wendy's, Taco Bell, KFC, Popeyes,
   Chick-fil-A, Subway, Chipotle, Panera, Applebee's, Chili's, Olive Garden,
   TGI Fridays, Red Lobster, Outback, IHOP, Denny's, Cracker Barrel, Waffle
   House, Buffalo Wild Wings, Five Guys, Shake Shack, Starbucks, Dunkin',
   Panda Express, Jersey Mike's, Firehouse, Zaxby's, Bojangles, Cook Out,
   Hardee's, Sonic, Arby's, Jack in the Box, Whataburger, Culver's, Raising
   Cane's, Wingstop, Jimmy John's, Quiznos, Steak 'n Shake, Long John Silver's,
   Golden Corral, Texas Roadhouse, LongHorn, Ruby Tuesday, Hooters, Cheesecake
   Factory, PF Chang's, Bonefish, Carrabba's, Maggiano's, Cheddar's, Logan's.
   Put it in its own file with a comment that it's a floor, not the whole
   system — `chain_name` + Google types remain the general mechanism.
3. Add a **generic chain-shape heuristic** as a second net: if the same
   normalized brand name appears at ≥3 distinct `google_place_id`s in the
   `restaurants` table, treat it as a chain. Migration `0052_chain_detection.sql`:
   a view or materialized count + a `restaurants.is_chain_brand` boolean the
   client can read. Do not call any paid API to do this — it's a pure DB query.
4. Chains still get **stored and logged** (a user really did eat at Domino's,
   and Wrapped should say so). Only *recommendation surfaces* exclude them.
   This distinction is already the intent in `gems.ts` — preserve it.
5. Tests in `mobile/lib/recommendation/__tests__/gems.test.ts`: Domino's by
   name with null `chain_name` and null eligibility → ineligible. A cheap
   independent taqueria → still eligible (the existing false-positive guard).

**Done when:** every rec surface routes through one gate, and a fixture named
"Domino's Pizza" cannot appear in Home, Discover, Stretch, Featured Lists, or
Similar.

#### W2. Tap-through on "Places you'll probably like" (feedback #10)

Add the same `onPress={() => router.push('/restaurant/${gpid}')}` treatment
`StretchPick.tsx:69` has to each row in `RecommendationsCard.tsx`. Wrap the row
body (name/cuisine/distance/match) in the Pressable and keep Save + Maps as
separate buttons that don't trigger the parent — nested Pressables, not
`onPress` bubbling. Audit every other list surface for the same gap and fix
them all: `SavedNearbyCard`, `WishlistRail`, `NextMovesPreview`,
`BasedOnSaves`, `FeaturedLists` rows. Add `accessibilityRole="button"` and a
label. Add a haptic on tap to match the rest of the app.

**Done when:** every restaurant name rendered anywhere in the app opens
`/restaurant/[place_id]`.

#### W3. Discover cleanup (feedback #5, #6)

1. **Green dot.** `mobile/components/LocationPill.tsx` — when there's no city
   override (i.e. real GPS), the dot is `colors.mute` grey. Make live-GPS state
   a green dot (`#1DB954`-family green, but pick one that sits in the palette —
   suggest `#2E7D5B` on light ground) with a subtle pulse, and keep the label
   "Your location". A manually-picked city keeps the current filled-pill
   treatment. Green = "we know where you are", which is the signal the user
   actually wants.
2. **Duplicates.** `discover.tsx` renders shelves + the main feed from
   overlapping sources with no cross-shelf dedupe. Introduce a single
   `seen: Set<google_place_id>` at the screen level, applied in render order
   (Featured → Most Compatible → Trending → Nearby), so a place shown in one
   shelf is suppressed below. Also normalize on `google_place_id` when merging
   `nearbyRestaurants()` results with DB rows — the same venue arriving from
   both paths is the likely duplicate source. Add a unit test for the merge.
3. **Prune weak featured lists.** In `mobile/lib/featured-lists.ts`
   `CATEGORY_META`, remove `fries` and `early-morning`. Verify nothing else
   references those slugs (the refresh edge function
   `supabase/functions/featured-lists-refresh` may have a matching list —
   update it too, but **do not invoke it**, it calls Google directly and costs
   money). Keep date-night, late-night, brunch, burgers, wings, steaks, pizza,
   tacos, sushi, bbq, and the cuisine lists.

#### W4. Screenshot → feedback prompt (feedback #11)

`npx expo install expo-screen-capture`. Register `addScreenshotListener` in
`mobile/app/_layout.tsx` (guard for iOS, and only when signed in). On fire,
show a non-blocking bottom sheet: "Saw a screenshot — something off?" with
[Send feedback] / [Dismiss]. Send feedback routes to `/feedback` with the
current route pre-filled in `context.route`.

Rate-limit hard: at most one prompt per 24h, and suppress entirely for 60s
after a dismiss. Persist in AsyncStorage. The screenshot image itself is not
readable from the listener — do **not** try to capture the screen; the existing
`screenshotUri` path stays a manual attach. Add a Settings toggle to turn the
prompt off.

---

### P1 — Notifications. The highest-leverage retention work.

#### W5. Notification system rebuild (feedback #1, #3, #7)

**A. Actionable confirm notifications (#3) — this is the big one.**

Register a notification category with actions so a visit can be confirmed from
the lock screen with zero app opens:

```
Notifications.setNotificationCategoryAsync('passive_confirm', [
  { identifier: 'confirm_yes', buttonTitle: 'Yes, I ate here',
    options: { opensAppToForeground: false } },
  { identifier: 'confirm_no',  buttonTitle: 'No',
    options: { opensAppToForeground: false } },
])
```

Set `categoryIdentifier: 'passive_confirm'` on the content in
`scheduleConfirmNotification()` (`mobile/lib/passive-confirm.ts:137`). Extend
the response handler at `mobile/app/_layout.tsx:240` to branch on
`response.actionIdentifier`:

- `confirm_yes` → write the visit via the same path `/confirm-visit` uses, mark
  the inbox entry resolved, fire the existing analytics event with a
  `source: 'notification_action'` tag. **Never open the app.**
- `confirm_no` → dismiss + record the suppression (feeds `recentlyPrompted`).
- default tap → current behavior (open `/confirm-visit`).

Critical: an `opensAppToForeground: false` action gives you a short background
window. Extract the write path out of `app/confirm-visit.tsx` into
`mobile/lib/passive-confirm.ts` as a headless `confirmVisitById()` so it does
not depend on screen mount. Make it idempotent and queue-on-failure (persist to
AsyncStorage, drain on next foreground) — a background Supabase write can fail
with no UI to report it.

Test this on a real device, not the simulator (`registerPushToken` already
bails on simulator). Report honestly if you can't verify it end-to-end.

**B. Stop the duplicate storm (#7).**

Move the dedupe from `addToInbox()` up into `notifyOrInbox()` so
`scheduleConfirmNotification()` is gated by the same 1-hour place check, and add
a second global gate: **max 1 confirm notification per 15 minutes, max 4 per
day**, persisted in AsyncStorage. Also dedupe by *place cluster*, not just
`place_id` — two Google entries for the same venue currently both fire. Add
tests to `mobile/lib/__tests__/`.

**C. Food-hall multi-select (#7).**

When the pipeline emits ≥2 candidates within ~75m of each other (already
tracked as `candidateCount` / `alternates` on the inbox entry), send one
notification — "Where'd you eat near {area}?" — that opens a new
`/confirm-multi` screen: a multi-select checklist of the candidates plus
"Add another place" and "None of these". Log each checked place as its own
visit. This replaces N single prompts with 1.

**D. Never-fires (#7).**

Add a diagnostic pass in `mobile/lib/passive-pipeline.ts`: when a visit is
detected but no candidate survives filtering, log the reason to the existing
trace (the "silent miss" work in commit `fbf80d8` already built the latch —
extend it). Surface the last 20 in `app/debug-visits.tsx` so misses are
diagnosable from the device. Do **not** widen the Google radius — that costs
money. If the analysis shows the fix requires more Places calls, write up the
finding and stop.

**E. Proactive weekend discovery pings (#1).**

New `mobile/lib/notification-schedule.ts`. Weekly local notifications, all
opt-out-able individually in Settings:

| When | Copy | Deep link |
|---|---|---|
| Fri 4:30pm | "It's Friday. Here are 3 date-night spots near you." | `/(tabs)/discover?list=date-night` |
| Sat 10:00am | "Saturday brunch, sorted — 3 near you." | `/(tabs)/discover?list=brunch` |
| Sun 9:00am | existing Wrapped reminder (keep) | `/(tabs)/wrapped` |
| Thu 6:00pm | "Your palate's been {top cuisine} all week. Want a left turn?" | `/(tabs)/index?mood=surprise` |

Use `SchedulableTriggerInputTypes.WEEKLY` (the SDK 57 typed trigger — see the
existing comment at `notifications.ts:80`, the untyped form throws). Make
`discover.tsx` accept a `list` search param that opens straight to that
featured list, and Home accept `mood` (see W7).

Guardrails: never more than **one** proactive notification per day; suppress
all of them for a user who has logged a visit in the last 2 hours; hard quiet
hours 10pm–8am local. Put the whole schedule behind a `feature_flags` row
(pattern already exists — migration 0049) so it can be killed without a build.

---

### P2 — Product surface.

#### W6. Design: stop looking like an AI app (feedback #4)

The palette in `mobile/theme.ts` is already right. What reads as "AI-made" is
structural. Fix these, in this order — this is a **restyle, not a relayout**;
keep information architecture and navigation exactly as-is.

Study targets: **Airbnb** (card system, whitespace, photography-forward),
**Resy** (typographic restraint, dark accents used sparingly), **OpenTable**
(dense list legibility), **Beli** (score chips done tastefully).

Concrete rules to apply globally:

1. **Kill the black hero cards.** The place-detail header
   (`app/restaurant/[place_id].tsx`) and any other near-black filled block on a
   light page reads as a template. Make it a white card on the grey ground with
   ink type and a hairline — the same card system as everything else. Reserve
   `colors.ink` fills for the tab bar and one primary CTA.
2. **One accent, one weight.** Red is for: primary CTA, save-active, and the
   match chip. Nothing else. Right now Save buttons, match chips, "New to you"
   badges, and admin destructive actions are all red — that flattening is a big
   part of the AI look. Make "New to you" a neutral outline chip and admin
   actions a plain text button.
3. **Typographic scale.** Reduce to 4 sizes in `type` (display 32 / title 20 /
   body 16 / small 13) and stop mixing `fontWeight` numerics with `fontFamily`
   weights — pick the family, drop the numeric. Tighten `letterSpacing` on
   display only.
4. **Density and rhythm.** Cards currently have inconsistent internal padding.
   Standardize: 16 padding, 12 gap, 16 radius (`radius.md`→16), one shadow
   token (y2 blur8 at 6% opacity), hairlines only between rows inside a card,
   never around it.
5. **Copy.** Remove hedging microcopy — "A solid baseline pick — log a few
   visits and we'll get more specific", "EARLY ESTIMATE · sharper after a few
   more visits". They read as a model apologizing. Either show a confident
   line or show nothing. One short reason per rec, max ~6 words.
6. **Empty states.** "You haven't been here yet. Save it and we'll resurface."
   → real design: an icon, one line, one action.
7. **Photography.** Note in `SPRINT_LOG.md` that the single biggest remaining
   gap vs. Airbnb/Resy is that there are no food photos, and that's a deliberate
   cost decision (Google Photos API). Don't add them. Compensate with the
   category color language already in `categoryColors`.

Before/after: run the app in the simulator and screenshot Home, Discover, and
place-detail before and after. Attach them to the sprint log.

#### W7. Home tab mood switching (feedback #8)

"Places you'll probably like" is a statement about the past; the user is asking
about *right now*.

1. Add a **mood row** directly under the Home header: a horizontally scrolling
   set of chips — `Anything` (default), then the user's top 5 cuisines by visit
   count, then a `Surprise me` chip. Selection is local state, not persisted.
2. Selecting a chip re-filters the Home recs to that cuisine, re-scoring with
   the existing taste graph rather than swapping in a naive cuisine filter — the
   point is "the best Mexican *for me*", not "any Mexican".
3. Above the section, a one-line palate read that changes with data:
   "Your palate's been **American** this week." with a text link
   **"In the mood for something else?"** that scrolls to / opens the mood row.
4. `Surprise me` should use the stretch path (`computeRightNow().stretch`) — but
   now gated by W1, so it can never return Domino's.
5. Accept a `?mood=surprise` search param so the Thursday notification (W5-E)
   deep-links into it.
6. Empty result for a mood → "Nothing great nearby for {cuisine} tonight" plus
   the nearest 3 regardless of distance. Never show an empty list.

---

### P3 — Social. Design first, then build the smallest real slice.

#### W8. Palate match & group dining (feedback #9)

Baseline that already exists: friend requests/accept/block and a leaderboard
(`mobile/lib/friends.ts`), a friend-compatibility screen
(`mobile/app/compatibility/[id].tsx`) gated at ≥5 visits each, restaurant-level
compatibility (`mobile/lib/recommendation/compatibility.ts`), and taste vectors
(`mobile/lib/taste-vector.ts`). You are extending, not starting over.

**Before writing code, write `SOCIAL_DESIGN.md`** — a short design doc covering
the model below, and put it in the repo. Then build Phase 1 only.

Inspiration to actually borrow from, specifically:

- **Spotify Blend/Wrapped** — a single headline number ("You and Marcus are a
  **78% palate match**"), one hero stat, then the *why* underneath: shared top
  cuisines, the one place you both love, the one axis where you diverge. The
  number is the shareable object.
- **Strava** — the social object is the *activity*, not the profile. A friend's
  logged visit appearing in the feed with a reaction is the loop. Segments →
  "you've both been to 6 of the same places."
- **Beli** — ranked lists as identity. Their weakness is that ranking is work;
  your passive capture means Palate can produce the same artifact for free.

**Phase 1 (build now):**

1. **Palate Match score, user↔user.** Extract the vector-comparison math out of
   `compatibility.ts` into `mobile/lib/recommendation/palate-match.ts` computing
   `matchScore(vectorA, vectorB)` → 0–100 plus a `reasons[]` breakdown (top
   shared cuisines, shared visited places, biggest divergence axis). Pure
   function, fully unit-tested with fixtures. Keep the ≥5-visit gate but show a
   "needs N more visits" state rather than hiding the feature.
2. **Match on the friend profile + friends list.** Surface the score as a chip
   on every row in `app/friends.tsx` and as a hero on `app/profile/[id].tsx`.
   Sort the friends list by match descending — that alone creates the
   "top users you match with" list the user asked for.
3. **Shareable match card.** Reuse the `SharePalateCard` / `VisitShareCard`
   pattern to render a Spotify-Blend-style image: two avatars, the big number,
   three shared cuisines. This is the growth mechanic — make it good.

**Phase 2 (design doc only, do not build this sprint):**

4. **Group recommendations.** "Eating with" → select 2–4 friends → compute a
   group taste vector and rank nearby places against it. The interesting design
   question is the aggregation rule: mean vector optimizes for the average and
   picks bland; **minimax (maximize the least-happy member's score) is the right
   default** and produces the "best restaurant for everybody" the user asked
   for. Show per-person match under the pick ("Marcus 82 · Dana 74 · You 79")
   — the transparency is the feature. Write this up; note it needs a
   server-side function since it reads other users' vectors, which means RLS
   design work.
5. **Group session privacy.** Do not expose one user's taste vector to another
   client. Compute group recs in a Supabase edge function with the caller's JWT
   and a friendship check. Flag this as a prerequisite in the doc.

---

## 3. Priority summary

| # | Item | Workstream | Priority |
|---|---|---|---|
| 2 | Block national chains | W1 | P0 |
| 10 | Tappable rec rows | W2 | P0 |
| 5 | Green dot on location | W3 | P0 |
| 6 | Discover duplicates + prune lists | W3 | P0 |
| 11 | Screenshot → feedback | W4 | P0 |
| 3 | Confirm from notification | W5-A | P1 |
| 7 | Duplicate / missing detections + food halls | W5-B/C/D | P1 |
| 1 | Weekend discovery pings | W5-E | P1 |
| 4 | Design overhaul | W6 | P2 |
| 8 | Home mood switching | W7 | P2 |
| 9 | Palate match + group dining | W8 | P3 |

---

## 4. Definition of done

- `npx tsc --noEmit` clean, `npm test` green, new tests for W1, W3.2, W5-B, W8.1.
- `SPRINT_LOG.md` written, with anything deferred stated plainly.
- `SOCIAL_DESIGN.md` written.
- Before/after screenshots for W6 on Home, Discover, place detail.
- One EAS build containing P0+P1 (+P2 if it landed cleanly), with a summary of
  contents and the build result reported.
- An explicit list of anything you could **not** verify on-device (notification
  actions in particular) rather than a claim that it works.
