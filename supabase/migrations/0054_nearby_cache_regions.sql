-- ============================================================================
-- 0054_nearby_cache_regions.sql — make the nearby cache a real cache.
-- ----------------------------------------------------------------------------
-- Today every nearby request that misses the CLIENT cache costs a Google call.
-- places-proxy has no read-through cache at all: the one code path that records
-- `source = 'cache'` fires only after the kill switch has tripped, i.e. as a
-- degraded fallback once the daily budget is already spent. Telemetry confirms
-- it — 579 nearby calls in 30 days, every one billed, zero cache rows.
--
-- Meanwhile we already store every restaurant we have ever seen, with
-- coordinates, in `restaurants`. The data to answer most nearby requests is
-- sitting there unread.
--
-- What was missing is knowing whether a region has been *covered*. Row
-- timestamps can't tell you that: an empty box is indistinguishable from a box
-- nobody has ever searched. This table records coverage explicitly — "we asked
-- Google about this cell, at this radius, at this time, and got this many
-- results" — so a hit is a fact rather than an inference.
--
-- Pure bookkeeping over rows we already have. No API calls, no cost.
-- ============================================================================

create table if not exists public.nearby_cache_regions (
  -- Coordinates bucketed to 0.01° (~1.1km lat) so two users a few blocks apart
  -- share a cell instead of each paying for their own call. Stored as integers
  -- (degrees x 100) to keep the primary key exact.
  lat_bucket   integer     not null,
  lng_bucket   integer     not null,
  radius_m     integer     not null,
  fetched_at   timestamptz not null default now(),
  -- How many places the live call returned. A cell that legitimately holds
  -- three restaurants must not be treated as a dense hit later.
  result_count integer     not null default 0,
  primary key (lat_bucket, lng_bucket, radius_m)
);

comment on table public.nearby_cache_regions is
  'Coverage log for the places-proxy nearby read-through cache: which lat/lng cell was fetched from Google, at what radius, when, and how many results came back. Lets the proxy serve from public.restaurants instead of paying for a repeat call.';

alter table public.nearby_cache_regions enable row level security;

-- Service-role only. The proxy writes it; no client ever reads it directly,
-- and RLS denies by default with no policy.
revoke all on public.nearby_cache_regions from anon, authenticated;
