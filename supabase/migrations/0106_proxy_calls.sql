-- ============================================================================
-- 0106_proxy_calls.sql — one row per Google-backed places-proxy call, per user.
-- ----------------------------------------------------------------------------
-- The proxy's per-user rate limit counted location_events, which nothing
-- writes, so no account had a cap on Google spend. This is the table it
-- counts now. Service role only; the client never touches it. Rows older
-- than two days are useless and are pruned nightly.
-- ============================================================================
create table if not exists public.proxy_calls (
  user_id   uuid not null,
  action    text not null,
  called_at timestamptz not null default now()
);
create index if not exists proxy_calls_user_time on public.proxy_calls (user_id, called_at desc);
alter table public.proxy_calls enable row level security;
revoke all on public.proxy_calls from anon, authenticated, public;

create or replace function public.prune_proxy_calls() returns integer
language sql security definer set search_path = public as $$
  with d as (delete from public.proxy_calls where called_at < now() - interval '2 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.prune_proxy_calls() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'prune_proxy_calls';
select cron.schedule('prune_proxy_calls', '15 3 * * *', 'select public.prune_proxy_calls();');
