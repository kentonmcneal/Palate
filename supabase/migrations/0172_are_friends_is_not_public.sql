-- ============================================================================
-- 0172 — are_friends() was a friendship oracle for anyone with the anon key.
-- ----------------------------------------------------------------------------
-- public.are_friends(a uuid, b uuid) is SECURITY DEFINER, takes two ARBITRARY
-- user ids, reads public.follows, and holds EXECUTE for both anon and
-- authenticated. It has no guard of any kind — it never consults auth.uid(),
-- so it does not care who is asking or whether either id is the caller.
--
-- Anyone holding the anon key, which ships inside every copy of the app, can
-- therefore ask "are these two people friends?" about any pair and get a
-- straight answer. Nineteen accounts is 171 probes; the cost is O(n^2) and
-- each probe is a single cheap RPC.
--
-- This is not a new discovery. docs/REVIEW_2026-09-05.md already recorded it:
-- "are_friends (0007:74) has no guard at all — it is a friendship oracle for
-- any signed-in user." It was written down nine days ago and never closed. It
-- turned up again here because a standing check now enumerates definer grants
-- instead of pinning five names by hand.
--
-- WHY REVOKING IS SAFE, checked rather than assumed:
--
--   * NO CLIENT CALLS IT. Not the app, not the landing site.
--   * ELEVEN DATABASE FUNCTIONS call it — can_view_feed_author, dm_send,
--     follow_user, friend_taste_features, friends_leaderboard,
--     get_friend_profile_snapshot_unguarded, list_follows, palate_matches,
--     palate_overlap_rank, shared_places, top_ranked_places — and ALL ELEVEN
--     are SECURITY DEFINER owned by postgres, the same owner as are_friends.
--     A definer function calls it as its owner, not as the person who invoked
--     it, so none of them needs the caller to hold EXECUTE. Revoking cannot
--     break them.
--   * supabase/tests/smoke.sql calls it directly, but that file inserts into
--     auth.users, so it already runs with privileges far above authenticated.
--
-- The function itself is left in place precisely because those eleven callers
-- depend on it. What changes is who may reach it from outside.
-- ============================================================================

revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- ---- proofs ----------------------------------------------------------------
do $$
declare a uuid; b uuid; ok boolean;
begin
  if has_function_privilege('anon', 'public.are_friends(uuid,uuid)', 'execute') then
    raise exception '0172: anon can still execute are_friends';
  end if;
  if has_function_privilege('authenticated', 'public.are_friends(uuid,uuid)', 'execute') then
    raise exception '0172: authenticated can still execute are_friends';
  end if;

  -- The eleven internal callers must still work. can_view_feed_author is the
  -- one that matters most: it runs inside the feed RLS path, and a broken
  -- EXECUTE there turns empty results into 42501 for every reader.
  select id into a from public.profiles order by created_at limit 1;
  begin
    select public.can_view_feed_author(a) into ok;
  exception when others then
    raise exception '0172: can_view_feed_author broke after the revoke: %', sqlerrm;
  end;

  -- And a definer caller reached as a normal user still resolves.
  perform set_config('role', 'authenticated', true);
  begin
    perform * from public.list_follows('friends') limit 1;
  exception when others then
    perform set_config('role','postgres',true);
    raise exception '0172: list_follows broke after the revoke: %', sqlerrm;
  end;
  perform set_config('role','postgres',true);
end $$;
