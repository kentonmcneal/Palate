-- ============================================================================
-- 0025_featured_lists_cron.sql
-- ----------------------------------------------------------------------------
-- Schedules a nightly refresh of the featured-lists cache for every active
-- city. Runs at 4 AM UTC (off-peak in the Americas, before users wake up
-- and open Discover).
--
-- This relies on pg_cron + pg_net extensions (Supabase has these enabled by
-- default). The cron job invokes the featured-lists-refresh edge function
-- with action=refresh_all_active.
-- ============================================================================

-- Make sure the extensions are present (no-op if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any prior schedule so re-running this migration is safe.
do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'featured_lists_refresh_nightly';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end$$;

-- Schedule the nightly refresh.
-- IMPORTANT: replace `https://YOUR-PROJECT.supabase.co` with your actual
-- project URL when running this migration. Supabase doesn't expose the
-- project URL inside SQL, so we hard-code it here. The service-role key
-- is also required — store it in vault and reference, OR put it directly
-- (the cron job runs on Supabase's infrastructure, so the service key
-- never leaves the postgres host).
--
-- TODO before running this migration: replace both placeholders below.
select cron.schedule(
  'featured_lists_refresh_nightly',
  '0 4 * * *',  -- every day at 04:00 UTC
  $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/featured-lists-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY'
    ),
    body := jsonb_build_object('action', 'refresh_all_active')
  );
  $$
);
