-- ============================================================================
-- 0121 — the payoff can say what share of your Palate a cuisine is.
-- ----------------------------------------------------------------------------
-- The founder, on what confirming a visit should feel like: "telling them
-- logging the food increased your american percentage XYZ".
--
-- visit_payoff_facts already returns the cuisine and a 30-day count, which
-- answers "how often lately" but not "how much of you". The all-time count is
-- one more aggregate over the same rows, and with it the client can state the
-- share exactly AND the movement, because the before-state is arithmetic:
-- this visit is one of the counts, so (n-1)/(total-1) is where you were.
--
-- Return type changes, so the function is dropped and rebuilt.
-- ============================================================================

drop function if exists public.visit_payoff_facts(uuid);

create function public.visit_payoff_facts(p_visit_id uuid)
returns table (
  total_visits        integer,
  visits_here         integer,
  cuisine             text,
  cuisine_visits_30d  integer,
  cuisine_visits_all  integer,
  distinct_places     integer,
  became_top_spot     boolean
)
language sql stable security definer set search_path = public as $$
  with v as (
    -- The visit must belong to the caller. Anything else returns no rows,
    -- and the client renders nothing — a silent no-op, not a wrong boast.
    select vi.id, vi.user_id, vi.restaurant_id
      from public.visits vi
     where vi.id = p_visit_id and vi.user_id = auth.uid()
  ),
  r as (
    select re.id, re.cuisine_type from public.restaurants re join v on v.restaurant_id = re.id
  ),
  totals as (
    select count(*)::int as total_visits, count(distinct vi.restaurant_id)::int as distinct_places
      from public.visits vi join v on vi.user_id = v.user_id
  ),
  here as (
    select count(*)::int as n from public.visits vi
      join v on vi.user_id = v.user_id and vi.restaurant_id = v.restaurant_id
  ),
  cuisine_30d as (
    select count(*)::int as n from public.visits vi
      join v on vi.user_id = v.user_id
      join public.restaurants re on re.id = vi.restaurant_id
      join r on r.cuisine_type is not null and re.cuisine_type = r.cuisine_type
     where vi.visited_at >= now() - interval '30 days'
  ),
  cuisine_all as (
    select count(*)::int as n from public.visits vi
      join v on vi.user_id = v.user_id
      join public.restaurants re on re.id = vi.restaurant_id
      join r on r.cuisine_type is not null and re.cuisine_type = r.cuisine_type
  ),
  runner_up as (
    select coalesce(max(c.n), 0)::int as n
      from (
        select vi.restaurant_id, count(*)::int n
          from public.visits vi join v on vi.user_id = v.user_id
         where vi.restaurant_id <> v.restaurant_id
         group by 1
      ) c
  )
  select totals.total_visits, here.n, r.cuisine_type,
         cuisine_30d.n, cuisine_all.n, totals.distinct_places,
         (here.n > runner_up.n)
    from totals, here, r, cuisine_30d, cuisine_all, runner_up;
$$;

revoke all on function public.visit_payoff_facts(uuid) from public, anon;
grant execute on function public.visit_payoff_facts(uuid) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; vid uuid; r record;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  if kenton is null then
    raise notice '0121: fresh database — proofs skipped';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);

  select v.id into vid from public.visits v
    join public.restaurants re on re.id = v.restaurant_id
   where v.user_id = kenton and re.cuisine_type is not null
   order by v.visited_at desc limit 1;

  if vid is null then
    raise notice '0121: founder has no visit with a known cuisine';
  else
    select * into r from public.visit_payoff_facts(vid);
    if r.total_visits is null then raise exception '0121: the RPC returned no row for the owner'; end if;
    if r.cuisine_visits_all is null or r.cuisine_visits_all < 1 then
      raise exception '0121: cuisine_visits_all came back %', coalesce(r.cuisine_visits_all::text,'<null>');
    end if;
    if r.cuisine_visits_all < r.cuisine_visits_30d then
      raise exception '0121: all-time (%) is below 30-day (%)', r.cuisine_visits_all, r.cuisine_visits_30d;
    end if;
    raise notice '0121: % — % of % visits all time', r.cuisine, r.cuisine_visits_all, r.total_visits;
  end if;

  -- somebody else's visit is not readable
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
  if vid is not null and exists (select 1 from public.visit_payoff_facts(vid)) then
    raise exception '0121: another user read the founder''s visit facts';
  end if;
  perform set_config('request.jwt.claims', null, true);
end $$;
