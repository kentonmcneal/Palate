# Sprint log

## Session 2 — accessibility + the zero-cost sprint (2026-09-02, later)

Baseline at start: `tsc` clean, 154 tests. After: `tsc` clean, **155 tests**.
Six commits, `b681a45` … `e2220bb`.

### Dynamic Type — finished

Reported by the founder's mother, who runs her iPhone at a large text size.
Session 1 covered Home, the tab bar and the shared Button/chip primitives; this
finishes it.

The pass needed a distinction session 1 didn't: **not all text in the app is
interface text.**

- **Share cards are pictures.** WrappedCard, WrappedStoryCard, SharePalateCard
  and VisitShareCard all render inside `<ViewShot>` and are captured to PNG.
  Scaling a fixed 280pt canvas to 235% doesn't make a more readable image, it
  makes a clipped one that the user then shares. They use `CanvasText`
  (`allowFontScaling={false}`), which documents why at length so it isn't
  "fixed" later.
- **Chart annotations get a cap** (`FONT_CAP.chart`, 1.3). PalateAxisGraph
  positions four axis labels and four quadrant names absolutely inside a fixed
  square; past ~1.3x they overlap rather than become readable.
- **The cuisine legend is real UI** and now behaves like it — scales fully, stops
  truncating at one line.
- **Nine fixed-height text containers → `minHeight` + padding.** The one that
  mattered most: `sign-in`'s 54pt email field clipped what you were typing, on
  the first screen, before an account exists.
- **The Wrapped story screen** keeps `adjustsFontSizeToFit` (a full-screen card
  must fit) but gets more lines before it starts shrinking — shrinking text
  someone asked to be bigger should be the last resort, not the first.

Left alone deliberately: avatars, progress bars, the welcome glow, circular
close buttons. Fixed heights there are circles and bars, not text.

### W1 — places-proxy read-through cache (migration applied, function NOT deployed)

The finding behind it: **places-proxy had no cache at all.** The one path
recording `source='cache'` fires only after the kill switch trips, i.e. as a
degraded fallback once the day's budget is spent. Telemetry agrees — 579 nearby
calls in 30 days, every one billed, zero cache rows.

What was missing was *coverage*: row timestamps cannot distinguish "this area is
empty" from "nobody has ever looked here." Migration **0054** records it
explicitly — cell, radius, when, how many results. Fails open on every doubt.

### W2 — server push (migrations applied, function NOT deployed, flag OFF)

`registerPushToken()` has written tokens to `profiles.push_token` since build 14
and nothing ever read them. This is the read side.

- **Quiet hours needed a timezone we didn't have.** `profiles` had no such
  column. Added, set from `Intl` beside the token. **Null timezone = no
  proactive push at all** — failing closed, because the failure mode is buzzing
  a stranger at 3am. Verified against real instants: midnight ET defers to 08:00
  ET, 2pm ET sends now, null returns null.
- **An outbox, not fire-and-forget** — attempts, error, unique `(user,
  dedupe_key)` so a retried trigger can't buzz twice for one visit.
- **One proactive push per user per day**, enforced at send time against what was
  actually delivered, not at enqueue against what we intended.
- **Friend activity is opt-in, default OFF.** Product decision: the setting is
  reciprocal, and defaulting people into broadcasting where they eat costs trust
  exactly once.

### Builds

- **27** (`34ba143`) — finished. Contains the complete Dynamic Type work.
- **28** (`e2220bb`) — cut so one artifact carries everything including the W1/W2
  client bits. Check status before installing.

### Needs you — three things I could not do

1. **Deploy the two edge functions.** Both are held deliberately. `send-push`
   messages real people and `places-proxy` is the live money path; the session
   brief makes both ask-first, and neither can be verified end-to-end without
   spending a Google call or notifying someone.
   `supabase functions deploy places-proxy` / `... send-push`
2. **Verify lock-screen confirm actions on a physical device.** Still the
   highest-value unverified thing in the product. Simulator cannot exercise
   notification action buttons. Install build 28, trigger a confirm
   notification, tap "Yes, I ate here" with the app fully closed, reopen, check
   the visit landed. It fails *silently* by design if the background write drops.
3. **Decide on distribution and the merge.** Branch is 16 commits ahead of
   `main`, unmerged, nothing submitted.

### Scoped, not done

- **Feed posts still don't link to places.** `top_restaurant` is only a name
  string produced by the `generate_weekly_wrapped` SQL function. Linking it means
  changing that function, the feed payload, and the renderer — more surface than
  a "small debt", and it touches the Wrapped path, so I stopped rather than
  half-do it.
- **Batching the friends-list palate-match RPC.** Real, but premature at three
  users.
- **Before/after design screenshots** — still blocked on the space-in-path local
  build issue from session 1.

---

## Session 1 — tester feedback (2026-09-02)

Branch: `sprint/tester-feedback` (branched from `main` @ `bfc23a7`).
Baseline before any change: `tsc` clean, 91/91 tests passing.
After: `tsc` clean, **148/148 tests passing** (57 new).

| # | Tester item | Workstream | Status |
|---|---|---|---|
| 2 | National chains in recs (Domino's) | W1 | Done — `8f7ee5e` |
| 10 | Rec rows not tappable | W2 | Done — `e87b1a1` |
| 5 | Green dot on "Your location" | W3 | Done — `7af8ffb` |
| 6 | Duplicate restaurants + weak lists | W3 | Done — `7af8ffb` |
| 11 | Screenshot doesn't prompt feedback | W4 | Done — `3f2fc98` |
| 3 | Confirm/deny without opening the app | W5-A | Done — `71fd9d3` (unverified on device, see below) |
| 7 | Multi-fire / never-fire, food halls | W5-B/C/D | Done — `71fd9d3` |
| 1 | Weekend discovery notifications | W5-E | Done — `71fd9d3` (partial, see below) |
| 4 | "Looks like an AI app" | W6 | Done — `fa89454` (no screenshots, see below) |
| 8 | Home cuisine/mood toggle | W7 | Done — `e8fadaf` |
| 9 | Palate match + group dining | W8 | Phase 1 done — `8828c3a`; Phase 2 specified only |

---

## Root causes worth remembering

**Domino's (#2)** was not a scoring bug. The hard chain gate existed and was
called from exactly one file. Five other surfaces each rolled their own
`recommendation_eligibility > 0` check, which only catches venues the classifier
has already labelled — an unclassified Domino's has `chain_name` null *and*
`eligibility` null, so it passed all of them. `getPersonaRecommendations`, which
powers "Places you'll probably like", had no gate at all. There is now one gate
and screens call it instead of re-deriving the rule.

**Duplicate restaurants (#6)** were not render-key bugs — the feed was already
keyed by `google_place_id`. Google Places returns one venue under two place ids
(a clean listing plus a keyword-stuffed one: "Hong Kong Restaurant" and "Hong
Kong Restaurant | Chinese"), so no id-based dedupe could ever catch them.
Matching is on identity now: same normalized name, or one name being the other
plus trailing words, within 150m.

**Duplicate notifications (#7)** — the inbox deduped correctly; the notification
path never asked the inbox whether it already held the entry.

---

## Deviations from the brief, and why

**Daily notification cap stays at 6, not 4.** The comment on
`MAX_NOTIFS_PER_DAY` records it being raised from 3 on 2026-08-31 because an
ordinary food day exceeded it and real visits were being silently inboxed —
indistinguishable, from the user's seat, from the feature not working. Lowering
it would re-introduce that. The storm is fixed by duplicate suppression and a
15-minute floor between prompts, not by a tighter cap.

**Cross-shelf dedupe on Discover was not implemented as specified.** The brief
called for a screen-level `seen` set across Featured → Most Compatible →
Trending → Nearby. On inspection that would have been wrong: the sub-tabs are
mutually exclusive views (you can't see two at once), featured lists render as
title cards rather than restaurant rows, and `buildTrendingGroups` already
assigns each restaurant to exactly one shelf via `.find()`. The real duplication
was the Google twin-listing problem above, which a `seen` set would not have
touched.

**Café rule exempted for café-shaped featured lists.** Applying the gems-only
café rule uniformly would have made "Top 10 Cafés" filter itself empty.

---

## Not done / not verified — read this before trusting anything

**Lock-screen confirm actions are UNVERIFIED on device (#3).** The code path is
complete and unit-tested at the logic layer, but notification action buttons
cannot be exercised in the iOS Simulator, and `registerPushToken` bails there by
design. What specifically needs a real device: that `confirm_yes` writes a visit
with the app fully closed, that the background window is long enough for the
Supabase round trip, and that a failure lands in the queue and drains on next
foreground. **Test this first on the new build.**

**Before/after screenshots for the design work were not produced (#4).** There
is no `ios/` directory and no prior build artifact, so this needs `expo prebuild`
plus a full local build — and this repo lives under `~/Claude Code/`, a path with
a space, which is a known local-build failure (see the reference memory). A
"before" set would mean building the previous commit too. The restyle is
reviewable in the diff; the visual check should happen on the TestFlight build.

**"Skip the nudge if they logged a visit in the last 2 hours" is not
implemented (#1).** This is not an oversight — it is not possible with local
notifications. An OS-scheduled local notification cannot be conditioned on app
state at fire time. Local was chosen deliberately: it keeps firing for users who
don't open the app, which is the entire point of a re-engagement nudge, whereas
a schedule refreshed only on app open reaches exactly the people who don't need
reaching. Enforcing the guard needs server-side push. **The push token
infrastructure already exists and is unused** (`registerPushToken` writes to
`profiles.push_token`) — that is the upgrade path.

**Feed posts still don't link to place pages (#10).** The feed renders a
friend's top restaurant as a bare name string with no place id attached, so
there is nothing to link to. Fixing it means changing the feed payload.

**No food photos, deliberately.** The largest remaining gap against
Airbnb/Resy/OpenTable is that those apps are photography-first and Palate has no
images at all. This is a standing cost decision (Google Photos API), not an
oversight. The `categoryColors` palette is the compensation. Worth revisiting
with real numbers if photos are ever a paid experiment.

---

## Needs a deploy (nothing was applied to prod)

Two migrations are written and **not applied**:

- `0052_chain_detection.sql` — adds `restaurants.is_chain_brand`, a
  `refresh_chain_brands()` function, backfills once, and rebuilds
  `restaurants_resolved` (a view's column list is frozen at creation — learned
  in 0032). Pure SQL over rows we already store; no API calls, no cost.
- `0053_discovery_pings_flag.sql` — inserts `feature_flags.discovery_pings`,
  **off**. The weekly nudges stay dark until this is flipped in the dashboard.

The client reads `is_chain_brand` only if present, and no explicit `.select()`
was widened to include it, so the app is safe against either migration order.
`places-proxy` already does `select("*")`, so the flag flows to clients
automatically once 0052 is applied.

`featured-lists-refresh` was edited (dropped the fries and early-morning lists,
saving two Google text searches per city per run) but **not redeployed**, and
never invoked — it calls Google directly and costs money.

---

## Follow-ups worth doing next

1. Verify lock-screen actions on a device, then flip `discovery_pings` on.
2. Apply 0052 and confirm `refresh_chain_brands()` marks the right rows.
3. Watch the `confirm_notif_suppressed` reasons in analytics — `duplicate_recent`
   vs `min_gap` will show whether the storm is actually gone.
4. Check the "Silent misses" panel in debug-visits after a few days of real use.
   If misses cluster on `all_filtered_out`, the loggable filter is the bug; if on
   `no_places_returned`, it's a radius problem and that costs money to fix.
5. Phase 2 group recommendations — needs the edge function in SOCIAL_DESIGN.md
   before any of it ships.
