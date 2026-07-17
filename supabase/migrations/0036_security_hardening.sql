-- ============================================================================
-- 0036_security_hardening.sql
-- ----------------------------------------------------------------------------
-- Fixes found in the 2026-07-15 backend security audit:
--   1. The social feed's friend-visibility RLS branch could NEVER be true — its
--      inline `profiles` subquery runs under profiles' own-select-only RLS, so
--      every user saw only their OWN feed events. Replace it with a SECURITY
--      DEFINER helper (and fold in block enforcement while we're here).
--   2. feed_likes was world-readable (`using (true)`) — like-graph leak.
--   3. search_users returned every matching user's EMAIL on a 2-char prefix
--      scan — enumerable PII harvest. Return no email; match email exactly only.
--   4. friendships had no uniqueness on the unordered pair, so a near-
--      simultaneous double-"Add" could create duplicate/phantom rows.
-- ============================================================================

-- 1. Feed visibility ---------------------------------------------------------
-- SECURITY DEFINER so it can read friendships + profiles (+ blocked_users)
-- without being filtered by the caller's own-row RLS. Returns true iff the
-- caller may see `author`'s feed: accepted friends, author visible to friends/
-- public, and neither party has blocked the other.
create or replace function public.can_view_feed_author(author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = author)
          or (f.addressee_id = auth.uid() and f.requester_id = author)
        )
    )
    and exists (
      select 1 from public.profiles p
      where p.id = author
        and p.profile_visibility in ('friends', 'public')
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = author)
         or (b.blocker_id = author       and b.blocked_id = auth.uid())
    );
$$;

grant execute on function public.can_view_feed_author(uuid) to authenticated;

drop policy if exists "feed_events: own + friends" on public.feed_events;
create policy "feed_events: own + friends"
  on public.feed_events for select
  using (
    auth.uid() = user_id
    or public.can_view_feed_author(user_id)
  );

-- 2. feed_likes — only likes on events the caller can actually see ------------
-- The feed_events subquery is itself RLS-filtered to visible events (branch 1
-- above), so a matching row exists only when the caller can see the event.
drop policy if exists "feed_likes: any read" on public.feed_likes;
drop policy if exists "feed_likes: visible events" on public.feed_likes;
create policy "feed_likes: visible events"
  on public.feed_likes for select
  using (
    exists (
      select 1 from public.feed_events e
      where e.id = feed_likes.feed_event_id
    )
  );

-- 3. search_users — never return email; match email EXACTLY (no enumeration) --
-- Return type changes, so drop-then-create (CREATE OR REPLACE can't change it).
drop function if exists public.search_users(text);
create function public.search_users(q text)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  profile_visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, display_name, username, avatar_url, profile_visibility::text
  from public.profiles
  where length(trim(q)) >= 3
    and (
      lower(email) = lower(trim(q))                 -- exact email only: can't harvest by prefix
      or display_name ilike '%' || trim(q) || '%'
      or username    ilike trim(q) || '%'
    )
    and id <> auth.uid()
  limit 20;
$$;

grant execute on function public.search_users(text) to authenticated;

-- 4. friendships — one row per unordered pair --------------------------------
-- NOTE: if this migration errors on a duplicate, dedupe existing friendship
-- rows first (pre-launch this is very unlikely). Prevents phantom, un-removable
-- friendships from a near-simultaneous double request.
create unique index if not exists friendships_unique_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
