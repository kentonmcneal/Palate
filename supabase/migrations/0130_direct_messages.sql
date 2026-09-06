-- ============================================================================
-- 0130 — direct messages, between friends only.
-- ----------------------------------------------------------------------------
-- WHO CAN MESSAGE WHOM is the load-bearing decision, and it is answered from
-- this graph rather than by analogy to another app.
--
-- 0116 made follows unilateral on purpose: one tap, and the followee is never
-- asked. So a follow row records the FOLLOWER's intent and nothing whatever
-- about the followee. "You may message anyone you follow" therefore means
-- "anyone may message anyone, one tap away", and "anyone who follows you may
-- message you" is the same sentence backwards. Neither is a permission.
--
-- The only edge in this graph that required consent from BOTH people is a
-- mutual follow — are_friends(a, b). This repo has already litigated it: 0120
-- exists solely because 0116 mechanically treated a one-way follower as a
-- friend in three places, one of which handed a stranger somebody's visit
-- history. Applying that lesson here rather than relearning it.
--
-- Checked at SEND time, never at read time. A conversation that was legitimate
-- when it happened stays readable after an unfollow — deleting somebody's
-- history because they drifted apart would be a worse failure than the one
-- being prevented — but nothing new can be sent.
--
-- No message requests and no stranger tier in v1. All three independent
-- designs proposed one and all three judges cut it: signup is invite-only
-- with founder approval, so a stranger tier admits nobody he did not already
-- approve. It buys no reach and doubles the surface.
-- ============================================================================

create table if not exists public.dm_threads (
  id              uuid primary key default gen_random_uuid(),
  -- Ids in canonical order so the unique constraint genuinely means "one
  -- thread per pair" and two people tapping Message simultaneously cannot
  -- create two.
  user_a          uuid not null references public.profiles(id) on delete cascade,
  user_b          uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  last_preview    text,
  last_sender_id  uuid references public.profiles(id) on delete set null,
  constraint dm_threads_ordered check (user_a < user_b),
  constraint dm_threads_pair unique (user_a, user_b)
);
create index if not exists dm_threads_a_idx on public.dm_threads (user_a, last_message_at desc nulls last);
create index if not exists dm_threads_b_idx on public.dm_threads (user_b, last_message_at desc nulls last);

create table if not exists public.dm_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.dm_threads(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint dm_messages_body_len check (char_length(body) between 1 and 2000)
);
create index if not exists dm_messages_thread_idx on public.dm_messages (thread_id, created_at desc);

-- Read position per person per thread, so an unread count is an index lookup
-- rather than a scan of everything they have ever received.
create table if not exists public.dm_reads (
  thread_id uuid not null references public.dm_threads(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.dm_threads  enable row level security;
alter table public.dm_messages enable row level security;
alter table public.dm_reads    enable row level security;

-- No policy grants a write anywhere. Every mutation goes through a definer RPC
-- so the permission check sits in exactly one place and a client cannot route
-- around it. Reads are participant-only, which is what lets Realtime work.
revoke all on public.dm_threads, public.dm_messages, public.dm_reads from anon;
grant select on public.dm_threads, public.dm_messages, public.dm_reads to authenticated;

drop policy if exists "dm_threads: participants read" on public.dm_threads;
create policy "dm_threads: participants read" on public.dm_threads for select to authenticated
  using (auth.uid() in (user_a, user_b));

drop policy if exists "dm_messages: participants read" on public.dm_messages;
create policy "dm_messages: participants read" on public.dm_messages for select to authenticated
  using (exists (
    select 1 from public.dm_threads t
     where t.id = thread_id and auth.uid() in (t.user_a, t.user_b)
  ));

drop policy if exists "dm_reads: own" on public.dm_reads;
create policy "dm_reads: own" on public.dm_reads for select to authenticated
  using (auth.uid() = user_id);

-- ---- the one door --------------------------------------------------------
create or replace function public.dm_send(p_to uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid;
  tid uuid;
  msg uuid;
  clean text := btrim(coalesce(p_body, ''));
  recent int;
begin
  if me is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'no recipient' using errcode = '22023'; end if;
  if clean = '' then raise exception 'empty message' using errcode = '22023'; end if;
  if char_length(clean) > 2000 then raise exception 'message too long' using errcode = '22023'; end if;

  -- One kill switch, flipped from Profile → Admin without a deploy.
  if not coalesce((select enabled from public.feature_flags where key = 'direct_messages'), false) then
    raise exception 'messaging is off' using errcode = '42501';
  end if;

  if public.is_blocked_either_way(me, p_to) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- THE PERMISSION. Mutual follow, evaluated now.
  if not public.are_friends(me, p_to) then
    raise exception 'you can only message people who follow you back' using errcode = '42501';
  end if;

  -- A ceiling, so a compromised or malfunctioning client cannot flood one
  -- person. Generous enough that a real conversation never touches it.
  select count(*) into recent from public.dm_messages
   where sender_id = me and created_at > now() - interval '1 hour';
  if recent >= 120 then
    raise exception 'slow down' using errcode = '42901';
  end if;

  a := least(me, p_to);
  b := greatest(me, p_to);

  insert into public.dm_threads (user_a, user_b) values (a, b)
  on conflict (user_a, user_b) do nothing;
  select t.id into tid from public.dm_threads t where t.user_a = a and t.user_b = b;

  insert into public.dm_messages (thread_id, sender_id, body)
       values (tid, me, clean)
    returning dm_messages.id into msg;

  update public.dm_threads
     set last_message_at = now(),
         last_preview = left(clean, 140),
         last_sender_id = me
   where dm_threads.id = tid;

  -- The sender has by definition read their own message.
  insert into public.dm_reads (thread_id, user_id, read_at) values (tid, me, now())
  on conflict (thread_id, user_id) do update set read_at = now();

  -- Notify, through the same outbox as everything else. send-push gives direct
  -- types their own daily ceiling, because a message from a person is not
  -- ambient activity and was being deferred behind "somebody joined".
  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select p_to,
         coalesce(sender.display_name, sender.username, 'Someone'),
         left(clean, 140),
         jsonb_build_object('type', 'dm_message', 'thread_id', tid, 'user_id', me),
         public.next_sendable_at(recipient.timezone),
         -- One buzz per thread per hour. A rapid exchange should not be a
         -- rapid series of notifications.
         'dm:' || tid::text || ':' || to_char(now(), 'YYYYMMDDHH24'),
         now() + interval '24 hours'
    from public.profiles sender, public.profiles recipient
   where sender.id = me and recipient.id = p_to
     and recipient.push_social_activity
     and recipient.push_token is not null
     and public.next_sendable_at(recipient.timezone) is not null
  on conflict (user_id, dedupe_key) do nothing;

  return msg;
end $$;
revoke all on function public.dm_send(uuid, text) from public, anon;
grant execute on function public.dm_send(uuid, text) to authenticated;

-- ---- reading -------------------------------------------------------------
create or replace function public.dm_threads_list()
returns table (
  thread_id uuid, other_id uuid, other_name text, other_username text,
  other_avatar text, last_preview text, last_message_at timestamptz,
  last_sender_id uuid, unread integer
)
language sql stable security definer set search_path = public as $$
  select t.id,
         p.id, p.display_name, p.username, p.avatar_url,
         t.last_preview, t.last_message_at, t.last_sender_id,
         (select count(*)::int from public.dm_messages m
           where m.thread_id = t.id
             and m.sender_id <> auth.uid()
             and m.created_at > coalesce(
               (select r.read_at from public.dm_reads r
                 where r.thread_id = t.id and r.user_id = auth.uid()),
               '-infinity'::timestamptz))
    from public.dm_threads t
    join public.profiles p
      on p.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
   where auth.uid() is not null
     and auth.uid() in (t.user_a, t.user_b)
     and t.last_message_at is not null
     and not public.is_blocked_either_way(auth.uid(), p.id)
   order by t.last_message_at desc;
$$;
revoke all on function public.dm_threads_list() from public, anon;
grant execute on function public.dm_threads_list() to authenticated;

create or replace function public.dm_mark_read(p_thread uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if not exists (
    select 1 from public.dm_threads t
     where t.id = p_thread and me in (t.user_a, t.user_b)
  ) then return; end if;
  insert into public.dm_reads (thread_id, user_id, read_at) values (p_thread, me, now())
  on conflict (thread_id, user_id) do update set read_at = now();
end $$;
revoke all on function public.dm_mark_read(uuid) from public, anon;
grant execute on function public.dm_mark_read(uuid) to authenticated;

create or replace function public.dm_unread_total()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(unread), 0)::int from public.dm_threads_list();
$$;
revoke all on function public.dm_unread_total() from public, anon;
grant execute on function public.dm_unread_total() to authenticated;

-- Off until the founder turns it on, like every other social switch.
insert into public.feature_flags (key, enabled)
values ('direct_messages', false)
on conflict (key) do nothing;

-- ---- proofs --------------------------------------------------------------
do $$
declare a uuid; b uuid; c uuid; n int; mid uuid; had_flag boolean;
begin
  -- unauthenticated reaches nothing
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.dm_threads_list();
  if n <> 0 then raise exception '0130: signed-out caller listed threads'; end if;

  select id into a from public.profiles where display_name = 'Kenton M';
  select id into b from public.profiles where display_name = 'mcldkt';
  select id into c from public.profiles where display_name = 'Taylor M.';
  if a is null or b is null or c is null then
    raise notice '0130: fresh database — conversation proofs skipped';
    return;
  end if;

  select enabled into had_flag from public.feature_flags where key = 'direct_messages';
  update public.feature_flags set enabled = true where key = 'direct_messages';

  perform set_config('request.jwt.claims', json_build_object('sub', a::text)::text, true);

  -- a and b are mutual (0116). This must work.
  if not public.are_friends(a, b) then
    raise exception '0130: expected Kenton and mcldkt to be mutual follows';
  end if;
  mid := public.dm_send(b, '0130 self-test');
  if mid is null then raise exception '0130: a friend could not send'; end if;

  -- a follows c one way. This must NOT work, and that is the whole design.
  begin
    perform public.dm_send(c, 'should never arrive');
    raise exception '0130: a ONE-WAY follow was allowed to send a message';
  exception when insufficient_privilege then
    null; -- correct
  end;

  -- the recipient sees it, with an unread count
  perform set_config('request.jwt.claims', json_build_object('sub', b::text)::text, true);
  select count(*) into n from public.dm_threads_list() where other_id = a and unread >= 1;
  if n <> 1 then raise exception '0130: the recipient does not see one unread thread (%)', n; end if;

  -- A third party sees nothing of it.
  --
  -- The role switch is load-bearing and the first version of this proof did
  -- not have it: a do-block runs as the migration owner, which BYPASSES RLS,
  -- so a bare select here reads every row and proves nothing about the policy.
  -- It reported a leak that was really the test being wrong, which is the
  -- better direction for a test to fail in.
  perform set_config('request.jwt.claims', json_build_object('sub', c::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.dm_messages;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception '0130: a non-participant read % messages', n; end if;

  select count(*) into n from public.dm_threads_list();
  if n <> 0 then raise exception '0130: a non-participant listed a thread'; end if;

  -- And the participant CAN read, through the same policy. A policy that
  -- denies everybody would pass the test above and break the product.
  perform set_config('request.jwt.claims', json_build_object('sub', b::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.dm_messages;
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception '0130: a participant read % messages, expected 1', n; end if;

  -- marking read clears it
  perform set_config('request.jwt.claims', json_build_object('sub', b::text)::text, true);
  perform public.dm_mark_read((select thread_id from public.dm_threads_list() where other_id = a));
  if public.dm_unread_total() <> 0 then raise exception '0130: mark_read left an unread'; end if;

  -- clean up entirely
  perform set_config('request.jwt.claims', null, true);
  delete from public.push_outbox where data->>'type' = 'dm_message';
  delete from public.dm_threads where user_a = least(a,b) and user_b = greatest(a,b);
  update public.feature_flags set enabled = coalesce(had_flag, false) where key = 'direct_messages';
  raise notice '0130: friends can message, one-way follows cannot, third parties see nothing';
end $$;
