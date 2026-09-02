-- ============================================================================
-- 0052_chain_detection.sql — mark venues that behave like a chain.
-- ----------------------------------------------------------------------------
-- Third net under the client-side chain gate (mobile/lib/recommendation/):
--
--   1. classifier chain_name        — accurate, but only after classification
--   2. NATIONAL_CHAINS name match   — accurate, but only for brands we listed
--   3. THIS: chain-shape heuristic  — brand-agnostic, learns from our own data
--
-- If the same normalized brand name appears at >= 3 distinct google_place_ids,
-- it is a chain by behavior regardless of whether anyone labeled it one. That
-- catches strong regional chains nobody hardcoded.
--
-- Pure SQL over rows we already store. No API calls, no cost.
--
-- NOTE: this only ever affects what we RECOMMEND. Chains are still stored,
-- classified, and logged — a visit to Domino's is a real visit and must keep
-- showing up in Wrapped.
-- ============================================================================

alter table public.restaurants
  add column if not exists is_chain_brand boolean not null default false;

comment on column public.restaurants.is_chain_brand is
  'True when the same normalized brand name occurs at >=3 distinct places. Suppresses the venue from recommendation surfaces only; visits still log normally. Recomputed by refresh_chain_brands().';

-- Mirrors normalizeBrand() in mobile/lib/recommendation/chains.ts: lowercase,
-- drop parentheticals and anything after a " - " separator, strip apostrophes
-- and punctuation, drop store numbers, collapse whitespace.
create or replace function public.normalize_brand(raw text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              split_part(lower(coalesce(raw, '')), ' - ', 1),
              '\([^)]*\)', ' ', 'g'),                 -- (Store 4521)
            '[''’`]', '', 'g'),                   -- domino's -> dominos
          '[^a-z0-9]+', ' ', 'g'),                     -- punctuation -> space
        '\s+\d+(\s|$)', ' ', 'g'),                     -- bare store numbers
      '\s+', ' ', 'g')                                 -- collapse
  );
$$;

-- Recompute the flag for every row. Returns the number of rows whose flag
-- changed. Cheap enough to run on demand; call it after a bulk import.
create or replace function public.refresh_chain_brands()
returns integer
language plpgsql
as $$
declare
  changed integer;
begin
  with brand_counts as (
    select
      public.normalize_brand(name) as brand,
      count(distinct google_place_id) as n
    from public.restaurants
    where name is not null
      and length(public.normalize_brand(name)) >= 3
    group by 1
  )
  update public.restaurants r
     set is_chain_brand = (bc.n >= 3)
    from brand_counts bc
   where public.normalize_brand(r.name) = bc.brand
     and r.is_chain_brand is distinct from (bc.n >= 3);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

-- Backfill once at migration time.
select public.refresh_chain_brands();

-- A view's column list is frozen at creation, so the new base column is NOT
-- picked up by `r.*` until the view is rebuilt (learned in 0032). Body is
-- otherwise identical to 0032.
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
