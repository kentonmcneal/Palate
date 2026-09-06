-- ============================================================================
-- 0122 — search suggestions as you type, for nothing.
-- ----------------------------------------------------------------------------
-- The founder: "some of the search bars only allow you to type letters but
-- doesn't bring in suggestions as you type, only after you press search."
--
-- The obvious fix is to debounce the existing search and fire it per keystroke.
-- That would be a mistake: every one of those bars calls searchRestaurants,
-- which goes through places-proxy to Google Places Text Search and BILLS PER
-- CALL. Typing "chipotle" with a 300ms debounce is two or three billed
-- requests where there was one, on the single most-used path in the app.
--
-- So: search what we already have, first and free. The catalogue holds ~1,480
-- restaurants, and the place someone is typing is usually already in it —
-- they are logging somewhere they just ate, near where they are. This RPC
-- answers instantly from Postgres for zero cents, and Google stays where it
-- belongs: on an explicit "search everywhere", for the places we do not know.
--
-- Ranking: an exact prefix beats a word-start beats a substring; then closer
-- beats further; then better-rated. Distance only when the caller gives a
-- location, so it degrades to a plain name search rather than returning
-- nothing.
-- ============================================================================

-- Trigram index so ILIKE '%x%' does not table-scan as the catalogue grows.
create extension if not exists pg_trgm;
create index if not exists restaurants_name_trgm on public.restaurants using gin (name gin_trgm_ops);

create or replace function public.search_restaurants_local(
  p_query text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 8
)
returns table (
  google_place_id text, name text, address text, neighborhood text,
  cuisine_type text, price_level integer, rating numeric,
  user_rating_count integer, latitude double precision, longitude double precision,
  distance_km double precision
)
language sql stable security definer set search_path = public as $$
  with q as (select trim(coalesce(p_query, '')) as t)
  select r.google_place_id, r.name, r.address, r.neighborhood,
         r.cuisine_type, r.price_level, r.rating, r.user_rating_count,
         r.latitude, r.longitude,
         case when p_lat is null or p_lng is null or r.latitude is null then null
              else round((111.045 * sqrt(
                     power(r.latitude - p_lat, 2)
                   + power((r.longitude - p_lng) * cos(radians(p_lat)), 2)))::numeric, 2)::double precision
         end as distance_km
    from public.restaurants r, q
   where auth.uid() is not null
     and length(q.t) >= 2
     and r.name ilike '%' || q.t || '%'
     and coalesce(r.recommendation_eligibility, 1) > 0
   order by
     -- What you typed, where it matched. "chip" should surface Chipotle before
     -- Fish & Chips, and both before Woodchipper Bar.
     case
       when lower(r.name) = lower(q.t) then 0
       when lower(r.name) like lower(q.t) || '%' then 1
       when lower(r.name) like '% ' || lower(q.t) || '%' then 2
       else 3
     end,
     case when p_lat is null or r.latitude is null then 0
          else sqrt(power(r.latitude - p_lat, 2) + power((r.longitude - p_lng) * cos(radians(p_lat)), 2))
     end,
     coalesce(r.user_rating_count, 0) desc,
     r.name
   limit greatest(1, least(p_limit, 25));
$$;

revoke all on function public.search_restaurants_local(text, double precision, double precision, integer) from public, anon;
grant execute on function public.search_restaurants_local(text, double precision, double precision, integer) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; n int; r record; first_name text;
begin
  -- signed out: nothing, ever
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.search_restaurants_local('chip', 35.098, -89.841);
  if n <> 0 then raise exception '0122: signed-out caller searched the catalogue'; end if;

  select id into kenton from public.profiles where display_name = 'Kenton M';
  if kenton is null then
    raise notice '0122: fresh database — ranking proofs skipped';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);

  -- a one-character query is not a search; it is every row in the table
  select count(*) into n from public.search_restaurants_local('c', 35.098, -89.841);
  if n <> 0 then raise exception '0122: a single character returned % rows', n; end if;

  -- prefix beats substring
  select name into first_name from public.search_restaurants_local('chi', 35.098, -89.841, 5) limit 1;
  if first_name is null then
    raise notice '0122: nothing matched "chi" near Memphis';
  elsif lower(first_name) not like 'chi%' then
    raise exception '0122: ranking put a substring match first: %', first_name;
  end if;

  -- it works with no location at all
  select count(*) into n from public.search_restaurants_local('bar', null, null, 5);
  raise notice '0122: "bar" with no location returned % rows', n;

  perform set_config('request.jwt.claims', null, true);
end $$;
