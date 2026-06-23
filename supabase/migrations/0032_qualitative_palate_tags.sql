-- ============================================================================
-- 0032_qualitative_palate_tags.sql
-- ----------------------------------------------------------------------------
-- Adds the qualitative "feel" tags the LLM classifier now derives — the
-- attributes Google Places can't express. These are written by
-- googleToRestaurantRow() (classifier v1.4.0) after the LLM merge:
--   vibe           → single dominant atmosphere
--   crowd_energy   → who's in the room (0-3 tags)
--   menu_style     → how the food is structured/served
--   price_feel     → perceived value, independent of raw price_level
--   ambiance_notes → one short, grounded free-text sentence
--
-- All nullable: the deterministic rule path leaves them empty, and the LLM
-- only fills them when reviews/editorial text actually support a value.
-- ============================================================================

alter table public.restaurants
  add column if not exists vibe           text,
  add column if not exists crowd_energy   text[],
  add column if not exists menu_style     text,
  add column if not exists price_feel     text,
  add column if not exists ambiance_notes text;

-- Rebuild restaurants_resolved so its `r.*` expansion picks up the new
-- columns (a view's column list is frozen at creation; new base columns are
-- NOT added automatically). Body is otherwise identical to 0030.
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
