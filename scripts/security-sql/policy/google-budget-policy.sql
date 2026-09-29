-- REVIEW DRAFT: assign a migration version only after independent review.
-- No helper/reservation algorithm change. Start disabled; an operator must set
-- an approved cap and align deployed GOOGLE_DAILY_BUDGET_USD before enabling.
begin;

create table public.google_spend_policy (
  singleton boolean primary key default true check (singleton),
  daily_cap_micros bigint not null default 0
    check (daily_cap_micros >= 0 and daily_cap_micros <= 9007199254740991)
);
alter table public.google_spend_policy enable row level security;
revoke all on table public.google_spend_policy from public, anon, authenticated, service_role;
insert into public.google_spend_policy(singleton, daily_cap_micros) values (true, 0);
comment on table public.google_spend_policy is
  'Operator-owned Google reservation policy. Zero or missing row disables admissions. Clients and service callers cannot edit it.';

-- Preserve the tested 0179 implementation byte-for-byte. Only the guarded
-- public entry point is callable by service_role after this migration.
alter function public.bump_google_spend(date, integer, bigint)
  rename to reserve_google_spend_internal;
revoke all on function public.reserve_google_spend_internal(date, integer, bigint)
  from public, anon, authenticated, service_role;

create function public.bump_google_spend(
  p_day date, p_micros integer, p_cap_micros bigint
)
returns table (
  new_spend_micros bigint, new_count integer,
  crossed_warn boolean, crossed_trip boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_cap bigint;
begin
  -- Serialize policy changes against admission, not against the later HTTP
  -- request. This does not cancel an already admitted Google request.
  select p.daily_cap_micros into configured_cap
    from public.google_spend_policy p where p.singleton = true for share;
  if configured_cap is null or configured_cap = 0
     or p_cap_micros is distinct from configured_cap then
    raise exception 'Google spend policy disabled or caller cap mismatch'
      using errcode = '42501';
  end if;
  if p_day is null or p_micros is null or p_micros < 0 then
    raise exception 'Invalid Google reservation input' using errcode = '22023';
  end if;
  return query select * from public.reserve_google_spend_internal(p_day, p_micros, configured_cap);
end;
$$;
revoke all on function public.bump_google_spend(date, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.bump_google_spend(date, integer, bigint) to service_role;

commit;
