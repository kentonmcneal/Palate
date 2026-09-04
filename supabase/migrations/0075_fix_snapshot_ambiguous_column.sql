-- ============================================================================
-- 0075_fix_snapshot_ambiguous_column.sql
-- ----------------------------------------------------------------------------
-- get_friend_profile_snapshot has been returning 400 for every call, not just
-- since 0073 — the same line is in 0059 and in 0008 before it:
--
--     select profile_visibility::text into vis
--       from public.profiles
--      where profiles.id = target_id;
--
-- `profile_visibility` is both a column of `profiles` and an OUT parameter of
-- this function, so PL/pgSQL raises 42702 "column reference is ambiguous" the
-- first time the statement executes. The function deploys cleanly and fails at
-- runtime, which is why it survived several migrations: nothing type-checks a
-- function body until a row goes through it.
--
-- The client swallows the throw and renders "Profile not found", so the failure
-- looked like an empty profile rather than an error. Qualifying the column is
-- the entire fix.
-- ============================================================================

create or replace function public.get_friend_profile_snapshot(target_id uuid)
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

  -- Aliased. Unqualified, this is the OUT parameter.
  select pv.profile_visibility::text into vis
  from public.profiles pv
  where pv.id = target_id;

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
    -- Lifetime most-visited among VISIBLE visits (0073), not last week's pick.
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
