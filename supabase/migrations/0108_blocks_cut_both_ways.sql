-- ============================================================================
-- 0108_blocks_cut_both_ways.sql — a block has to stop the other person too.
-- ----------------------------------------------------------------------------
-- Two gaps from the review:
--   * get_friend_profile_snapshot did not consult blocked_users, so somebody
--     you blocked could still open your profile and read the full snapshot.
--   * the friendships INSERT policy only checked requester = me, so a blocked
--     person could keep sending requests to the person who blocked them.
-- ============================================================================

create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocked_users x
     where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a)
  );
$$;
revoke all on function public.is_blocked_either_way(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_either_way(uuid, uuid) to authenticated;

drop policy if exists "friendships: insert own" on public.friendships;
create policy "friendships: insert own"
  on public.friendships for insert
  with check (
    auth.uid() = requester_id
    and not public.is_blocked_either_way(requester_id, addressee_id)
  );

-- The snapshot: wrap the existing function body with a block check by
-- renaming the current one and delegating. Keeps 0088's body untouched.
alter function public.get_friend_profile_snapshot(uuid) rename to get_friend_profile_snapshot_unguarded;
revoke all on function public.get_friend_profile_snapshot_unguarded(uuid) from public, anon, authenticated;

create function public.get_friend_profile_snapshot(target_id uuid)
returns table (
  id uuid, display_name text, email text, avatar_url text, profile_visibility text,
  persona_label text, persona_tagline text, top_restaurant text,
  unique_restaurants integer, total_visits integer, is_friend boolean, is_self boolean,
  bio text, school text, current_city text, instagram_handle text, tiktok_handle text,
  hidden_visits integer, username text, friend_state text
)
language sql stable security definer set search_path = public as $$
  select * from public.get_friend_profile_snapshot_unguarded(target_id)
   where auth.uid() is not null
     and (auth.uid() = target_id or not public.is_blocked_either_way(auth.uid(), target_id));
$$;
revoke all on function public.get_friend_profile_snapshot(uuid) from public, anon;
grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;

do $$
declare kenton uuid; mom uuid; n int;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  select id into mom from public.profiles where display_name = 'mcldkt';
  perform set_config('request.jwt.claims', json_build_object('sub', mom::text)::text, true);
  select count(*) into n from public.get_friend_profile_snapshot(kenton);
  if n <> 1 then raise exception '0108: unblocked snapshot returned % rows', n; end if;
  -- Simulate a block inside the transaction and expect the snapshot to close.
  insert into public.blocked_users (blocker_id, blocked_id) values (kenton, mom);
  select count(*) into n from public.get_friend_profile_snapshot(kenton);
  if n <> 0 then raise exception '0108: blocked viewer still got the snapshot'; end if;
  raise notice '0108: block closes the snapshot both ways';
  raise exception 'rollback' using errcode = 'P0002';
exception when sqlstate 'P0002' then
  null;
end $$;
