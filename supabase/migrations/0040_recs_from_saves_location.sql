-- ============================================================================
-- 0040_recs_from_saves_location.sql
-- ----------------------------------------------------------------------------
-- Make the "Based on your saves" rail LOCATION-AWARE.
--
-- Before: recommendations_from_saves called similar_restaurants per anchor,
-- which bounds candidates to ~16km around the SAVED place. A user in Memphis
-- whose saves are all in Philadelphia got Philadelphia recommendations — the
-- RPC had no notion of where the user actually is.
--
-- After: the RPC accepts the user's current lat/lng and bounds candidates to a
-- box around the USER (default ~40km metro radius) while still scoring
-- similarity against each saved anchor's attributes. Similarity comes from the
-- saves; geography comes from the user. Chains stay filtered
-- (recommendation_eligibility > 0), visited places stay excluded.
--
-- When lat/lng are NULL (location unknown / older client that doesn't pass
-- them) the geo filter is skipped, preserving the previous behavior — so this
-- is backward-compatible with the currently-shipped app until it rebuilds.
--
-- Auth remains implicit via auth.uid() (no caller-supplied user id).
-- ============================================================================

-- Old 3-arg signature is superseded. Drop it so there's a single overload;
-- the new one defaults lat/lng to NULL, so existing 3-named-arg callers still
-- resolve (and simply get the pre-location behavior).
drop function if exists public.recommendations_from_saves(int, int, int);

create or replace function public.recommendations_from_saves(
  result_limit     int default 12,
  per_anchor_limit int default 12,
  max_anchors      int default 5,
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_max_km         double precision default 40
)
returns table (
  restaurant_id   uuid,
  total_score     numeric,
  matched_against text[]
)
language sql
stable
as $$
  with anchors as (
    select r.*, r.name as anchor_name
    from public.wishlist w
    join public.restaurants r on r.id = w.restaurant_id
    where w.user_id = auth.uid()
    order by w.added_at desc
    limit max_anchors
  ),
  scored as (
    select
      a.anchor_name,
      cand.id as match_id,
      (
        case when cand.cuisine_subregion is not null
              and cand.cuisine_subregion = a.cuisine_subregion then 30 else 0 end
        + case when cand.cuisine_type is not null
                and cand.cuisine_type = a.cuisine_type then 20 else 0 end
        + case when cand.cuisine_region is not null
                and cand.cuisine_region = a.cuisine_region then 10 else 0 end
        + case when abs(coalesce(cand.price_level, 2) - coalesce(a.price_level, 2)) <= 1
              then 15 else 0 end
        + case when cand.neighborhood is not null
                and cand.neighborhood = a.neighborhood then 15 else 0 end
        + case when cand.format_class is not null
                and cand.format_class = a.format_class then 10 else 0 end
        + case when cand.flavor_tags is not null and a.flavor_tags is not null
                and cand.flavor_tags && a.flavor_tags then 5 else 0 end
        + case when cand.occasion_tags is not null and a.occasion_tags is not null
                and cand.occasion_tags && a.occasion_tags then 5 else 0 end
      )::numeric as similarity_score
    from anchors a
    join public.restaurants cand
      on cand.id <> a.id
     and coalesce(cand.recommendation_eligibility, 1) > 0
     -- Geo bound = the USER's location (skipped entirely when unknown).
     and (
       p_lat is null or p_lng is null
       or cand.latitude is null or cand.longitude is null
       or (
         abs(cand.latitude  - p_lat) < (p_max_km / 111.0)
         and abs(cand.longitude - p_lng) < (p_max_km / (111.0 * greatest(cos(radians(p_lat)), 0.01)))
       )
     )
    where cand.id not in (select id from anchors)
      and not exists (
        select 1 from public.visits v
        where v.user_id = auth.uid() and v.restaurant_id = cand.id
      )
  ),
  ranked as (
    select
      match_id, anchor_name, similarity_score,
      row_number() over (partition by anchor_name order by similarity_score desc) as rn
    from scored
    where similarity_score > 0
  )
  select
    match_id as restaurant_id,
    sum(similarity_score)::numeric as total_score,
    array_agg(distinct anchor_name) as matched_against
  from ranked
  where rn <= per_anchor_limit
  group by match_id
  order by total_score desc
  limit result_limit;
$$;

grant execute on function public.recommendations_from_saves(int, int, int, double precision, double precision, double precision) to authenticated;
