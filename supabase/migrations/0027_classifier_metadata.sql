-- ============================================================================
-- 0027_classifier_metadata.sql
-- ----------------------------------------------------------------------------
-- Supports the next-gen restaurant classifier:
--   1. classifier_version + classification_confidence on restaurants
--      → backfill script can find stale rows; UI can hide low-confidence tags
--   2. review_snippets + editorial_summary cache on restaurants
--      → input to review-text mining (flavor/occasion tags)
--   3. restaurant_overrides table
--      → user corrections (e.g. "no, this is Sichuan, not just Chinese")
--        that win over algorithmic values at read time
-- ============================================================================

-- ---------- 1. Versioning + confidence ----------
alter table public.restaurants
  -- Semver of the classifier that wrote this row. Used by backfill to find
  -- rows produced by older versions and re-classify them in bulk.
  add column if not exists classifier_version text,
  -- Per-field confidence, e.g. { "cuisine_type": 0.9, "cuisine_subregion": 0.3 }
  -- 0 = no signal, 1 = high confidence. Read-side may hide tags below ~0.5.
  add column if not exists classification_confidence jsonb;

create index if not exists restaurants_classifier_version_idx
  on public.restaurants (classifier_version);

-- ---------- 2. Review / editorial summary cache ----------
alter table public.restaurants
  -- Up to ~5 short review excerpts, used as input to the flavor/occasion
  -- miner and the LLM fallback. Not user-facing.
  add column if not exists review_snippets text[],
  -- Google's `editorialSummary.text` if present.
  add column if not exists editorial_summary text,
  -- Separate from refreshed_at: reviews are expensive to fetch, so they
  -- refresh on a longer cadence than the base place record.
  add column if not exists reviews_refreshed_at timestamptz,
  -- Raw Google Places payload. Lets the backfill script re-classify any
  -- restaurant in-memory without paying Google for a fresh API call.
  add column if not exists google_raw jsonb;

-- ---------- 3. User-correction overrides ----------
-- Scalar fields only for the first cut. Array fields (flavor_tags etc.)
-- can be added later if users request them.
create table if not exists public.restaurant_overrides (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  field           text not null check (field in (
    'cuisine_type',
    'cuisine_subregion',
    'cuisine_region',
    'format_class',
    'chain_type'
  )),
  value           text not null,
  reason          text,
  created_at      timestamptz not null default now(),
  -- Last-write-wins per (restaurant, field). Acceptable at TestFlight scale;
  -- revisit if we see disagreement at meaningful volume.
  unique (restaurant_id, field)
);

create index if not exists restaurant_overrides_restaurant_idx
  on public.restaurant_overrides (restaurant_id);

alter table public.restaurant_overrides enable row level security;

drop policy if exists "overrides public read" on public.restaurant_overrides;
create policy "overrides public read"
  on public.restaurant_overrides for select
  using (true);

drop policy if exists "overrides authenticated insert" on public.restaurant_overrides;
create policy "overrides authenticated insert"
  on public.restaurant_overrides for insert
  to authenticated
  with check (auth.uid() = user_id);

-- No update/delete policy → only the service role (edge functions) can
-- rewrite or remove an override. Prevents users overwriting each other.

-- ---------- View: restaurants with overrides applied ----------
-- Mobile + analytics read from this view so they get corrected values
-- without each caller having to remember to join overrides.
create or replace view public.restaurants_resolved as
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
