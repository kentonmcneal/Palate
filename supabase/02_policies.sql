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
