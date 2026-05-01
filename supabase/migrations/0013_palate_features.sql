-- ============================================================================
-- 0013_palate_features.sql
-- ----------------------------------------------------------------------------
-- Extends the restaurant tag schema for the Palate Feature Engine.
--
-- New columns are derived by the places-proxy edge function on every nearby/
-- search/details call, so they backfill naturally as the cache refreshes.
--
-- Compatibility note: existing analytics that read `cuisine_type` and `tags`
-- continue to work unchanged. The new columns are additive.
-- ============================================================================

alter table public.restaurants
  -- High-level cuisine region (e.g., "southern_us", "east_asian", "caribbean")
  add column if not exists cuisine_region text,
  -- Granular subregion (e.g., "memphis_bbq", "korean_bbq", "halal_cart")
  add column if not exists cuisine_subregion text,
  -- Format/service style ("quick_service", "fast_casual", "casual_dining",
  -- "fine_dining", "café", "bar", "wine_bar", "food_truck", "bodega",
  -- "ghost_kitchen", "market_hall", "hotel_dining")
  add column if not exists format_class text,
  -- Chain affiliation ("national_chain", "regional_chain", "local_chain", "independent")
  add column if not exists chain_type text,
  -- Occasion archetype ("date_night", "group_dinner", "casual_solo", "brunch",
  -- "late_night", "breakfast", "working_lunch", "weekend_anchor")
  add column if not exists occasion_tags text[],
  -- Flavor profile descriptors ("smoky", "spicy", "savory", "sweet",
  -- "fresh", "rich", "light", "umami", "char")
  add column if not exists flavor_tags text[],
  -- Cultural posture ("heritage", "modernist", "fusion", "comfort", "trending", "hidden")
  add column if not exists cultural_context text;

create index if not exists restaurants_cuisine_region_idx on public.restaurants (cuisine_region);
create index if not exists restaurants_cuisine_subregion_idx on public.restaurants (cuisine_subregion);
create index if not exists restaurants_format_class_idx on public.restaurants (format_class);
create index if not exists restaurants_chain_type_idx on public.restaurants (chain_type);
create index if not exists restaurants_occasion_tags_gin on public.restaurants using gin (occasion_tags);
create index if not exists restaurants_flavor_tags_gin on public.restaurants using gin (flavor_tags);
