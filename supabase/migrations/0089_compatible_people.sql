-- ============================================================================
-- 0089_compatible_people.sql — the people on the app who eat like you.
-- ----------------------------------------------------------------------------
-- Distinct from palate_matches (0078), which must not be loosened to do this.
-- That one is friends-only, reciprocal and deliberately count-free: designed so
-- nobody can be ranked. This is the opposite and is asked for as such — an
-- explicit ranking across everybody, so a new tester can find people worth
-- following before they have any friends.
--
-- Counted before building, and the numbers say what the UI has to be honest
-- about: 3 accounts have any public visit, 2 have five or more, 2 have both a
-- public profile and public visits, and exactly ONE pair in the entire app
-- shares a restaurant. This will return one row today. The empty state is the
-- feature until that changes, and the caller is told the difference between
-- "nobody yet" and "nobody who overlaps you".
--
-- Rules, all inherited rather than invented:
--   * public profiles only, never private, never friends-only
--   * public visits only (0073) — a hidden visit cannot pull somebody onto a
--     list, or curation would leak through the back door
--   * blocks cut both directions
--   * signed-in callers only
--
-- Score is deliberately explicable rather than clever. Shared restaurants is
-- the strongest signal Palate has and the only one a person can check: "you
-- have both been to these four places" is verifiable, where a cosine over
-- taste vectors is a number you either trust or do not. Cuisine overlap breaks
-- ties. Both counts are returned so the row can say what it is claiming.
-- ============================================================================

create or replace function public.compatible_people(p_limit integer default 10)
returns table (
  id             uuid,
  display_name   text,
  username       text,
  avatar_url     text,
  shared_places  integer,
  shared_cuisines integer,
  score          integer,
  top_shared     text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as uid where auth.uid() is not null
  ),
  my_places as (
    select distinct v.restaurant_id
      from public.visits v, me
     where v.user_id = me.uid and v.is_public
  ),
  my_cuisines as (
    select distinct r.cuisine_type
      from public.visits v
      join public.restaurants r on r.id = v.restaurant_id, me
     where v.user_id = me.uid and v.is_public and r.cuisine_type is not null
  ),
  candidates as (
    select p.id, p.display_name, p.username, p.avatar_url
      from public.profiles p, me
     where p.profile_visibility = 'public'
       and p.id <> me.uid
       and coalesce(p.approval_status, 'approved') = 'approved'
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = me.uid and b.blocked_id = p.id)
             or (b.blocker_id = p.id and b.blocked_id = me.uid)
       )
  ),
  overlap as (
    select
      c.id,
      c.display_name,
      c.username,
      c.avatar_url,
      (select count(*)::int
         from (select distinct v.restaurant_id
                 from public.visits v
                where v.user_id = c.id and v.is_public) theirs
         join my_places mp on mp.restaurant_id = theirs.restaurant_id) as shared_places,
      (select count(*)::int
         from (select distinct r.cuisine_type
                 from public.visits v
                 join public.restaurants r on r.id = v.restaurant_id
                where v.user_id = c.id and v.is_public
                  and r.cuisine_type is not null) tc
         join my_cuisines mc on mc.cuisine_type = tc.cuisine_type) as shared_cuisines
    from candidates c
  )
  select
    o.id,
    o.display_name,
    o.username,
    o.avatar_url,
    o.shared_places,
    o.shared_cuisines,
    -- Bounded and explicable: a shared restaurant is worth far more than a
    -- shared cuisine, because two people who have both eaten at one specific
    -- place have made the same decision, not the same kind of decision.
    least(99, o.shared_places * 18 + o.shared_cuisines * 6)::int as score,
    (select r.name
       from public.visits v
       join public.restaurants r on r.id = v.restaurant_id
      where v.user_id = o.id
        and v.is_public
        and r.id in (select restaurant_id from my_places)
      group by r.name
      order by count(*) desc, r.name
      limit 1) as top_shared
  from overlap o
  -- Somebody with no overlap at all is not a match, they are a stranger.
  where o.shared_places > 0 or o.shared_cuisines > 0
  order by score desc, o.shared_places desc, o.display_name
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.compatible_people(integer) from public;
revoke all on function public.compatible_people(integer) from anon;
grant execute on function public.compatible_people(integer) to authenticated;
