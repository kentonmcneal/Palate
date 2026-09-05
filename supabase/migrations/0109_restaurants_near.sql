-- ============================================================================
-- 0109_restaurants_near.sql — depth for Discover, from rows we already own.
-- ----------------------------------------------------------------------------
-- Discover was built from one 20-result Google Nearby call. After the
-- eligibility gate, dedupe and "already visited" it was a handful of places,
-- and the Trending shelves (which need two places with 25+ reviews in a
-- category) almost never formed. The catalogue has 138 classified,
-- recommendable places within 8km of the founder's last visit. Same shape as
-- cuisines_near (0090): signed-in only, bounding box, eligible only, free.
-- ============================================================================
create or replace function public.restaurants_near(
  p_lat double precision, p_lng double precision,
  p_radius_m integer default 5000, p_limit integer default 150
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
     and coalesce(r.recommendation_eligibility, 1) > 0
   order by coalesce(r.rating, 0) * ln(1 + coalesce(r.user_rating_count, 0)) desc, r.name
   limit greatest(1, least(coalesce(p_limit, 150), 300));
$$;
revoke all on function public.restaurants_near(double precision, double precision, integer, integer) from public, anon;
grant execute on function public.restaurants_near(double precision, double precision, integer, integer) to authenticated;
