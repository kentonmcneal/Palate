-- ============================================================================
-- 0151 — Wrapped covers the user's week, not UTC's.
-- ----------------------------------------------------------------------------
-- generate_weekly_wrapped_for compared `visited_at` (timestamptz) against
-- `p_week_start` (date). Postgres resolves that by coercing the date to
-- midnight in the SESSION timezone, and this database runs in UTC. So every
-- Wrapped week ran Monday 00:00 UTC to Monday 00:00 UTC.
--
-- Monday 00:00 UTC is Sunday 5pm in Los Angeles. A Pacific user's Sunday
-- dinner therefore landed in NEXT week's Wrapped -- the wrong week, in the one
-- feature whose entire job is telling you what your week was. Three hours wide
-- on the east coast, seven on the west, and wider still for anyone travelling.
--
-- visits.local_date already exists for exactly this reason (0026): it is the
-- calendar date the person actually experienced, computed on their device in
-- their own timezone. Bucketing on it is both correct and free.
--
-- coalesce(...) because rows predating 0026, and some imported ones, have a
-- null local_date. Those fall back to the old UTC behaviour, which is what
-- they were counted as before -- a null must not silently drop a visit out of
-- every week at once.
--
-- Found by checking a hypothesis rather than by a report: as of today ZERO of
-- 35 visits actually straddle a boundary, so nobody has been bitten yet. This
-- is fixed while it is still cheap.
-- ============================================================================

create or replace function public.generate_weekly_wrapped_for(p_user_id uuid, p_week_start date)
returns public.weekly_wrapped
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_end date;
  v_total int;
  v_unique int;
  v_top_restaurant text;
  v_top_category text;
  v_repeat_rate numeric(4,3);
  v_personality text;
  v_json jsonb;
  v_row public.weekly_wrapped;
begin
  if p_user_id is null then
    raise exception 'p_user_id required';
  end if;

  v_week_end := p_week_start + interval '7 days';

  select count(*),
         count(distinct restaurant_id)
    into v_total, v_unique
    from public.visits
   where user_id = p_user_id
     and coalesce(local_date, (visited_at at time zone 'UTC')::date) >= p_week_start
     and coalesce(local_date, (visited_at at time zone 'UTC')::date) <  v_week_end;

  if v_total = 0 then
    raise exception 'No visits this week';
  end if;

  select coalesce(r.chain_name, r.name)
    into v_top_restaurant
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = p_user_id
     and coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) >= p_week_start
     and coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) <  v_week_end
   group by coalesce(r.chain_name, r.name)
   order by count(*) desc
   limit 1;

  select r.primary_type
    into v_top_category
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = p_user_id
     and coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) >= p_week_start
     and coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) <  v_week_end
   group by r.primary_type
   order by count(*) desc
   limit 1;

  v_repeat_rate := round((v_total - v_unique)::numeric / v_total, 3);

  v_personality := case
    when v_total >= 10 and v_repeat_rate >= 0.6 then 'The Loyalist'
    when v_total >= 7  and v_repeat_rate <  0.3 then 'The Explorer'
    when v_top_category in ('meal_takeaway','fast_food_restaurant') then 'The Fast Casual Regular'
    when v_top_category = 'cafe' and v_total >= 5 then 'The Café Dweller'
    else 'The Comfort Food Connoisseur'
  end;

  v_json := jsonb_build_object(
    'total_visits', v_total,
    'unique_restaurants', v_unique,
    'top_restaurant', v_top_restaurant,
    'top_category', v_top_category,
    'repeat_rate', v_repeat_rate,
    'personality_label', v_personality,
    'top_three', (
      select jsonb_agg(jsonb_build_object('name', name, 'count', cnt) order by cnt desc)
      from (
        select coalesce(r.chain_name, r.name) as name, count(*) as cnt
          from public.visits v
          join public.restaurants r on r.id = v.restaurant_id
         where v.user_id = p_user_id
           and coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) >= p_week_start
           and coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) <  v_week_end
         group by coalesce(r.chain_name, r.name)
         order by count(*) desc
         limit 3
      ) t
    )
  );

  insert into public.weekly_wrapped
    (user_id, week_start, week_end, total_visits, unique_restaurants,
     top_restaurant, top_category, repeat_rate, personality_label, wrapped_json)
  values
    (p_user_id, p_week_start, v_week_end, v_total, v_unique,
     v_top_restaurant, v_top_category, v_repeat_rate, v_personality, v_json)
  on conflict (user_id, week_start) do update set
    week_end           = excluded.week_end,
    total_visits       = excluded.total_visits,
    unique_restaurants = excluded.unique_restaurants,
    top_restaurant     = excluded.top_restaurant,
    top_category       = excluded.top_category,
    repeat_rate        = excluded.repeat_rate,
    personality_label  = excluded.personality_label,
    wrapped_json       = excluded.wrapped_json
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.generate_weekly_wrapped_for(uuid, date) from public;
grant execute on function public.generate_weekly_wrapped_for(uuid, date) to service_role;

-- Caller-facing function now delegates — one source of truth, and the on-demand
-- "Generate now" button keeps working for the authenticated user.
