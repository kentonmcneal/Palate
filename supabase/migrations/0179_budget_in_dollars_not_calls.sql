-- ============================================================================
-- 0179 — the Google budget becomes a dollar ceiling, like the LLM one already is.
-- ----------------------------------------------------------------------------
-- 0153 got this right for the LLM: "a ceiling measured in dollars, not calls."
-- The Google side — 90% of the bill, and the side that actually cost $300 —
-- still counts calls, so the SAME 1500/day cap is roughly $0/day when the
-- calls are Essentials and $37.50/day when they are Enterprise + Atmosphere.
-- A field-mask change is a price change, and a call counter cannot see one.
--
-- Money is tracked in integer MICRO-DOLLARS. Places SKUs are quoted per 1,000
-- calls ($25/1000 = 25000 micros/call), so micros keep every price exact and
-- keep the running total in bigint arithmetic rather than float.
--
-- bump_google_usage is DELIBERATELY LEFT IN PLACE. Migrations apply before
-- functions deploy, so between the two there is a window where the live
-- functions still call the old RPC; removing it would take the kill switch
-- offline for exactly as long as that window lasts. Both write the same
-- `warned`/`tripped` flags on the same row, so the switch behaves during the
-- overlap. Drop the old one once every caller is on the new one.
-- ============================================================================

alter table public.google_usage_counter
  add column if not exists spend_micros bigint not null default 0;

comment on column public.google_usage_counter.spend_micros is
  'Today''s Google spend in micro-dollars (1e-6 USD), summed per call from the SKU price table in _shared/google-spend.ts. This — not billable_calls — is what trips the kill switch as of 0179.';

-- Count one billable call AND what it cost. Returns whether THIS call crossed
-- 80% or the cap, exactly once each per day, so a caller can alert on it.
create or replace function public.bump_google_spend(
  p_day        date,
  p_micros     integer,
  p_cap_micros bigint
)
returns table (
  new_spend_micros bigint,
  new_count        integer,
  crossed_warn     boolean,
  crossed_trip     boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before  bigint;
  v_after   bigint;
  v_count   integer;
  v_warned  boolean;
  v_tripped boolean;
begin
  insert into public.google_usage_counter (day, billable_calls)
  values (p_day, 0)
  on conflict (day) do nothing;

  select g.spend_micros into v_before
    from public.google_usage_counter g where g.day = p_day for update;

  update public.google_usage_counter g
     set billable_calls = g.billable_calls + 1,
         spend_micros   = g.spend_micros + greatest(p_micros, 0)
   where g.day = p_day
  returning g.spend_micros, g.billable_calls, g.warned, g.tripped
    into v_after, v_count, v_warned, v_tripped;

  -- Edge-triggered: true only for the call that crosses, so an alert fires once.
  crossed_warn := (not v_warned)
                  and (v_before < (p_cap_micros * 8) / 10)
                  and (v_after >= (p_cap_micros * 8) / 10);
  crossed_trip := (not v_tripped) and (v_after >= p_cap_micros);

  if crossed_warn then
    update public.google_usage_counter set warned = true where day = p_day;
  end if;
  if crossed_trip then
    update public.google_usage_counter set tripped = true where day = p_day;
  end if;

  new_spend_micros := v_after;
  new_count        := v_count;
  return next;
end $$;

revoke all     on function public.bump_google_spend(date, integer, bigint) from public, anon, authenticated;
grant  execute on function public.bump_google_spend(date, integer, bigint) to service_role;

-- ---- proofs ----------------------------------------------------------------
-- Probed against a far-future day so no real counter row is touched.
do $$
declare
  d         date := date '2999-01-01';
  cap       bigint := 1000000;          -- $1.00 for the probe
  r         record;
  warns     int := 0;
  trips     int := 0;
begin
  delete from public.google_usage_counter where day = d;

  -- 4 calls at 200000 micros ($0.20) = $0.80, which crosses 80% on the 4th.
  for i in 1..4 loop
    select * into r from public.bump_google_spend(d, 200000, cap);
    if r.crossed_warn then warns := warns + 1; end if;
    if r.crossed_trip then trips := trips + 1; end if;
  end loop;

  if r.new_spend_micros <> 800000 then
    raise exception '0179: expected 800000 micros, got %', r.new_spend_micros;
  end if;
  if warns <> 1 then raise exception '0179: warn fired % times, expected exactly 1', warns; end if;
  if trips <> 0 then raise exception '0179: tripped early at 80%%'; end if;

  -- One more $0.20 reaches $1.00 and must trip, once.
  select * into r from public.bump_google_spend(d, 200000, cap);
  if not r.crossed_trip then raise exception '0179: did not trip at the cap'; end if;
  if not (select tripped from public.google_usage_counter where day = d) then
    raise exception '0179: tripped flag not persisted';
  end if;

  select * into r from public.bump_google_spend(d, 200000, cap);
  if r.crossed_trip then raise exception '0179: trip fired twice — alerts would spam'; end if;

  -- Cheap and expensive calls must NOT cost the same. This is the whole point.
  delete from public.google_usage_counter where day = d;
  select * into r from public.bump_google_spend(d, 5000, cap);   -- Essentials-ish
  select * into r from public.bump_google_spend(d, 25000, cap);  -- Atmosphere
  if r.new_spend_micros <> 30000 then
    raise exception '0179: price weighting lost — expected 30000 micros, got %', r.new_spend_micros;
  end if;
  if r.new_count <> 2 then raise exception '0179: call count should still be 2'; end if;

  delete from public.google_usage_counter where day = d;
  raise notice '0179: dollar ceiling works; warn and trip are edge-triggered once each';
end $$;
