# Palate — Change Summary (launch-hardening initiative)

Covers all work from the classifier/audit push toward the TestFlight beta.
Authoritative record is git history (`982a108` → `91ababc`); this is the
human-readable rollup. **All code is on `main` and typechecks. Nothing below is
deployed yet** — see SHIP_CHECKLIST.md for the deploy sequence.

---

## Security & auth hardening  ⚠️ has deploy dependencies
- **RLS + auth hardening** (`c6c43bd`, migration `0036`): fixed a dead feed-visibility
  RLS branch + block enforcement via `can_view_feed_author()`; removed an email leak
  from `search_users` (no email returned, exact-match only); added a unique
  friendships pair index.
- **Unauthenticated cost endpoint closed** (`c6c43bd`): `featured-lists-refresh`
  now requires `x-cron-secret` for `refresh_all_active` and a signed-in user for
  `refresh_city` — it calls Google directly, outside the places-proxy kill-switch.
- **Weekly-wrapped service-role RPC** (`8a92186`, migration `0037`): the Sunday
  auto-generation had a signature mismatch (`p_user_id_override` the RPC never
  accepted) so **no Wrapped was ever generated**. New `generate_weekly_wrapped_for`
  fixes it; both edge functions now **fail closed**.
- **Featured-lists cron secret** (`b32fb2c`, migration `0038`): reschedules the
  nightly cron to send `x-cron-secret` (the old `0025` cron sent only a bearer +
  had never-substituted placeholders → would 401 post-deploy).
- **Corrected false encryption comment** (`91ababc`): `0022`'s header claimed Gmail
  tokens were "encrypted at rest via pgsodium" — they're plaintext. Comment fixed;
  real encryption deferred to post-launch (#9).

> **Deploy dependency:** `CRON_SECRET` must be set (Vault `cron_secret` + edge secret,
> same value) and the two hardened functions deployed with `--no-verify-jwt`, or
> Sunday Wrapped + nightly Featured Lists silently stop. See SHIP_CHECKLIST step 2a.

## Scoring & recommendations
- **Honest cold-start match %** (`5445521`, #7/#8): low-confidence cards show a
  **NEW** badge instead of a fabricated "~62% match"; seeded persona now informs
  ranking (signal-presence guards instead of a `totalVisits === 0` gate).
- **One canonical engine** (`5445521` + `1ec5901`, #12): deleted the dead
  pre-migration stack (`palate-match-score.ts`, `restaurant-ranking.ts`,
  `lib/right-now.ts` + test); everything routes through `lib/recommendation/*`.
- **Scoring honesty — percentiles** (`fe2fea5`, #20): replaced fabricated "Top X%"
  claims (no population to rank against) with qualitative **Strong / Notable / Light**
  self-signal bands + honest self-scores; ego-hook rewritten to absolute phrasing.
- **Exploration-swap bug** (`af14b13`): the stretch/exploration pool bypassed
  chain/visited filters — now filters the base pool.
- (#21 vibe/occasion tags into the scorer — verified **already implemented** in the
  canonical engine; no change needed.)

## Cost controls
- **Uncached Google Places calls removed** (`af14b13`): Discover,
  RecommendationsCard, and palate-insights routed through the nearby-cache
  (`getOrFetchNearby`, 5-min TTL / 150m buckets) instead of re-fetching Places.

## Classifier (qualitative tags)
- **Prompt tuning to v1.5.0** (`7ff245c`): richer vibe/occasion/crowd/ambiance tags
  from Google reviews + atmosphere.
- **Backfill dry-run** (`4a7e09b`): prints the qualitative tags it would write.

## Client robustness (audit tier 1–2)  (`fa64966`)
- Double-tap duplicate-visit guard on Add (savingRef + disabled state).
- `getRestaurantIdByPlaceId` uses `.maybeSingle()` + friendly error (was a crash).
- repeatRate fix (first visits were being counted as repeats).
- Visibility-change rollback on failure; moderation `hiddenUserIds` no longer
  fails open; hydrate-error propagation in recs-from-saves / similar-restaurants;
  confirm-visit alternates JSON parse guarded; removed vaporware feed copy;
  friends-look-private gate on profiles.
- Invite link repointed to the working Vercel URL.

## Legal / docs
- Privacy + terms brought current (`982a108`); in-app links point at the live page
  (`002f5ae`).
- SHIP_CHECKLIST rewritten into an accurate runbook (`91ababc`).

---

## Deferred to post-launch (NOT TestFlight blockers)
- **#9 Gmail token encryption** — `gmail_tokens` columns are plaintext; RLS already
  blocks all client reads (service-role only). Fix = pgcrypto + Vault key +
  encrypt-at-rest columns + 3 SECURITY DEFINER RPCs, shipped atomically with a
  rewire of the 5 token touchpoints in `gmail-import`; needs one live connect→scan
  test.
- **#17 Wrapped cold-start polish** — already has 3 handled states; low-value churn
  pre-launch.
- **No LLM eval harness** for the classifier yet.
