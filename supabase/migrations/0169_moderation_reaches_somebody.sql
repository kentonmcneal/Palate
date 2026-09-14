-- ============================================================================
-- 0169 — a content report reaches somebody.
-- ----------------------------------------------------------------------------
-- feed.tsx promises "We'll review this within 24 hours" and the live Terms
-- promise removal and termination on the same clock. Behind that promise:
-- content_reports has no trigger, no SELECT policy for users, and no admin
-- screen. The only reader is a local service-role script. It is a published
-- legal commitment with no mechanism, and a report nobody reads is worse than
-- no report, because the reporter believes they were heard.
--
-- This is 0125 applied to moderation, deliberately and exactly:
--
--   1. A push to the founder's device via ALERT_PUSH_TOKEN. Immediate, and
--      INDEPENDENT of feature_flags.server_push — that flag gates user-facing
--      product notifications and is off on purpose; an operational alert to
--      one device is a different thing.
--   2. An open count and a list the admin screen can read without a push, a
--      token, or any network service being up. This is the one that cannot
--      break, and it is why the SLA becomes keepable rather than merely
--      promised.
--
-- What this does NOT do is act on reports. Triage is still a human reading the
-- list and deciding. The gap being closed here is that nobody was told.
-- ============================================================================

-- ---- 1. the push -----------------------------------------------------------
create or replace function public.notify_content_report_filed()
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
    body := jsonb_build_object('report_id', new.id),
    timeout_milliseconds := 4000
  );
  return new;
exception when others then
  -- Somebody reporting harassment must never see an error because our
  -- alerting is down. This is the whole reason it is an AFTER trigger that
  -- swallows.
  return new;
end $$;

drop trigger if exists content_report_notify on public.content_reports;
create trigger content_report_notify
  after insert on public.content_reports
  for each row execute function public.notify_content_report_filed();

-- ---- 2. the count and list that cannot break -------------------------------
-- Admin only. Reports name a reporter and a target, so both functions are
-- gated on profiles.is_admin the same way the feedback pair is.
create or replace function public.open_report_count()
returns integer language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
      then (select count(*)::int from public.content_reports where status = 'open')
    else 0
  end;
$$;
revoke all on function public.open_report_count() from public, anon;
grant execute on function public.open_report_count() to authenticated;

create or replace function public.list_content_reports(p_limit integer default 50)
returns table (
  id uuid, target_type text, target_id text, reason text, note text,
  status text, created_at timestamptz,
  reporter text, target_user text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    return;
  end if;
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.note,
         r.status, r.created_at,
         -- Display names, never login addresses.
         coalesce(rp.display_name, rp.username, 'Someone'),
         coalesce(tp.display_name, tp.username, 'Someone')
    from public.content_reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles tp on tp.id = r.target_user_id
   order by (r.status = 'open') desc, r.created_at desc
   limit greatest(1, least(p_limit, 200));
end $$;
revoke all on function public.list_content_reports(integer) from public, anon;
grant execute on function public.list_content_reports(integer) to authenticated;

create or replace function public.resolve_content_report(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('reviewed', 'actioned', 'dismissed') then
    raise exception 'bad status %', p_status using errcode = '22023';
  end if;
  update public.content_reports set status = p_status where id = p_id and status = 'open';
end $$;
revoke all on function public.resolve_content_report(uuid, text) from public, anon;
grant execute on function public.resolve_content_report(uuid, text) to authenticated;

-- ---- proofs ----------------------------------------------------------------
-- plpgsql parses a function body at RUNTIME, so a clean push proves only that
-- the text was stored. These assertions make the migration fail if the objects
-- are not actually there and callable.
do $$
declare n int;
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'content_report_notify' and not tgisinternal
  ) then
    raise exception '0169: content_report_notify trigger is missing';
  end if;

  -- Executes the bodies rather than trusting that they compiled.
  select public.open_report_count() into n;
  if n is null then raise exception '0169: open_report_count returned null'; end if;
  perform * from public.list_content_reports(1);

  -- A non-admin (this session is the migration role, not a user) must get
  -- nothing back rather than an error, so the admin screen degrades quietly.
  if n <> 0 then
    raise exception '0169: open_report_count leaked % to a non-admin caller', n;
  end if;
end $$;

-- Anon must not be able to reach any of them.
do $$
declare ok boolean;
begin
  select has_function_privilege('anon', 'public.open_report_count()', 'execute') into ok;
  if ok then raise exception '0169: anon can execute open_report_count'; end if;
  select has_function_privilege('anon', 'public.list_content_reports(integer)', 'execute') into ok;
  if ok then raise exception '0169: anon can execute list_content_reports'; end if;
  select has_function_privilege('anon', 'public.resolve_content_report(uuid,text)', 'execute') into ok;
  if ok then raise exception '0169: anon can execute resolve_content_report'; end if;
end $$;
