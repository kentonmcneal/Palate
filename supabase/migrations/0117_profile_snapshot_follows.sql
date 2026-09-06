-- ============================================================================
-- 0117 — the profile snapshot speaks in follows.
-- ----------------------------------------------------------------------------
-- friend_state had four values describing a negotiation ('pending_out' meant
-- "you asked and are waiting"). There is no waiting any more, so the states
-- are the four ways two people can point at each other, and the header gets
-- the follower/following/friend counts it now displays.
--
-- The return type changes, so both functions are dropped and rebuilt; a
-- create-or-replace cannot rename or add an OUT column.
-- ============================================================================

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

  -- Four states, and none of them is a request. "follows_you" is the one that
  -- earns a distinct button: it says Follow back.
  if is_me then fstate := 'self';
  elsif is_friends then fstate := 'mutual';
  elsif exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = target_id)
    then fstate := 'following';
  elsif exists (select 1 from public.follows where follower_id = target_id and followee_id = auth.uid())
    then fstate := 'follows_you';
  else fstate := 'none';
  end if;

  -- Counts are public the way a follower list is public: they say how many,
  -- never who, and they do not depend on the viewer.
  select count(*)::int into n_followers from public.follows where followee_id = target_id;
  select count(*)::int into n_following from public.follows where follower_id = target_id;
  select count(*)::int into n_friends   from public.follows a
   where a.follower_id = target_id
     and exists (select 1 from public.follows b where b.follower_id = a.followee_id and b.followee_id = target_id);

  -- Private, viewed by anyone else: identity only. follow_state still travels,
  -- or you could never follow a private profile.
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
         ww.personality_label, (ww.wrapped_json ->> 'personality_label')::text,
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
      select w.personality_label, w.wrapped_json from public.weekly_wrapped w
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

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; mom uuid; taylor uuid; r record; n int;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  select id into mom    from public.profiles where display_name = 'mcldkt';
  select id into taylor from public.profiles where display_name = 'Taylor M.';

  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.get_friend_profile_snapshot(kenton);
  if n <> 0 then raise exception '0117: signed-out caller read a profile'; end if;

  if kenton is null or mom is null or taylor is null then
    raise notice '0117: fresh database, no seed profiles — proofs skipped';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select * into r from public.get_friend_profile_snapshot(mom);
  if r.follow_state <> 'mutual' then raise exception '0117: mutual follow read as %', r.follow_state; end if;
  if r.total_visits is null then raise exception '0117: a mutual follow cannot see visits'; end if;

  select * into r from public.get_friend_profile_snapshot(taylor);
  if r.follow_state <> 'following' then raise exception '0117: one-way follow read as %', r.follow_state; end if;

  -- and from the other side, the same edge is "follows_you"
  perform set_config('request.jwt.claims', json_build_object('sub', taylor::text)::text, true);
  select * into r from public.get_friend_profile_snapshot(kenton);
  if r.follow_state <> 'follows_you' then raise exception '0117: reverse edge read as %', r.follow_state; end if;

  -- THE GATE THAT MATTERS: following a friends-only profile must not open it.
  update public.profiles set profile_visibility = 'friends' where id = kenton;
  select * into r from public.get_friend_profile_snapshot(kenton);
  if r.total_visits is not null then
    raise exception '0117: LEAK — a one-way follower read a friends-only profile';
  end if;
  -- but a mutual follow may
  insert into public.follows (follower_id, followee_id) values (taylor, kenton);
  select * into r from public.get_friend_profile_snapshot(kenton);
  if r.total_visits is null then raise exception '0117: a mutual follow was locked out'; end if;
  delete from public.follows where follower_id = taylor and followee_id = kenton;
  update public.profiles set profile_visibility = 'public' where id = kenton;

end $$;
