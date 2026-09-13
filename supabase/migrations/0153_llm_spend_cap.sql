-- ============================================================================
-- 0153_llm_spend_cap.sql — a ceiling measured in dollars, not calls.
-- ----------------------------------------------------------------------------
-- The backfill already caps itself at 500 CALLS a day. That bounds the rate,
-- not the bill: 500 a day forever is not a budget, and nobody authorising this
-- thinks in calls. The founder authorised TEN DOLLARS, so ten dollars is what
-- the code should enforce.
--
-- Every call records the token counts Anthropic reports back -- input, output,
-- and cache reads separately, because they are priced an order of magnitude
-- apart -- and the estimated cost derived from them. The function refuses to
-- start another batch once the lifetime sum reaches the cap.
--
-- The prices live in the edge function, not here, because they change and a
-- migration is the wrong place for a number that goes stale. This table stores
-- what was actually spent according to whatever prices were in force at the
-- time, which is the number that matters afterwards.
-- ============================================================================

create table if not exists public.llm_spend (
  id                 bigserial primary key,
  day                date        not null default (now() at time zone 'utc')::date,
  action             text        not null,
  model              text        not null,
  calls              integer     not null default 1,
  input_tokens       bigint      not null default 0,
  output_tokens      bigint      not null default 0,
  cache_read_tokens  bigint      not null default 0,
  cache_write_tokens bigint      not null default 0,
  est_cost_usd       numeric(10,6) not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists llm_spend_day_idx on public.llm_spend (day desc);
create index if not exists llm_spend_action_idx on public.llm_spend (action);

alter table public.llm_spend enable row level security;
-- Service role only. This is a cost ledger, not user data, and no client has
-- any business reading or writing it.
revoke all on public.llm_spend from anon, authenticated;
revoke all on sequence public.llm_spend_id_seq from anon, authenticated;

-- ----------------------------------------------------------------------------
-- What has been spent, ever, on a given action.
-- ----------------------------------------------------------------------------
create or replace function public.llm_spend_total_usd(p_action text default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(est_cost_usd), 0)::numeric
    from public.llm_spend
   where p_action is null or action = p_action;
$$;

revoke all on function public.llm_spend_total_usd(text) from public, anon, authenticated;

-- Admins can see the number on the admin screen. A total, nothing else.
create or replace function public.admin_llm_spend_usd()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    return 0;
  end if;
  return public.llm_spend_total_usd(null);
end;
$$;

revoke all on function public.admin_llm_spend_usd() from public, anon;
grant execute on function public.admin_llm_spend_usd() to authenticated;
