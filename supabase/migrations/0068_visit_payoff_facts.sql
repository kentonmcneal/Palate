-- ============================================================================
-- 0068_visit_payoff_facts.sql — the numbers behind "what did logging that do?"
-- ----------------------------------------------------------------------------
-- THE SWARM PROBLEM. Foursquare had check-ins and a social graph, moved to
-- automatic detection, and collapsed: passive logging removed the ritual, the
-- moment where you did something and it was yours. Palate is on the same road
-- with better technology and the same exposure. The confirm prompt is our
-- ritual and it currently ends by clearing an alert.
--
-- This returns the facts a single honest line can be built from. Server-side
-- for one reason: the client would need six round trips on the screen that
-- appears immediately after a confirm, which is exactly the moment that must
-- not feel slow.
--
-- Additive. Reads only the caller's own rows. No new tables.
-- ============================================================================

create or replace function public.visit_payoff_facts(p_visit_id uuid)
returns table (
  total_visits       integer,
  visits_here        integer,
  cuisine            text,
  cuisine_visits_30d integer,
  distinct_places    integer,
  became_top_spot    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    -- The visit must belong to the caller. Anything else returns no rows,
    -- and the client renders nothing — a silent no-op, not a wrong boast.
    select vi.id, vi.user_id, vi.restaurant_id
      from public.visits vi
     where vi.id = p_visit_id
       and vi.user_id = auth.uid()
  ),
  r as (
    select re.id, re.cuisine_type
      from public.restaurants re
      join v on v.restaurant_id = re.id
  ),
  totals as (
    select
      count(*)::int                                 as total_visits,
      count(distinct vi.restaurant_id)::int         as distinct_places
      from public.visits vi
      join v on vi.user_id = v.user_id
  ),
  here as (
    select count(*)::int as n
      from public.visits vi
      join v on vi.user_id = v.user_id and vi.restaurant_id = v.restaurant_id
  ),
  cuisine_30d as (
    select count(*)::int as n
      from public.visits vi
      join v  on vi.user_id = v.user_id
      join public.restaurants re on re.id = vi.restaurant_id
      join r  on r.cuisine_type is not null and re.cuisine_type = r.cuisine_type
     where vi.visited_at >= now() - interval '30 days'
  ),
  runner_up as (
    select coalesce(max(c.n), 0)::int as n
      from (
        select vi.restaurant_id, count(*)::int n
          from public.visits vi
          join v on vi.user_id = v.user_id
         where vi.restaurant_id <> v.restaurant_id
         group by 1
      ) c
  )
  select
    totals.total_visits,
    here.n,
    r.cuisine_type,
    cuisine_30d.n,
    totals.distinct_places,
    -- BECAME, not IS. `here.n > runner_up.n` stays true for every later visit
    -- to a long-standing favourite, so it would announce the same change over
    -- and over. Since visits accrue one at a time, `= runner_up.n + 1` is
    -- exactly the visit that broke the tie — the moment itself, once.
    (here.n = runner_up.n + 1)
    from totals
    cross join here
    cross join cuisine_30d
    cross join runner_up
    -- A visit that isn't the caller's produces no facts at all, rather than a
    -- row of zeros that reads like a real answer.
    left join r on true
   where exists (select 1 from v);
$$;

revoke all on function public.visit_payoff_facts(uuid) from public;
grant execute on function public.visit_payoff_facts(uuid) to authenticated;
