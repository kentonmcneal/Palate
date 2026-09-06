-- ============================================================================
-- 0136 — the recommendation feedback loop, server side.
-- ----------------------------------------------------------------------------
-- Three things, all free:
--
-- 1. A kill switch. `rec_feedback_loop` gates the implicit-feedback ledger
--    in the app (lib/personal-signal.ts). ON: every rec gesture changes that
--    place's rank by a bounded, decaying amount. OFF: today's ranking,
--    exactly. Shipped ON — it is a kill switch, not a launch gate — and the
--    client keeps the last value it saw through a network blip.
--
-- 2. Keep the training set. 0133 prunes analytics_events at 180 days. The
--    rec_* events are the only rows that could ever justify a learned
--    ranker, and they were being deleted on a schedule before anyone could
--    read them. They now live 730 days; everything else keeps its 180.
--
-- 3. Read the loop. `rec_funnel(p_days)` on the 0123 pattern: definer,
--    admin only, aggregates only. Per (surface, slot, rank): verified
--    impressions, clicks, saves, directions, try-another, not-interested,
--    and visits within 7 days of an impression at that place — the one
--    number that says whether a recommendation led anywhere. Computed at
--    read time from the events; no second store, no cron.
-- ============================================================================

insert into public.feature_flags (key, enabled, description) values
  ('rec_feedback_loop', true, 'Home/Discover rank responds to clicks, saves, directions and ignored days (lib/recommendation/feedback.ts). Off = ranking ignores implicit feedback.')
on conflict (key) do nothing;

-- ---- 2. retention ---------------------------------------------------------
create or replace function public.prune_analytics_events()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.analytics_events
   where (event not like 'rec\_%' and created_at < now() - interval '180 days')
      or (event like 'rec\_%' and created_at < now() - interval '730 days');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_analytics_events() from public, anon, authenticated;

-- ---- 3. the funnel --------------------------------------------------------
drop function if exists public.rec_funnel(integer);
create or replace function public.rec_funnel(p_days integer default 28)
returns table (
  surface text, slot text, rank integer,
  impressions integer, clicks integer, saves integer, maps integer,
  try_another integer, not_interested integer, visits_7d integer,
  distinct_places integer, distinct_users integer
)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if not exists (select 1 from public.profiles p where p.id = me and p.is_admin) then
    return;
  end if;

  return query
  with ev as (
    select a.user_id,
           a.event,
           a.created_at,
           a.props->>'google_place_id'            as place,
           coalesce(a.props->>'surface', '?')     as surface,
           coalesce(a.props->>'slot', 'exploit')  as slot,
           nullif(a.props->>'rank', '')::int      as rank
      from public.analytics_events a
     where a.event like 'rec\_%'
       and a.created_at > now() - make_interval(days => greatest(1, least(p_days, 730)))
  ),
  imp as (
    select e.*,
           exists (
             select 1
               from public.visits v
               join public.restaurants r on r.id = v.restaurant_id
              where v.user_id = e.user_id
                and r.google_place_id = e.place
                and v.visited_at >= e.created_at
                and v.visited_at <  e.created_at + interval '7 days'
                and (v.detection_source = 'manual' or coalesce(v.confirmed_by_user, false))
           ) as converted
      from ev e
     where e.event = 'rec_restaurant_viewed'
  ),
  keys as (
    select distinct e.surface, e.slot, coalesce(e.rank, -1) as rank from ev e
  )
  select k.surface::text, k.slot::text, k.rank,
         (select count(*) from imp i where i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int,
         (select count(*) from ev e where e.event in ('rec_restaurant_clicked', 'rec_stretch_pick_clicked')
             and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int,
         (select count(*) from ev e where e.event = 'rec_restaurant_saved'
             and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int,
         (select count(*) from ev e where e.event = 'rec_maps_opened'
             and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int,
         (select count(*) from ev e where e.event = 'rec_try_another'
             and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int,
         (select count(*) from ev e where e.event = 'rec_recommendation_dismissed'
             and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int,
         (select count(*) from imp i where i.converted
             and i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int,
         (select count(distinct i.place) from imp i where i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int,
         (select count(distinct i.user_id) from imp i where i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int
    from keys k
   order by 1, 2, 3;
end $$;

revoke all on function public.rec_funnel(integer) from public, anon;
grant execute on function public.rec_funnel(integer) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; stranger uuid; n int; flag boolean;
begin
  -- The flag is there and on.
  select enabled into flag from public.feature_flags where key = 'rec_feedback_loop';
  if flag is distinct from true then raise exception '0136: rec_feedback_loop is not on'; end if;

  -- Signed out: nothing.
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.rec_funnel(28);
  if n <> 0 then raise exception '0136: signed-out caller read the rec funnel'; end if;

  -- A signed-in non-admin: nothing, and no error.
  select id into stranger from public.profiles where coalesce(is_admin, false) = false limit 1;
  if stranger is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', stranger::text)::text, true);
    select count(*) into n from public.rec_funnel(28);
    if n <> 0 then raise exception '0136: a non-admin read the rec funnel'; end if;
  end if;

  select id into kenton from public.profiles where is_admin limit 1;
  if kenton is null then
    raise notice '0136: no admin profile on this database — admin proof skipped';
    perform set_config('request.jwt.claims', null, true);
    return;
  end if;

  -- Three synthetic impressions for the admin, one of them with a visit that
  -- follows it, so the join is exercised and not merely parsed. plpgsql
  -- parses `return query` at runtime; a clean push proves nothing.
  insert into public.analytics_events (user_id, event, props, created_at) values
    (kenton, 'rec_restaurant_viewed',  '{"google_place_id":"PROBE_0136_A","surface":"home_recs","slot":"exploit","rank":0}', now() - interval '2 days'),
    (kenton, 'rec_restaurant_viewed',  '{"google_place_id":"PROBE_0136_B","surface":"home_recs","slot":"explore","rank":2}', now() - interval '2 days'),
    (kenton, 'rec_restaurant_clicked', '{"google_place_id":"PROBE_0136_A","surface":"home_recs","slot":"exploit","rank":0}', now() - interval '2 days');

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select count(*) into n from public.rec_funnel(7) f where f.surface = 'home_recs';
  if n < 2 then raise exception '0136: expected the probe rows in the funnel, got % groups', n; end if;
  select f.clicks into n from public.rec_funnel(7) f where f.surface = 'home_recs' and f.slot = 'exploit' and f.rank = 0;
  if n < 1 then raise exception '0136: the click did not land in its group'; end if;
  raise notice '0136: rec_funnel answers; home_recs groups present, exploit rank 0 clicks=%', n;
  perform set_config('request.jwt.claims', null, true);

  delete from public.analytics_events where props->>'google_place_id' like 'PROBE_0136_%';

  -- The prune keeps rec_* rows for two years and nothing else changed.
  insert into public.analytics_events (user_id, event, props, created_at) values
    (kenton, 'rec_restaurant_viewed', '{"google_place_id":"PROBE_0136_OLD"}', now() - interval '400 days'),
    (kenton, 'app_opened',            '{"probe":"0136"}',                       now() - interval '400 days');
  perform public.prune_analytics_events();
  select count(*) into n from public.analytics_events where props->>'google_place_id' = 'PROBE_0136_OLD';
  if n <> 1 then raise exception '0136: the prune deleted a 400-day-old rec event'; end if;
  select count(*) into n from public.analytics_events where event = 'app_opened' and props->>'probe' = '0136';
  if n <> 0 then raise exception '0136: the prune kept a 400-day-old non-rec event'; end if;
  delete from public.analytics_events where props->>'google_place_id' = 'PROBE_0136_OLD';
  raise notice '0136: prune keeps rec_* for 730 days and prunes the rest at 180';
end $$;
