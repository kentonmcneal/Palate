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
