-- ============================================================================
-- 0029_similar_restaurants.sql
-- ----------------------------------------------------------------------------
-- "More like Almyra" — ranks restaurants against a source by cuisine,
-- region, format, price, neighborhood, and tag overlap. Returns the
-- top-N IDs + a similarity score; mobile follows up with a SELECT to
-- hydrate full rows. (One extra round-trip but keeps the function
-- schema-stable across restaurant column changes.)
--
-- Signals + weights:
--   same cuisine_subregion : 30
--   same cuisine_type      : 20
--   same cuisine_region    : 10
--   price within ±1        : 15
--   same neighborhood      : 15
--   same format_class      : 10
--   flavor_tags overlap    :  5
--   occasion_tags overlap  :  5
--   max possible           : 110
--
-- Always filters out:
--   - the source itself
--   - ineligible restaurants (chains, airports, hotels — eligibility = 0)
--   - far-away places (>~16km bounding box from source)
--
-- By default also hides places the *calling user* has visited (`auth.uid()`
-- — not a caller-supplied param, so it can't be used to probe another
-- user's visit history). Pass `include_visited=true` to opt in.
-- ============================================================================

-- Defensive: drop any prior signature in case an earlier iteration of this
-- migration shipped with `exclude_user_id` (caller-supplied user id was a
-- visit-history leak; we now derive from auth.uid() instead).
drop function if exists public.similar_restaurants(uuid, int, uuid);

create or replace function public.similar_restaurants(
  source_id uuid,
  result_limit int default 20,
  include_visited boolean default false
)
returns table (
  restaurant_id uuid,
  similarity_score numeric,
  signals jsonb
)
language sql
stable
as $$
  with src as (
    select * from public.restaurants where id = source_id
  )
  select
    r.id as restaurant_id,
    (
      case when r.cuisine_subregion is not null
            and r.cuisine_subregion = src.cuisine_subregion then 30 else 0 end
      + case when r.cuisine_type is not null
              and r.cuisine_type = src.cuisine_type then 20 else 0 end
      + case when r.cuisine_region is not null
              and r.cuisine_region = src.cuisine_region then 10 else 0 end
      + case when abs(coalesce(r.price_level, 2) - coalesce(src.price_level, 2)) <= 1
            then 15 else 0 end
      + case when r.neighborhood is not null
              and r.neighborhood = src.neighborhood then 15 else 0 end
      + case when r.format_class is not null
              and r.format_class = src.format_class then 10 else 0 end
      + case when r.flavor_tags is not null and src.flavor_tags is not null
              and r.flavor_tags && src.flavor_tags then 5 else 0 end
      + case when r.occasion_tags is not null and src.occasion_tags is not null
              and r.occasion_tags && src.occasion_tags then 5 else 0 end
    )::numeric as similarity_score,
    jsonb_build_object(
      'same_subregion',     r.cuisine_subregion is not distinct from src.cuisine_subregion,
      'same_cuisine',       r.cuisine_type      is not distinct from src.cuisine_type,
      'same_region',        r.cuisine_region    is not distinct from src.cuisine_region,
      'same_neighborhood',  r.neighborhood      is not distinct from src.neighborhood,
      'same_format',        r.format_class      is not distinct from src.format_class,
      'price_diff',         abs(coalesce(r.price_level, 2) - coalesce(src.price_level, 2)),
      'flavor_overlap',     coalesce(r.flavor_tags && src.flavor_tags, false),
      'occasion_overlap',   coalesce(r.occasion_tags && src.occasion_tags, false)
    ) as signals
  from public.restaurants r
  cross join src
  where r.id <> src.id
    and coalesce(r.recommendation_eligibility, 1) > 0
    and (
      src.latitude is null or r.latitude is null
      or (
        abs(r.latitude  - src.latitude)  < 0.15
        and abs(r.longitude - src.longitude) < 0.2
      )
    )
    and (
      include_visited
      or auth.uid() is null
      or not exists (
        select 1
        from public.visits v
        where v.user_id = auth.uid()
          and v.restaurant_id = r.id
      )
    )
  order by similarity_score desc, r.user_rating_count desc nulls last
  limit result_limit;
$$;

grant execute on function public.similar_restaurants(uuid, int, boolean) to authenticated;
