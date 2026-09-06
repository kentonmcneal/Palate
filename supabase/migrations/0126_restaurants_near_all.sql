-- ============================================================================
-- 0126 — "should we recommend this?" is not "did you eat here?"
-- ----------------------------------------------------------------------------
-- Tonight's change made passive venue resolution ask our own catalogue before
-- paying Google. It called restaurants_near, which filters
-- `recommendation_eligibility > 0` — correct for a recommendation surface, and
-- wrong for this one.
--
-- Measured live: 258 chain rows carry eligibility 0, and among them is
-- Chick-fil-A, the founder's most-visited restaurant at three visits. Topside
-- Tavern, not a chain, is 0 as well. mobile/lib/passive-pipeline.ts's own
-- isLoggableVenue deliberately admits chains, because passive capture records
-- where somebody ATE — and people eat at chains.
--
-- The benign failure was paying Google anyway. The bad one: a stop at an
-- ineligible venue with an eligible neighbour inside the 75 m resolve radius
-- resolves to the NEIGHBOUR, silently and without ever asking Google. In a
-- strip mall that is the common case, and the user is asked "did you eat at"
-- the wrong restaurant.
--
-- So the eligibility gate becomes a parameter. It stays ON by default, so
-- every existing recommendation caller is unchanged.
-- ============================================================================

-- The old four-argument signature has to go, not merely be replaced: adding a
-- fifth parameter with a default creates an OVERLOAD, and every existing
-- four-argument call then fails with "function is not unique" (42725).
drop function if exists public.restaurants_near(double precision, double precision, integer, integer);

create or replace function public.restaurants_near(
  p_lat double precision, p_lng double precision,
  p_radius_m integer default 5000, p_limit integer default 150,
  -- When false, the recommendation-eligibility gate is skipped. Only the
  -- passive-capture resolver should pass false: it is answering a question
  -- about the past, not making a suggestion about the future.
  p_recommendable_only boolean default true
)
returns setof public.restaurants
language sql stable security definer set search_path = public
as $$
  with box as (
    select p_lat - (p_radius_m / 111320.0) as min_lat, p_lat + (p_radius_m / 111320.0) as max_lat,
           p_lng - (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as min_lng,
           p_lng + (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as max_lng
  )
  select r.*
    from public.restaurants r, box b
   where auth.uid() is not null
     and r.latitude between b.min_lat and b.max_lat
     and r.longitude between b.min_lng and b.max_lng
     and (not p_recommendable_only or coalesce(r.recommendation_eligibility, 1) > 0)
   order by
     ((r.latitude - p_lat) * (r.latitude - p_lat))
     + ((r.longitude - p_lng) * (r.longitude - p_lng) * cos(radians(p_lat)) * cos(radians(p_lat)))
   limit greatest(1, least(p_limit, 300));
$$;

revoke all on function public.restaurants_near(double precision, double precision, integer, integer, boolean) from public, anon;
grant execute on function public.restaurants_near(double precision, double precision, integer, integer, boolean) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; cfa record; n_rec int; n_all int;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';

  -- signed out sees nothing, either way
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n_all from public.restaurants_near(35.098, -89.841, 3000, 50, false);
  if n_all <> 0 then raise exception '0126: signed-out caller read the catalogue'; end if;

  if kenton is null then
    raise notice '0126: fresh database — data proofs skipped';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);

  -- Find his Chick-fil-A: eligibility 0, so invisible to the recommendation
  -- path and visible to the passive one. That difference IS the fix.
  select r.latitude, r.longitude, r.google_place_id into cfa
    from public.restaurants r
   where r.name ilike 'Chick-fil-A%' and coalesce(r.recommendation_eligibility, 1) <= 0
     and r.latitude is not null
   limit 1;

  if cfa is null then
    raise notice '0126: no ineligible Chick-fil-A row to test against';
  else
    select count(*) into n_rec from public.restaurants_near(cfa.latitude, cfa.longitude, 75, 20, true)
     where google_place_id = cfa.google_place_id;
    select count(*) into n_all from public.restaurants_near(cfa.latitude, cfa.longitude, 75, 20, false)
     where google_place_id = cfa.google_place_id;

    if n_rec <> 0 then
      raise exception '0126: the recommendation path should NOT see an ineligible venue';
    end if;
    if n_all <> 1 then
      raise exception '0126: the passive path cannot see the place he actually ate at (got %)', n_all;
    end if;
    raise notice '0126: ineligible venue hidden from recommendations, visible to passive capture';
  end if;

  -- and the default is unchanged for every existing caller
  select count(*) into n_rec from public.restaurants_near(35.098, -89.841, 3000, 100);
  select count(*) into n_all from public.restaurants_near(35.098, -89.841, 3000, 100, false);
  if n_all < n_rec then
    raise exception '0126: unfiltered returned fewer rows than filtered';
  end if;
  raise notice '0126: near Memphis, recommendable=% all=%', n_rec, n_all;

  perform set_config('request.jwt.claims', null, true);
end $$;
