-- ============================================================================
-- 0035_moderation.sql
-- ----------------------------------------------------------------------------
-- User-safety primitives required for the social feed (Apple Guideline 1.2):
--   1. block a user   -> you stop seeing their content, and any friendship
--                        between you is dropped immediately.
--   2. report content -> a feed post or a profile is flagged for review.
--
-- Blocking is enforced both ways for the FEED via hidden_user_ids(): you never
-- see people you blocked, nor people who blocked you. The block table itself
-- stays private to the blocker (you can't enumerate who blocked you directly).
-- ============================================================================

-- 1. Blocks -------------------------------------------------------------------
create table if not exists public.blocked_users (
  blocker_id uuid        not null references auth.users(id) on delete cascade,
  blocked_id uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.blocked_users enable row level security;

-- A user only ever sees/manages the blocks they created.
drop policy if exists "blocks manage own" on public.blocked_users;
create policy "blocks manage own"
  on public.blocked_users
  for all
  to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- 2. Reports ------------------------------------------------------------------
create table if not exists public.content_reports (
  id             uuid        primary key default gen_random_uuid(),
  reporter_id    uuid        references auth.users(id) on delete set null,
  target_type    text        not null,                       -- 'feed_event' | 'profile'
  target_id      text        not null,                       -- feed_event id or profile id
  target_user_id uuid        references auth.users(id) on delete set null, -- author being reported
  reason         text        not null,                       -- spam | harassment | inappropriate | other
  note           text,
  status         text        not null default 'open',        -- open | reviewed | actioned | dismissed
  created_at     timestamptz not null default now()
);

create index if not exists content_reports_open_idx
  on public.content_reports (created_at desc) where status = 'open';

alter table public.content_reports enable row level security;

-- Anyone signed in can file a report as themselves. No SELECT for normal users;
-- triage happens with the service-role key (bypasses RLS).
drop policy if exists "reports insert own" on public.content_reports;
create policy "reports insert own"
  on public.content_reports
  for insert
  to authenticated
  with check (reporter_id = auth.uid());

-- 3. RPCs ---------------------------------------------------------------------

-- Block a user atomically: record the block and drop any friendship so their
-- friends-only content stops appearing right away.
create or replace function public.block_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if target = me then raise exception 'cannot block yourself'; end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (me, target)
  on conflict do nothing;

  delete from public.friendships
  where (requester_id = me and addressee_id = target)
     or (requester_id = target and addressee_id = me);
end;
$$;

create or replace function public.unblock_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  delete from public.blocked_users where blocker_id = me and blocked_id = target;
end;
$$;

-- The set of user ids the current user should never see in the feed: everyone
-- they blocked, plus everyone who blocked them. SECURITY DEFINER so the second
-- half can read rows the caller's RLS policy would otherwise hide.
create or replace function public.hidden_user_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select blocked_id from public.blocked_users where blocker_id = auth.uid()
  union
  select blocker_id from public.blocked_users where blocked_id = auth.uid()
$$;

grant execute on function public.block_user(uuid)   to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.hidden_user_ids()  to authenticated;
