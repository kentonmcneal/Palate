-- ============================================================================
-- 0055_push_outbox.sql — durable server push.
-- ----------------------------------------------------------------------------
-- registerPushToken() has been writing Expo push tokens to profiles.push_token
-- on every launch since build 14. Nothing has ever read them. This is the read
-- side, and it unlocks two things local notifications cannot do:
--
--   1. The guard that could not be built. The weekly discovery nudges are LOCAL
--      notifications, and an OS-scheduled local notification cannot be
--      conditioned on state at fire time — "skip this if they already logged a
--      visit in the last two hours" is unenforceable locally. Server-side it is
--      a WHERE clause.
--
--   2. Friend activity. "Marcus just logged Saté" is a better reason to open the
--      app than anything we can say about ourselves, and it is the only
--      notification that gets MORE valuable as the user base grows.
--
-- An outbox rather than fire-and-forget: a push that fails at 7pm should be
-- visible at 9pm, not gone. Expo's push service is free, so the only cost here
-- is Supabase rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Timezone, so quiet hours can mean anything
-- ----------------------------------------------------------------------------
-- Quiet hours are a promise about the RECIPIENT's night, and the server has no
-- idea when that is. The client sets this from Intl.DateTimeFormat(). Until it
-- does, proactive push to that user is skipped entirely — failing closed,
-- because the failure mode is buzzing someone at 3am.
alter table public.profiles
  add column if not exists timezone text,
  add column if not exists push_friend_activity boolean not null default false;

comment on column public.profiles.timezone is
  'IANA zone from the client (Intl.DateTimeFormat().resolvedOptions().timeZone). Null means proactive push is skipped for this user — quiet hours cannot be honoured without it.';
comment on column public.profiles.push_friend_activity is
  'Opt-in for "a friend logged a visit" pushes. Default FALSE on purpose: telling your friends where you eat is a choice, not a default.';

-- ----------------------------------------------------------------------------
-- 2. The outbox
-- ----------------------------------------------------------------------------
create table if not exists public.push_outbox (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  title        text        not null,
  body         text        not null,
  data         jsonb       not null default '{}'::jsonb,
  /** Earliest send time. Quiet hours are enforced by pushing this forward. */
  send_after   timestamptz not null default now(),
  sent_at      timestamptz,
  error        text,
  attempts     integer     not null default 0,
  /** Dedupe key: one row per (user, event). Stops a retried trigger or a
   *  double-logged visit from buzzing someone twice for the same thing. */
  dedupe_key   text        not null,
  created_at   timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists push_outbox_pending_idx
  on public.push_outbox (send_after)
  where sent_at is null;

alter table public.push_outbox enable row level security;
-- Service-role only: the sender function drains it. No client policy, and RLS
-- denies by default.
revoke all on public.push_outbox from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Quiet hours
-- ----------------------------------------------------------------------------
-- Returns the earliest instant at or after `from_ts` that falls inside the
-- recipient's waking hours. Null timezone => null, and the caller must not send.
create or replace function public.next_sendable_at(
  p_timezone text,
  from_ts timestamptz default now()
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  local_ts timestamp;
  local_hour integer;
begin
  if p_timezone is null or p_timezone = '' then
    return null;
  end if;

  begin
    local_ts := from_ts at time zone p_timezone;
  exception when others then
    -- Unrecognised zone string: treat as unknown rather than guessing UTC.
    return null;
  end;

  local_hour := extract(hour from local_ts);

  -- Quiet 22:00-08:00 local, matching the local-notification schedule.
  if local_hour >= 22 then
    return ((date_trunc('day', local_ts) + interval '1 day 8 hours') at time zone p_timezone);
  elsif local_hour < 8 then
    return ((date_trunc('day', local_ts) + interval '8 hours') at time zone p_timezone);
  end if;

  return from_ts;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Friend activity
-- ----------------------------------------------------------------------------
-- Enqueue for every accepted friend who opted in, has a token, and has a
-- timezone we can honour. Deliberately does NOT notify the visitor.
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
  where p.push_friend_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

drop trigger if exists visits_enqueue_friend_push on public.visits;
create trigger visits_enqueue_friend_push
  after insert on public.visits
  for each row execute function public.enqueue_friend_visit_push();

-- ----------------------------------------------------------------------------
-- 5. Kill switch — ships OFF, like every flag here
-- ----------------------------------------------------------------------------
insert into public.feature_flags (key, enabled, description)
values (
  'server_push',
  false,
  'Master switch for server-sent push (friend activity + any future server nudge). The send-push function refuses to send while this is false.'
)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 6. The drain schedule — WRITTEN, NOT SCHEDULED
-- ----------------------------------------------------------------------------
-- Uncommenting this starts recurring invocations. That is a spending decision
-- and a "we are now messaging real people" decision, so it belongs to a human.
-- Follow the pattern set by 0051.
--
-- select cron.schedule(
--   'drain-push-outbox',
--   '*/5 * * * *',
--   $$ select net.http_post(
--        url := 'https://<project-ref>.supabase.co/functions/v1/send-push',
--        headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
--      ) $$
-- );
