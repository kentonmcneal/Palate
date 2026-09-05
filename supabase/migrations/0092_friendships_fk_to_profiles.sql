-- ============================================================================
-- 0092_friendships_fk_to_profiles.sql — the friends list has never loaded.
-- ----------------------------------------------------------------------------
-- The client reads friendships with the author embedded:
--
--   requester:profiles!friendships_requester_id_fkey ( ... )
--
-- PostgREST resolves that hint by looking for a foreign key from friendships
-- to profiles with that name. The constraint exists, and it points at
-- auth.users (0007). So every call has answered:
--
--   PGRST200 "Could not find a relationship between 'friendships' and
--   'profiles' in the schema cache"      HTTP 400
--
-- That is listFriends, listIncomingRequests and listOutgoingRequests: the
-- Friends screen, the pending-request badge, and — because the Feed loads the
-- pending count in the same Promise.all as the posts — the Feed. The feed's
-- own embed had this identical bug (fixed in 0077 by replacing it with an
-- RPC); the sibling call was left in place, and its failure was swallowed
-- until the load-state work started showing errors instead of hiding them.
-- Reported by the founder as "Feed page isn't loading". Verified LIVE with
-- curl before writing this.
--
-- blocked_users already references profiles by the same pattern, and its
-- embed works, so this follows it rather than inventing another shape.
--
-- Same constraint names on purpose: the client hint stays valid, so every
-- OTA already on phones starts working the moment PostgREST reloads. Every
-- profiles.id is an auth.users id (profiles_id_fkey, on delete cascade), so
-- the cascade semantics are unchanged. Checked before writing: 0 friendship
-- rows reference a user with no profile row, so the ALTER cannot fail on
-- data — and if it ever could, failing loudly here beats a 400 nobody reads.
-- ============================================================================

alter table public.friendships
  drop constraint friendships_requester_id_fkey,
  add constraint friendships_requester_id_fkey
    foreign key (requester_id) references public.profiles(id) on delete cascade;

alter table public.friendships
  drop constraint friendships_addressee_id_fkey,
  add constraint friendships_addressee_id_fkey
    foreign key (addressee_id) references public.profiles(id) on delete cascade;

-- feed_likes has the same shape and the same latent bug. Nothing embeds
-- through it today, so this is prevention rather than repair.
alter table public.feed_likes
  drop constraint feed_likes_user_id_fkey,
  add constraint feed_likes_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;

-- PostgREST caches relationships. Without this, the fix lands on the next
-- restart, whenever that is.
notify pgrst, 'reload schema';

do $$
declare r record;
begin
  for r in
    select conname, confrelid::regclass::text as ref
      from pg_constraint
     where conrelid = 'public.friendships'::regclass and contype = 'f'
  loop
    if r.ref <> 'profiles' then
      raise exception '0092: % still references %', r.conname, r.ref;
    end if;
  end loop;
  raise notice '0092: friendships now references profiles';
end $$;
