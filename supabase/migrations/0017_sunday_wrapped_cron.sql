-- ============================================================================
-- 0017_sunday_wrapped_cron.sql
-- ----------------------------------------------------------------------------
-- Schedules the generate-weekly-wrapped edge function to run every Sunday at
-- 9am ET (= 14:00 UTC). Uses pg_cron + pg_net (both enabled by default in
-- Supabase Pro; on Free, you may need to enable them in the dashboard:
-- Database → Extensions → pg_cron, pg_net).
--
-- Setup steps for the operator:
--   1. Enable pg_cron + pg_net extensions in the Supabase dashboard.
--   2. In Supabase SQL editor, run:
--        select vault.create_secret('cron_secret', '<your-random-string>');
--      and add the same value to the Edge Function secrets as CRON_SECRET.
--   3. Run this migration. The schedule fires every Sunday 9am ET.
--
-- The cron job hits the edge function via pg_net.http_post with the secret.
-- ============================================================================

-- Make sure pg_cron + pg_net are available
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior schedule so re-running this migration is idempotent.
do $$
begin
  perform cron.unschedule('palate_sunday_wrapped');
exception when others then null;
end $$;

-- Schedule: every Sunday at 14:00 UTC (= 9am ET / 10am EDT depending on DST).
-- Cron format: minute hour day month day-of-week (0 = Sunday)
select cron.schedule(
  'palate_sunday_wrapped',
  '0 14 * * 0',
  $cron$
    select net.http_post(
      url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/generate-weekly-wrapped',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1),
          ''
        )
      ),
      body := '{}'::jsonb
    ) as request_id;
  $cron$
);
