-- ============================================================================
-- 0045_notify_admin_waitlist.sql
-- ----------------------------------------------------------------------------
-- Push-notify admins when someone lands on the waitlist.
--
-- Fires whenever a profile's approval_status becomes 'pending' — either a brand
-- new signup (INSERT, since 0043 defaults new rows to 'pending') or an admin
-- moving someone back to pending. Calls the notify-admin-waitlist edge function
-- via pg_net, authenticated with the shared Vault `cron_secret` (same pattern
-- as the featured-lists / Sunday-Wrapped crons, migrations 0017 & 0038).
--
-- OPERATOR PREREQUISITES (all already satisfied if the existing crons work):
--   1. Vault secret `cron_secret` exists (reused from 0017/0038).
--   2. notify-admin-waitlist deployed with JWT verification disabled
--      (`supabase functions deploy notify-admin-waitlist --no-verify-jwt`) and
--      its CRON_SECRET edge-function env var equals the Vault secret.
--   3. The admin has opened the app with notifications enabled at least once,
--      so profiles.push_token is populated for the admin row.
--
-- Best-effort: pg_net fires the request asynchronously and never blocks or
-- fails the signup, even if the function is down.
-- ============================================================================

create extension if not exists pg_net;

create or replace function public.notify_admin_new_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only on a transition INTO 'pending' (new signup, or reset to pending).
  if new.approval_status = 'pending'
     and (tg_op = 'INSERT' or coalesce(old.approval_status, '') is distinct from 'pending')
  then
    perform net.http_post(
      url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/notify-admin-waitlist',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1),
          ''
        ),
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1),
          ''
        )
      ),
      body := jsonb_build_object('new_user_id', new.id::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_admin_new_waitlist on public.profiles;

create trigger trg_notify_admin_new_waitlist
  after insert or update of approval_status on public.profiles
  for each row
  execute function public.notify_admin_new_waitlist();
