-- ============================================================================
-- 0145 — remember WHERE a prompt was refused, not just which place.
-- ----------------------------------------------------------------------------
-- Refusals are counted per google_place_id today, over a 90-day window, and two
-- of them demote the place everywhere and forever. That is the wrong shape for
-- the error people actually hit.
--
-- The founder's report: standing inside a Walmart, asked whether he had eaten
-- at the Panda Express across the car park. He never entered it. He will refuse
-- it, and under the current rule that teaches the app that HE DISLIKES PANDA
-- EXPRESS — so a Panda Express he genuinely eats at, in another town, is
-- demoted too. Meanwhile the thing that is actually wrong, the pairing of that
-- venue with that spot, is never learned at all.
--
-- The failure is geometric. A venue 70m from where somebody habitually stands
-- is wrong THERE, and only there. So the coordinates of the stop are recorded
-- with the decision, and a refusal becomes evidence about a place-and-position
-- rather than about a brand.
--
-- Nullable on purpose: 91 decisions already exist without coordinates and they
-- stay valid as the coarse place-level signal they always were.
--
-- No index. The whole table is 91 rows, the query filters by google_place_id
-- first, and distance is computed on the device from the handful of rows that
-- returns. An index here would be cargo cult.
-- ============================================================================

alter table public.prompt_decisions
  add column if not exists lat double precision,
  add column if not exists lng double precision;

comment on column public.prompt_decisions.lat is
  'Where the STOP was when this prompt was answered — not where the venue is. Null on rows written before 0145.';

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='prompt_decisions' and column_name in ('lat','lng');
  if n <> 2 then raise exception '0145: columns missing'; end if;
  raise notice '0145: prompt_decisions now records where a refusal happened';
end $$;
