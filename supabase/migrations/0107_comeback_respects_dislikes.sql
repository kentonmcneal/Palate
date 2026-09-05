-- ============================================================================
-- 0107_comeback_respects_dislikes.sql — never "come back to" a place you hid.
-- ----------------------------------------------------------------------------
-- The comeback push names the most-visited place. A place visited six times
-- and then marked "Not interested" was still the one it named. Excluded.
-- ============================================================================
create or replace function public.enqueue_comeback_pushes()
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer := 0;
begin
  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select
    p.id,
    'You have not been back to ' || fav.name,
    case
      when fav.last_at >= now() - interval '45 days'
        then 'Not since ' || to_char(fav.last_at, 'FMDay') || '. ' || fav.n || ' visits and counting.'
      else 'Not since ' || to_char(fav.last_at, 'FMMonth') || '. ' || fav.n || ' visits and counting.'
    end,
    jsonb_build_object('type', 'comeback', 'place_id', fav.google_place_id),
    public.next_sendable_at(p.timezone),
    'comeback:' || to_char(now(), 'IYYY-IW'),
    now() + interval '1 day'
  from public.profiles p
  join lateral (
    select r.name, r.google_place_id, count(*)::int as n, max(v.visited_at) as last_at
      from public.visits v
      join public.restaurants r on r.id = v.restaurant_id
     where v.user_id = p.id
       and not exists (
         select 1 from public.place_dislikes d
          where d.user_id = p.id and d.google_place_id = r.google_place_id
       )
     group by r.id, r.name, r.google_place_id
     order by count(*) desc, max(v.visited_at) desc
     limit 1
  ) fav on true
  where p.push_token is not null
    and p.timezone is not null
    and coalesce(p.approval_status, 'approved') = 'approved'
    and (select count(*) from public.visits v where v.user_id = p.id) >= 3
    and not exists (
      select 1 from public.visits v
       where v.user_id = p.id and v.visited_at >= now() - interval '5 days'
    )
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.enqueue_comeback_pushes() from public, anon, authenticated;
do $$
declare n int;
begin
  begin
    n := public.enqueue_comeback_pushes();
    raise notice '0107: comeback dry run would enqueue % (rolled back)', n;
    raise exception 'rb' using errcode = 'P0002';
  exception when sqlstate 'P0002' then null; end;
end $$;
