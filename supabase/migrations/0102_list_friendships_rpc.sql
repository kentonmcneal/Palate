-- ============================================================================
-- 0102_list_friendships_rpc.sql — the Board crash, and the reason for it.
-- ----------------------------------------------------------------------------
-- "The app hit an unexpected error" after tapping Board on the Feed.
--
-- listFriends() reads friendships with the two profiles embedded through
-- PostgREST. Until 0092 the FK pointed at auth.users, the embed failed with
-- 400, the client caught it, and the Friends screen showed an error. 0092
-- repointed the FK at profiles, the embed started resolving — and the only
-- SELECT policy on profiles is own-row, so the OTHER person in every
-- friendship came back null. friends.tsx then ran f.friend.id inside an
-- effect and threw; group.tsx does the same in render. The FK fix unmasked
-- a bug that the 400 had been hiding.
--
-- Same shape as every other cross-user read in this app since 0080: a
-- SECURITY DEFINER function that returns exactly the fields the screen needs
-- and nothing else. No email — 0036 took it out of search, 0080 out of
-- snapshots, 0098 out of the leaderboard; this was the last embed still
-- selecting it.
-- ============================================================================

create or replace function public.list_friendships(p_kind text default 'accepted')
returns table (
  friendship_id     uuid,
  requester_id      uuid,
  addressee_id      uuid,
  status            text,
  created_at        timestamptz,
  accepted_at       timestamptz,
  other_id          uuid,
  other_display_name text,
  other_username    text,
  other_avatar_url  text,
  other_visibility  text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id, f.requester_id, f.addressee_id, f.status::text, f.created_at, f.accepted_at,
    p.id, p.display_name, p.username, p.avatar_url, p.profile_visibility::text
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  where auth.uid() is not null
    and (
      (p_kind = 'accepted'    and f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid()))
      or (p_kind = 'pending_in'  and f.status = 'pending' and f.addressee_id = auth.uid())
      or (p_kind = 'pending_out' and f.status = 'pending' and f.requester_id = auth.uid())
    )
  order by coalesce(f.accepted_at, f.created_at) desc;
$$;
revoke all on function public.list_friendships(text) from public, anon;
grant execute on function public.list_friendships(text) to authenticated;

create or replace function public.list_blocked()
returns table (
  blocked_id     uuid,
  blocked_at     timestamptz,
  display_name   text,
  username       text,
  avatar_url     text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.blocked_id, b.created_at, p.display_name, p.username, p.avatar_url
    from public.blocked_users b
    join public.profiles p on p.id = b.blocked_id
   where auth.uid() is not null and b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;
revoke all on function public.list_blocked() from public, anon;
grant execute on function public.list_blocked() to authenticated;

do $$
declare kenton uuid; n int; nulls int;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select count(*), count(*) filter (where other_display_name is null) into n, nulls
    from public.list_friendships('accepted');
  raise notice '0102: % accepted friendships for the founder, % with a missing other party', n, nulls;
  if n > 0 and nulls > 0 then
    raise exception '0102: the other party is still null';
  end if;
  perform set_config('request.jwt.claims', null, true);
  if (select count(*) from public.list_friendships('accepted')) <> 0 then
    raise exception '0102: unauthenticated caller got rows';
  end if;
end $$;
