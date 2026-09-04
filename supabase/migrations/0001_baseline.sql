-- ============================================================================
-- 0001_baseline.sql — the schema every later migration assumes exists.
-- ----------------------------------------------------------------------------
-- The migration chain started at 0002. The tables, policies and functions that
-- 0002 onwards build on lived in supabase/01_schema.sql, 02_policies.sql and
-- 03_functions.sql, which were run by hand in the SQL editor and were never
-- migrations. So `supabase db push` against an empty project failed on the
-- first file, and the committed history could not reconstruct the database it
-- described — a latent single point of failure with no backup story.
--
-- This is those three files, concatenated in their original order and
-- unmodified. They were already written to be replayable (create table if not
-- exists, drop policy if exists + create, create or replace function), which is
-- what makes concatenating them safe rather than a rewrite.
--
-- IMPORTANT — this is NOT applied to the existing project, and must not be.
-- 02_policies.sql recreates every policy as it stood at the beginning, which
-- would silently revert later work: 0036's feed visibility, 0077's open feed,
-- and the RLS on visits among others. The live database was marked as having
-- applied this migration with `supabase migration repair --status applied
-- 0001`, which records it without executing it. On a FRESH project it runs
-- first and 0002-0081 then layer their changes on top in order, reaching the
-- same end state.
--
-- If you edit this file, you are changing what a rebuilt database starts from,
-- not what production is. Production only ever moves forward through numbered
-- migrations.
-- ============================================================================

-- ==== supabase/01_schema.sql ====

-- Palate — schema
-- Run this once in the Supabase SQL Editor.
-- Idempotent: you can re-run safely while iterating.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- profiles  (one row per signed-up user)
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  created_at    timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- restaurants  (one row per Google Place we've ever cared about)
-- shared across all users (public read, authenticated insert)
-- ============================================================
create table if not exists public.restaurants (
  id              uuid primary key default uuid_generate_v4(),
  google_place_id text unique not null,
  name            text not null,
  chain_name      text,                       -- e.g. "Starbucks" — for Wrapped grouping
  address         text,
  latitude        double precision,
  longitude       double precision,
  primary_type    text,                       -- restaurant / cafe / bakery / bar / meal_takeaway
  cuisine_type    text,
  price_level     int,                        -- 0..4 if Google returns it
  rating          numeric(2,1),
  created_at      timestamptz not null default now(),
  refreshed_at    timestamptz not null default now()
);

create index if not exists restaurants_lat_lng_idx
  on public.restaurants (latitude, longitude);
create index if not exists restaurants_chain_idx
  on public.restaurants (chain_name);

-- ============================================================
-- visits  (one row per confirmed eat)
-- ============================================================
do $$ begin
  create type visit_source as enum ('auto', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack', 'unknown');
exception when duplicate_object then null; end $$;

create table if not exists public.visits (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  restaurant_id       uuid not null references public.restaurants(id) on delete restrict,
  visited_at          timestamptz not null default now(),
  meal_type           meal_type not null default 'unknown',
  detection_source    visit_source not null default 'manual',
  confirmed_by_user   boolean not null default true,
  confidence          numeric(3,2),           -- 0.00..1.00, used by detection scoring
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists visits_user_visited_idx
  on public.visits (user_id, visited_at desc);

-- ============================================================
-- location_events  (raw foreground/background pings, used to build prompts)
-- auto-purges after 30 days for privacy + storage
-- ============================================================
create table if not exists public.location_events (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  latitude          double precision not null,
  longitude         double precision not null,
  accuracy_m        numeric(7,2),
  captured_at       timestamptz not null default now(),
  nearest_place_id  text,
  prompt_shown      boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists location_events_user_captured_idx
  on public.location_events (user_id, captured_at desc);

-- ============================================================
-- prompt_decisions  (records "Yes"/"Not now"/"Wrong place" so we can cool down)
-- ============================================================
do $$ begin
  create type prompt_outcome as enum ('confirmed', 'dismissed', 'wrong_place', 'ignored');
exception when duplicate_object then null; end $$;

create table if not exists public.prompt_decisions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  restaurant_id   uuid references public.restaurants(id) on delete set null,
  google_place_id text,
  outcome         prompt_outcome not null,
  decided_at      timestamptz not null default now()
);

create index if not exists prompt_decisions_user_place_idx
  on public.prompt_decisions (user_id, google_place_id, decided_at desc);

-- ============================================================
-- weekly_wrapped  (cached per user, per ISO week)
-- ============================================================
create table if not exists public.weekly_wrapped (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  week_start          date not null,
  week_end            date not null,
  total_visits        int not null,
  unique_restaurants  int not null,
  top_restaurant      text,
  top_category        text,
  repeat_rate         numeric(4,3),
  personality_label   text,
  wrapped_json        jsonb not null,
  created_at          timestamptz not null default now(),
  unique (user_id, week_start)
);

create index if not exists weekly_wrapped_user_week_idx
  on public.weekly_wrapped (user_id, week_start desc);

-- ============================================================
-- waitlist  (landing page email capture — unauthenticated insert)
-- ============================================================
create table if not exists public.waitlist (
  id          uuid primary key default uuid_generate_v4(),
  email       text not null unique,
  source      text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Done.
-- ============================================================

-- ==== supabase/02_policies.sql ====

-- Palate — Row Level Security policies
-- A user can only ever read or write their own data.
-- restaurants is public-readable (cached metadata) and authenticated-writable.
-- waitlist is anonymous-insertable (landing page) but readable only by service role.

-- ============================================================
-- profiles
-- ============================================================
alter table public.profiles enable row level security;

drop policy if exists "profiles: own select" on public.profiles;
create policy "profiles: own select"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "profiles: own delete" on public.profiles;
create policy "profiles: own delete"
  on public.profiles for delete
  using (auth.uid() = id);

-- ============================================================
-- restaurants
-- ============================================================
alter table public.restaurants enable row level security;

drop policy if exists "restaurants: any read" on public.restaurants;
create policy "restaurants: any read"
  on public.restaurants for select
  using (true);

drop policy if exists "restaurants: authed insert" on public.restaurants;
create policy "restaurants: authed insert"
  on public.restaurants for insert
  with check (auth.uid() is not null);

drop policy if exists "restaurants: authed update" on public.restaurants;
create policy "restaurants: authed update"
  on public.restaurants for update
  using (auth.uid() is not null);

-- ============================================================
-- visits
-- ============================================================
alter table public.visits enable row level security;

drop policy if exists "visits: own all" on public.visits;
create policy "visits: own all"
  on public.visits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- location_events
-- ============================================================
alter table public.location_events enable row level security;

drop policy if exists "location_events: own all" on public.location_events;
create policy "location_events: own all"
  on public.location_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- prompt_decisions
-- ============================================================
alter table public.prompt_decisions enable row level security;

drop policy if exists "prompt_decisions: own all" on public.prompt_decisions;
create policy "prompt_decisions: own all"
  on public.prompt_decisions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- weekly_wrapped
-- ============================================================
alter table public.weekly_wrapped enable row level security;

drop policy if exists "weekly_wrapped: own all" on public.weekly_wrapped;
create policy "weekly_wrapped: own all"
  on public.weekly_wrapped for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- waitlist
-- ============================================================
alter table public.waitlist enable row level security;

drop policy if exists "waitlist: anyone insert" on public.waitlist;
create policy "waitlist: anyone insert"
  on public.waitlist for insert
  with check (true);

-- intentionally no select/update/delete policies → only service role can read

-- ==== supabase/03_functions.sql ====

-- Palate — server-side helper functions

-- ============================================================
-- delete_my_data — wipes everything for the calling user
-- (the visits/location_events FKs cascade from auth.users, but we also
--  call this when a user wants a soft "delete history" without losing the account)
-- ============================================================
create or replace function public.delete_my_history()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated';
  end if;

  delete from public.visits where user_id = auth.uid();
  delete from public.location_events where user_id = auth.uid();
  delete from public.prompt_decisions where user_id = auth.uid();
  delete from public.weekly_wrapped where user_id = auth.uid();
end;
$$;

grant execute on function public.delete_my_history() to authenticated;

-- ============================================================
-- delete_my_account — wipe everything AND delete auth user
-- ============================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  delete from public.visits where user_id = uid;
  delete from public.location_events where user_id = uid;
  delete from public.prompt_decisions where user_id = uid;
  delete from public.weekly_wrapped where user_id = uid;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- ============================================================
-- purge_old_location_events — privacy hygiene, run nightly via pg_cron
-- (cron is optional; the app also queries with a 30-day filter so this is just cleanup)
-- ============================================================
create or replace function public.purge_old_location_events()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.location_events
  where captured_at < now() - interval '30 days';
$$;

-- ============================================================
-- generate_weekly_wrapped — computes Wrapped for caller for the given week
-- Returns the cached row (insert-or-replace).
-- ============================================================
create or replace function public.generate_weekly_wrapped(p_week_start date)
returns public.weekly_wrapped
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_week_end date;
  v_total int;
  v_unique int;
  v_top_restaurant text;
  v_top_category text;
  v_repeat_rate numeric(4,3);
  v_personality text;
  v_json jsonb;
  v_row public.weekly_wrapped;
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  v_week_end := p_week_start + interval '7 days';

  select count(*),
         count(distinct restaurant_id)
    into v_total, v_unique
    from public.visits
   where user_id = uid
     and visited_at >= p_week_start
     and visited_at <  v_week_end;

  if v_total = 0 then
    raise exception 'No visits this week';
  end if;

  -- top restaurant by name (chain-aware)
  select coalesce(r.chain_name, r.name)
    into v_top_restaurant
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = uid
     and v.visited_at >= p_week_start
     and v.visited_at <  v_week_end
   group by coalesce(r.chain_name, r.name)
   order by count(*) desc
   limit 1;

  -- top category
  select r.primary_type
    into v_top_category
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = uid
     and v.visited_at >= p_week_start
     and v.visited_at <  v_week_end
   group by r.primary_type
   order by count(*) desc
   limit 1;

  v_repeat_rate := round((v_total - v_unique)::numeric / v_total, 3);

  -- personality label heuristic
  v_personality := case
    when v_total >= 10 and v_repeat_rate >= 0.6 then 'The Loyalist'
    when v_total >= 7  and v_repeat_rate <  0.3 then 'The Explorer'
    when v_top_category in ('meal_takeaway','fast_food_restaurant') then 'The Fast Casual Regular'
    when v_top_category = 'cafe' and v_total >= 5 then 'The Café Dweller'
    else 'The Comfort Food Connoisseur'
  end;

  v_json := jsonb_build_object(
    'total_visits', v_total,
    'unique_restaurants', v_unique,
    'top_restaurant', v_top_restaurant,
    'top_category', v_top_category,
    'repeat_rate', v_repeat_rate,
    'personality_label', v_personality,
    'top_three', (
      select jsonb_agg(jsonb_build_object('name', name, 'count', cnt) order by cnt desc)
      from (
        select coalesce(r.chain_name, r.name) as name, count(*) as cnt
          from public.visits v
          join public.restaurants r on r.id = v.restaurant_id
         where v.user_id = uid
           and v.visited_at >= p_week_start
           and v.visited_at <  v_week_end
         group by coalesce(r.chain_name, r.name)
         order by count(*) desc
         limit 3
      ) t
    )
  );

  insert into public.weekly_wrapped
    (user_id, week_start, week_end, total_visits, unique_restaurants,
     top_restaurant, top_category, repeat_rate, personality_label, wrapped_json)
  values
    (uid, p_week_start, v_week_end, v_total, v_unique,
     v_top_restaurant, v_top_category, v_repeat_rate, v_personality, v_json)
  on conflict (user_id, week_start) do update set
    week_end           = excluded.week_end,
    total_visits       = excluded.total_visits,
    unique_restaurants = excluded.unique_restaurants,
    top_restaurant     = excluded.top_restaurant,
    top_category       = excluded.top_category,
    repeat_rate        = excluded.repeat_rate,
    personality_label  = excluded.personality_label,
    wrapped_json       = excluded.wrapped_json
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.generate_weekly_wrapped(date) to authenticated;
