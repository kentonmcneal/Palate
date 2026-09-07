-- ============================================================================
-- 0142 — keep bookkeeping events out of the quality numbers.
-- ----------------------------------------------------------------------------
-- rec_funnel and snapshot_rec_funnel select every event matching 'rec\_%'.
-- Two of those describe the ranking pass rather than a person's reaction to
-- it: rec_pool (how big the candidate pool was) and rec_slate (which
-- candidates were considered, added today). Neither is an impression, a click
-- or a save, so both contribute zero to every count while still creating a
-- key in the group-by. The result is an all-zero row that looks like a surface
-- nobody engaged with.
--
-- Fixed here rather than later because 0140 just started writing this series
-- to a permanent table. A metric is worth what its history is worth, and the
-- history begins now.
--
-- rec_funnel_weekly is recomputed from scratch below. It is fully derived from
-- analytics_events, so deleting and regenerating it inside one transaction
-- loses nothing; the rows it holds were themselves written twenty minutes ago.
-- ============================================================================

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
       and a.event not in ('rec_pool', 'rec_slate')
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

create or replace function public.snapshot_rec_funnel(p_weeks integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n_rows integer := 0;
  wk     date;
begin
  for wk in
    select generate_series(
             date_trunc('week', now() - make_interval(weeks => greatest(1, least(p_weeks, 52))))::date,
             date_trunc('week', now())::date,
             interval '1 week'
           )::date
  loop
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
         and a.event not in ('rec_pool', 'rec_slate')
       and a.created_at >= wk
         and a.created_at <  wk + interval '7 days'
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
    ),
    rows as (
      select wk as week_start, k.surface, k.slot, k.rank,
        (select count(*) from imp i where i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int as impressions,
        (select count(*) from ev e where e.event in ('rec_restaurant_clicked', 'rec_stretch_pick_clicked')
            and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int as clicks,
        (select count(*) from ev e where e.event = 'rec_restaurant_saved'
            and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int as saves,
        (select count(*) from ev e where e.event = 'rec_maps_opened'
            and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int as maps,
        (select count(*) from ev e where e.event = 'rec_try_another'
            and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int as try_another,
        (select count(*) from ev e where e.event = 'rec_recommendation_dismissed'
            and e.surface = k.surface and e.slot = k.slot and coalesce(e.rank, -1) = k.rank)::int as not_interested,
        (select count(*) from imp i where i.converted
            and i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int as visits_7d,
        (select count(distinct i.place) from imp i where i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int as distinct_places,
        (select count(distinct i.user_id) from imp i where i.surface = k.surface and i.slot = k.slot and coalesce(i.rank, -1) = k.rank)::int as distinct_users
      from keys k
    )
    insert into public.rec_funnel_weekly as t (
      week_start, surface, slot, rank, impressions, clicks, saves, maps,
      try_another, not_interested, visits_7d, distinct_places, distinct_users, captured_at
    )
    select r.week_start, r.surface, r.slot, r.rank, r.impressions, r.clicks, r.saves, r.maps,
           r.try_another, r.not_interested, r.visits_7d, r.distinct_places, r.distinct_users, now()
      from rows r
    on conflict (week_start, surface, slot, rank) do update set
      impressions = excluded.impressions, clicks = excluded.clicks,
      saves = excluded.saves, maps = excluded.maps,
      try_another = excluded.try_another, not_interested = excluded.not_interested,
      visits_7d = excluded.visits_7d, distinct_places = excluded.distinct_places,
      distinct_users = excluded.distinct_users, captured_at = now();

    get diagnostics n_rows = row_count;
  end loop;

  return n_rows;
end $$;

revoke all on function public.snapshot_rec_funnel(integer) from public, anon, authenticated;

delete from public.rec_funnel_weekly;
select public.snapshot_rec_funnel(26);
