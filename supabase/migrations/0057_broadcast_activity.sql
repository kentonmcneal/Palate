-- ============================================================================
-- 0057_broadcast_activity.sql — app-wide activity push.
-- ----------------------------------------------------------------------------
-- Three events, two audiences, on purpose:
--
--   joined    → EVERYONE. A welcome. Rare, not sensitive, and it makes a small
--               app feel alive.
--   wrapped   → EVERYONE. Already a thing people share.
--   visit     → FRIENDS ONLY. Where someone eats and when is not a broadcast,
--               and profiles are public by default now, so "everyone" means
--               strangers. Friends-only is also what keeps it feeling like a
--               signal instead of spam.
--
-- THE FAN-OUT PROBLEM, handled rather than discovered later. "X got their
-- Wrapped" to everyone is N notifications per recipient per week — at 13 users
-- that's fine, at 300 it is 299 buzzes every Sunday and people disable
-- notifications permanently. Two guards:
--
--   • send-push already caps one proactive push per user per day.
--   • that cap DEFERS a row to tomorrow, which would build a permanent
--     backlog of stale news. So broadcast rows now carry expires_at and are
--     dropped instead. "Someone joined three days ago" is worth nothing;
--     a visit confirmation still is, and keeps its old behaviour.
-- ============================================================================

alter table public.push_outbox
  add column if not exists expires_at timestamptz;

comment on column public.push_outbox.expires_at is
  'Broadcast news is perishable. Past this, send-push drops the row instead of deferring it, so a rate-limited user does not receive a week-old backlog. Null = never expires (visit confirmations).';

-- One receive toggle covering all three events, as decided. Default ON: this
-- governs what arrives on YOUR phone, which is a notification preference. What
-- you BROADCAST is governed separately by profile_visibility, below.
alter table public.profiles
  add column if not exists push_social_activity boolean not null default true;

comment on column public.profiles.push_social_activity is
  'Receive activity push about other people (joins, Wrapped, friends visits). Default on — this is a notification preference, not a sharing one.';

-- Carry over anyone who already opted into friend activity, so an existing
-- choice is not silently widened or narrowed by the rename.
update public.profiles
   set push_social_activity = push_friend_activity
 where push_friend_activity is true;

-- ----------------------------------------------------------------------------
-- Shared helper: everyone who should hear about a public event
-- ----------------------------------------------------------------------------
create or replace function public.broadcast_recipients(p_actor uuid)
returns table (id uuid, timezone text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.timezone
    from public.profiles p
   where p.id <> p_actor
     and p.push_social_activity
     and p.push_token is not null
     and p.timezone is not null            -- no timezone, no quiet hours, no send
     and coalesce(p.approval_status, 'approved') = 'approved'
     and not exists (
       select 1 from public.blocked_users b
       where (b.blocker_id = p.id and b.blocked_id = p_actor)
          or (b.blocker_id = p_actor and b.blocked_id = p.id)
     );
$$;

-- ----------------------------------------------------------------------------
-- 1. Someone joined
-- ----------------------------------------------------------------------------
-- Fires on APPROVAL, not on row insert: signups land as 'pending' behind the
-- waitlist, and announcing someone who never gets in would be a lie.
create or replace function public.enqueue_join_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if coalesce(old.approval_status, '') = 'approved'
     or coalesce(new.approval_status, '') <> 'approved' then
    return new;
  end if;

  -- A private profile joins quietly.
  if coalesce(new.profile_visibility, 'friends') = 'private' then
    return new;
  end if;

  who := coalesce(new.display_name, new.username, 'Someone new');

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select
    r.id,
    who || ' joined Palate',
    'Say hi — see if your palates match.',
    jsonb_build_object('type', 'user_joined', 'user_id', new.id),
    public.next_sendable_at(r.timezone),
    'user_joined:' || new.id::text,
    now() + interval '3 days'
  from public.broadcast_recipients(new.id) r
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists profiles_enqueue_join_push on public.profiles;
create trigger profiles_enqueue_join_push
  after update of approval_status on public.profiles
  for each row execute function public.enqueue_join_push();

-- ----------------------------------------------------------------------------
-- 2. Someone's Wrapped is ready
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_wrapped_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
  vis text;
begin
  select coalesce(display_name, username, 'Someone'), coalesce(profile_visibility, 'friends')
    into who, vis
    from public.profiles where id = new.user_id;

  if vis = 'private' then
    return new;
  end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select
    r.id,
    who || '''s Wrapped is in',
    coalesce(new.personality_label, 'See how they ate') || ' this week.',
    jsonb_build_object('type', 'user_wrapped', 'user_id', new.user_id, 'wrapped_id', new.id),
    public.next_sendable_at(r.timezone),
    'user_wrapped:' || new.id::text,
    -- Perishable by definition: a Wrapped is about one week.
    now() + interval '3 days'
  from public.broadcast_recipients(new.user_id) r
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists weekly_wrapped_enqueue_push on public.weekly_wrapped;
create trigger weekly_wrapped_enqueue_push
  after insert on public.weekly_wrapped
  for each row execute function public.enqueue_wrapped_push();

-- ----------------------------------------------------------------------------
-- 3. A friend logged a visit — rescoped, not rewritten
-- ----------------------------------------------------------------------------
-- Two changes from 0055: it reads the new single toggle, and it now respects
-- the ACTOR's visibility. Previously any visit notified friends regardless of
-- whether the person who ate wanted that announced — the recipient had a
-- setting, the subject didn't.
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

  if actor_vis = 'private' then
    return new;
  end if;

  select name into place_name
    from public.restaurants where id = new.restaurant_id;

  if place_name is null then
    return new;
  end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key)
  select
    f.friend_id,
    actor_name || ' just logged a visit',
    actor_name || ' ate at ' || place_name || '.',
    jsonb_build_object('type', 'friend_visit', 'visit_id', new.id, 'user_id', new.user_id),
    public.next_sendable_at(p.timezone),
    'friend_visit:' || new.id::text
  from (
    select case when requester_id = new.user_id then addressee_id else requester_id end as friend_id
      from public.friendships
     where status = 'accepted'
       and (requester_id = new.user_id or addressee_id = new.user_id)
  ) f
  join public.profiles p on p.id = f.friend_id
  where p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;
