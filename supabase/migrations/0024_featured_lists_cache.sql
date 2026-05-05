-- ============================================================================
-- 0024_featured_lists_cache.sql
-- ----------------------------------------------------------------------------
-- City-level cache for Featured Lists ("Top 10 Burgers in Philadelphia").
--
-- Featured Lists are NOT personalized — they're "what's hot in this area,"
-- the same for every user in the same city. Computing them per-user per-open
-- via Google Places Text Search would cost thousands of dollars/month at any
-- meaningful user count. Caching them at the city level decouples cost from
-- user count: one refresh per city per day, served from this table to every
-- user in that city.
--
-- Refresh strategy:
--   • Nightly cron (pg_cron) refreshes every active city
--   • Lazy on-demand refresh if a user opens Discover in an uncached city
--   • Stale-while-revalidate: serve the cached row even if older than 24h,
--     while triggering a background refresh
-- ============================================================================

-- The cache table. One row per (city, category).
create table if not exists public.featured_lists_cache (
  id              uuid primary key default gen_random_uuid(),
  -- "Philadelphia, PA" | "Brooklyn, NY" | "gps:39.95,-75.16" — city slug, used
  -- both as cache key and display label. We also keep coords so the refresher
  -- knows where to search.
  city_key        text not null,
  city_label      text not null,
  city_lat        double precision not null,
  city_lng        double precision not null,
  -- "burgers" | "pizza" | "date_night" — matches the category slugs the
  -- mobile client knows about.
  category_slug   text not null,
  category_title  text not null,         -- "Top 10 Burgers"
  -- The 10 ranked restaurants for this (city, category).
  -- Each item: { google_place_id, name, cuisine_type, neighborhood, price_level,
  --              rating, user_rating_count, latitude, longitude }
  restaurants     jsonb not null,
  refreshed_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  unique (city_key, category_slug)
);

create index if not exists featured_lists_cache_city_idx
  on public.featured_lists_cache (city_key);

create index if not exists featured_lists_cache_refreshed_idx
  on public.featured_lists_cache (refreshed_at desc);

-- ----------------------------------------------------------------------------
-- RLS — every signed-in user can read the cache. Only the service role (the
-- edge function) can write. No per-user data lives here.
-- ----------------------------------------------------------------------------
alter table public.featured_lists_cache enable row level security;

drop policy if exists "featured_lists_cache: read" on public.featured_lists_cache;
create policy "featured_lists_cache: read"
  on public.featured_lists_cache for select
  using (auth.role() = 'authenticated');

-- No insert/update/delete policies for normal users — service role bypasses RLS.

-- ----------------------------------------------------------------------------
-- Active cities table — tracks which cities the cron should refresh.
-- A city is "active" when at least one user has opened the app there in the
-- last 14 days (the mobile client pings this on Discover open).
-- ----------------------------------------------------------------------------
create table if not exists public.featured_lists_active_cities (
  city_key       text primary key,
  city_label     text not null,
  city_lat       double precision not null,
  city_lng       double precision not null,
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists featured_lists_active_cities_seen_idx
  on public.featured_lists_active_cities (last_seen_at desc);

alter table public.featured_lists_active_cities enable row level security;

drop policy if exists "featured_lists_active_cities: read" on public.featured_lists_active_cities;
create policy "featured_lists_active_cities: read"
  on public.featured_lists_active_cities for select
  using (auth.role() = 'authenticated');

-- The mobile client calls a SECURITY DEFINER function to upsert active city
-- (rather than allowing direct inserts) so we control the shape.
create or replace function public.featured_lists_mark_city_active(
  p_city_key text,
  p_city_label text,
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;
  insert into public.featured_lists_active_cities (city_key, city_label, city_lat, city_lng)
  values (p_city_key, p_city_label, p_lat, p_lng)
  on conflict (city_key) do update
    set last_seen_at = now(),
        city_label = excluded.city_label,
        city_lat = excluded.city_lat,
        city_lng = excluded.city_lng;
end;
$$;

grant execute on function public.featured_lists_mark_city_active(text, text, double precision, double precision) to authenticated;

-- ----------------------------------------------------------------------------
-- Convenience view for the mobile client — flattens cache rows into the
-- shape the client expects, joined with active-city metadata.
-- ----------------------------------------------------------------------------
create or replace view public.featured_lists_for_city as
select
  c.city_key,
  c.city_label,
  c.city_lat,
  c.city_lng,
  c.category_slug,
  c.category_title,
  c.restaurants,
  c.refreshed_at,
  -- "fresh" = updated within the last 36 hours; otherwise stale-but-usable.
  (now() - c.refreshed_at) < interval '36 hours' as is_fresh
from public.featured_lists_cache c;
