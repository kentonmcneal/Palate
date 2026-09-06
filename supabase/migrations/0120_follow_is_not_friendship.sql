-- ============================================================================
-- 0120 — three places where 0116 treated a follow as a friendship.
-- ----------------------------------------------------------------------------
-- 0116 replaced "accepted friendship" with "follows" mechanically, and in
-- three places that substitution was wrong. Under the old model the friend set
-- was reciprocal by construction, so `profile_visibility in ('friends',
-- 'public')` was a safe test. Under follows it is not: a one-way follower is
-- not a friend, and two of these gates were handing them a friends-only
-- account's data. Measured live before this migration:
--
--   friends_leaderboard    a one-way follower of a friends-only profile read
--                          its visit counts.                        [1 row]
--   enqueue_friend_visit_push  a friends-only person's visit would push
--                          "X just ate at Y" — the restaurant name is the
--                          private part — to one-way followers.      [1 row]
--
-- The third is not a leak but a fragility: 0116 revoked EXECUTE on
-- can_view_feed_author from anon, and the feed_events RLS policy calls it, so
-- an anon read of feed_events raised 42501 instead of returning no rows. A
-- cold launch that queries before the session hydrates would throw rather than
-- come back empty. The function already returns false when auth.uid() is null,
-- so granting execute back is strictly safer than the error.
-- ============================================================================

-- ---- 1. the leaderboard ---------------------------------------------------
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
     -- A friends-only account appears only to a MUTUAL follow. Following
     -- someone is a request to hear from them, not a grant of access to them.
     and (p.profile_visibility = 'public'
          or (p.profile_visibility = 'friends' and public.are_friends(me, p.id)))
     and not public.is_blocked_either_way(me, p.id)
   order by coalesce(stats.this_week,0) desc, coalesce(stats.total_visits,0) desc;
end $$;

-- ---- 2. the visit push ----------------------------------------------------
create or replace function public.enqueue_friend_visit_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text; actor_vis text; place_name text;
begin
  select coalesce(display_name, split_part(email,'@',1), 'Someone'), coalesce(profile_visibility,'friends')
    into actor_name, actor_vis from public.profiles where id = new.user_id;
  if actor_vis = 'private' then return new; end if;
  select name into place_name from public.restaurants where id = new.restaurant_id;
  if place_name is null then return new; end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select f.follower_id,
    actor_name || ' just ate at ' || place_name,
    case when mine.n is null or mine.n = 0 then 'Somewhere you have not been yet.'
         when mine.n = 1 then 'You have been once.'
         else 'You have been ' || mine.n || ' times.' end,
    jsonb_build_object('type','friend_visit','visit_id',new.id,'user_id',new.user_id),
    public.next_sendable_at(p.timezone), 'friend_visit:' || new.id::text, now() + interval '12 hours'
  from public.follows f
  join public.profiles p on p.id = f.follower_id
  left join lateral (
    select count(*)::int n from public.visits v
     where v.user_id = f.follower_id and v.restaurant_id = new.restaurant_id
  ) mine on true
  where f.followee_id = new.user_id
    -- The title carries the restaurant name, so the push IS the disclosure.
    -- A friends-only actor reaches mutual follows only.
    and (actor_vis = 'public' or public.are_friends(new.user_id, f.follower_id))
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(new.user_id, f.follower_id)
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end $$;

-- ---- 3. anon gets an empty list, not an error -----------------------------
-- The function's own first condition is `auth.uid() is not null`, so an anon
-- caller is already answered "false". Letting it run returns zero rows; not
-- letting it run returns 42501 from inside an RLS policy, which is a worse
-- failure at exactly the moment the session has not hydrated yet.
grant execute on function public.can_view_feed_author(uuid) to anon;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; mom uuid; n int;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  select id into mom    from public.profiles where display_name = 'mcldkt';

  -- anon reads the feed as an empty list rather than raising
  begin
    perform set_config('role', 'anon', true);
    perform count(*) from public.feed_events;
  exception when others then
    perform set_config('role', 'postgres', true);
    raise exception '0120: anon feed read still raises % %', SQLSTATE, SQLERRM;
  end;
  perform set_config('role', 'postgres', true);

  if kenton is null or mom is null then
    raise notice '0120: fresh database, no seed profiles — leak proofs skipped';
    return;
  end if;

  -- Reproduce the exact leak: make mom friends-only, drop her follow back, and
  -- confirm Kenton (still following her) can no longer read her counts.
  update public.profiles set profile_visibility = 'friends' where id = mom;
  delete from public.follows where follower_id = mom and followee_id = kenton;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select count(*) into n from public.friends_leaderboard() where user_id = mom;
  if n <> 0 then
    update public.profiles set profile_visibility = 'public' where id = mom;
    insert into public.follows (follower_id, followee_id) values (mom, kenton) on conflict do nothing;
    raise exception '0120: LEAK — a one-way follower still reads a friends-only leaderboard row';
  end if;

  -- and with the follow returned, the row comes back
  insert into public.follows (follower_id, followee_id) values (mom, kenton) on conflict do nothing;
  select count(*) into n from public.friends_leaderboard() where user_id = mom;
  if n <> 1 then
    update public.profiles set profile_visibility = 'public' where id = mom;
    raise exception '0120: a mutual follow was locked out of the leaderboard (% rows)', n;
  end if;

  perform set_config('request.jwt.claims', null, true);
  update public.profiles set profile_visibility = 'public' where id = mom;
end $$;
