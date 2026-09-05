-- ============================================================================
-- 0087_email_sender_misses.sql — which platforms we are failing to read.
-- ----------------------------------------------------------------------------
-- "Are there other emails to add?" is currently unanswerable except by guessing
-- at brand names, and guessing is how the sender list got it wrong before: it
-- held exact no-reply@ addresses that matched nothing, so OpenTable, SevenRooms
-- and Square were fetched from a live inbox and parsed to zero for months.
--
-- The import loop already knows the answer and throws it away. Every message it
-- fetches and cannot parse increments a counter and moves on, so the sender of
-- a real receipt Palate could not read is discarded at the one moment it was in
-- hand. This records the DOMAIN only.
--
-- Domain only, deliberately. "opentable.com" says a platform is unhandled;
-- "OpenTable@em.opentable.com" adds nothing and starts storing fragments of
-- somebody's mail. No subject, no address, no user id — the question is which
-- platforms to support, not who eats where.
-- ============================================================================

create table if not exists public.email_sender_misses (
  domain      text primary key,
  seen_count  integer not null default 0,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

comment on table public.email_sender_misses is
  'Sender domains whose messages were fetched during Gmail import and could not '
  'be parsed. Domain and counts only — no addresses, subjects or user ids. '
  'Exists so "which platforms should we add?" is answered from evidence.';

alter table public.email_sender_misses enable row level security;

-- Written by the import function under the service role, which bypasses RLS.
-- No policy grants anyone else access: this is operational telemetry, and the
-- app has no reason to read it.
revoke all on table public.email_sender_misses from anon;
revoke all on table public.email_sender_misses from authenticated;

create or replace function public.record_sender_miss(p_domain text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.email_sender_misses (domain, seen_count)
  values (lower(trim(p_domain)), 1)
  on conflict (domain) do update
    set seen_count = public.email_sender_misses.seen_count + 1,
        last_seen  = now();
$$;

revoke all on function public.record_sender_miss(text) from public;
revoke all on function public.record_sender_miss(text) from anon;
revoke all on function public.record_sender_miss(text) from authenticated;
