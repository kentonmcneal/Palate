-- ============================================================================
-- 0080_close_anon_profile_reads.sql — STOP-SHIP.
-- ----------------------------------------------------------------------------
-- Three cross-user readers answer the ANON key with real user data. Verified
-- live against the deployed project with nothing but the publishable key that
-- ships inside the app binary:
--
--   friend_taste_features        -> a user's entire visit history: restaurant
--                                   names, latitude/longitude, meal times,
--                                   neighbourhoods
--   friend_taste_features_batch  -> the same, for up to 100 users per call
--   get_friend_profile_snapshot  -> display name, EMAIL, avatar, bio, school,
--                                   city, social handles, visit stats
--
-- Two independent mistakes combined into one hole.
--
-- FIRST: the authorization guard is written as a denial test that a null caller
-- passes. `if not is_me and (vis = 'private' or (vis = 'friends' and not
-- is_friends))` rejects private and friends-only profiles, and says nothing at
-- all about a caller who is not signed in. For a 'public' profile it therefore
-- returns everything to anybody. A guard has to assert who you ARE, not only
-- rule out who you are not.
--
-- SECOND: migration 0077 set all 14 profiles to 'public'. That converted a hole
-- that had been latent for most rows into a live one for every user in the
-- product. The bug predates 0077; the blast radius did not.
--
-- The anon key is public by design — it is compiled into the app and readable by
-- anyone who downloads it. So "you need the key" is not a control.
--
-- Fixed here:
--   1. every one of these functions requires auth.uid() to be non-null
--   2. email is returned only to its owner (0036 stripped email from
--      search_users to stop address harvesting; the profile snapshot handed it
--      back out, and now to anonymous callers)
--   3. username is returned so clients have an identity fallback that is not an
--      email address
--   4. EXECUTE is revoked from `anon` BY NAME. Supabase's default privileges
--      grant execute to anon, authenticated and service_role individually, and
--      `revoke ... from public` does not touch those grants — 0078/0079 already
--      learned this the hard way with palate_overlap_rank.
--
-- Defence in depth on purpose: the in-body guard and the revoke each close this
-- alone. shared_places, top_ranked_places, palate_matches and list_feed already
-- carry `auth.uid() is not null` and were verified to return empty to anon.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. friend_taste_features — the worst of the three.
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
  -- Assert the caller exists before anything else. This is the line whose
  -- absence exposed every user's dining history to the anon key.
  if auth.uid() is null then
    return jsonb_build_object('authorized', false, 'reason', 'not_authenticated');
  end if;

  is_me := (auth.uid() = target_id);

  select pv.profile_visibility::text into vis
  from public.profiles pv
  where pv.id = target_id;

  if vis is null then
    return jsonb_build_object('authorized', false, 'reason', 'not_found');
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  if not is_me and (vis = 'private' or (vis = 'friends' and not is_friends)) then
    return jsonb_build_object('authorized', false, 'reason', 'not_authorized');
  end if;

  -- `is_me or v.is_public` (0073): your own vector is built from your complete
  -- history, a friend's only from the slice they chose to publish.
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

revoke all on function public.friend_taste_features(uuid) from public;
revoke all on function public.friend_taste_features(uuid) from anon;
grant execute on function public.friend_taste_features(uuid) to authenticated;

-- friend_taste_features_batch delegates per id, so it inherits the guard above.
-- It still needs its own revoke: the grant to anon is per-function.
revoke all on function public.friend_taste_features_batch(uuid[]) from public;
revoke all on function public.friend_taste_features_batch(uuid[]) from anon;
grant execute on function public.friend_taste_features_batch(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. get_friend_profile_snapshot — auth required, email owner-only, + username.
-- ----------------------------------------------------------------------------
-- Return type gains `username`, so DROP + CREATE (Postgres cannot change a
-- function's OUT columns in place). `email` stays in the signature rather than
-- being dropped: existing clients read the field, and returning null is a
-- smaller break than removing the column out from under them.
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
  hidden_visits integer,
  username text
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
  -- Signed-in callers only. Anonymous callers previously received the whole row.
  if auth.uid() is null then
    return;
  end if;

  is_me := (auth.uid() = target_id);

  -- Aliased: unqualified, `profile_visibility` is the OUT parameter, and the
  -- ambiguity raised 42702 on every call from 0008 to 0075.
  select pv.profile_visibility::text into vis
  from public.profiles pv
  where pv.id = target_id;

  if vis is null then
    return;
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  -- Private, viewed by anyone else: identity only. No email.
  if vis = 'private' and not is_me then
    return query
    select
      p.id, p.display_name, null::text, p.avatar_url, p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false,
      null::text, null::text, null::text, null::text, null::text,
      null::int, p.username
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  -- Friends-only, viewed by a non-friend: identity only. No email.
  if vis = 'friends' and not is_friends and not is_me then
    return query
    select
      p.id, p.display_name, null::text, p.avatar_url, p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false,
      null::text, null::text, null::text, null::text, null::text,
      null::int, p.username
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  return query
  select
    p.id,
    p.display_name,
    -- Owner only. A login address is not profile content, and every account is
    -- public since 0077, so this was every user's email shown to all the others.
    case when is_me then p.email else null::text end,
    p.avatar_url,
    p.profile_visibility::text,
    ww.personality_label,
    (ww.wrapped_json ->> 'personality_label')::text,
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
    case when is_me then (
      select count(*)::int from public.visits v
       where v.user_id = target_id and not v.is_public
    ) else null::int end,
    p.username
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
revoke all on function public.get_friend_profile_snapshot(uuid) from anon;
grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. browse_profiles — make the guard deliberate rather than incidental.
-- ----------------------------------------------------------------------------
-- It returns nothing to anon today, but only because `p.id <> auth.uid()`
-- evaluates to NULL and filters every row. That is an accident of three-valued
-- logic, not a decision, and it would silently stop protecting anything the day
-- somebody rewrote that predicate.
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
  where auth.uid() is not null
    and p.profile_visibility = 'public'
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

revoke all on function public.browse_profiles(integer, integer, text, text) from anon;
grant execute on function public.browse_profiles(integer, integer, text, text) to authenticated;

-- search_users matches email exactly but never selects it, and already returns
-- nothing to anon. Revoked anyway — every one of these is authenticated-only.
revoke all on function public.search_users(text) from anon;
grant execute on function public.search_users(text) to authenticated;
