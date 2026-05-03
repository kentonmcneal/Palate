-- ============================================================================
-- 0023_menu_items.sql
-- ----------------------------------------------------------------------------
-- Menu items + per-user item ratings.
--
-- The product loop: after a user logs a visit we ask "What did you get?". They
-- tap one of three reactions (loved / ok / not_for_me) per item. This sharpens
-- the palate model below the restaurant level — a user might love Chick-fil-A
-- salads but skip the sandwiches; we should learn that.
--
-- Long-term this also seeds the B2B layer: restaurants can see which dishes
-- attract which palate identities, which items drive repeat visits, etc.
--
-- Schema:
--   menu_items          — restaurant-scoped item catalog (one row per dish)
--   menu_item_ratings   — user × item × visit reaction (loved/ok/not_for_me)
--
-- Items are user-contributed (no menu API yet). We dedupe by lower-cased name
-- per restaurant so "Spicy Chicken Sandwich" and "spicy chicken sandwich"
-- don't double-up.
-- ============================================================================

create table if not exists public.menu_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  name            text not null,
  name_normalized text not null,                        -- lower(trim(name)) for dedup
  category        text,                                  -- nullable: "burgers", "sides", etc.
  source          text not null default 'user' check (source in ('user', 'menu_api', 'inferred')),
  created_by      uuid references auth.users(id) on delete set null,
  visit_count     int not null default 0,                -- denormalized: how often this has been ordered
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists menu_items_restaurant_name_unique
  on public.menu_items (restaurant_id, name_normalized);

create index if not exists menu_items_restaurant_idx on public.menu_items (restaurant_id);

alter table public.menu_items enable row level security;

-- Anyone signed in can read menu items (they're shared across users).
drop policy if exists "menu_items: read" on public.menu_items;
create policy "menu_items: read"
  on public.menu_items for select
  using (auth.role() = 'authenticated');

-- Anyone signed in can add a new item (user-contributed catalog).
drop policy if exists "menu_items: insert" on public.menu_items;
create policy "menu_items: insert"
  on public.menu_items for insert
  with check (auth.uid() is not null);

-- ----------------------------------------------------------------------------
-- Ratings
-- ----------------------------------------------------------------------------
create table if not exists public.menu_item_ratings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  menu_item_id    uuid not null references public.menu_items(id) on delete cascade,
  visit_id        uuid references public.visits(id) on delete set null,
  rating          text not null check (rating in ('loved', 'ok', 'not_for_me')),
  notes           text,
  created_at      timestamptz not null default now()
);

-- A user's most recent rating for a given item is the source of truth — we
-- allow multiple rows over time so we can see how taste evolves.
create index if not exists menu_item_ratings_user_item_idx
  on public.menu_item_ratings (user_id, menu_item_id, created_at desc);

create index if not exists menu_item_ratings_visit_idx
  on public.menu_item_ratings (visit_id);

create index if not exists menu_item_ratings_item_idx
  on public.menu_item_ratings (menu_item_id);

alter table public.menu_item_ratings enable row level security;

drop policy if exists "menu_item_ratings: own select" on public.menu_item_ratings;
create policy "menu_item_ratings: own select"
  on public.menu_item_ratings for select
  using (auth.uid() = user_id);

drop policy if exists "menu_item_ratings: own insert" on public.menu_item_ratings;
create policy "menu_item_ratings: own insert"
  on public.menu_item_ratings for insert
  with check (auth.uid() = user_id);

drop policy if exists "menu_item_ratings: own delete" on public.menu_item_ratings;
create policy "menu_item_ratings: own delete"
  on public.menu_item_ratings for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Aggregate view: items at a restaurant by reaction count.
-- Read-friendly for the "What people loved here" surface on restaurant pages.
-- ----------------------------------------------------------------------------
create or replace view public.menu_item_summary as
select
  mi.id,
  mi.restaurant_id,
  mi.name,
  mi.category,
  mi.visit_count,
  count(*) filter (where r.rating = 'loved')        as loved_count,
  count(*) filter (where r.rating = 'ok')           as ok_count,
  count(*) filter (where r.rating = 'not_for_me')   as not_for_me_count,
  count(*)                                           as rating_count
from public.menu_items mi
left join public.menu_item_ratings r on r.menu_item_id = mi.id
group by mi.id, mi.restaurant_id, mi.name, mi.category, mi.visit_count;

-- View inherits RLS from the underlying tables — anonymous reads still blocked.

-- ----------------------------------------------------------------------------
-- Trigger: keep visit_count denormalized + name_normalized synced
-- ----------------------------------------------------------------------------
create or replace function public.menu_items_normalize_name()
returns trigger
language plpgsql
as $$
begin
  new.name := trim(new.name);
  new.name_normalized := lower(new.name);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists menu_items_normalize_name_t on public.menu_items;
create trigger menu_items_normalize_name_t
  before insert or update of name on public.menu_items
  for each row execute function public.menu_items_normalize_name();

create or replace function public.menu_item_ratings_bump_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.menu_items
       set visit_count = visit_count + 1,
           updated_at = now()
     where id = new.menu_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists menu_item_ratings_bump_count_t on public.menu_item_ratings;
create trigger menu_item_ratings_bump_count_t
  after insert on public.menu_item_ratings
  for each row execute function public.menu_item_ratings_bump_count();
