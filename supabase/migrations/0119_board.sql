-- ============================================================================
-- 0119 — the Board.
-- ----------------------------------------------------------------------------
-- One leaderboard of "visits this week" is a scoreboard nobody but the leader
-- enjoys. Beli's trick is that there are several boards and most people are
-- near the top of one of them: the person who eats out constantly, the person
-- who never eats the same thing twice, the person who has been to one place
-- forty times. Different virtues, different winners.
--
-- Categories:
--   never_cooks    most visits           — eats out more than anyone
--   widest_net     distinct cuisines     — never eats the same thing twice
--   deep_regular   most visits to ONE place, and which
--   first_in       places nobody else here has logged — the scout
--
-- Two scopes: 'following' (people you follow) and 'everyone' (public profiles
-- across the app). Both exclude blocks in either direction, both count only
-- public visits, and 'everyone' additionally requires a public profile —
-- a friends-only account does not appear on a board strangers can read.
--
-- All of it is one aggregate over `visits`; no Google, no LLM, no cost.
-- ============================================================================

create or replace function public.board_leaders(
  p_category text default 'never_cooks',
  p_scope text default 'everyone',
  p_window text default 'all',
  p_limit int default 20
)
returns table (
  user_id uuid, display_name text, username text, avatar_url text,
  value integer, detail text, you boolean
)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); since timestamptz;
begin
  if me is null then return; end if;
  since := case p_window
             when 'week'  then date_trunc('week', now())
             when 'month' then date_trunc('month', now())
             when 'year'  then date_trunc('year', now())
             else '-infinity'::timestamptz
           end;

  return query
  with eligible as (
    select p.id, p.display_name, p.username, p.avatar_url
      from public.profiles p
     where not public.is_blocked_either_way(me, p.id)
       and p.approval_status = 'approved'
       and (
         (p_scope = 'everyone' and p.profile_visibility = 'public')
         or (p_scope = 'following' and (
              p.id = me
              or (p.profile_visibility in ('public','friends')
                  and exists (select 1 from public.follows f
                               where f.follower_id = me and f.followee_id = p.id))
            ))
       )
  ),
  v as (
    select vi.user_id, vi.restaurant_id, vi.visited_at, r.name as rname, r.cuisine_type
      from public.visits vi
      join eligible e on e.id = vi.user_id
      left join public.restaurants r on r.id = vi.restaurant_id
     where vi.is_public and vi.visited_at >= since
  ),
  scored as (
    select * from (
      select v.user_id, count(*)::int as value, null::text as detail
        from v where p_category = 'never_cooks' group by v.user_id
      union all
      select v.user_id, count(distinct v.cuisine_type)::int, null::text
        from v where p_category = 'widest_net' and v.cuisine_type is not null group by v.user_id
      union all
      select d.user_id, d.n, d.rname
        from (
          select v.user_id, count(*)::int as n, v.rname,
                 row_number() over (partition by v.user_id order by count(*) desc, max(v.visited_at) desc) as rk
            from v where p_category = 'deep_regular' and v.rname is not null
           group by v.user_id, v.rname
        ) d where d.rk = 1
      union all
      -- Places only this person has logged, among everyone the board can see.
      select s.user_id, count(*)::int, null::text
        from (
          select distinct v.user_id, v.restaurant_id
            from v
           where p_category = 'first_in'
             and v.restaurant_id is not null
             and not exists (
               select 1 from v v2
                where v2.restaurant_id = v.restaurant_id and v2.user_id <> v.user_id
             )
        ) s group by s.user_id
    ) u
  )
  select e.id, e.display_name, e.username, e.avatar_url,
         s.value, s.detail, (e.id = me)
    from scored s join eligible e on e.id = s.user_id
   where s.value > 0
   order by s.value desc, e.display_name nulls last
   limit greatest(1, least(p_limit, 50));
end $$;
revoke all on function public.board_leaders(text, text, text, int) from public, anon;
grant execute on function public.board_leaders(text, text, text, int) to authenticated;

-- "Top visits for a specific restaurant you type in." Same visibility rules.
create or replace function public.restaurant_regulars(p_query text, p_limit int default 20)
returns table (
  user_id uuid, display_name text, username text, avatar_url text,
  restaurant_name text, value integer, you boolean
)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); q text := trim(coalesce(p_query, ''));
begin
  if me is null or length(q) < 2 then return; end if;
  return query
  with target as (
    -- One restaurant, the best match by name. Several rows can share a name
    -- (the same chain, different branches), so they are folded by name.
    select r.name from public.restaurants r
     where r.name ilike '%' || q || '%'
     group by r.name
     order by (lower(r.name) = lower(q)) desc, count(*) desc, r.name
     limit 1
  )
  select p.id, p.display_name, p.username, p.avatar_url,
         t.name, count(*)::int, (p.id = me)
    from public.visits vi
    join public.restaurants r on r.id = vi.restaurant_id
    join target t on t.name = r.name
    join public.profiles p on p.id = vi.user_id
   where vi.is_public
     and p.approval_status = 'approved'
     and (p.profile_visibility = 'public' or p.id = me)
     and not public.is_blocked_either_way(me, p.id)
   group by p.id, p.display_name, p.username, p.avatar_url, t.name
   order by count(*) desc, p.display_name nulls last
   limit greatest(1, least(p_limit, 50));
end $$;
revoke all on function public.restaurant_regulars(text, int) from public, anon;
grant execute on function public.restaurant_regulars(text, int) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; n int; r record; hidden uuid;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';

  -- signed out: nothing, from either function
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.board_leaders('never_cooks','everyone'); 
  if n <> 0 then raise exception '0119: signed-out caller read the board'; end if;
  select count(*) into n from public.restaurant_regulars('a');
  if n <> 0 then raise exception '0119: signed-out caller read regulars'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  for r in select * from public.board_leaders('never_cooks','everyone') loop
    raise notice 'never_cooks: % = %', coalesce(r.display_name,'?'), r.value;
  end loop;
  select count(*) into n from public.board_leaders('deep_regular','everyone');
  raise notice 'deep_regular rows: %', n;
  select count(*) into n from public.board_leaders('widest_net','everyone');
  raise notice 'widest_net rows: %', n;
  select count(*) into n from public.board_leaders('first_in','everyone');
  raise notice 'first_in rows: %', n;

  -- a PRIVATE profile must not appear on the everyone board
  update public.profiles set profile_visibility = 'private' where id = kenton;
  select count(*) into n from public.board_leaders('never_cooks','everyone') where user_id = kenton;
  if n <> 0 then raise exception '0119: a private profile appeared on the public board'; end if;
  update public.profiles set profile_visibility = 'public' where id = kenton;

  perform set_config('request.jwt.claims', null, true);
end $$;
