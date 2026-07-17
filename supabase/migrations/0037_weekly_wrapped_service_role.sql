-- ============================================================================
-- 0037_weekly_wrapped_service_role.sql
-- ----------------------------------------------------------------------------
-- The Sunday cron edge function called generate_weekly_wrapped with a
-- p_user_id_override arg the function never accepted (it's defined as
-- (p_week_start date) and keys entirely off auth.uid()). PostgREST resolves
-- RPCs by exact arg set, so every cron call 404'd (PGRST202) → no Wrapped was
-- ever generated and the "your Wrapped is ready" push never fired.
--
-- Fix: a service-role-only variant that takes an explicit user id. The core
-- body is unchanged; the caller-facing function now just delegates so the
-- on-demand "Generate now" path keeps working with one source of truth.
-- Granting the override to `public` would be a cross-user IDOR, so it's
-- revoked from public and granted only to service_role (used by the cron).
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
     and visited_at >= p_week_start
     and visited_at <  v_week_end;

  if v_total = 0 then
    raise exception 'No visits this week';
  end if;

  select coalesce(r.chain_name, r.name)
    into v_top_restaurant
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = p_user_id
     and v.visited_at >= p_week_start
     and v.visited_at <  v_week_end
   group by coalesce(r.chain_name, r.name)
   order by count(*) desc
   limit 1;

  select r.primary_type
    into v_top_category
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = p_user_id
     and v.visited_at >= p_week_start
     and v.visited_at <  v_week_end
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
           and v.visited_at >= p_week_start
           and v.visited_at <  v_week_end
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
create or replace function public.generate_weekly_wrapped(p_week_start date)
returns public.weekly_wrapped
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;
  return public.generate_weekly_wrapped_for(uid, p_week_start);
end;
$$;

grant execute on function public.generate_weekly_wrapped(date) to authenticated;
