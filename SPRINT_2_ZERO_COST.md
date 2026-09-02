# Palate — Sprint 2: the zero-cost work (autonomous brief)

**Paste this whole file as the opening prompt of a fresh Claude Code session in
`~/Claude Code/Palate`.**

Every workstream below costs **$0 in marginal API spend**. That is the organizing
constraint, not a coincidence — the items that cost money (food photos, group
recommendations) are named in §6 and deliberately excluded.

---

## 0. Mandate

Work the mobile app (`mobile/`) plus the Supabase migrations and edge functions
it needs. Do not touch `landing/`.

**Operating rules**

- Read `CLAUDE.md` first and obey it. The spending policy is the hard rule.
- Work in priority order. One commit per workstream, message says what changed
  and *why*. Do not batch unrelated changes.
- Before every commit: `npx tsc --noEmit` and `npm test` in `mobile/`. Add unit
  tests for pure logic. Current baseline is **18 suites / 154 tests green** — do
  not regress it.
- Verify against the source before changing it. Everything in §2 was checked on
  2026-09-02, but re-read the file.
- Where a decision is genuinely the user's, implement the stated default, note
  the assumption in the commit message, and keep going. Stop only for money or
  for something irreversible.
- Keep `SPRINT_LOG.md` updated — one line per item, plus anything deferred and
  anything you could not verify. Honest gaps are worth more than optimistic
  claims.

---

## 1. Permissions — what you may do without asking

These are granted for this sprint. They cover everything the work below needs.

**Free and always fine**
- `git` status/log/diff/branch/commit on the working branch
- `npx tsc --noEmit`, `npm test`, `npx jest <path>`
- `npm install` / `npx expo install` for packages the workstreams require
- `supabase db query --linked "<read-only SQL>"` — SELECTs against production.
  Use it. Grounding a decision in real rows beats reasoning about it.
- Reading any file, any log, any EAS build metadata

**Granted, use freely for this sprint**
- **`supabase db push`** — apply new migrations to production. Always
  `--dry-run` first and confirm only your own migrations are pending. Migrations
  are applied through **0053**; the next number is **0054**.
- **`supabase functions deploy <name>`** — deploy an edge function. Required for
  W1 and W2. Deploying is free; *invoking* one that calls Google is not (see
  §5).
- **EAS `build` / `update` / `submit`** — already pre-authorized in `CLAUDE.md`.
  Type-check and test first; never burn a build on a typo. Bump `version` in
  app.json whenever native code changes, per the runtime-version gotcha.
- **Sending a test push to the developer's own device.** Expo's push service is
  free and unlimited. Sending to *other* users is not covered — see below.
- **Merging this sprint's branch to `main`** once its own work is green.

**Ask first, every time**
- Anything that calls **Google Places**, the **LLM classifier**, **geocoding**,
  or **sends email** beyond what a normal local dev run makes.
- **Enabling any cron or scheduled job that spends.** Writing one is fine;
  scheduling it is a decision with a recurring bill attached.
- **Sending a push notification to real users**, or anything else that reaches
  the tester group — including `eas submit` when the intent is distribution
  rather than an internal install. Building is pre-authorized; *distributing* to
  people is a judgment call that belongs to the user.
- **Flipping a `feature_flags` row on in production.** Flags exist so a human
  decides when something goes live.
- Deleting data, dropping columns, or any migration that is not additive.

**Never**
- Widen a Google search radius, remove a rate limit, or raise
  `GOOGLE_DAILY_CALL_CAP` to make something work. If a fix requires more paid
  calls, write up the finding and stop.

---

## 2. Ground truth (verified 2026-09-02 — don't re-derive)

**Repo state.** Branch `sprint/tester-feedback`, 11 commits ahead of `main`,
none merged. `tsc` clean, 154 tests green. Migrations applied through 0053.
Build `556144d4` (0.1.7, build 26) finished but **predates the Dynamic Type
commit** and was never submitted.

**Real API spend.** `google_usage_counter` shows **40–56 billable calls/day**,
579 in the last 30 days, all `nearby`. Cap is 1,500/day. Kill switch has never
tripped. That is inside Google's free monthly allowance for the Nearby Search
SKU, so current spend is effectively zero.

**places-proxy has no server-side cache.** This is the important one. The
`recordUsage(admin, "nearby", "cache")` call at `supabase/functions/places-proxy/index.ts:158`
fires *only* when the kill switch has already tripped — it is a degraded-mode
fallback, not a read-through cache. Zero `cache` rows in `api_usage_daily` means
the cap has never been hit, not that caching is broken. What actually saves
calls today is the **client-side** AsyncStorage cache (`lib/nearby-cache.ts`),
which short-circuits before the request reaches the function. Every nearby
request that gets past it costs a Google call.

**Push infrastructure exists and is unused.** `registerPushToken()` in
`mobile/lib/notifications.ts:108` writes an Expo push token to
`profiles.push_token` on every launch. Nothing ever reads it. Expo's push
service is free and unlimited.

**Known dependency risk.** `expo-doctor` reports `expo@57.0.7` is affected by a
**Hermes V1 memory regression**, fixed in 57.0.9+. ~20 packages are behind their
SDK-57 patch versions. `expo-screen-capture` is pinned to 57.0.1 in
`expo.install.exclude` because 57.0.2 calls `SceneGeometry.keyWindow()`, which
does not exist in the installed `expo-modules-core@57.0.6` — that mismatch is a
symptom of the same drift.

---

## 3. Workstreams

### P0 — W1. Server-side nearby cache in places-proxy

**The single highest-leverage zero-cost change available.** It doesn't add a
feature; it buys headroom for every feature, including the ones that cost money
later.

Today every nearby request that misses the client cache hits Google. We already
store every restaurant we have ever seen in `restaurants`, with coordinates.

1. In `handleNearby`, before `reserveGoogleCall`, do a bounding-box lookup
   against `restaurants_resolved` for the requested lat/lng/radius.
2. Serve from the DB when the result is **fresh enough and dense enough** —
   suggest: ≥ 15 rows in the box, and the box was populated within the last 7
   days. Add a `nearby_cache_regions` table (migration `0054`) recording
   `(lat_bucket, lng_bucket, radius_m, fetched_at, result_count)` so freshness is
   a fact rather than an inference from row timestamps.
3. On a hit: `recordUsage(admin, "nearby", "cache")` and return, no Google call.
   On a miss: existing path, and record the region afterward.
4. Bucket coordinates coarsely (~2-3 decimal places) so two users on the same
   block share a region.

**Acceptance:** `api_usage_daily` starts showing `cache` rows in normal
operation, not just when tripped. Cache-hit ratio visible in the debug screen.
No behavioural change the user can see except faster loads.

**Do not** invoke the deployed function against Google to test it. Verify the
cache path with a `db query` against a region you know is populated, and the
miss path by reading the code.

---

### P0 — W2. Turn on server push

Free, and it unlocks two things nothing else can.

**A. The guard that couldn't be built.** Sprint 1 shipped weekly discovery
nudges as *local* notifications, which cannot be conditioned on state at fire
time — "skip this if they already logged a visit in the last 2 hours" is
unenforceable locally. See `mobile/lib/notification-schedule.ts`, which says so
in its header. Server push fixes it properly.

**B. The Strava loop.** *"Marcus just logged Saté"* is a far better reason to
open the app than anything we can say about ourselves. Friend activity is the
only notification that gets more valuable as the user base grows.

1. New edge function `send-push`: takes user ids + payload, looks up
   `profiles.push_token`, POSTs to `https://exp.host/--/api/v2/push/send`.
   Batch in chunks of 100 (Expo's limit). Handle `DeviceNotRegistered` by
   clearing the stored token.
2. Migration `0055`: a `push_outbox` table (recipient, payload, send_after,
   sent_at, error) so sends are durable and auditable rather than fire-and-forget.
3. Respect the existing guardrails: quiet hours 10pm–8am local, one proactive
   push per user per day, and a `feature_flags` kill switch (`server_push`,
   **ships off**).
4. Friend-activity trigger: when a visit is logged, enqueue for accepted friends
   who have opted in. Add the opt-in toggle in Settings, default **off** —
   telling your friends where you eat is a choice, not a default.
5. **Write the cron but do NOT schedule it.** Follow the pattern in migration
   0051, which ships commented out for exactly this reason.

**Acceptance:** a push sent to the developer's own device arrives with correct
deep-link routing. Nothing sent to any other user without explicit approval.

---

### P1 — W3. Finish the Dynamic Type pass

Sprint 1 covered Home, the tab bar, and the shared `Button`/chip primitives
(`mobile/lib/a11y.ts`). **Wrapped, Insights, onboarding, and the Wrapped story
cards were not touched** and are the most layout-fragile screens in the app —
they use absolute positioning and fixed-height cards.

Apply the existing tools: `FONT_CAP` for chrome, `useFontScale()` for row→column
reflow, `minHeight` instead of `height` on anything wrapping text. Do not
introduce new caps on content text; if a container can't fit content at 2x, fix
the container.

Test at 2x and at the largest accessibility size. This was reported by a real
user — the developer's mother — so the bar is "she can use it", not "it doesn't
crash".

---

### P1 — W4. Dependency upgrade, on its own

Bump `expo` to ≥57.0.9 and run `npx expo install --fix`. This clears the Hermes
V1 memory regression and the version drift that caused the
`expo-screen-capture` build failure.

**Its own commit and its own build**, deliberately not bundled with feature
work — if something regresses, the cause must be unambiguous. After upgrading,
check whether `expo-screen-capture` can come off its 57.0.1 pin and out of
`expo.install.exclude`.

---

### P2 — W5. Pairwise ranked rating

The Beli-shaped feature, and the one place Palate has a structural advantage:
their ranked list is the best food-identity artifact anyone ships, and it costs
their users manual work forever. Passive capture produces the same artifact for
free.

1. After a visit is logged, occasionally ask **one** question: "Better than
   {a place they've already rated}?" One comparison, never a queue.
2. Maintain a ranking from pairwise results — a simple Elo or merge-insertion
   is fine. Migration `0056` for `visit_rankings`.
3. Surface as an ordered list on the profile. This becomes the Wrapped
   centrepiece and the thing people screenshot.
4. Pure DB and client. No external calls.

Read `PRODUCT_STRATEGY.md` and `project_palate_competitive` context first — this
was already identified as the #1 post-launch item.

---

### P2 — W6. Make the match card worth sharing

`computePalateMatch()` already produces the number and the reasons
(`mobile/lib/recommendation/palate-match.ts`). What's missing is a card good
enough that someone posts it: two avatars, the big number, three shared
cuisines, one divergence line.

Reuse the `SharePalateCard` / `VisitShareCard` pattern. This is the cheapest
user acquisition available and it is design work, not engineering — give it real
attention rather than shipping a rectangle with a percentage in it.

---

### P3 — W7. Small debts

- **Feed posts don't link to places.** The feed renders a friend's top
  restaurant as a bare name with no place id. Change the payload to carry
  `google_place_id` so the name opens `/restaurant/[place_id]` like everywhere
  else in the app.
- **Friends list fires one RPC per friend.** `app/friends.tsx` calls
  `loadPalateMatch` per row. Fine at 3 users, wasteful at 50 — batch into one
  RPC that takes an array of ids.
- **Act on the silent-miss data.** Read the "Silent misses" panel in
  `app/debug-visits.tsx` after real use. If misses cluster on
  `all_filtered_out`, it's a filter bug — fix it, free. If they cluster on
  `no_places_returned`, it's a radius problem — **write up the finding and
  stop**, because that costs money.

---

## 4. Cost guardrails (restating, because it matters)

- Never widen a search radius, remove a rate limit, or raise the daily cap.
- Never invoke `featured-lists-refresh` — it calls Google directly.
- Every new feature that needs restaurant candidates must go through the
  nearby cache from W1 and sit behind the existing kill switch and daily cap.
- If a workstream turns out to require paid calls, stop and write up what you
  found. A clear finding is a better outcome than a quiet bill.

---

## 5. Explicitly out of scope (these cost money)

- **Food photos.** Google's Photos API bills per request, so it scales with
  *impressions*, not actions — a feed showing 20 places costs 20 calls. This is
  the correct reason it stays deferred, and the largest remaining gap against
  Airbnb/Resy. Revisit with real numbers, as a deliberate experiment.
- **Group recommendations (Phase 2).** The minimax math is free; the candidates
  are not. Specified in `SOCIAL_DESIGN.md`, blocked on both a server-side
  function (privacy: never ship another user's taste vector to a client) and on
  W1 existing, so group sessions read cache instead of Google.

---

## 6. Definition of done

- `tsc` clean, `npm test` green, no regression below 154 tests.
- New tests for W1's cache-decision logic and W5's ranking math — both are pure
  functions and both are the kind of thing that fails silently in production.
- `SPRINT_LOG.md` updated, including anything deferred or unverified.
- Migrations written; applied via `db push` after a `--dry-run` check.
- Feature flags for W2 written into a migration and left **off**.
- One EAS build at the end containing the sprint, with a report of what's in it.
- An explicit list of what you could **not** verify — especially anything
  needing a physical device — rather than a claim that it works.
