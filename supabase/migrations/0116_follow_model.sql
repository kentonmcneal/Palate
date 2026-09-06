-- ============================================================================
-- 0116_follow_model.sql — following, not friend requests.
-- ----------------------------------------------------------------------------
-- "You don't need someone to accept a request to follow them. It should be IG
-- style where you can follow them and they can follow you and it just has to
-- be reciprocal to become friends."
--
-- Mutual-accept was the wrong shape for a food app: it made discovery a
-- negotiation, and it showed. LIVE before this migration: 3 friendship rows
-- across 14 accounts, one accepted and two left pending — two people asked and
-- nobody answered.
--
-- follows(follower_id, followee_id) is the new truth. "Friends" is no longer a
-- stored state; it is a query: two rows pointing at each other. Every gate
-- that said "accepted friendship" becomes either "public profile" (most of
-- them, since the feed was opened in 0077) or "mutual follow" (the ones that
-- expose a friends-only profile).
--
-- Migration of the three existing rows: an accepted friendship becomes two
-- follows, a pending request becomes the one follow the requester intended.
-- Nobody loses a connection and nobody gains one they did not ask for.
--
-- friendships is left in place, unread, so this is reversible for one release.
-- ============================================================================

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);

alter table public.follows enable row level security;
revoke all on public.follows from anon;
grant select, insert, delete on public.follows to authenticated;

-- Who can see a follow row: anyone signed in, the way a follower list is
-- public on Instagram. Who can create one: only you, only as yourself, and
-- never across a block.
drop policy if exists "follows: readable by signed in" on public.follows;
create policy "follows: readable by signed in"
  on public.follows for select using (auth.uid() is not null);
drop policy if exists "follows: own insert" on public.follows;
create policy "follows: own insert"
  on public.follows for insert to authenticated
  with check (
    auth.uid() = follower_id
    and not public.is_blocked_either_way(follower_id, followee_id)
  );
drop policy if exists "follows: own delete" on public.follows;
create policy "follows: own delete"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

-- ---- migrate the three existing rows -------------------------------------
insert into public.follows (follower_id, followee_id, created_at)
select f.requester_id, f.addressee_id, coalesce(f.created_at, now())
  from public.friendships f
 where f.requester_id <> f.addressee_id
on conflict do nothing;

insert into public.follows (follower_id, followee_id, created_at)
select f.addressee_id, f.requester_id, coalesce(f.accepted_at, f.created_at, now())
  from public.friendships f
 where f.status = 'accepted' and f.requester_id <> f.addressee_id
on conflict do nothing;

-- ---- the gates -----------------------------------------------------------

-- "Friends" is now a question, not a column.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = a and followee_id = b)
     and exists (select 1 from public.follows where follower_id = b and followee_id = a);
$$;

create or replace function public.follow_user(target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if target = me then raise exception 'cannot follow yourself'; end if;
  if public.is_blocked_either_way(me, target) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  insert into public.follows (follower_id, followee_id) values (me, target)
  on conflict do nothing;
  return case when public.are_friends(me, target) then 'mutual' else 'following' end;
end $$;
revoke all on function public.follow_user(uuid) from public, anon;
grant execute on function public.follow_user(uuid) to authenticated;

create or replace function public.unfollow_user(target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  delete from public.follows where follower_id = me and followee_id = target;
  return case when exists (select 1 from public.follows where follower_id = target and followee_id = me)
              then 'follows_you' else 'none' end;
end $$;
revoke all on function public.unfollow_user(uuid) from public, anon;
grant execute on function public.unfollow_user(uuid) to authenticated;

-- A friends-only profile is visible to a MUTUAL follow, not to anyone who
-- pressed follow. One-way following must not be a way to read a private life.
create or replace function public.can_view_feed_author(author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles p
       where p.id = author
         and (p.profile_visibility = 'public'
              or (p.profile_visibility = 'friends' and public.are_friends(auth.uid(), author)))
    )
    and not public.is_blocked_either_way(auth.uid(), author);
$$;
revoke all on function public.can_view_feed_author(uuid) from public, anon;
grant execute on function public.can_view_feed_author(uuid) to authenticated;

-- Blocking removes the relationship in both directions.
create or replace function public.block_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if target = me then raise exception 'cannot block yourself'; end if;
  insert into public.blocked_users (blocker_id, blocked_id) values (me, target) on conflict do nothing;
  delete from public.follows
   where (follower_id = me and followee_id = target) or (follower_id = target and followee_id = me);
  delete from public.friendships
   where (requester_id = me and addressee_id = target) or (requester_id = target and addressee_id = me);
end $$;

-- ---- reading the graph ---------------------------------------------------
create or replace function public.list_follows(p_kind text default 'following')
returns table (
  id uuid, display_name text, username text, avatar_url text,
  profile_visibility text, follows_you boolean, you_follow boolean, since timestamptz
)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid where auth.uid() is not null),
  edges as (
    select f.followee_id as other, f.created_at from public.follows f, me where f.follower_id = me.uid and p_kind in ('following','friends')
    union
    select f.follower_id, f.created_at from public.follows f, me where f.followee_id = me.uid and p_kind in ('followers','friends')
  )
  select p.id, p.display_name, p.username, p.avatar_url, p.profile_visibility::text,
         exists (select 1 from public.follows x, me where x.follower_id = p.id and x.followee_id = me.uid),
         exists (select 1 from public.follows x, me where x.follower_id = me.uid and x.followee_id = p.id),
         min(e.created_at)
    from edges e
    join public.profiles p on p.id = e.other, me
   where not public.is_blocked_either_way(me.uid, p.id)
     and (p_kind <> 'friends' or public.are_friends(me.uid, p.id))
   group by p.id, p.display_name, p.username, p.avatar_url, p.profile_visibility
   order by min(e.created_at) desc;
$$;
revoke all on function public.list_follows(text) from public, anon;
grant execute on function public.list_follows(text) to authenticated;

create or replace function public.follow_counts(target uuid)
returns table (followers integer, following integer, friends integer)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.follows where followee_id = target),
    (select count(*)::int from public.follows where follower_id = target),
    (select count(*)::int from public.follows a
      where a.follower_id = target
        and exists (select 1 from public.follows b where b.follower_id = a.followee_id and b.followee_id = target))
  where auth.uid() is not null;
$$;
revoke all on function public.follow_counts(uuid) from public, anon;
grant execute on function public.follow_counts(uuid) to authenticated;

-- The board ranks the people you follow.
create or replace function public.friends_leaderboard()
returns table (user_id uuid, display_name text, email text, avatar_url text,
               persona_label text, total_visits integer, visits_this_week integer, unique_cuisines integer)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); week_start date := date_trunc('week', now())::date;
begin
  if me is null then return; end if;
  return query
  select p.id, p.display_name, null::text, p.avatar_url, ww.personality_label,
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
      select w.personality_label from public.weekly_wrapped w
       where w.user_id = p.id order by w.week_start desc limit 1
    ) ww on true
   where f.follower_id = me
     and p.profile_visibility in ('friends','public')
     and not public.is_blocked_either_way(me, p.id)
   order by coalesce(stats.this_week,0) desc, coalesce(stats.total_visits,0) desc;
end $$;

-- A visit notifies your FOLLOWERS, not a mutual-friend set.
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
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(new.user_id, f.follower_id)
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end $$;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; mom uuid; taylor uuid; n int; st text;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  select id into mom    from public.profiles where display_name = 'mcldkt';
  select id into taylor from public.profiles where display_name = 'Taylor M.';

  -- the accepted friendship became a mutual follow
  if not public.are_friends(kenton, mom) then raise exception '0116: the accepted friendship did not survive'; end if;
  -- the pending request became a one-way follow, and is NOT a friendship
  if public.are_friends(kenton, taylor) then raise exception '0116: a pending request became a friendship'; end if;
  if not exists (select 1 from public.follows where follower_id = kenton and followee_id = taylor) then
    raise exception '0116: the pending request did not become a follow';
  end if;

  -- following needs no acceptance, and makes a friendship when returned
  perform set_config('request.jwt.claims', json_build_object('sub', taylor::text)::text, true);
  st := public.follow_user(kenton);
  if st <> 'mutual' then raise exception '0116: returning a follow did not make a friendship, got %', st; end if;
  st := public.unfollow_user(kenton);
  if st <> 'follows_you' then raise exception '0116: unfollow reported %', st; end if;

  -- a signed-out caller sees nothing
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.list_follows('followers');
  if n <> 0 then raise exception '0116: unauthenticated caller read the graph'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select count(*) into n from public.list_follows('following');
  raise notice '0116: founder follows % people', n;
  perform set_config('request.jwt.claims', null, true);
end $$;
