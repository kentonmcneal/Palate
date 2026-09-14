-- ============================================================================
-- 0171 — a private profile's visits must not broadcast.
-- ----------------------------------------------------------------------------
-- 0057 set the contract in as many words: what arrives on YOUR phone is
-- governed by the notification toggle, and what you BROADCAST is governed
-- separately by profile_visibility — "a private profile joins quietly, its
-- Wrapped is not announced, and its visits do not reach friends". Keeping those
-- two apart is what lets the toggle default ON without deciding anyone's
-- privacy for them.
--
-- 0057 and 0093 both implemented it here: read the actor's visibility
-- alongside their name, and return early when it is 'private'. 0162 rewrote
-- this function and dropped the check. 0170 — mine, an hour ago — restored the
-- right toggle and the right social graph but reproduced 0162's body
-- faithfully, including the omission. Carrying a fix forward is not the same
-- as reading what it replaced.
--
-- Every other broadcast trigger still gates on it: enqueue_join_push,
-- enqueue_join_push_on_insert, enqueue_wrapped_push, enqueue_follow_push.
-- friend_visit was the only one that lost it, which is why nothing else caught
-- the change.
--
-- NOTHING HAS LEAKED. There is one private account and it currently has zero
-- followers, so the gate has not yet had anything to stop. This closes it
-- before it does, rather than after.
--
-- 0162's other two properties — the per-day dedupe and the deliberately vague
-- body — are correct and are preserved. The vagueness is not a substitute for
-- this gate: "someone ate somewhere new" still announces that a private person
-- went out, to an audience they did not individually approve.
-- ============================================================================

create or replace function public.enqueue_friend_visit_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  actor_vis  text;
  place_name text;
begin
  select coalesce(display_name, split_part(email, '@', 1), 'A friend'),
         coalesce(profile_visibility, 'friends')
    into actor_name, actor_vis
    from public.profiles where id = new.user_id;

  -- What you broadcast is yours to decide. See the header.
  if actor_vis = 'private' then
    return new;
  end if;

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
    -- One per recipient per ACTOR per THEIR OWN LOCAL DAY.
    'friend_visit:' || new.user_id::text || ':'
      || (timezone(coalesce(p.timezone, 'UTC'), now()))::date::text
  from public.follows f
  join public.profiles p on p.id = f.follower_id
  where f.followee_id = new.user_id
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(p.id, new.user_id)
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end $$;

-- ---- proofs ----------------------------------------------------------------
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='enqueue_friend_visit_push';
  -- Strip comments: the body explains the retired column and the private gate
  -- in prose, and a guard that trips on its own documentation is one nobody
  -- keeps. 0170 learned this the hard way.
  def := regexp_replace(def, '--[^\n]*', '', 'g');

  if not (def ~ 'profile_visibility') then
    raise exception '0171: the actor visibility gate is still missing';
  end if;
  if not (def ~ 'actor_vis = ''private''') then
    raise exception '0171: does not return early for a private actor';
  end if;
  -- Everything 0170 and 0162 established has to survive this rewrite too.
  if def ~ 'push_friend_activity' then
    raise exception '0171: regressed to the retired push_friend_activity';
  end if;
  if not (def ~ 'push_social_activity') then
    raise exception '0171: lost the push_social_activity gate';
  end if;
  if def ~ 'public\.friendships' then
    raise exception '0171: regressed to the retired friendships table';
  end if;
  if not (def ~ 'public\.follows') then
    raise exception '0171: lost the follows graph';
  end if;
  if not (def ~ 'is_blocked_either_way') then
    raise exception '0171: lost the block check';
  end if;
  if def ~ 'ate at ' then
    raise exception '0171: the body names the venue again';
  end if;
  if not (def ~ 'on conflict \(user_id, dedupe_key\) do nothing') then
    raise exception '0171: lost the per-day dedupe';
  end if;
end $$;
