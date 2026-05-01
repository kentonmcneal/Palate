-- ============================================================================
-- 0011_aspirational_palate.sql
-- ----------------------------------------------------------------------------
-- Adds:
--   1. wishlist.source enum + wishlist.aspiration_tags
--   2. restaurants.user_rating_count + restaurants.types (full Google types[])
--
-- Powers the new Aspirational Palate analytics: comparing the user's actual
-- visit pattern (where they go) against the wishlist (where they save = where
-- they want to be).
-- ============================================================================

-- ---------- wishlist ----------------------------------------------------------

alter table public.wishlist
  add column if not exists aspiration_tags text[] default '{}'::text[];

-- Existing rows have source='palate_insights' (legacy). Backfill to the new
-- vocabulary and add a check constraint.
update public.wishlist
   set source = case
     when source = 'palate_insights' then 'recommendation'
     else source
   end
 where source is not null;

-- Drop the constraint if a previous attempt created it, then add fresh.
alter table public.wishlist
  drop constraint if exists wishlist_source_check;
alter table public.wishlist
  add constraint wishlist_source_check
  check (source in ('manual', 'recommendation', 'friend', 'trending'));

create index if not exists wishlist_source_idx
  on public.wishlist (source);

create index if not exists wishlist_aspiration_tags_gin
  on public.wishlist using gin (aspiration_tags);

-- ---------- restaurants -------------------------------------------------------

alter table public.restaurants
  add column if not exists user_rating_count int,
  add column if not exists types             text[];

create index if not exists restaurants_types_gin
  on public.restaurants using gin (types);
