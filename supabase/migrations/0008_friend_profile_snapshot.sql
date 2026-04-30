-- ============================================================================
-- 0008_friend_profile_snapshot.sql
-- ----------------------------------------------------------------------------
-- Adds get_friend_profile_snapshot(target_id) — returns a friend's public
-- profile summary in a single call, gated by their profile_visibility setting.
--
-- Uses SECURITY DEFINER so we can read across protected tables (visits,
-- weekly_wrapped) without loosening their RLS policies.
-- ============================================================================

create or replace function public.get_friend_profile_snapshot(target_id uuid)
returns table (
  id                  uuid,
  display_name        text,
  email               text,
  profile_visibility  text,
  persona_label       text,
  persona_tagline     text,
  top_restaurant      text,
  unique_restaurants  int,
  total_visits        int,
  is_friend           boolean,
  is_self             boolean
)
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
    return;
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  -- Visibility gate
  if vis = 'private' and not is_me then
    -- Return shell (just identity bits, no stats)
    return query
    select
      p.id,
      p.display_name,
      p.email,
      p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  if vis = 'friends' and not is_friends and not is_me then
    return query
    select
      p.id,
      p.display_name,
      p.email,
      p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  -- Authorized: return full snapshot
  return query
  select
    p.id,
    p.display_name,
    p.email,
    p.profile_visibility::text,
    ww.personality_label,
    (ww.wrapped_json ->> 'personality_label')::text,
    ww.top_restaurant,
    ww.unique_restaurants,
    (select count(*)::int from public.visits v where v.user_id = target_id),
    is_friends,
    is_me
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
$$;

grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;
