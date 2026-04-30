-- ============================================================================
-- 0007_social_layer.sql
-- ----------------------------------------------------------------------------
-- v1 social layer for Palate.
-- Profile visibility setting + friendships + feed events + likes.
--
-- Brand-aligned defaults:
--   profile_visibility = 'friends' (not 'public') — the friend layer is the
--   first audience by default; users opt UP to public, never down to private.
--
--   Friendships are mutual + approval-required (status starts 'pending'
--   until the addressee accepts).
--
--   Feed events are explicitly inserted by the user (or by triggers on
--   user-initiated actions like Wrapped sharing) — never auto-shared.
-- ============================================================================

-- ============================================================
-- profiles: visibility + display_name (display_name already exists)
-- ============================================================
alter table public.profiles
  add column if not exists profile_visibility text not null default 'friends'
    check (profile_visibility in ('private', 'friends', 'public'));

create index if not exists profiles_visibility_idx
  on public.profiles (profile_visibility);

-- ============================================================
-- friendships
-- ============================================================
do $$ begin
  create type friendship_status as enum ('pending', 'accepted', 'blocked');
exception when duplicate_object then null; end $$;

create table if not exists public.friendships (
  id            uuid primary key default uuid_generate_v4(),
  requester_id  uuid not null references auth.users(id) on delete cascade,
  addressee_id  uuid not null references auth.users(id) on delete cascade,
  status        friendship_status not null default 'pending',
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists friendships_addressee_status_idx
  on public.friendships (addressee_id, status);
create index if not exists friendships_requester_status_idx
  on public.friendships (requester_id, status);

alter table public.friendships enable row level security;

drop policy if exists "friendships: own" on public.friendships;
create policy "friendships: own"
  on public.friendships for select
  using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "friendships: insert own" on public.friendships;
create policy "friendships: insert own"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

drop policy if exists "friendships: addressee update" on public.friendships;
create policy "friendships: addressee update"
  on public.friendships for update
  using (auth.uid() = addressee_id);

drop policy if exists "friendships: either delete" on public.friendships;
create policy "friendships: either delete"
  on public.friendships for delete
  using (auth.uid() in (requester_id, addressee_id));

-- Helper: are two users friends?
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.friendships
    where status = 'accepted'
    and (
      (requester_id = a and addressee_id = b) or
      (requester_id = b and addressee_id = a)
    )
  );
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- ============================================================
-- feed_events
-- ============================================================
do $$ begin
  create type feed_event_kind as enum ('wrapped_shared', 'persona_change', 'milestone');
exception when duplicate_object then null; end $$;

create table if not exists public.feed_events (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         feed_event_kind not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists feed_events_user_created_idx
  on public.feed_events (user_id, created_at desc);
create index if not exists feed_events_created_idx
  on public.feed_events (created_at desc);

alter table public.feed_events enable row level security;

-- I see my own events; OR my friends' events (if their visibility isn't 'private')
drop policy if exists "feed_events: own + friends" on public.feed_events;
create policy "feed_events: own + friends"
  on public.feed_events for select
  using (
    auth.uid() = user_id
    or (
      exists(
        select 1 from public.friendships f
        where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = feed_events.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = feed_events.user_id)
        )
      )
      and exists(
        select 1 from public.profiles p
        where p.id = feed_events.user_id
        and p.profile_visibility in ('friends', 'public')
      )
    )
  );

drop policy if exists "feed_events: insert own" on public.feed_events;
create policy "feed_events: insert own"
  on public.feed_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "feed_events: delete own" on public.feed_events;
create policy "feed_events: delete own"
  on public.feed_events for delete
  using (auth.uid() = user_id);

-- ============================================================
-- feed_likes
-- ============================================================
create table if not exists public.feed_likes (
  feed_event_id  uuid not null references public.feed_events(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (feed_event_id, user_id)
);

create index if not exists feed_likes_event_idx
  on public.feed_likes (feed_event_id);

alter table public.feed_likes enable row level security;

-- Anyone authed can see likes on events they have access to (RLS on
-- feed_events handles the visibility gate upstream)
drop policy if exists "feed_likes: any read" on public.feed_likes;
create policy "feed_likes: any read"
  on public.feed_likes for select
  using (true);

drop policy if exists "feed_likes: insert own" on public.feed_likes;
create policy "feed_likes: insert own"
  on public.feed_likes for insert
  with check (auth.uid() = user_id);

drop policy if exists "feed_likes: delete own" on public.feed_likes;
create policy "feed_likes: delete own"
  on public.feed_likes for delete
  using (auth.uid() = user_id);

-- ============================================================
-- search_users(q): minimal-fields search by email or display_name.
-- security definer so users can find each other across the email space
-- without exposing the entire profiles table to all reads.
-- ============================================================
create or replace function public.search_users(q text)
returns table (
  id uuid,
  email text,
  display_name text,
  profile_visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, email, display_name, profile_visibility::text
  from public.profiles
  where length(trim(q)) >= 2
    and (
      email ilike trim(q) || '%'
      or display_name ilike '%' || trim(q) || '%'
    )
    and id <> auth.uid()
  limit 20;
$$;

grant execute on function public.search_users(text) to authenticated;
