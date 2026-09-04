-- ============================================================================
-- 0074_palate_matches.sql — "you and Maya keep landing at the same places".
-- ----------------------------------------------------------------------------
-- The Snapchat Best Friends property, minus the part that got Best Friends
-- deleted. A ranked list of TOP RESTAURANTS barely moves month to month, so it
-- is not a reason to reopen the app. A list of PEOPLE, recomputed from what you
-- both actually did, is.
--
-- What this is NOT: proof that two people ate together. Palate cannot establish
-- that. `app/group.tsx` keeps its selection in component state and persists
-- nothing, and there is no co-visit record anywhere. This measures overlap —
-- "we independently keep choosing the same places" — and the copy in the app
-- must say that and nothing stronger.
--
-- Three structural protections, chosen because cosmetic ones do not survive
-- contact with a leaderboard:
--
--   FRIENDS-ONLY. Gated to the target and their accepted friends. A stranger
--   cannot audit who you eat like, so the list cannot become a public standing.
--
--   NO COUNTS. The function returns names and one example place. It never
--   returns the overlap number, so there is nothing to compare or screenshot as
--   a score, and no way to tell #1 from #3.
--
--   RECIPROCAL. B appears on A's list only if A appears on B's. This is the
--   expensive one — it costs a friends-of-friends pass and it will return short
--   lists early — and it is the one that matters. One-sided lists are how "am I
--   on their list?" becomes a thing people feel bad about.
--
-- Two shared places minimum: a single coincidence is not a pattern.
-- ============================================================================

create or replace function public.palate_matches(
  target_id uuid,
  p_limit integer default 3
)
returns table (
  id            uuid,
  display_name  text,
  username      text,
  avatar_url    text,
  -- One concrete place, so the row reads as an observation rather than a score.
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
    select 1
     where auth.uid() is not null
       and (target_id = auth.uid() or public.are_friends(auth.uid(), target_id))
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
             or (b.blocker_id = target_id and b.blocked_id = auth.uid())
       )
  ),
  -- Every accepted friendship in both directions, so the graph can be walked
  -- from either end without a case expression at each step.
  fr as (
    select requester_id as a, addressee_id as b
      from public.friendships where status = 'accepted'
    union all
    select addressee_id as a, requester_id as b
      from public.friendships where status = 'accepted'
  ),
  -- The pairs worth scoring: the target's own friendships, plus each of those
  -- friends' friendships. The second hop exists only to rank each candidate's
  -- list well enough to test reciprocity.
  scope as (
    select f.a, f.b from fr f where f.a = target_id
    union
    select f2.a, f2.b
      from fr f1
      join fr f2 on f2.a = f1.b
     where f1.a = target_id
  ),
  -- Everyone whose history this call needs to look at. Without this bound,
  -- `places` below is a scan of every visit in the table on every call — fine
  -- with a hundred users, not with a hundred thousand.
  scoped_users as (
    select a as uid from scope
    union
    select b as uid from scope
  ),
  -- Distinct VISIBLE restaurants per user. Hidden visits are invisible to this
  -- entirely — a place you curated off your profile cannot pull someone onto
  -- your matches list, and cannot be named as the example.
  places as (
    select distinct v.user_id, v.restaurant_id
      from public.visits v
      join scoped_users su on su.uid = v.user_id
     where v.is_public
  ),
  ov as (
    select s.a, s.b, count(*)::int as n
      from scope s
      join places pa on pa.user_id = s.a
      join places pb on pb.user_id = s.b
                    and pb.restaurant_id = pa.restaurant_id
     where not exists (
       select 1 from public.blocked_users bl
        where (bl.blocker_id = s.a and bl.blocked_id = s.b)
           or (bl.blocker_id = s.b and bl.blocked_id = s.a)
     )
     group by s.a, s.b
    having count(*) >= 2
  ),
  ranked as (
    select ov.a, ov.b, ov.n,
           row_number() over (partition by ov.a order by ov.n desc, ov.b) as rn
      from ov
  )
  select
    p.id,
    p.display_name,
    p.username,
    p.avatar_url,
    ex.name
  from ranked me
  -- The reciprocity join. Dropping it would make this a one-sided ranking.
  join ranked them
    on them.a = me.b
   and them.b = me.a
   and them.rn <= (select n from lim)
  join public.profiles p on p.id = me.b
  left join lateral (
    select r.name
      from places pa
      join places pb on pb.restaurant_id = pa.restaurant_id
                    and pb.user_id = me.b
      join public.restaurants r on r.id = pa.restaurant_id
     where pa.user_id = me.a
     order by (
       select count(*) from public.visits v
        where v.restaurant_id = pa.restaurant_id
          and v.is_public
          and v.user_id in (me.a, me.b)
     ) desc, r.name
     limit 1
  ) ex on true
  where me.a = target_id
    and me.rn <= (select n from lim)
    and exists (select 1 from allowed)
  order by me.n desc, p.display_name;
$$;

revoke all on function public.palate_matches(uuid, integer) from public;
grant execute on function public.palate_matches(uuid, integer) to authenticated;
