-- ============================================================================
-- 0088_snapshot_friend_state.sql — a sent request has to look sent.
-- ----------------------------------------------------------------------------
-- The profile screen has exactly one friendship signal, `is_friend`, computed
-- from are_friends(), which requires status = 'accepted'. requestFriendship
-- writes status = 'pending'. So tapping "Add friend" wrote the row, reloaded
-- the snapshot, got is_friend = false, and rendered "Add friend" again.
--
-- The founder reported this as the toggle not changing. The write had
-- succeeded: `mcldkt -> Kenton M [accepted]` and two of his own outgoing
-- requests sit at pending. Nothing in the UI could tell those three states
-- apart, so a request that was sent looked identical to one never sent, which
-- is how somebody sends it twice.
--
-- friend_state carries the four cases the screen actually needs:
--   'self'        — your own profile
--   'accepted'    — friends
--   'pending_out' — you asked, they have not answered
--   'pending_in'  — they asked, you have not answered
--   'none'        — no row either way
--
-- is_friend stays, unchanged, for every existing caller.
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
  tiktok_handle text,
  hidden_visits integer,
  username text,
  friend_state text
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
  fstate text;
begin
  if auth.uid() is null then
    return;
  end if;

  is_me := (auth.uid() = target_id);

  select pv.profile_visibility::text into vis
  from public.profiles pv
  where pv.id = target_id;

  if vis is null then
    return;
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  -- Direction matters: "you asked" and "they asked" need different buttons.
  if is_me then
    fstate := 'self';
  elsif is_friends then
    fstate := 'accepted';
  else
    select case
             when f.requester_id = auth.uid() then 'pending_out'
             else 'pending_in'
           end
      into fstate
      from public.friendships f
     where f.status = 'pending'
       and (
         (f.requester_id = auth.uid() and f.addressee_id = target_id)
         or (f.addressee_id = auth.uid() and f.requester_id = target_id)
       )
     limit 1;
    fstate := coalesce(fstate, 'none');
  end if;

  -- Private, viewed by anyone else: identity only. friend_state still travels,
  -- or you could never send a request to a private profile.
  if vis = 'private' and not is_me then
    return query
    select
      p.id, p.display_name, null::text, p.avatar_url, p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false,
      null::text, null::text, null::text, null::text, null::text,
      null::int, p.username, fstate
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  if vis = 'friends' and not is_friends and not is_me then
    return query
    select
      p.id, p.display_name, null::text, p.avatar_url, p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false,
      null::text, null::text, null::text, null::text, null::text,
      null::int, p.username, fstate
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  return query
  select
    p.id,
    p.display_name,
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
    p.username,
    fstate
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
