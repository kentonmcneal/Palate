-- ============================================================================
-- 0170 — the friend-visit push could not reach anybody.
-- ----------------------------------------------------------------------------
-- 0162 was written last night to satisfy a direct request: one notification
-- when a friend confirms a visit, saying they ate somewhere new rather than
-- naming the venue. Its dedupe change and its vague body are both right and
-- are preserved here verbatim. Its recipient query is not, and the result was
-- that the feature it was fixing became impossible to deliver.
--
-- TWO FAULTS, both in the FROM/WHERE.
--
-- 1. THE WRONG TOGGLE. 0055 gated this on profiles.push_friend_activity.
--    0057 replaced that with push_social_activity — "one receive toggle
--    covering all three events" — and migrated the values across. 0093 kept
--    the new column. 0162 rewrote the function and silently reverted to the
--    OLD one.
--
--    Measured, not assumed: push_social_activity is default TRUE and true for
--    all 19 accounts; push_friend_activity is default FALSE and false for all
--    19. So `where p.push_friend_activity` matched nobody, and no friend-visit
--    push has been enqueueable since 0162 applied. enqueue_follow_push, the
--    other live social trigger, was already on push_social_activity — this
--    function was the only one left on the dead column.
--
-- 2. THE WRONG GRAPH. It reads public.friendships, which 0116 retired in
--    favour of follows and left in place "unread, so this is reversible for
--    one release". friendships holds 3 rows, 1 accepted, newest 2026-09-05;
--    follows holds 15, newest 2026-09-13. Every other social trigger and
--    notify-feed-post moved to follows. This one did not, so even with the
--    right toggle it would fan out over a table nothing writes to any more.
--
-- Audience is FOLLOWERS of the actor, matching notify-feed-post and
-- enqueue_follow_push: a post reaches whoever chose to hear about it. That is
-- a one-way relationship, which is exactly why 0162's vagueness matters and is
-- kept — the push says somewhere new, never where, so it does not broadcast a
-- named person's real-time location to a lock screen. The block check stays.
--
-- Eligible recipients after this: 3. Before: 0.
-- ============================================================================

create or replace function public.enqueue_friend_visit_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  place_name text;
begin
  select coalesce(display_name, split_part(email, '@', 1), 'A friend')
    into actor_name
    from public.profiles where id = new.user_id;

  -- Still required: a visit we cannot name a venue for is not worth a push.
  select name into place_name
    from public.restaurants where id = new.restaurant_id;
  if place_name is null then
    return new;
  end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key)
  select
    f.follower_id,
    actor_name || ' ate somewhere new',
    -- Deliberately vague. See 0162: this lands on a lock screen, in front of
    -- whoever is holding the phone.
    'Open Palate to see where.',
    jsonb_build_object('type', 'friend_visit', 'user_id', new.user_id),
    public.next_sendable_at(p.timezone),
    -- One per recipient per ACTOR per THEIR OWN LOCAL DAY. The recipient's
    -- timezone, not the server's: the day has to be the one they are living
    -- in, or a late dinner counts against tomorrow.
    'friend_visit:' || new.user_id::text || ':'
      || (timezone(coalesce(p.timezone, 'UTC'), now()))::date::text
  from public.follows f
  join public.profiles p on p.id = f.follower_id
  where f.followee_id = new.user_id
    -- The live toggle. push_friend_activity was retired by 0057.
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(p.id, new.user_id)
  -- Per-day key, so the SECOND meal of the day hits this and is dropped
  -- rather than queued.
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end $$;

-- ---- proofs ----------------------------------------------------------------
-- plpgsql parses a body at RUNTIME, so a clean push proves only that the text
-- was stored. These read the LIVE definition and the LIVE data.
do $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='enqueue_friend_visit_push';

  -- Strip -- comments before matching. The body explains WHY the retired
  -- column is retired, and naming it in prose made the first version of this
  -- check fail on its own documentation. A guard that trips on its own
  -- comments is a guard nobody keeps.
  def := regexp_replace(def, '--[^\n]*', '', 'g');

  if def ~ 'push_friend_activity' then
    raise exception '0170: still gated on the retired push_friend_activity column';
  end if;
  if not (def ~ 'push_social_activity') then
    raise exception '0170: not gated on push_social_activity';
  end if;
  if def ~ 'public\.friendships|from friendships' then
    raise exception '0170: still reading the retired friendships table';
  end if;
  if not (def ~ 'public\.follows') then
    raise exception '0170: not reading follows';
  end if;
  -- The safety properties 0162 established must survive this rewrite.
  if not (def ~ 'is_blocked_either_way') then
    raise exception '0170: lost the block check';
  end if;
  if def ~ 'ate at ' then
    raise exception '0170: the body names the venue again';
  end if;
  if not (def ~ 'on conflict \(user_id, dedupe_key\) do nothing') then
    raise exception '0170: lost the per-day dedupe';
  end if;

  -- And the point of the exercise: somebody can now actually receive one.
  select count(distinct p.id) into n
    from public.follows f join public.profiles p on p.id = f.follower_id
   where p.push_social_activity and p.push_token is not null;
  if n = 0 then
    raise exception '0170: still nobody eligible to receive a friend-visit push';
  end if;
  raise notice '0170: % follower(s) eligible', n;
end $$;
