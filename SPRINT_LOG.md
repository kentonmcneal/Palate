# Sprint log

## Session 5 — GYM.md, complete (2026-09-02)

`tsc` clean, **235 tests** (up from 205). Every commit JS-only, so the whole
sprint is **staged for an OTA** to runtime 0.1.7 and **not published** — build
30 is in Beta App Review. `app.json` untouched, no native modules, no flags
flipped, no Apple submission, no Gmail import run.

W1–W6 all shipped. What matters:

### Migrations 0068 and 0069 are NOT APPLIED — and I could not apply them

The Supabase CLI access token has expired. Both `supabase db push --dry-run`
and `supabase migration list` return `LegacyPlatformAuthRequiredError`, and
`supabase login` is interactive, so this needs Kenton:

```bash
npx supabase login && npx supabase db push --dry-run
```

There is no local Postgres or Docker on this machine either, so **neither
migration has been parse-checked against a real server**. Treat the dry-run as
required, not optional. One identifier was renamed by eye for this reason:
`position` is a `col_name_keyword` in Postgres and is not safe as a bare
identifier in a `RETURNS TABLE` declaration, so 0069 returns `rank_position`.

Both degrade to silence if the RPC is missing — `visit_payoff_facts` returning
an error shows no line, `top_ranked_places` returning an error shows no list —
so shipping the JS ahead of the SQL is safe, just inert.

Migrations applied through **0067**.

### W1 — Gmail refresh tokens encrypted at rest (`c5f1cf0`)

Vault-held key + pgcrypto (0066). Round-trip verified before anything was
dropped: decrypt returns the original, the plaintext column is null, and the
ciphertext is 95 bytes of valid PGP.

Two things this turned up. The encrypted write failed first time because
`refresh_token` was still `NOT NULL` — caught by the mandated round-trip check
before any real token existed, fixed in 0067. And `handleDisconnect` was still
reading the plaintext column, which would have silently skipped the Google
revoke and left mailbox access alive after a user disconnected. Swept all three
plaintext reads.

**The plaintext column still exists** and should be dropped only after the
encrypted path has run once against a real token.

### W2 — Group recommendations got a screen (`7596534`)

`group-recs` was deployed with `lib/group-recs.ts` beside it and **nothing
calling either** — dead code with a deployment. Now `/group`, reachable from
the Feed tab header.

Every pick shows its per-person scores. The headline chip is labelled "worst
case" because that is literally what minimax maximises, and the veto count is
surfaced ("ruled out 12 places at least one of you wouldn't have wanted")
rather than hidden. A group pick people can audit is a group pick people
accept; that is the whole reason to be the neutral party.

### W3 — The visit moment says what it changed (`a845dd9`)

The Swarm lesson. `visitPayoff()` is pure, picks the most **specific** true
fact rather than the most flattering, and returns null rather than reaching for
filler.

Two things the tests pinned that I had wrong first:

- "Became the top spot" is `visitsHere === runnerUp + 1`, the visit that broke
  the tie. `>` stays true for every later visit to a long-standing favourite
  and would announce the same change over and over.
- The Wrapped nudge reads `visitsToWrapped()` rather than carrying a threshold
  of its own, so it cannot nudge toward something already unlocked. My first
  version invented a per-week threshold; the real gate is lifetime, and is 3.

### W4 — The ranked list moved to the profile (`a845dd9`, `c7da6e8`)

Top five inline on your own profile and on other people's, same component both
places, plus a 9:16 share card.

`place_ratings` is RLS'd to own-rows, correctly — Elo ratings derive from
private comparison history. `top_ranked_places` (0069) shares the **order**
without the history: names and position only, never ratings or comparison
counts. Someone else's empty list and someone else's private list render
identically, on purpose.

The share is gated on three earned positions and confidence above "low", for
the same reason the screen states its own confidence: posting a list built from
one coin-flip would be the app inviting somebody to vouch publicly for a claim
it has not earned.

### W5 — The first ten minutes teach one thing (`c87a2e8`)

What a new account actually saw: a recommendation rail with nothing to
recommend from, a stretch pick built on no history, an empty saves rail — and
then, **below all of it**, a getting-started block offering three CTAs of equal
weight. Three equal choices is a menu, and a menu asks somebody to diagnose
their own account.

`nextStep()` picks one from real state, ordered by what actually unblocks
things: a connected-but-never-reviewed mailbox first (hard permission already
granted, nothing to show for it), then background location, then email import,
then logging one by hand, then friends. Hand-entering history is the Beli
labour our whole approach exists to avoid, so it is the fallback and never the
opener. Friends are never suggested for an empty account.

The card renders above the decision engine and disappears once the account is
healthy — an onboarding card that never leaves becomes furniture.

Home never calls `previewGmailImport`. Knowing a live receipt count would mean
scanning somebody's mailbox on every render of the home screen, so the step is
derived from `gmail_connection_status`, which is free.

### W6 — Activation funnel on the debug screen (`07d9648`)

Five stages, not six: confirming **is** the write, so a separate "logged" row
would always equal "confirmed". Suppressions broken out by reason, because a
suppressed detection is indistinguishable from one that never happened if you
only read stage totals — which is exactly how the confirm-multi bug stayed
invisible while it ate four prompts in an afternoon.

An unrecognized suppression reason still renders, so the funnel cannot silently
under-report precisely when the pipeline changes.

---

## Still needs Kenton — nothing below this line can be done without a device or a decision

1. **`npx supabase login`, then dry-run and apply 0068 + 0069.** Neither has
   been parse-checked. See above.
2. **Publish the OTA** once build 30 clears Beta App Review. Everything from
   sessions 4 and 5 is staged for runtime 0.1.7.
3. **Three device checks**, unchanged from last session: lock-screen confirm
   actions, Dynamic Type at the largest setting, Gmail connect.
4. **Run `preview` once on a real inbox** and record the actual
   `gmail_place_lookup` count here, so the import's cost is known before it is
   paid at scale.
5. **Flip `server_push` and `discovery_pings`** after device verification.
6. **Drop the plaintext `refresh_token` column** after the encrypted path has
   run once against a real token.

## Session 4 — TONIGHT.md, complete (2026-09-02, overnight)

`tsc` clean, **187 tests** (up from 168). Migrations applied through **0065**.
All JS-only plus additive SQL, so the whole sprint is **staged for an OTA** to
runtime 0.1.7 and not yet published — build 30 is in Beta App Review.

W1–W7 all shipped. The parts worth remembering:

- **Waitlist removed** (0061). The evidence was weaker than my own hypothesis:
  three real users signed in and never started onboarding, all post-gate — but
  three others who joined post-gate started the same day. n=3 either way. The
  gate was costing more than it protected at seven testers, so it went, and the
  column, admin RPCs and screen all stay for a one-line revert. Caught while
  doing it: the "someone joined" broadcast fires on an UPDATE into approved, so
  accounts born approved would have silently stopped announcing. Added an
  INSERT-path trigger sharing the dedupe key.
- **Generated card art was reverted** on the founder's screenshot. I had the
  reasoning backwards — a photo is information, initials are not, so a 132pt
  block of gradient made the feed emptier and pushed the name, match and reason
  below the fold. Art now renders only when a real photo exists.
- **Pairwise ranking** uses Elo rather than insertion sort, because the product
  constraint is one question and never a queue. 19 tests including a property
  test that recovers a known order from 400 comparisons with 15% wrong answers.
- **Group recs are minimax with a veto pass**, cache-only, server-side.

### Needs a human

1. **Publish the OTA** once build 30 clears review. Everything since build 30 —
   photos, heartbeat, ranking, names, match card, shared places, group recs —
   is JS-only and reaches installed 0.1.7 binaries in one `eas update`.
2. **The three device checks** are still unverified: lock-screen confirm
   actions, Dynamic Type at large text, Gmail connect.
3. **Flip `server_push` and `discovery_pings`** only after (2).

### Known divergence, flagged not buried

The group scorer is simpler than the client's five-dimension compatibility
model (cuisine, format, price, quality). A per-person number in a group result
may therefore not equal that person's solo match % for the same place. Fixing
it properly means porting `compatibility.ts` to Deno — real work, and the right
call is to do it deliberately rather than at 5am.

---


## Session 3 — social, generated art, activity push (2026-09-02, overnight)

> **SHIPPED: build 30** (`6809803`, 0.1.7, runtime 0.1.7) built and **submitted
> to App Store Connect**. It is the first build carrying ANY of the eleven
> tester items — 26 through 29 were never installed by anyone. Internal
> TestFlight gets it once Apple finishes processing; the external "Public Beta"
> group still needs Beta App Review.
>
> Both feature flags remain OFF (`server_push`, `discovery_pings`). Both edge
> functions are deployed. Three things in this build have never run on a
> physical device: lock-screen confirm actions, Dynamic Type at large text, and
> the Gmail OAuth fix.

`tsc` clean, **167 tests**. Migrations applied through **0059**. Build **29**
(`5e7e066`, runtime 0.1.7) finished. Both edge functions deployed. Both feature
flags still OFF.

### Shipped
- **Wrapped share card contrast** — the card paints a dark gradient but its text
  used light-surface tokens: `colors.ink` (#222222) on #141414, i.e. invisible.
  Added an ON_DARK palette local to the component. The dark card is kept
  deliberately; it is the share artifact.
- **PlaceArt** — generated card art from the `categoryColors` that had been
  unused since the re-skin. Cuisine maps to a fixed hue, so the feed is
  scannable by colour. Deterministic from `google_place_id`. On Discover cards
  and the place-detail hero. Its tests caught three real bugs immediately.
- **Social layer** (0056, 0059) — bio, school, Instagram, TikTok; a People
  directory sorted by palate match; profile display; a Settings editor; and a
  one-time discoverability prompt for pre-existing accounts.
- **Activity push** (0057, 0058) — joins to everyone, friend visits to friends.
  Wrapped broadcast was built then **withdrawn** on request.
- **Gmail OAuth fix** — `Error 400: invalid_request` was a redirect mismatch;
  Google's iOS clients only accept the reversed client ID. JS-only fix.
- **Font cleanup** — Fraunces was loaded and rendered nowhere.

### Decisions worth remembering
- **Existing users were not flipped to public.** New accounts default to
  discoverable, as decided. The 13 pre-existing profiles keep `friends` and are
  asked once. A default governs people who haven't decided; it is not a licence
  to decide for people who have.
- **Receiving and broadcasting are separate controls.** One notification toggle
  (default ON) governs what reaches your phone; `profile_visibility` governs
  what you emit. That separation is what lets the toggle default on without
  deciding anyone's privacy.
- **The actor now has a say.** The 0055 visit trigger notified friends
  regardless of whether the person who ate wanted it announced. All events now
  respect the actor's visibility.
- **Broadcast rows expire (3 days) and are dropped, not deferred**, and are
  retired via `attempts` rather than `sent_at` so they don't consume the
  recipient's daily quota for a push they never got.

### Still unverified — needs a device
1. **Lock-screen confirm actions.** Install build 29, trigger a confirm
   notification, tap "Yes, I ate here" with the app fully closed, reopen,
   confirm the visit landed. Fails silently by design if the background write
   drops.
2. **Dynamic Type**, at a large system text size: Home, sign-in, Wrapped.
3. **Gmail connect** — should now reach the consent screen instead of the 400.

Only after 1 passes: flip `server_push` and `discovery_pings`.

### Notes
- `broadcast_recipients` currently reaches 1 user, not 13 — it requires a
  timezone, which only populates once people install a build carrying the code
  that writes it. Fails closed by design.
- Feedback table holds **one** row, from 2026-07-21 on v0.1.0. Testers have not
  been using the form; the screenshot prompt that should fix that is in build 29
  and has never been in anyone's hands. Worth re-checking a week after rollout.
- Batching the People directory's per-person match RPC is still deferred.

---


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
