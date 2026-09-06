-- ============================================================================
-- 0129 — being followed is worth knowing about.
-- ----------------------------------------------------------------------------
-- Following is the whole social graph now (0116), and it happens silently.
-- Somebody follows you and you find out never — which also means you never
-- follow back, and a reciprocal follow is what the app calls a friendship.
-- The single most likely moment a person has to make a connection was passing
-- unannounced.
--
-- Same outbox every other social push uses: quiet hours through
-- next_sendable_at, the push_social_activity preference, a dedupe key so a
-- follow/unfollow/refollow loop cannot buzz somebody repeatedly, and an expiry
-- so a stale one never lands days later.
--
-- The copy says which of the two states it is, because "X followed you" and
-- "you two are now friends" are different events and only one needs an action.
-- ============================================================================

create or replace function public.enqueue_follow_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  follower_name text;
  follower_vis text;
  mutual boolean;
begin
  select coalesce(display_name, username, 'Someone'), coalesce(profile_visibility, 'public')
    into follower_name, follower_vis
    from public.profiles where id = new.follower_id;

  -- A private account following you is not an introduction; naming them would
  -- disclose an account they have chosen to keep unlisted.
  if follower_vis = 'private' then return new; end if;

  mutual := exists (
    select 1 from public.follows
     where follower_id = new.followee_id and followee_id = new.follower_id
  );

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select new.followee_id,
    case when mutual
      then follower_name || ' followed you back'
      else follower_name || ' followed you' end,
    case when mutual
      then 'You are friends now. Their visits show up in your feed.'
      else 'Follow back to see each other''s visits.' end,
    jsonb_build_object('type', 'new_follower', 'user_id', new.follower_id, 'mutual', mutual),
    public.next_sendable_at(p.timezone),
    -- One notification per pair per direction, ever. Unfollowing and following
    -- again must not be a way to buzz somebody.
    'follow:' || new.follower_id::text || ':' || new.followee_id::text,
    now() + interval '48 hours'
  from public.profiles p
  where p.id = new.followee_id
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(new.follower_id, new.followee_id)
  on conflict (user_id, dedupe_key) do nothing;

  return new;
exception when others then
  -- Following someone must never fail because the notification did.
  return new;
end $$;

drop trigger if exists follows_enqueue_push on public.follows;
create trigger follows_enqueue_push
  after insert on public.follows
  for each row execute function public.enqueue_follow_push();

-- ---- proofs --------------------------------------------------------------
do $$
declare a uuid; b uuid; n int; had boolean;
begin
  select id into a from public.profiles where display_name = 'Kenton M';
  select id into b from public.profiles where display_name = 'Taylor M.';
  if a is null or b is null then
    raise notice '0129: fresh database — proofs skipped';
    return;
  end if;

  -- Remember the real state so the proof leaves nothing behind.
  had := exists (select 1 from public.follows where follower_id = b and followee_id = a);
  delete from public.push_outbox where dedupe_key = 'follow:' || b::text || ':' || a::text;
  delete from public.follows where follower_id = b and followee_id = a;

  insert into public.follows (follower_id, followee_id) values (b, a);
  select count(*) into n from public.push_outbox
   where user_id = a and dedupe_key = 'follow:' || b::text || ':' || a::text;
  if n <> 1 then
    raise exception '0129: a follow produced % outbox rows, expected 1', n;
  end if;

  -- The insert must be idempotent against the dedupe key: unfollow, refollow,
  -- and nobody gets buzzed twice.
  delete from public.follows where follower_id = b and followee_id = a;
  insert into public.follows (follower_id, followee_id) values (b, a);
  select count(*) into n from public.push_outbox
   where user_id = a and dedupe_key = 'follow:' || b::text || ':' || a::text;
  if n <> 1 then
    raise exception '0129: refollowing queued a second notification (% rows)', n;
  end if;

  -- Clean up entirely, including the row we created.
  delete from public.push_outbox where dedupe_key = 'follow:' || b::text || ':' || a::text;
  if not had then
    delete from public.follows where follower_id = b and followee_id = a;
  end if;
  raise notice '0129: one notification per pair, and refollowing does not repeat it';
end $$;
