-- ============================================================================
-- 0059_profile_snapshot_social.sql — surface the social fields on a profile.
-- ----------------------------------------------------------------------------
-- 0056 added bio, school, Instagram and TikTok, and the People directory reads
-- them through browse_profiles. The PROFILE screen reads a different function —
-- get_friend_profile_snapshot — which never learned about them, so tapping
-- someone in the directory led to a page missing everything the directory just
-- showed you.
--
-- Extending the return type means DROP + CREATE (Postgres will not change a
-- function's OUT columns in place). Body is otherwise identical to the existing
-- definition, including both visibility short-circuits.
--
-- The privacy shape is preserved exactly: a private profile, or a friends-only
-- profile viewed by a non-friend, returns nulls for everything except the
-- identity columns. Bio, school and the social handles ride in the FULL branch
-- only — they are profile content, not identity, so a stranger looking at a
-- friends-only account must not see them.
-- ============================================================================

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
  tiktok_handle text
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
      null::text, null::text, null::text, null::text, null::text
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
      null::text, null::text, null::text, null::text, null::text
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
    ww.top_restaurant,
    ww.unique_restaurants,
    (select count(*)::int from public.visits v where v.user_id = target_id),
    is_friends,
    is_me,
    p.bio,
    p.school,
    p.current_city,
    p.instagram_handle,
    p.tiktok_handle
  from public.profiles p
  left join lateral (
    select w.personality_label, w.top_restaurant, w.unique_restaurants, w.wrapped_json
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
