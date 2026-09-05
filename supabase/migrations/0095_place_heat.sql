-- ============================================================================
-- 0095_place_heat.sql — what "trending" can honestly mean here.
-- ----------------------------------------------------------------------------
-- Social APIs are out: Instagram's Graph API returns your own business
-- media and a capped hashtag search with no location aggregation, TikTok's
-- Research API is academic-only, Facebook does not expose place check-ins,
-- and scraping any of them risks the App Store account. So heat is built
-- from what is ours and what is free:
--
--   * Palate visits by place, 7 and 30 days
--   * saves (wishlist) and feed likes on that place
--   * Google review-count velocity, from a nightly snapshot of the counts we
--     already hold. No Google call. The snapshot starts tonight and means
--     nothing for ~30 days; the score says so by degrading gracefully.
--
-- Counted before writing (LIVE, 2026-09-05): 14 profiles, 5 visits in the
-- last 7 days across 2 people, 11 places with any visit in 30 days, every one
-- of them visited once. At this scale "hot" is not a thing the data can say.
-- So the score has three regimes and is honest about which one it is in:
--
--   palate  : any Palate signal in 30 days   -> visits/saves/likes dominate
--   velocity: review-count delta available    -> the city's own momentum
--   baseline: neither                         -> rating x log(review count),
--             which is "popular", not "hot", and the client labels it so
--
-- heat is 0..100, normalised within the returned set so the top place is
-- always 100 and the map has something to light. `regime` tells the caller
-- what the number means.
-- ============================================================================

create table if not exists public.restaurant_rating_snapshots (
  restaurant_id     uuid not null references public.restaurants(id) on delete cascade,
  captured_on       date not null default current_date,
  user_rating_count integer,
  rating            numeric(2,1),
  primary key (restaurant_id, captured_on)
);
alter table public.restaurant_rating_snapshots enable row level security;
revoke all on public.restaurant_rating_snapshots from anon, authenticated;

create or replace function public.snapshot_restaurant_ratings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  insert into public.restaurant_rating_snapshots (restaurant_id, captured_on, user_rating_count, rating)
  select id, current_date, user_rating_count, rating
    from public.restaurants
   where user_rating_count is not null
  on conflict (restaurant_id, captured_on) do update
    set user_rating_count = excluded.user_rating_count, rating = excluded.rating;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.snapshot_restaurant_ratings() from public, anon, authenticated;

-- Nightly at 03:30 UTC, ahead of the 04:00 featured-lists refresh, so the
-- snapshot records the day's counts before that job touches any rows.
select cron.unschedule(jobid) from cron.job where jobname = 'snapshot_restaurant_ratings';
select cron.schedule('snapshot_restaurant_ratings', '30 3 * * *', 'select public.snapshot_restaurant_ratings();');

-- The first snapshot, now, so the table is not empty for a day.
select public.snapshot_restaurant_ratings();

create or replace function public.place_heat(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 6000,
  p_limit integer default 12
)
returns table (
  google_place_id  text,
  name             text,
  latitude         double precision,
  longitude        double precision,
  cuisine_type     text,
  heat             integer,
  regime           text,
  palate_visits_7d integer,
  palate_visits_30d integer,
  saves            integer,
  review_delta_30d integer,
  rating           numeric,
  user_rating_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with box as (
    select
      p_lat - (p_radius_m / 111320.0) as min_lat,
      p_lat + (p_radius_m / 111320.0) as max_lat,
      p_lng - (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as min_lng,
      p_lng + (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as max_lng
  ),
  cand as (
    select r.id, r.google_place_id, r.name, r.latitude, r.longitude, r.cuisine_type,
           r.rating, r.user_rating_count
      from public.restaurants r, box b
     where auth.uid() is not null
       and r.latitude between b.min_lat and b.max_lat
       and r.longitude between b.min_lng and b.max_lng
       and coalesce(r.recommendation_eligibility, 1) > 0
  ),
  sig as (
    select c.*,
      (select count(*)::int from public.visits v
        where v.restaurant_id = c.id and v.is_public and v.visited_at >= now() - interval '7 days') as v7,
      (select count(*)::int from public.visits v
        where v.restaurant_id = c.id and v.is_public and v.visited_at >= now() - interval '30 days') as v30,
      (select count(*)::int from public.wishlist w where w.restaurant_id = c.id) as saves,
      (select count(*)::int from public.feed_events fe
        join public.feed_likes fl on fl.feed_event_id = fe.id
        where fe.payload ->> 'google_place_id' = c.google_place_id) as likes,
      (select (max(s.user_rating_count) - min(s.user_rating_count))::int
         from public.restaurant_rating_snapshots s
        where s.restaurant_id = c.id
          and s.captured_on >= current_date - 30
        having count(*) >= 2) as delta30
    from cand c
  ),
  scored as (
    select s.*,
      (s.v7 * 30.0 + s.v30 * 8.0 + s.saves * 5.0 + s.likes * 3.0) as palate_raw,
      case
        when (s.v7 + s.v30 + s.saves + s.likes) > 0 then 'palate'
        when coalesce(s.delta30, 0) > 0 then 'velocity'
        else 'baseline'
      end as regime,
      coalesce(s.rating, 0) * ln(1 + coalesce(s.user_rating_count, 0)) as baseline_raw
    from sig s
  ),
  ranked as (
    select s.*,
      case s.regime
        when 'palate'   then 200 + s.palate_raw
        when 'velocity' then 100 + least(99, s.delta30)
        else s.baseline_raw
      end as rank_raw
    from scored s
  ),
  top as (
    select * from ranked order by rank_raw desc, user_rating_count desc nulls last limit greatest(1, least(coalesce(p_limit, 12), 40))
  )
  select
    t.google_place_id, t.name, t.latitude, t.longitude, t.cuisine_type,
    -- Normalised within the set: the hottest thing on screen is 100, and the
    -- glow scales from there. Absolute heat is meaningless at 14 users.
    greatest(5, round(100.0 * t.rank_raw / nullif((select max(rank_raw) from top), 0)))::int as heat,
    t.regime,
    t.v7, t.v30, t.saves, t.delta30, t.rating, t.user_rating_count
  from top t
  order by t.rank_raw desc;
$$;

revoke all on function public.place_heat(double precision, double precision, integer, integer) from public;
revoke all on function public.place_heat(double precision, double precision, integer, integer) from anon;
grant execute on function public.place_heat(double precision, double precision, integer, integer) to authenticated;
