-- ============================================================================
-- 0140 — keep the quality history, because raw events do not keep it for us.
-- ----------------------------------------------------------------------------
-- rec_funnel(p_days) (0136) answers "how is the ranker doing" by aggregating
-- raw analytics_events over a TRAILING window. That is fine for looking at
-- today and useless for looking back: 0133/0136 prune those rows at 180 and
-- 730 days, so the moment they go, so does any way to ask what the click rate
-- was in September, or whether the feedback loop changed anything when it
-- shipped.
--
-- Every week that passes without a snapshot is a week that can never be
-- analysed. That is why this lands before any model, not after one: a learned
-- ranker is worth nothing without a baseline to beat, and the baseline has to
-- have been recorded while it was happening.
--
-- It also makes aggressive pruning safe. Raw impressions can be deleted freely
-- once the numbers derived from them are permanent, which is the whole
-- argument in docs/later/telemetry-retention.md.
--
-- Cost: a few dozen rows a week, forever. At the current shape of the app that
-- is well under a megabyte a decade.
-- ============================================================================

create table if not exists public.rec_funnel_weekly (
  week_start      date    not null,
  surface         text    not null,
  slot            text    not null,
  rank            integer not null,
  impressions     integer not null default 0,
  clicks          integer not null default 0,
  saves           integer not null default 0,
  maps            integer not null default 0,
  try_another     integer not null default 0,
  not_interested  integer not null default 0,
  visits_7d       integer not null default 0,
  distinct_places integer not null default 0,
  distinct_users  integer not null default 0,
  captured_at     timestamptz not null default now(),
  primary key (week_start, surface, slot, rank)
);

comment on table public.rec_funnel_weekly is
  'Permanent weekly aggregate of the recommendation funnel. Survives the prune of analytics_events. Written only by snapshot_rec_funnel().';

alter table public.rec_funnel_weekly enable row level security;
-- No policy: nothing reads this directly. Access is through the admin-gated
-- RPC below, which is security definer. An RLS-enabled table with no policy
-- answers every client select with zero rows, which is the intent.

-- ----------------------------------------------------------------------------
-- The snapshot. Same arithmetic as rec_funnel, over an explicit [from, to)
-- week rather than a trailing window, and with no auth.uid() gate because a
-- scheduler has no user to be.
--
-- Re-runnable on purpose. It upserts, and the cron re-snapshots the last three
-- weeks every time, because visits_7d cannot be correct until seven days after
-- the impression. A week snapshotted the morning it ends under-counts its own
-- conversions; a week re-snapshotted a fortnight later does not.
-- ----------------------------------------------------------------------------
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

-- Only the scheduler runs this. Revoking from each grantee BY NAME, because
-- PUBLIC is a separate grantee from anon and from authenticated and revoking
-- one says nothing about the others.
revoke all on function public.snapshot_rec_funnel(integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Reading it back. Admin only, same gate as rec_funnel.
-- ----------------------------------------------------------------------------
create or replace function public.rec_funnel_history(p_weeks integer default 26)
returns table (
  week_start date, surface text, slot text, rank integer,
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
  select w.week_start, w.surface, w.slot, w.rank,
         w.impressions, w.clicks, w.saves, w.maps,
         w.try_another, w.not_interested, w.visits_7d,
         w.distinct_places, w.distinct_users
    from public.rec_funnel_weekly w
   where w.week_start >= (date_trunc('week', now()) - make_interval(weeks => greatest(1, least(p_weeks, 520))))::date
   order by w.week_start desc, w.surface, w.slot, w.rank;
end $$;

revoke all on function public.rec_funnel_history(integer) from public, anon;
grant execute on function public.rec_funnel_history(integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Weekly, Mondays 04:10 UTC — after the 03:xx prune jobs, so a week is
-- snapshotted from whatever survived rather than racing the deletion.
-- ----------------------------------------------------------------------------
select cron.unschedule('snapshot_rec_funnel')
 where exists (select 1 from cron.job where jobname = 'snapshot_rec_funnel');

select cron.schedule('snapshot_rec_funnel', '10 4 * * 1', $cron$
  select public.snapshot_rec_funnel(3);
$cron$);
