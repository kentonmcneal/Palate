-- ============================================================================
-- 0003_wishlist.sql
-- ----------------------------------------------------------------------------
-- Adds a per-user wishlist used by the Weekly Palate Insights feature so a
-- user can "Save" a recommended restaurant without recording it as a visit.
-- ============================================================================

create table if not exists public.wishlist (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source        text not null default 'palate_insights',
  added_at      timestamptz not null default now(),
  unique (user_id, restaurant_id)
);

create index if not exists wishlist_user_added_idx
  on public.wishlist (user_id, added_at desc);

alter table public.wishlist enable row level security;

drop policy if exists "wishlist_owner_select" on public.wishlist;
create policy "wishlist_owner_select" on public.wishlist
  for select using (auth.uid() = user_id);

drop policy if exists "wishlist_owner_modify" on public.wishlist;
create policy "wishlist_owner_modify" on public.wishlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
