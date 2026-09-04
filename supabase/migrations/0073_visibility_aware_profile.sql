-- ============================================================================
-- 0073_visibility_aware_profile.sql — make per-visit privacy actually private.
-- ----------------------------------------------------------------------------
-- 0071 added `visits.is_public` and the app grew a per-visit curation control.
-- Nothing that reads ACROSS users was updated, so hiding a visit removed it
-- from your own list and changed nothing anybody else could see. Three
-- functions leaked it, in descending order of severity:
--
--   1. friend_taste_features — hands a friend the full visit list including
--      restaurant NAMES. A hidden visit was disclosed verbatim. This is the
--      real leak; the other two are counts.
--   2. shared_places — joins both users' visits with no filter, so a hidden
--      visit could surface as "you've both been here".
--   3. get_friend_profile_snapshot — total_visits counted every row.
--
-- The rule applied throughout: the private ledger stays complete for its OWNER
-- (recommendations, Wrapped and your own history read everything), and every
-- cross-user read sees only `is_public` rows. `is_me` keeps the full view in
-- each function, because reading your own data is not a disclosure.
--
-- get_friend_profile_snapshot additionally STOPS sourcing top_restaurant and
-- unique_restaurants from weekly_wrapped. Those were last week's Wrapped stats
-- masquerading as lifetime profile stats — wrong on their own terms, and
-- unfixable for privacy without breaking Wrapped, which should stay complete.
-- They are now computed inline from visible visits. The persona label still
-- comes from Wrapped: it is a coarse adjective, not a place, and it identifies
-- no hidden visit.
--
-- Self and public now show the SAME numbers on purpose — the owner's profile is
-- a faithful preview of what friends see. The new `hidden_visits` column, which
-- is null for everyone but the owner, discloses the private remainder.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. friend_taste_features — the disclosure that mattered.
-- ----------------------------------------------------------------------------
create or replace function public.friend_taste_features(target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  vis text;
  is_friends boolean;
  is_me boolean;
begin
  is_me := (auth.uid() = target_id);

  select profile_visibility::text into vis
  from public.profiles
  where profiles.id = target_id;

  if vis is null then
    return jsonb_build_object('authorized', false, 'reason', 'not_found');
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  -- Visibility gate — same rules as get_friend_profile_snapshot.
  if not is_me and (vis = 'private' or (vis = 'friends' and not is_friends)) then
    return jsonb_build_object('authorized', false, 'reason', 'not_authorized');
  end if;

  -- Authorized. `is_me or v.is_public` is the whole change: your own taste
  -- vector is built from your complete history, a friend's from the slice they
  -- chose to show. Compatibility scores computed against a friend are
  -- therefore based on public data only — accurate to what they published,
  -- which is the correct trade. A user who hides most of their history should
  -- match on less of it.
  return jsonb_build_object(
    'authorized', true,
    'visit_count', (
      select count(*)::int from public.visits v
       where v.user_id = target_id and (is_me or v.is_public)
    ),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'visited_at', v.visited_at,
        'meal_type', v.meal_type,
        'restaurant', jsonb_build_object(
          'id',              r.id,
          'name',            r.name,
          'cuisine_type',    r.cuisine_type,
          'cuisine_region',  r.cuisine_region,
          'cuisine_subregion', r.cuisine_subregion,
          'format_class',    r.format_class,
          'chain_type',      r.chain_type,
          'occasion_tags',   r.occasion_tags,
          'flavor_tags',     r.flavor_tags,
          'cultural_context', r.cultural_context,
          'neighborhood',    r.neighborhood,
          'latitude',        r.latitude,
          'longitude',       r.longitude,
          'price_level',     r.price_level
        )
      ))
      from public.visits v
      join public.restaurants r on r.id = v.restaurant_id
      where v.user_id = target_id
        and (is_me or v.is_public)
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.friend_taste_features(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. shared_places — both sides filtered.
-- ----------------------------------------------------------------------------
-- The caller's own side is filtered too, and that is deliberate. "We have both
-- been here" is a mutual disclosure: surfacing a place you hid tells the other
-- person you go there, even though the row is rendered on your screen. The
-- counts shown are visible-visit counts on both sides for the same reason.
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
       and v.is_public
     group by 1
  ),
  theirs as (
    select v.restaurant_id, count(*)::int n
      from public.visits v
     where v.user_id = target_id
       and v.is_public
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
-- 3. get_friend_profile_snapshot — visible-only stats, plus hidden_visits.
-- ----------------------------------------------------------------------------
-- DROP + CREATE because the return type gains a column; Postgres will not
-- change a function's OUT columns in place (see 0059).
drop function if exists public.get_friend_profile_snapshot(uuid);

create function public.get_friend_profile_snapshot(target_id uuid)
returns table (
  id uuid,
  display_name text,
  email text,
  avatar_url text,
  profile_visibility text,
  persona_label text,
  persona_tagline text,
  top_restaurant text,
  unique_restaurants integer,
  total_visits integer,
  is_friend boolean,
  is_self boolean,
  bio text,
  school text,
  current_city text,
  instagram_handle text,
  tiktok_handle text,
  hidden_visits integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  vis text;
  is_friends boolean;
  is_me boolean;
begin
  is_me := (auth.uid() = target_id);

  select profile_visibility::text into vis
  from public.profiles
  where profiles.id = target_id;

  if vis is null then
    return;
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  -- Private, viewed by anyone else: identity only.
  if vis = 'private' and not is_me then
    return query
    select
      p.id, p.display_name, p.email, p.avatar_url, p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false,
      null::text, null::text, null::text, null::text, null::text,
      null::int
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  -- Friends-only, viewed by a non-friend: identity only.
  if vis = 'friends' and not is_friends and not is_me then
    return query
    select
      p.id, p.display_name, p.email, p.avatar_url, p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false,
      null::text, null::text, null::text, null::text, null::text,
      null::int
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.email,
    p.avatar_url,
    p.profile_visibility::text,
    ww.personality_label,
    (ww.wrapped_json ->> 'personality_label')::text,
    -- Lifetime most-visited among VISIBLE visits, not last week's Wrapped pick.
    (select r.name
       from public.visits v
       join public.restaurants r on r.id = v.restaurant_id
      where v.user_id = target_id and v.is_public
      group by r.name
      order by count(*) desc, r.name
      limit 1),
    (select count(distinct v.restaurant_id)::int
       from public.visits v
      where v.user_id = target_id and v.is_public),
    (select count(*)::int
       from public.visits v
      where v.user_id = target_id and v.is_public),
    is_friends,
    is_me,
    p.bio,
    p.school,
    p.current_city,
    p.instagram_handle,
    p.tiktok_handle,
    -- Owner-only. Null for everyone else so the column cannot become a signal
    -- that someone is hiding things — a friend sees no difference between a
    -- curated profile and a complete one.
    case when is_me then (
      select count(*)::int from public.visits v
       where v.user_id = target_id and not v.is_public
    ) else null::int end
  from public.profiles p
  left join lateral (
    select w.personality_label, w.wrapped_json
    from public.weekly_wrapped w
    where w.user_id = target_id
    order by w.week_start desc
    limit 1
  ) ww on true
  where p.id = target_id;
end;
$function$;

revoke all on function public.get_friend_profile_snapshot(uuid) from public;
grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;
