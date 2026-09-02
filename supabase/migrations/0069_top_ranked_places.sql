-- ============================================================================
-- 0069_top_ranked_places.sql — somebody else's top five.
-- ----------------------------------------------------------------------------
-- THE LETTERBOXD LESSON. Letterboxd beat nobody and won anyway, because a
-- ranked list is an identity object: it is the thing worth looking at on a
-- stranger's page, and the thing worth building on your own. Palate has a
-- ranked list already (0062) and it is reachable only from Settings, which is
-- where features go to be forgotten.
--
-- `place_ratings` is RLS'd to own-rows, correctly — Elo ratings are derived
-- from private comparison history. Sharing the ORDER without exposing the
-- history needs a definer function, and this is it: it returns names and rank
-- position only. No ratings, no comparison counts, nothing that reconstructs
-- how somebody answered.
--
-- Visibility is the same rule as `shared_places` (0064), plus a block check:
-- friends, or a public profile, and never across a block in either direction.
-- ============================================================================

create or replace function public.top_ranked_places(
  target_id uuid,
  p_limit integer default 5
)
returns table (
  google_place_id text,
  name            text,
  cuisine_type    text,
  -- Not `position`: that is a col_name_keyword in Postgres and cannot be
  -- used as a bare identifier in a RETURNS TABLE declaration.
  rank_position   integer
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
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
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
             or (b.blocker_id = target_id and b.blocked_id = auth.uid())
       )
  )
  select
    r.google_place_id,
    r.name,
    r.cuisine_type,
    row_number() over (order by pr.rating desc, pr.comparisons desc, r.name)::int
    from public.place_ratings pr
    join public.restaurants r on r.id = pr.restaurant_id
   where pr.user_id = target_id
     and exists (select 1 from allowed)
     -- An unanswered place still sits at the default 1500 and would outrank
     -- something the person actually judged worse. A list is only an identity
     -- object if every entry was earned.
     and pr.comparisons > 0
   order by pr.rating desc, pr.comparisons desc, r.name
   limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.top_ranked_places(uuid, integer) from public;
grant execute on function public.top_ranked_places(uuid, integer) to authenticated;
