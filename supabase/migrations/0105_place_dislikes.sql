-- ============================================================================
-- 0105_place_dislikes.sql — "Not interested", permanently, and it learns.
-- ----------------------------------------------------------------------------
-- The existing dismiss was an analytics event with a small score penalty:
-- a dismissed place lost up to 12 points and came straight back. What the
-- founder asked for is the TikTok gesture — gone for good for this person,
-- and the app learns what it was about the place.
--
-- One row per (user, place). `reason` is what the person said it was about,
-- which decides how far the lesson generalises:
--   place  — just this one; a light nudge against places like it
--   food   — the cuisine / dishes; strong penalty on the same cuisine,
--            subregion and dish families
--   price  — the price tier
--   vibe   — the format and occasion
-- Own-row RLS. The client reads it into the personal signal and every
-- recommendation surface excludes the ids; the scorer applies the learned
-- penalty to everything else.
-- ============================================================================
create table if not exists public.place_dislikes (
  user_id          uuid not null references public.profiles(id) on delete cascade,
  google_place_id  text not null,
  restaurant_id    uuid references public.restaurants(id) on delete set null,
  reason           text not null default 'place'
                   check (reason in ('place', 'food', 'price', 'vibe')),
  -- A snapshot of what the place was, so the lesson survives the row being
  -- reclassified or deleted.
  cuisine_type     text,
  cuisine_subregion text,
  format_class     text,
  dish_family      text[],
  price_level      integer,
  neighborhood     text,
  created_at       timestamptz not null default now(),
  primary key (user_id, google_place_id)
);
create index if not exists place_dislikes_user_idx on public.place_dislikes (user_id, created_at desc);

alter table public.place_dislikes enable row level security;
drop policy if exists "place_dislikes: own all" on public.place_dislikes;
create policy "place_dislikes: own all"
  on public.place_dislikes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
grant select, insert, update, delete on public.place_dislikes to authenticated;
revoke all on public.place_dislikes from anon;

-- Fill the snapshot from the catalogue on insert so the client sends only
-- the place id and the reason.
create or replace function public.place_dislikes_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.restaurants%rowtype;
begin
  select * into r from public.restaurants where google_place_id = new.google_place_id;
  if found then
    new.restaurant_id     := coalesce(new.restaurant_id, r.id);
    new.cuisine_type      := coalesce(new.cuisine_type, r.cuisine_type);
    new.cuisine_subregion := coalesce(new.cuisine_subregion, r.cuisine_subregion);
    new.format_class      := coalesce(new.format_class, r.format_class);
    new.dish_family       := coalesce(new.dish_family, r.dish_family);
    new.price_level       := coalesce(new.price_level, r.price_level);
    new.neighborhood      := coalesce(new.neighborhood, r.neighborhood);
  end if;
  return new;
end $$;
drop trigger if exists place_dislikes_snapshot on public.place_dislikes;
create trigger place_dislikes_snapshot
  before insert on public.place_dislikes
  for each row execute function public.place_dislikes_snapshot();
