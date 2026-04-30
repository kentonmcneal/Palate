-- ============================================================================
-- 0004_restaurants_taxonomy.sql
-- ----------------------------------------------------------------------------
-- Adds neighborhood + tags columns to public.restaurants so the Weekly Palate
-- Insights feature can use them directly instead of re-deriving on every read.
-- The places-proxy edge function now populates all three (cuisine_type,
-- neighborhood, tags) on every nearby/details/search call.
-- ============================================================================

alter table public.restaurants
  add column if not exists neighborhood text,
  add column if not exists tags         text[];

create index if not exists restaurants_cuisine_idx
  on public.restaurants (cuisine_type);

create index if not exists restaurants_neighborhood_idx
  on public.restaurants (neighborhood);

-- GIN for fast tag-based filtering ("any restaurants tagged spicy near me?")
create index if not exists restaurants_tags_gin
  on public.restaurants using gin (tags);
