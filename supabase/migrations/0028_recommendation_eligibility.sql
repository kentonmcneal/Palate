-- ============================================================================
-- 0028_recommendation_eligibility.sql
-- ----------------------------------------------------------------------------
-- Eligibility score (0..1) that the classifier writes for every restaurant.
--   0    → never appear in discovery feeds (McDonald's, airports, hotels,
--          members-only lounges, all national chains)
--   1    → full discovery candidate
--   0.7  → soft downrank (regional chain)
--   0.85 → soft downrank (local chain)
-- The `restaurants_resolved` view (from 0027) gets an updated copy so
-- consumers can filter using a single source of truth.
-- ============================================================================

alter table public.restaurants
  add column if not exists recommendation_eligibility numeric(3,2) default 1.0,
  add column if not exists ineligibility_reason text;

-- Discovery feeds filter on this; partial index for the fast path.
create index if not exists restaurants_eligible_idx
  on public.restaurants (recommendation_eligibility)
  where recommendation_eligibility > 0;

-- Extend the resolved view with the new columns so reads stay one-stop.
-- CREATE OR REPLACE VIEW can't shift column positions, and `r.*` now expands
-- to include the new columns above — drop and recreate.
drop view if exists public.restaurants_resolved;
create view public.restaurants_resolved as
select
  r.*,
  coalesce(o_cuisine.value,    r.cuisine_type)      as resolved_cuisine_type,
  coalesce(o_subregion.value,  r.cuisine_subregion) as resolved_cuisine_subregion,
  coalesce(o_region.value,     r.cuisine_region)    as resolved_cuisine_region,
  coalesce(o_format.value,     r.format_class)      as resolved_format_class,
  coalesce(o_chain.value,      r.chain_type)        as resolved_chain_type
from public.restaurants r
left join public.restaurant_overrides o_cuisine
  on o_cuisine.restaurant_id = r.id and o_cuisine.field = 'cuisine_type'
left join public.restaurant_overrides o_subregion
  on o_subregion.restaurant_id = r.id and o_subregion.field = 'cuisine_subregion'
left join public.restaurant_overrides o_region
  on o_region.restaurant_id = r.id and o_region.field = 'cuisine_region'
left join public.restaurant_overrides o_format
  on o_format.restaurant_id = r.id and o_format.field = 'format_class'
left join public.restaurant_overrides o_chain
  on o_chain.restaurant_id = r.id and o_chain.field = 'chain_type';
