-- ============================================================================
-- 0124 — featured lists go quarterly, and the three clocks are made to agree.
-- ----------------------------------------------------------------------------
-- Featured lists were the single largest line in the Google bill: 377 of 1,053
-- billable calls over the 30 days to 2026-09-06, 284 of them on one day, at
-- roughly 15 paid Text Searches per city rebuild.
--
-- The nightly cron was blamed for that and it was not the culprit. THREE
-- separate clocks governed a rebuild and they disagreed, so the tightest one
-- won:
--
--   is_fresh (this view)            36 hours
--   refresh_city on-demand gate     18 hours   <- the binding constraint
--   the cron's own gate              6 days
--
-- The client fires refresh_city whenever any row reports is_fresh = false. So
-- eighteen hours after a rebuild, the next person to open the app paid for
-- another one. Fourteen accounts were enough to produce 284 calls in a day;
-- the cron never got a look in.
--
-- All three are now ninety days. These lists are editorial — "the ten best
-- pizza places in Memphis" is not a fact with a daily cadence — and a new
-- restaurant still reaches people immediately through Discover and search.
-- ============================================================================

create or replace view public.featured_lists_for_city as
select
  c.city_key,
  c.city_label,
  c.city_lat,
  c.city_lng,
  c.category_slug,
  c.category_title,
  c.restaurants,
  c.refreshed_at,
  -- Must match REFRESH_INTERVAL_DAYS in
  -- supabase/functions/featured-lists-refresh/index.ts. When these disagree
  -- the client asks for refreshes the server then declines, or worse, pays
  -- for ones nobody needed.
  (now() - c.refreshed_at) < interval '90 days' as is_fresh
from public.featured_lists_cache c;

-- The cron can drop from nightly to weekly: with a ninety-day window a nightly
-- pass spends its time discovering there is nothing to do. Sunday 04:00.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'featured_lists_refresh_nightly'),
  schedule := '0 4 * * 0'
);

-- ---- proofs --------------------------------------------------------------
do $$
declare n int; r record; sched text;
begin
  -- the view still answers, and now reports its rows as fresh
  select count(*) into n from public.featured_lists_for_city;
  raise notice '0124: cache holds % rows', n;

  select count(*) into n from public.featured_lists_for_city where is_fresh;
  raise notice '0124: % of them now read as fresh', n;

  -- anything rebuilt inside ninety days must be fresh, or the client will
  -- immediately ask for a paid refresh of a list it just received
  select count(*) into n from public.featured_lists_for_city
   where refreshed_at > now() - interval '80 days' and not is_fresh;
  if n <> 0 then
    raise exception '0124: % recently-built rows still report stale', n;
  end if;

  select schedule into sched from cron.job where jobname = 'featured_lists_refresh_nightly';
  if sched <> '0 4 * * 0' then
    raise exception '0124: cron schedule is %, expected weekly', sched;
  end if;
end $$;
