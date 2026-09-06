-- ============================================================================
-- 0133 — bound the two tables that grow forever.
-- ----------------------------------------------------------------------------
-- Only proxy_calls was ever pruned. analytics_events and
-- restaurant_rating_snapshots grow without limit, and 2,232 analytics rows are
-- already older than ninety days.
--
-- Neither is urgent — the database is 26 MB of a 500 MB ceiling — and that is
-- exactly why it is worth doing now, while deleting is boring. A retention
-- policy added under pressure gets a shorter window than anyone wanted.
--
-- 180 DAYS FOR ANALYTICS, not 90. The funnel is read over 30 days, so 90 would
-- be defensible, but half a year is what makes a year-on-year question
-- possible at all and the storage is trivial: 470 bytes a row, ~550 rows per
-- active user per month. Fifty active testers is about 13 MB a month, so a
-- 180-day window settles at roughly 80 MB — a sixth of the free tier, held
-- flat forever rather than climbing.
--
-- 400 DAYS FOR RATING SNAPSHOTS, deliberately more than a year. Their whole
-- purpose is detecting that a restaurant's rating is drifting, and a window
-- under a year cannot answer "is this place better or worse than last summer".
-- ============================================================================

create or replace function public.prune_analytics_events()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.analytics_events where created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_analytics_events() from public, anon, authenticated;

create or replace function public.prune_rating_snapshots()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.restaurant_rating_snapshots where captured_on < current_date - 400;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_rating_snapshots() from public, anon, authenticated;

-- Weekly, not nightly. These delete a handful of rows; a nightly job would
-- spend most of its life discovering there is nothing to do, and a big delete
-- once a week is easier to notice than a small one every night.
select cron.unschedule(jobid) from cron.job where jobname = 'prune_analytics_events';
select cron.schedule('prune_analytics_events', '40 3 * * 0', 'select public.prune_analytics_events();');
select cron.unschedule(jobid) from cron.job where jobname = 'prune_rating_snapshots';
select cron.schedule('prune_rating_snapshots', '45 3 * * 0', 'select public.prune_rating_snapshots();');

-- ---- proofs --------------------------------------------------------------
do $$
declare before_n bigint; after_n bigint; old_n bigint; deleted int; sched text;
begin
  select count(*) into before_n from public.analytics_events;
  select count(*) into old_n from public.analytics_events
   where created_at < now() - interval '180 days';

  deleted := public.prune_analytics_events();
  select count(*) into after_n from public.analytics_events;

  -- It must delete exactly what it claimed, and nothing else.
  if deleted <> old_n then
    raise exception '0133: prune deleted % rows but % were out of window', deleted, old_n;
  end if;
  if after_n <> before_n - old_n then
    raise exception '0133: analytics went from % to %, expected %', before_n, after_n, before_n - old_n;
  end if;
  raise notice '0133: analytics %  ->  % (removed % older than 180 days)', before_n, after_n, deleted;

  -- Nothing inside the window may be touched. This is the assertion that
  -- matters: a retention job that takes one day too many is silent data loss.
  select count(*) into old_n from public.analytics_events
   where created_at < now() - interval '180 days';
  if old_n <> 0 then raise exception '0133: prune left % stale rows', old_n; end if;

  select count(*) into old_n from public.analytics_events
   where created_at > now() - interval '30 days';
  if old_n = 0 then
    raise exception '0133: the last 30 days of analytics are gone — the funnel is blind';
  end if;
  raise notice '0133: % events inside the last 30 days survived', old_n;

  deleted := public.prune_rating_snapshots();
  raise notice '0133: rating snapshots removed: %', deleted;

  select schedule into sched from cron.job where jobname = 'prune_analytics_events';
  if sched is null then raise exception '0133: the analytics prune is not scheduled'; end if;
end $$;
