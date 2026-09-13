-- ============================================================================
-- 0158 — leaderboard windows follow the viewer's week, not UTC's.
-- ----------------------------------------------------------------------------
-- Same defect 0151 fixed in Wrapped, in two more places. A cold audit found
-- both by grepping the DEPLOYED function bodies rather than the migrations.
--
-- Two faults compound:
--
--   1. `visited_at >= week_start` compares a timestamptz to a date, which
--      Postgres resolves at midnight in the SESSION timezone. This database
--      runs in UTC.
--   2. `week_start := date_trunc('week', now())` uses the SERVER's clock, so
--      the window itself starts at Monday 00:00 UTC for everybody.
--
-- Monday 00:00 UTC is Sunday 5pm in Los Angeles. So a Pacific user's "this
-- week" resets while they are still eating Sunday dinner, and that dinner
-- lands in the next week's count. On a leaderboard, that is not a rounding
-- error -- it is somebody's number being wrong next to their friends' names.
--
-- Both halves fixed: the window is computed in the VIEWER's timezone, and the
-- comparison is against visits.local_date, the calendar date the person
-- actually experienced (0026). coalesce covers pre-0026 and imported rows.
--
-- A null profiles.timezone falls back to UTC, which is the old behaviour --
-- the wrong week is better than no leaderboard, and syncTimezone() now fills
-- that column on every launch.
-- ============================================================================

-- ---- 1. friends_leaderboard ------------------------------------------------
create or replace function public.friends_leaderboard()
returns table (user_id uuid, display_name text, email text, avatar_url text,
               persona_label text, total_visits integer, visits_this_week integer, unique_cuisines integer)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tz text;
  week_start date;
begin
  if me is null then return; end if;
  select p.timezone into tz from public.profiles p where p.id = me;
  week_start := date_trunc('week', (now() at time zone coalesce(tz, 'UTC')))::date;

  return query
  select p.id, p.display_name, null::text, p.avatar_url,
         coalesce(ww.palate_identity, ww.personality_label),
         coalesce(stats.total_visits,0)::int, coalesce(stats.this_week,0)::int, coalesce(stats.unique_cuisines,0)::int
    from public.follows f
    join public.profiles p on p.id = f.followee_id
    left join lateral (
      select count(*)::int total_visits,
             count(*) filter (
               where coalesce(v.local_date, (v.visited_at at time zone 'UTC')::date) >= week_start
             )::int this_week,
             count(distinct r.cuisine_type)::int unique_cuisines
        from public.visits v left join public.restaurants r on r.id = v.restaurant_id
       where v.user_id = p.id and v.is_public
    ) stats on true
    left join lateral (
      select w.personality_label, w.palate_identity from public.weekly_wrapped w
       where w.user_id = p.id order by w.week_start desc limit 1
    ) ww on true
   where f.follower_id = me
     and (p.profile_visibility = 'public'
          or (p.profile_visibility = 'friends' and public.are_friends(me, p.id)))
     and not public.is_blocked_either_way(me, p.id)
   order by coalesce(stats.this_week,0) desc, coalesce(stats.total_visits,0) desc;
end $$;

revoke all on function public.friends_leaderboard() from public, anon;
grant execute on function public.friends_leaderboard() to authenticated;

-- ---- 2. board_leaders: the window boundary ---------------------------------
-- Only the `since` calculation and the row filter change; everything else is
-- 0119 verbatim, so this is a boundary fix and not a rewrite of the board.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'board_leaders';

  -- Window computed in the viewer's zone, as a DATE.
  src := replace(src,
    'declare me uuid := auth.uid(); since timestamptz;',
    'declare me uuid := auth.uid(); since date; tz text;');
  src := replace(src,
    '  since := case p_window
             when ''week''  then date_trunc(''week'', now())
             when ''month'' then date_trunc(''month'', now())
             when ''year''  then date_trunc(''year'', now())
             else ''-infinity''::timestamptz
           end;',
    '  select p.timezone into tz from public.profiles p where p.id = me;
  since := case p_window
             when ''week''  then date_trunc(''week'',  (now() at time zone coalesce(tz, ''UTC'')))::date
             when ''month'' then date_trunc(''month'', (now() at time zone coalesce(tz, ''UTC'')))::date
             when ''year''  then date_trunc(''year'',  (now() at time zone coalesce(tz, ''UTC'')))::date
             else ''-infinity''::date
           end;');
  -- Compare against the date the person experienced.
  src := replace(src,
    'where vi.is_public and vi.visited_at >= since',
    'where vi.is_public and coalesce(vi.local_date, (vi.visited_at at time zone ''UTC'')::date) >= since');

  if position('at time zone coalesce(tz' in src) = 0 then
    raise exception 'board_leaders rewrite did not match the deployed source; fix by hand';
  end if;
  execute src;
  raise notice 'board_leaders window is now viewer-local';
end $$;

-- ---- 3. assert both, so a later DROP+CREATE cannot quietly undo it ---------
do $$
declare bad text := '';
begin
  select coalesce(string_agg(p.proname, ', '), '') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('friends_leaderboard', 'board_leaders')
     and position('local_date' in pg_get_functiondef(p.oid)) = 0;
  if bad <> '' then
    raise exception 'Leaderboard function(s) no longer bucket on local_date: %', bad;
  end if;
  raise notice 'leaderboard week assertions passed';
end $$;
