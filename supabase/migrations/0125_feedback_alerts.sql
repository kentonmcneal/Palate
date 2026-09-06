-- ============================================================================
-- 0125 — a bug report reaches somebody.
-- ----------------------------------------------------------------------------
-- public.feedback has been collecting real reports, with screenshots, into a
-- table nobody is told about. A report nobody reads is worse than no report,
-- because the tester believes they were heard.
--
-- Two routes, deliberately, because they fail differently:
--
--   1. A push to the founder's device, via the ALERT_PUSH_TOKEN that
--      places-proxy already uses for budget alerts. Immediate, and
--      INDEPENDENT of feature_flags.server_push — that flag gates user-facing
--      product notifications and is off on purpose; an operational alert to
--      one device is a different thing.
--   2. An unread count the app can read without a push, a token, or a network
--      service being up. This is the one that cannot break.
--
-- Credentials come from Vault, the way the featured-lists cron already does
-- it, so nothing sensitive is committed here.
-- ============================================================================

create index if not exists feedback_status_idx on public.feedback (status, created_at desc);

-- ---- 1. the push -----------------------------------------------------------
create or replace function public.notify_feedback_filed()
returns trigger language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if secret is null or secret = '' then
    -- No secret, no alert. The row is already stored; losing the notification
    -- must never lose the report or fail the insert.
    return new;
  end if;

  perform net.http_post(
    url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/notify-feedback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', secret
    ),
    body := jsonb_build_object('feedback_id', new.id),
    timeout_milliseconds := 4000
  );
  return new;
exception when others then
  -- A tester filing a bug must never see an error because our alerting is
  -- down. This is the whole reason it is an AFTER trigger that swallows.
  return new;
end $$;

drop trigger if exists feedback_notify on public.feedback;
create trigger feedback_notify
  after insert on public.feedback
  for each row execute function public.notify_feedback_filed();

-- ---- 2. the count that cannot break ---------------------------------------
-- Admin only, aggregate only. feedback rows carry a user_id and free text, so
-- this returns numbers rather than contents; the list below is separate and
-- also admin-gated.
create or replace function public.feedback_unread_count()
returns integer language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
      then (select count(*)::int from public.feedback where status = 'new')
    else 0
  end;
$$;
revoke all on function public.feedback_unread_count() from public, anon;
grant execute on function public.feedback_unread_count() to authenticated;

create or replace function public.list_feedback(p_limit integer default 50)
returns table (
  id uuid, category text, message text, status text,
  app_version text, platform text, device text,
  screenshot_path text, created_at timestamptz,
  reporter text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    return;
  end if;
  return query
  select f.id, f.category, f.message, f.status,
         f.app_version, f.platform, f.device,
         f.screenshot_path, f.created_at,
         -- Display name, never the login address.
         coalesce(pr.display_name, pr.username, 'Someone')
    from public.feedback f
    left join public.profiles pr on pr.id = f.user_id
   order by f.created_at desc
   limit greatest(1, least(p_limit, 200));
end $$;
revoke all on function public.list_feedback(integer) from public, anon;
grant execute on function public.list_feedback(integer) to authenticated;

create or replace function public.mark_feedback_triaged(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.feedback set status = 'triaged' where id = p_id and status = 'new';
end $$;
revoke all on function public.mark_feedback_triaged(uuid) from public, anon;
grant execute on function public.mark_feedback_triaged(uuid) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; stranger uuid; n int; test_id uuid;
begin
  -- signed out reads nothing, from either function
  perform set_config('request.jwt.claims', null, true);
  if public.feedback_unread_count() <> 0 then
    raise exception '0125: signed-out caller got a feedback count';
  end if;
  select count(*) into n from public.list_feedback(10);
  if n <> 0 then raise exception '0125: signed-out caller listed feedback'; end if;

  select id into stranger from public.profiles where coalesce(is_admin,false) = false limit 1;
  if stranger is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', stranger::text)::text, true);
    select count(*) into n from public.list_feedback(10);
    if n <> 0 then raise exception '0125: a non-admin listed feedback'; end if;
    if public.feedback_unread_count() <> 0 then
      raise exception '0125: a non-admin got a feedback count';
    end if;
  end if;

  select id into kenton from public.profiles where display_name = 'Kenton M' and is_admin;
  if kenton is null then
    raise notice '0125: no admin profile — admin proofs skipped';
    perform set_config('request.jwt.claims', null, true);
    return;
  end if;

  -- The trigger must not be able to fail an insert. Insert, confirm the row
  -- landed, then remove it.
  insert into public.feedback (category, message, app_version, platform)
       values ('bug', '0125 self-test, safe to ignore', '0.1.9', 'ios')
    returning id into test_id;
  if test_id is null then raise exception '0125: the trigger blocked an insert'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  if public.feedback_unread_count() < 1 then
    raise exception '0125: the admin count did not see the new row';
  end if;
  select count(*) into n from public.list_feedback(10) where id = test_id;
  if n <> 1 then raise exception '0125: the admin list did not return the new row'; end if;

  delete from public.feedback where id = test_id;
  perform set_config('request.jwt.claims', null, true);
end $$;
