-- ============================================================================
-- 0118 — one identity, one name, and the end of the quoted duplicate.
-- ----------------------------------------------------------------------------
-- The founder, looking at his own profile: "'The Fast Casual Regular' on my
-- profile and then listed again in quotation marks is doing nothing."
--
-- He was reading a bug. `get_friend_profile_snapshot` returned
--     persona_label   := ww.personality_label
--     persona_tagline := ww.wrapped_json ->> 'personality_label'
-- which is the SAME STRING by construction (0088:135-136). The screen printed
-- it twice, the second time in quotes, because the second field was supposed
-- to be a tagline and never was.
--
-- Underneath that: the app has TWO identity systems. The real one lives in
-- mobile/lib/palate (four quadrants on novelty × premium) and never leaves the
-- phone. The server invents its own five strings in a CASE and writes those.
-- So Wrapped says one thing and the profile says another, about the same week.
--
-- This migration gives the real identity somewhere to live, and makes the
-- snapshot read it. The legacy CASE keeps writing `personality_label` for one
-- release so nothing goes blank mid-rollout; the client maps those five names
-- home (lib/palate/palateNames.ts) rather than showing them.
-- ============================================================================

alter table public.weekly_wrapped
  add column if not exists palate_identity text,
  add column if not exists palate_tagline  text;

-- The client computes the identity; this is how it says so. Own-row only:
-- the user id comes from the JWT, never from the argument.
create or replace function public.set_palate_identity(
  p_week_start date, p_identity text, p_tagline text
) returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_identity is null or length(trim(p_identity)) = 0 then return; end if;
  if length(p_identity) > 40 or coalesce(length(p_tagline), 0) > 200 then
    raise exception 'identity too long';
  end if;
  update public.weekly_wrapped
     set palate_identity = trim(p_identity), palate_tagline = nullif(trim(coalesce(p_tagline,'')), '')
   where user_id = me and week_start = p_week_start;
end $$;
revoke all on function public.set_palate_identity(date, text, text) from public, anon;
grant execute on function public.set_palate_identity(date, text, text) to authenticated;

-- ---- the snapshot stops printing the same string twice --------------------
drop function if exists public.get_friend_profile_snapshot(uuid);
drop function if exists public.get_friend_profile_snapshot_unguarded(uuid);

create function public.get_friend_profile_snapshot_unguarded(target_id uuid)
returns table (
  id uuid, display_name text, email text, avatar_url text, profile_visibility text,
  persona_label text, persona_tagline text, top_restaurant text,
  unique_restaurants integer, total_visits integer, is_friend boolean, is_self boolean,
  bio text, school text, current_city text, instagram_handle text, tiktok_handle text,
  hidden_visits integer, username text, follow_state text,
  followers_count integer, following_count integer, friends_count integer
)
language plpgsql stable security definer set search_path to 'public' as $function$
declare vis text; is_friends boolean; is_me boolean; fstate text;
        n_followers int; n_following int; n_friends int;
begin
  if auth.uid() is null then return; end if;
  is_me := (auth.uid() = target_id);

  select pv.profile_visibility::text into vis from public.profiles pv where pv.id = target_id;
  if vis is null then return; end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  if is_me then fstate := 'self';
  elsif is_friends then fstate := 'mutual';
  elsif exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = target_id)
    then fstate := 'following';
  elsif exists (select 1 from public.follows where follower_id = target_id and followee_id = auth.uid())
    then fstate := 'follows_you';
  else fstate := 'none';
  end if;

  select count(*)::int into n_followers from public.follows where followee_id = target_id;
  select count(*)::int into n_following from public.follows where follower_id = target_id;
  select count(*)::int into n_friends   from public.follows a
   where a.follower_id = target_id
     and exists (select 1 from public.follows b where b.follower_id = a.followee_id and b.followee_id = target_id);

  if (vis = 'private' or (vis = 'friends' and not is_friends)) and not is_me then
    return query
    select p.id, p.display_name, null::text, p.avatar_url, p.profile_visibility::text,
           null::text, null::text, null::text, null::int, null::int, false, false,
           null::text, null::text, null::text, null::text, null::text,
           null::int, p.username, fstate, n_followers, n_following, n_friends
      from public.profiles p where p.id = target_id;
    return;
  end if;

  return query
  select p.id, p.display_name,
         case when is_me then p.email else null::text end,
         p.avatar_url, p.profile_visibility::text,
         -- The real identity when the client has written one; the legacy CASE
         -- string only as a fallback, which the app maps home before display.
         coalesce(ww.palate_identity, ww.personality_label),
         -- NOT wrapped_json->>'personality_label'. A tagline the client never
         -- wrote is absent, and absent renders as nothing — which is strictly
         -- better than the label repeated in quotation marks.
         ww.palate_tagline,
         (select r.name from public.visits v join public.restaurants r on r.id = v.restaurant_id
           where v.user_id = target_id and v.is_public
           group by r.name order by count(*) desc, r.name limit 1),
         (select count(distinct v.restaurant_id)::int from public.visits v where v.user_id = target_id and v.is_public),
         (select count(*)::int from public.visits v where v.user_id = target_id and v.is_public),
         is_friends, is_me, p.bio, p.school, p.current_city, p.instagram_handle, p.tiktok_handle,
         case when is_me then (select count(*)::int from public.visits v where v.user_id = target_id and not v.is_public)
              else null::int end,
         p.username, fstate, n_followers, n_following, n_friends
    from public.profiles p
    left join lateral (
      select w.personality_label, w.palate_identity, w.palate_tagline
        from public.weekly_wrapped w
       where w.user_id = target_id order by w.week_start desc limit 1
    ) ww on true
   where p.id = target_id;
end;
$function$;

create function public.get_friend_profile_snapshot(target_id uuid)
returns table (
  id uuid, display_name text, email text, avatar_url text, profile_visibility text,
  persona_label text, persona_tagline text, top_restaurant text,
  unique_restaurants integer, total_visits integer, is_friend boolean, is_self boolean,
  bio text, school text, current_city text, instagram_handle text, tiktok_handle text,
  hidden_visits integer, username text, follow_state text,
  followers_count integer, following_count integer, friends_count integer
)
language sql stable security definer set search_path to 'public' as $function$
  select * from public.get_friend_profile_snapshot_unguarded(target_id)
   where auth.uid() is not null
     and (auth.uid() = target_id or not public.is_blocked_either_way(auth.uid(), target_id));
$function$;

revoke all on function public.get_friend_profile_snapshot(uuid) from public, anon;
revoke all on function public.get_friend_profile_snapshot_unguarded(uuid) from public, anon;
grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;

-- The leaderboard reads the same field, so a person is called one thing.
create or replace function public.friends_leaderboard()
returns table (user_id uuid, display_name text, email text, avatar_url text,
               persona_label text, total_visits integer, visits_this_week integer, unique_cuisines integer)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); week_start date := date_trunc('week', now())::date;
begin
  if me is null then return; end if;
  return query
  select p.id, p.display_name, null::text, p.avatar_url,
         coalesce(ww.palate_identity, ww.personality_label),
         coalesce(stats.total_visits,0)::int, coalesce(stats.this_week,0)::int, coalesce(stats.unique_cuisines,0)::int
    from public.follows f
    join public.profiles p on p.id = f.followee_id
    left join lateral (
      select count(*)::int total_visits,
             count(*) filter (where v.visited_at >= week_start)::int this_week,
             count(distinct r.cuisine_type)::int unique_cuisines
        from public.visits v left join public.restaurants r on r.id = v.restaurant_id
       where v.user_id = p.id and v.is_public
    ) stats on true
    left join lateral (
      select w.personality_label, w.palate_identity from public.weekly_wrapped w
       where w.user_id = p.id order by w.week_start desc limit 1
    ) ww on true
   where f.follower_id = me
     and p.profile_visibility in ('friends','public')
     and not public.is_blocked_either_way(me, p.id)
   order by coalesce(stats.this_week,0) desc, coalesce(stats.total_visits,0) desc;
end $$;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; r record; wk date;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);

  select week_start into wk from public.weekly_wrapped where user_id = kenton order by week_start desc limit 1;
  if wk is not null then
    perform public.set_palate_identity(wk, 'Explorer', 'Anywhere new. Bonus points if nobody has heard of it.');
    select * into r from public.get_friend_profile_snapshot(kenton);
    if r.persona_label <> 'Explorer' then
      raise exception '0118: the written identity did not come back, got %', coalesce(r.persona_label,'<null>');
    end if;
    if r.persona_tagline = r.persona_label then
      raise exception '0118: label and tagline are still the same string';
    end if;
    -- and put it back, so this proof leaves no trace on a real row
    update public.weekly_wrapped set palate_identity = null, palate_tagline = null
     where user_id = kenton and week_start = wk;
  else
    raise notice '0118: founder has no wrapped row; identity write untested against real data';
  end if;

  -- with nothing written, the tagline is ABSENT rather than a repeat
  select * into r from public.get_friend_profile_snapshot(kenton);
  if r.persona_tagline is not null and r.persona_tagline = r.persona_label then
    raise exception '0118: the duplicate survived the fallback path';
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
