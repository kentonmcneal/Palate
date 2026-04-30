-- Palate — server-side helper functions

-- ============================================================
-- delete_my_data — wipes everything for the calling user
-- (the visits/location_events FKs cascade from auth.users, but we also
--  call this when a user wants a soft "delete history" without losing the account)
-- ============================================================
create or replace function public.delete_my_history()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated';
  end if;

  delete from public.visits where user_id = auth.uid();
  delete from public.location_events where user_id = auth.uid();
  delete from public.prompt_decisions where user_id = auth.uid();
  delete from public.weekly_wrapped where user_id = auth.uid();
end;
$$;

grant execute on function public.delete_my_history() to authenticated;

-- ============================================================
-- delete_my_account — wipe everything AND delete auth user
-- ============================================================
create or replace function public.delete_my_account()
returns void
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

  delete from public.visits where user_id = uid;
  delete from public.location_events where user_id = uid;
  delete from public.prompt_decisions where user_id = uid;
  delete from public.weekly_wrapped where user_id = uid;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- ============================================================
-- purge_old_location_events — privacy hygiene, run nightly via pg_cron
-- (cron is optional; the app also queries with a 30-day filter so this is just cleanup)
-- ============================================================
create or replace function public.purge_old_location_events()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.location_events
  where captured_at < now() - interval '30 days';
$$;

-- ============================================================
-- generate_weekly_wrapped — computes Wrapped for caller for the given week
-- Returns the cached row (insert-or-replace).
-- ============================================================
create or replace function public.generate_weekly_wrapped(p_week_start date)
returns public.weekly_wrapped
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
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
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  v_week_end := p_week_start + interval '7 days';

  select count(*),
         count(distinct restaurant_id)
    into v_total, v_unique
    from public.visits
   where user_id = uid
     and visited_at >= p_week_start
     and visited_at <  v_week_end;

  if v_total = 0 then
    raise exception 'No visits this week';
  end if;

  -- top restaurant by name (chain-aware)
  select coalesce(r.chain_name, r.name)
    into v_top_restaurant
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = uid
     and v.visited_at >= p_week_start
     and v.visited_at <  v_week_end
   group by coalesce(r.chain_name, r.name)
   order by count(*) desc
   limit 1;

  -- top category
  select r.primary_type
    into v_top_category
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = uid
     and v.visited_at >= p_week_start
     and v.visited_at <  v_week_end
   group by r.primary_type
   order by count(*) desc
   limit 1;

  v_repeat_rate := round((v_total - v_unique)::numeric / v_total, 3);

  -- personality label heuristic
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
         where v.user_id = uid
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
    (uid, p_week_start, v_week_end, v_total, v_unique,
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

grant execute on function public.generate_weekly_wrapped(date) to authenticated;
