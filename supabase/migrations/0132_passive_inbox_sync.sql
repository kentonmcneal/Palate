-- ============================================================================
-- 0132 — the pending inbox survives a reinstall.
-- ----------------------------------------------------------------------------
-- Everything in the passive pipeline lives in AsyncStorage and nowhere else:
-- the inbox of detected visits awaiting confirmation, the retry queue, the
-- lock-screen answers not yet written, and the 500-point cluster history that
-- teaches the app where somebody lives and works.
--
-- Confirmed visits are safe — they are rows in public.visits. Everything
-- BEFORE confirmation is one app deletion from gone, silently. A tester who
-- reinstalls and loses three days of pending confirmations reports it as "the
-- app forgot everything", and they are right.
--
-- WHAT IS SYNCED, and what deliberately is not.
--
-- Synced: the RESOLVED venue, its alternates, and the detection metadata —
-- dwell, accuracy, confidence, candidate count. Every coordinate in that
-- payload belongs to a RESTAURANT and is already public data in
-- public.restaurants.
--
-- Not synced, ever: the raw location trail. `palate.passive.queue`,
-- `retryQueue` and `clusterHistory` hold unresolved lat/lng — where a person
-- actually stood, including their home and their office. That stays on the
-- device. The privacy property of this product is that raw location never
-- leaves the phone until the user has said "yes, I ate there", and a backup is
-- not a good enough reason to break it. The cost is that home/work suppression
-- relearns after a reinstall, which takes three overnight stays.
--
-- The device stays the source of truth: it writes offline, in the background,
-- with no network. This is a mirror, and it is read only when the local inbox
-- is empty — which is exactly the reinstall case.
-- ============================================================================

create table if not exists public.passive_inbox (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  -- The client's own entry id, so a mirror is idempotent and a re-sync of the
  -- same detection cannot produce a duplicate prompt.
  entry_id    text not null,
  payload     jsonb not null,
  detected_at timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, entry_id)
);
create index if not exists passive_inbox_user_idx
  on public.passive_inbox (user_id, detected_at desc);

alter table public.passive_inbox enable row level security;
revoke all on public.passive_inbox from anon;
grant select, insert, update, delete on public.passive_inbox to authenticated;

-- Own rows, all four verbs. There is no cross-user read of this table at any
-- privilege level, and no definer RPC that could become one: an inbox is a
-- list of places somebody has been and has not yet decided to admit to.
drop policy if exists "passive_inbox: own rows" on public.passive_inbox;
create policy "passive_inbox: own rows" on public.passive_inbox
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Entries expire from the device at 48 hours (INBOX_EXPIRY_HOURS). The mirror
-- keeps a little longer so a reinstall inside the window still recovers them,
-- and then lets them go — an unconfirmed detection nobody answered in a week
-- is not going to be answered.
create or replace function public.prune_passive_inbox()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.passive_inbox where detected_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.prune_passive_inbox() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'prune_passive_inbox';
select cron.schedule('prune_passive_inbox', '25 3 * * *', 'select public.prune_passive_inbox();');

-- ---- proofs --------------------------------------------------------------
do $$
declare a uuid; b uuid; n int;
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.passive_inbox;
    perform set_config('role', 'postgres', true);
    if n <> 0 then raise exception '0132: anon read the inbox'; end if;
  exception when insufficient_privilege then
    perform set_config('role', 'postgres', true);
  end;

  select id into a from public.profiles where display_name = 'Kenton M';
  select id into b from public.profiles where id <> a limit 1;
  if a is null or b is null then
    raise notice '0132: fresh database — isolation proof skipped';
    return;
  end if;

  insert into public.passive_inbox (user_id, entry_id, payload, detected_at)
  values (a, '0132-self-test', '{"name":"self test"}'::jsonb, now());

  -- The owner reads it THROUGH the policy, not as superuser.
  perform set_config('request.jwt.claims', json_build_object('sub', a::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.passive_inbox where entry_id = '0132-self-test';
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception '0132: the owner cannot read their own inbox (%)', n; end if;

  -- And nobody else can, at all.
  perform set_config('request.jwt.claims', json_build_object('sub', b::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.passive_inbox;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception '0132: another user read % inbox rows', n; end if;

  -- The mirror must be idempotent: the same detection synced twice is one row.
  insert into public.passive_inbox (user_id, entry_id, payload, detected_at)
  values (a, '0132-self-test', '{"name":"again"}'::jsonb, now())
  on conflict (user_id, entry_id) do update set payload = excluded.payload;
  select count(*) into n from public.passive_inbox where entry_id = '0132-self-test';
  if n <> 1 then raise exception '0132: re-syncing produced % rows', n; end if;

  delete from public.passive_inbox where entry_id = '0132-self-test';
  perform set_config('request.jwt.claims', null, true);
  raise notice '0132: own rows only, and re-syncing is idempotent';
end $$;
