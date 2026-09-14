-- ============================================================================
-- 0162 — one notification per friend per day, and it does not say where.
-- ----------------------------------------------------------------------------
-- Reported: Allyson went to two places and the founder was pinged twice, each
-- naming the venue. Two problems, and the second is the serious one.
--
-- VOLUME. enqueue_friend_visit_push dedupes on 'friend_visit:' || visit.id, so
-- the key is unique per VISIT. Three meals is three buzzes. The 3/day cap in
-- send-push bounds the total but does not stop one person's day filling
-- somebody else's entire allowance, which is worse than noise -- it crowds out
-- the evening digest, the only route a detected meal has to reach anyone.
--
-- SAFETY. The body read "<name> ate at <place>." pushed to everyone following
-- them. A push notification renders on a LOCKED SCREEN, to whoever is holding
-- the phone, and it broadcasts a named person's real-time location to an
-- audience they did not individually approve. Palate's whole passive-capture
-- design is careful about location -- raw GPS never leaves the device before
-- confirmation -- and then the social layer published the answer anyway.
--
-- So: one push per (recipient, actor, local day), and it says a new spot, not
-- which one. The feed still shows the place to people who go and look, which
-- is a pull the person controls rather than a push they cannot recall.
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
    f.friend_id,
    actor_name || ' ate somewhere new',
    -- Deliberately vague. See the header: this lands on a lock screen.
    'Open Palate to see where.',
    jsonb_build_object('type', 'friend_visit', 'user_id', new.user_id),
    public.next_sendable_at(p.timezone),
    -- One per recipient per ACTOR per THEIR OWN LOCAL DAY. The recipient's
    -- timezone, not the server's: the day has to be the one they are living
    -- in, or a late dinner counts against tomorrow.
    'friend_visit:' || new.user_id::text || ':'
      || (timezone(coalesce(p.timezone, 'UTC'), now()))::date::text
  from (
    select case when requester_id = new.user_id then addressee_id else requester_id end as friend_id
      from public.friendships
     where status = 'accepted'
       and (requester_id = new.user_id or addressee_id = new.user_id)
  ) f
  join public.profiles p on p.id = f.friend_id
  where p.push_friend_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(p.id, new.user_id)
  -- The dedupe key is now per-day, so the SECOND meal of the day hits this
  -- and is dropped rather than queued.
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname='enqueue_friend_visit_push';
  if position('ate at ' in src) > 0 then
    raise exception 'friend push still names the venue in its body';
  end if;
  if position('new.id::text' in src) > 0 then
    raise exception 'friend push is still keyed per visit, so it can fire more than once a day';
  end if;
  raise notice 'friend push: one per actor per local day, venue not named';
end $$;
