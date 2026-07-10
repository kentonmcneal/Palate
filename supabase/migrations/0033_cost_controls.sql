-- ============================================================================
-- 0033_cost_controls.sql
-- ----------------------------------------------------------------------------
-- Phase 1 cost controls for places-proxy:
--   1. A per-day counter of *billable* Google Places calls, with a kill-switch
--      flag. When today's count hits the cap, the proxy serves cached/DB
--      results instead of calling Google until the next UTC day.
--   2. Lightweight telemetry: per-day tally of proxy activity by action and
--      source (google = billable fetch, cache = served free from the DB), so
--      the cost forecast becomes real data.
--
-- Both tables are server-only. RLS is enabled with NO policies, so anon/auth
-- clients can't read or write them; places-proxy uses the service-role key,
-- which bypasses RLS.
-- ============================================================================

-- 1. Billable-call counter + alert state. One row per UTC day; the day itself
--    is the natural reset (a new day inserts a fresh zeroed row).
create table if not exists public.google_usage_counter (
  day            date primary key,
  billable_calls integer     not null default 0,
  warned         boolean     not null default false, -- 80% warning push sent
  tripped        boolean     not null default false, -- cap reached; degrade mode
  updated_at     timestamptz not null default now()
);

-- 2. Telemetry rollup. source: 'google' (billable) | 'cache' (free DB read).
create table if not exists public.api_usage_daily (
  day    date    not null,
  action text    not null,  -- 'nearby' | 'search' | 'details'
  source text    not null,  -- 'google' | 'cache'
  count  integer not null default 0,
  primary key (day, action, source)
);

alter table public.google_usage_counter enable row level security;
alter table public.api_usage_daily      enable row level security;

-- 3. Atomic increment for the billable counter. Returns the post-increment
--    count plus whether THIS call is the one that crossed the 80% warning or
--    the hard cap — so exactly one concurrent caller fires each alert (dedupe).
create or replace function public.bump_google_usage(p_day date, p_cap integer)
returns table (new_count integer, crossed_warn boolean, crossed_trip boolean)
language plpgsql
as $$
declare
  v_after   integer;
  v_warned  boolean;
  v_tripped boolean;
  v_warn_at integer := greatest(1, floor(p_cap * 0.8)::integer);
begin
  insert into public.google_usage_counter (day, billable_calls)
    values (p_day, 0)
    on conflict (day) do nothing;

  update public.google_usage_counter g
     set billable_calls = g.billable_calls + 1,
         updated_at     = now()
   where g.day = p_day
  returning g.billable_calls, g.warned, g.tripped
    into v_after, v_warned, v_tripped;

  crossed_warn := (not v_warned)  and (v_after >= v_warn_at);
  crossed_trip := (not v_tripped) and (v_after >= p_cap);

  if crossed_warn then
    update public.google_usage_counter set warned = true where day = p_day;
  end if;
  if crossed_trip then
    update public.google_usage_counter set tripped = true where day = p_day;
  end if;

  new_count := v_after;
  return next;
end;
$$;

-- 4. Telemetry increment (best-effort upsert).
create or replace function public.record_api_usage(p_day date, p_action text, p_source text)
returns void
language plpgsql
as $$
begin
  insert into public.api_usage_daily (day, action, source, count)
    values (p_day, p_action, p_source, 1)
    on conflict (day, action, source)
    do update set count = api_usage_daily.count + 1;
end;
$$;

-- These are server-only RPCs. CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default — revoke it so no client (anon/authenticated) can tamper with the
-- kill-switch counter; places-proxy calls them with the service-role key.
revoke execute on function public.bump_google_usage(date, integer) from public;
revoke execute on function public.record_api_usage(date, text, text) from public;
grant  execute on function public.bump_google_usage(date, integer) to service_role;
grant  execute on function public.record_api_usage(date, text, text) to service_role;
