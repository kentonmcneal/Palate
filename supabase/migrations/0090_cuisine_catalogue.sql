-- ============================================================================
-- 0090_cuisine_catalogue.sql — asking for a cuisine you do not eat.
-- ----------------------------------------------------------------------------
-- The mood chips were built from the user's own history, so a cuisine they had
-- never eaten could not be offered. That was fixed by building them from the
-- nearby candidate pool instead — which fixed half the problem and left the
-- other half in place.
--
-- The pool is a 2.5km fetch, already filtered to recommendable places and
-- capped. If there is no steakhouse in it, "Steakhouse" is still not offered
-- and you still cannot ask. The founder's words were "it should still pull in
-- top steakhouses", and filtering a list that does not contain any is not that.
--
-- These read the restaurants table directly. No Google call, no cost: 1043 rows
-- are already classified and sitting there, and the question "what cuisines
-- exist near me" has always been answerable without spending anything.
--
-- Bounding box rather than a distance function, matching what places-proxy
-- already does for degraded nearby. It over-selects slightly at the corners,
-- which for "show me steakhouses within a few miles" is the right trade against
-- a sequential scan with a trig function in the predicate.
-- ============================================================================

create or replace function public.cuisines_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 8000
)
returns table (cuisine text, place_count integer)
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
  )
  select r.cuisine_type::text, count(*)::int
    from public.restaurants r, box b
   where auth.uid() is not null
     and r.latitude between b.min_lat and b.max_lat
     and r.longitude between b.min_lng and b.max_lng
     and r.cuisine_type is not null
     and r.cuisine_type <> 'other'
     -- Same eligibility gate the recommendation surfaces use, so a chip can
     -- never lead somewhere the app would refuse to recommend.
     and coalesce(r.recommendation_eligibility, 1) > 0
   group by r.cuisine_type
  having count(*) >= 1
   order by count(*) desc, r.cuisine_type;
$$;

revoke all on function public.cuisines_near(double precision, double precision, integer) from public;
revoke all on function public.cuisines_near(double precision, double precision, integer) from anon;
grant execute on function public.cuisines_near(double precision, double precision, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- The places themselves, when the local pool has none of them.
-- ----------------------------------------------------------------------------
-- Ordered by rating and how many people rated it, because this is the branch
-- where personal fit is precisely what we do NOT have: the user is asking for a
-- cuisine outside their pattern, so "best of these" is the only honest ranking.
-- The client still scores them and says plainly that they are not your usual.
create or replace function public.restaurants_by_cuisine(
  p_lat double precision,
  p_lng double precision,
  p_cuisine text,
  p_radius_m integer default 8000,
  p_limit integer default 20
)
returns setof public.restaurants
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
  )
  select r.*
    from public.restaurants r, box b
   where auth.uid() is not null
     and r.latitude between b.min_lat and b.max_lat
     and r.longitude between b.min_lng and b.max_lng
     and lower(r.cuisine_type) = lower(trim(p_cuisine))
     and coalesce(r.recommendation_eligibility, 1) > 0
   order by
     coalesce(r.rating, 0) desc,
     coalesce(r.user_rating_count, 0) desc,
     r.name
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.restaurants_by_cuisine(double precision, double precision, text, integer, integer) from public;
revoke all on function public.restaurants_by_cuisine(double precision, double precision, text, integer, integer) from anon;
grant execute on function public.restaurants_by_cuisine(double precision, double precision, text, integer, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Proof, in the same push. A clean deploy proves nothing on its own (CLAUDE.md),
-- so both functions are invoked here as a real signed-in user and the counts are
-- raised as notices. If the plan is wrong, the push fails instead of shipping.
-- ----------------------------------------------------------------------------
do $$
declare
  probe uuid;
  plat double precision;
  plng double precision;
  n_cuisines int;
  top_cuisine text;
  n_top int;
  n_steak int;
  row_rec record;
begin
  select v.user_id into probe
    from public.visits v
   group by v.user_id
   order by count(*) desc
   limit 1;

  if probe is null then
    raise notice '0090: no visits on this database, skipping the live probe';
    return;
  end if;

  select r.latitude, r.longitude into plat, plng
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = probe and r.latitude is not null
   order by v.visited_at desc
   limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', probe::text)::text, true);

  select count(*) into n_cuisines from public.cuisines_near(plat, plng, 8000);

  select cuisine, place_count into top_cuisine, n_top
    from public.cuisines_near(plat, plng, 8000)
   limit 1;

  select count(*) into n_steak
    from public.restaurants_by_cuisine(plat, plng, 'steakhouse', 8000, 20);

  raise notice '0090 LIVE: % distinct cuisines within 8km of (%, %)',
    n_cuisines, round(plat::numeric, 3), round(plng::numeric, 3);
  raise notice '0090 LIVE: top cuisine is % with % places; steakhouse returns % places',
    coalesce(top_cuisine, 'none'), coalesce(n_top, 0), n_steak;

  for row_rec in
    select cuisine, place_count from public.cuisines_near(plat, plng, 8000) limit 12
  loop
    raise notice '0090 LIVE:   % (%)', row_rec.cuisine, row_rec.place_count;
  end loop;

  -- The anonymous branch must return nothing at all.
  perform set_config('request.jwt.claims', null, true);
  if (select count(*) from public.cuisines_near(plat, plng, 8000)) <> 0 then
    raise exception '0090: cuisines_near answered an unauthenticated caller';
  end if;
  raise notice '0090 LIVE: unauthenticated caller gets 0 rows, as intended';
end $$;
