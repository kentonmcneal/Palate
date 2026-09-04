-- ============================================================================
-- 0078_palate_matches_open.sql — make the matches module possible to see.
-- ----------------------------------------------------------------------------
-- 0074 shipped palate_matches with three protections: friends-only, no counts,
-- reciprocal. 0077 then opened the app so that nobody needs to add friends —
-- which means the module now returns an empty set for every user, because it
-- requires an ACCEPTED FRIENDSHIP that the product no longer asks anyone to
-- create. A feature nobody can see is not a protected feature.
--
-- Two of the three protections are kept exactly as they were, and they are the
-- two that do the work:
--
--   NO COUNTS. Still names and one example place. Nothing rankable, nothing
--   screenshotable as a score, no way to tell #1 from #3.
--
--   RECIPROCAL. Still: B appears on A's list only if A appears on B's. This is
--   what stops "am I on their list?" from becoming a thing people feel bad
--   about, and it does not depend on friendship to hold.
--
-- The third — friends-only — is replaced by the visibility rule the rest of the
-- app now uses: public profiles participate, 'friends' profiles participate
-- with their friends, 'private' never participates. That is a loosening, and
-- worth naming as one. What it is NOT is a leaderboard: no stranger can rank
-- you, because there are no numbers to rank by, and nobody appears on your
-- profile who has not independently landed on yours.
--
-- Two viewer-side rules on top, so opening the pool does not open a side door:
--   * a peer is only shown to a viewer who could see that peer's own profile,
--     so a friends-only account is never surfaced to a stranger by way of
--     somebody else's page
--   * blocks cut in both directions, at both hops
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Internal: one user's overlap ranking.
-- ----------------------------------------------------------------------------
-- NOT granted to authenticated, and that is load-bearing. It takes a user id as
-- an argument and answers "who eats like this person", so a direct caller could
-- ask it about anybody. It is callable only by palate_matches, which runs as
-- this function's owner and applies the viewer-side gate that this one cannot.
create or replace function public.palate_overlap_rank(p_user uuid, p_limit integer)
returns table (peer_id uuid, shared integer, rn integer)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select distinct v.restaurant_id
      from public.visits v
     where v.user_id = p_user
       and v.is_public
  ),
  cand as (
    select v.user_id as peer_id, count(distinct v.restaurant_id)::int as shared
      from public.visits v
      join mine m on m.restaurant_id = v.restaurant_id
      join public.profiles p on p.id = v.user_id
     where v.is_public
       and v.user_id <> p_user
       -- Same rule as the feed (0077). 'private' is absent from this list on
       -- purpose: a private account neither appears nor is matched against.
       and (
         p.profile_visibility = 'public'
         or (
           p.profile_visibility = 'friends'
           and public.are_friends(p_user, v.user_id)
         )
       )
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = p_user and b.blocked_id = v.user_id)
             or (b.blocker_id = v.user_id and b.blocked_id = p_user)
       )
     group by v.user_id
     -- One shared restaurant is a coincidence. Two is the smallest thing that
     -- can honestly be called a pattern.
    having count(distinct v.restaurant_id) >= 2
  )
  select
    cand.peer_id,
    cand.shared,
    (row_number() over (order by cand.shared desc, cand.peer_id))::int
  from cand
  order by cand.shared desc, cand.peer_id
  -- Hard ceiling. Reciprocity needs each candidate's own ranking computed, so
  -- an unbounded candidate list would make this quadratic on a graph where one
  -- popular restaurant makes everybody adjacent to everybody.
  limit greatest(1, least(coalesce(p_limit, 3), 50));
$$;

revoke all on function public.palate_overlap_rank(uuid, integer) from public;
revoke all on function public.palate_overlap_rank(uuid, integer) from authenticated;

-- ----------------------------------------------------------------------------
-- palate_matches — same signature, same shape, wider pool.
-- ----------------------------------------------------------------------------
create or replace function public.palate_matches(
  target_id uuid,
  p_limit integer default 3
)
returns table (
  id            uuid,
  display_name  text,
  username      text,
  avatar_url    text,
  shared_place  text
)
language sql
stable
security definer
set search_path = public
as $$
  with lim as (
    select greatest(1, least(coalesce(p_limit, 3), 10)) as n
  ),
  allowed as (
    -- Whether this VIEWER may see this TARGET's matches at all. Mirrors the
    -- profile rule: yourself, a public profile, or a friend.
    select 1
     where auth.uid() is not null
       and (
         target_id = auth.uid()
         or public.are_friends(auth.uid(), target_id)
         or exists (
           select 1 from public.profiles p
            where p.id = target_id and p.profile_visibility = 'public'
         )
       )
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
             or (b.blocker_id = target_id and b.blocked_id = auth.uid())
       )
  )
  select
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    ex.name
  from lim,
       lateral public.palate_overlap_rank(target_id, lim.n) me
  -- Reciprocity: the target has to appear in the peer's own ranking. Dropping
  -- this join is all it would take to turn this into a one-sided scoreboard.
  join lateral public.palate_overlap_rank(me.peer_id, lim.n) them
    on them.peer_id = target_id
  join public.profiles p on p.id = me.peer_id
  -- The viewer's own view of the peer. Without this, a friends-only account
  -- could be surfaced to a stranger through a third party's profile.
  join lateral (
    select 1
     where p.profile_visibility = 'public'
        or p.id = auth.uid()
        or public.are_friends(auth.uid(), p.id)
  ) visible_to_viewer on true
  left join lateral (
    -- One concrete place, so the row reads as an observation and not a score.
    select r.name
      from public.visits a
      join public.visits b
        on b.restaurant_id = a.restaurant_id
       and b.user_id = me.peer_id
       and b.is_public
      join public.restaurants r on r.id = a.restaurant_id
     where a.user_id = target_id
       and a.is_public
     group by r.name
     order by count(*) desc, r.name
     limit 1
  ) ex on true
  where exists (select 1 from allowed)
    and not exists (
      select 1 from public.blocked_users b2
       where (b2.blocker_id = auth.uid() and b2.blocked_id = p.id)
          or (b2.blocker_id = p.id and b2.blocked_id = auth.uid())
    )
  order by me.shared desc, p.display_name;
$$;

revoke all on function public.palate_matches(uuid, integer) from public;
grant execute on function public.palate_matches(uuid, integer) to authenticated;
