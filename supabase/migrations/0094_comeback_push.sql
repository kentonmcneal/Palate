-- ============================================================================
-- 0094_comeback_push.sql — the one push for somebody who has gone quiet.
-- ----------------------------------------------------------------------------
-- Retention, done with the person's own data instead of "we miss you". After
-- five days without a visit, one push that says something only Palate could
-- say: "You have not been back to Ecco since March."
--
-- Rules:
--   * at least 3 visits ever, or there is nothing true to say
--   * no visit in the last 5 days
--   * once per ISO week per person (dedupe key), expires after a day so it
--     can never arrive stale
--   * goes through push_outbox, so quiet hours, the daily cap and the
--     server_push switch all apply. While the switch is off this enqueues rows
--     that send-push skips and expiry drops. Nothing reaches a phone.
--   * private profiles are included: this is about their own history, not
--     anybody else's.
-- ============================================================================

create or replace function public.enqueue_comeback_pushes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
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

revoke all on function public.enqueue_comeback_pushes() from public;
revoke all on function public.enqueue_comeback_pushes() from anon;
revoke all on function public.enqueue_comeback_pushes() from authenticated;

-- Daily at 23:00 UTC (18:00 Central). next_sendable_at then places each row
-- in the recipient's own daytime.
select cron.unschedule(jobid) from cron.job where jobname = 'enqueue_comeback_pushes';
select cron.schedule('enqueue_comeback_pushes', '0 23 * * *', 'select public.enqueue_comeback_pushes();');

do $$
declare rows_now integer;
begin
  -- Dry run against live data, rolled back by the savepoint: proves the plan
  -- executes and reports how many people would qualify today.
  begin
    rows_now := public.enqueue_comeback_pushes();
    raise notice '0094: % people would receive a comeback push today', rows_now;
    raise exception 'rollback probe' using errcode = 'P0002';
  exception when sqlstate 'P0002' then
    null;
  end;
  if not exists (select 1 from cron.job where jobname = 'enqueue_comeback_pushes' and active) then
    raise exception '0094: comeback cron not scheduled';
  end if;
end $$;
