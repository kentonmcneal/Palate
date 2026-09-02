-- ============================================================================
-- 0064_shared_places.sql — "you've both been to six of the same places".
-- ----------------------------------------------------------------------------
-- The Strava-segment equivalent, and the strongest compatibility signal we
-- have. Cuisine histograms say two people like similar CATEGORIES; a shared
-- restaurant says they have stood in the same room and liked it. It is already
-- 15% of the palate-match score — this surfaces the places themselves.
--
-- Server-side because it reads another user's visits. The friendship check is
-- the whole reason this is a function and not a query: a client-side join would
-- need read access to everyone's visit history.
-- ============================================================================

create or replace function public.shared_places(target_id uuid, p_limit integer default 10)
returns table (
  google_place_id text,
  name            text,
  cuisine_type    text,
  my_visits       integer,
  their_visits    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    -- Friends, or a public profile. Anything else returns nothing at all
    -- rather than an empty-looking result that hides a permission failure.
    select 1
     where auth.uid() is not null
       and target_id <> auth.uid()
       and (
         public.are_friends(auth.uid(), target_id)
         or exists (
           select 1 from public.profiles p
            where p.id = target_id and p.profile_visibility = 'public'
         )
       )
  ),
  mine as (
    select v.restaurant_id, count(*)::int n
      from public.visits v
     where v.user_id = auth.uid()
     group by 1
  ),
  theirs as (
    select v.restaurant_id, count(*)::int n
      from public.visits v
     where v.user_id = target_id
     group by 1
  )
  select r.google_place_id, r.name, r.cuisine_type, mine.n, theirs.n
    from mine
    join theirs on theirs.restaurant_id = mine.restaurant_id
    join public.restaurants r on r.id = mine.restaurant_id
   where exists (select 1 from allowed)
   order by (mine.n + theirs.n) desc, r.name
   limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.shared_places(uuid, integer) from public;
grant execute on function public.shared_places(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Directory filters
-- ----------------------------------------------------------------------------
-- browse_profiles gains optional school / city filters. Defaults are null, so
-- every existing caller keeps its current behaviour.
create or replace function public.browse_profiles(
  p_limit integer default 50,
  p_offset integer default 0,
  p_school text default null,
  p_city text default null
)
returns table (
  id               uuid,
  display_name     text,
  username         text,
  avatar_url       text,
  bio              text,
  school           text,
  current_city     text,
  instagram_handle text,
  tiktok_handle    text,
  quiz_persona     text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id, p.display_name, p.username, p.avatar_url, p.bio, p.school,
    p.current_city, p.instagram_handle, p.tiktok_handle, p.quiz_persona
  from public.profiles p
  where p.profile_visibility = 'public'
    and p.id <> auth.uid()
    and coalesce(p.approval_status, 'approved') = 'approved'
    and (p_school is null or p.school ilike '%' || p_school || '%')
    and (p_city   is null or p.current_city ilike '%' || p_city || '%')
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

grant execute on function public.browse_profiles(integer, integer, text, text) to authenticated;

-- The two-argument version is now a strict subset of the four-argument one
-- (the new params default to null). Leaving both would give PostgREST an
-- ambiguous pair to resolve against, which fails at the worst possible moment
-- — a client calling with named params that match both signatures.
drop function if exists public.browse_profiles(integer, integer);
