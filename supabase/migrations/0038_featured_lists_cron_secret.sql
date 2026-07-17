-- ============================================================================
-- 0038_featured_lists_cron_secret.sql
-- ----------------------------------------------------------------------------
-- Re-schedules the nightly featured-lists refresh to authenticate with the
-- shared CRON_SECRET.
--
-- WHY: the featured-lists-refresh edge function was hardened (0036 era) so that
-- `refresh_all_active` now REQUIRES the `x-cron-secret` request header to equal
-- the function's CRON_SECRET env var — because it calls Google Places Text
-- Search directly, outside the places-proxy daily kill-switch, and must never
-- run for an unauthenticated caller. The original 0025 cron sent only an
-- `Authorization: Bearer <service key>` header (and shipped with unsubstituted
-- `YOUR-PROJECT` / `YOUR-SERVICE-ROLE-KEY` placeholders), so after the hardening
-- deploys the nightly job would 401 and the Featured Lists cache would quietly
-- stop refreshing. This migration fixes that.
--
-- OPERATOR PREREQUISITES (same shared secret used by the Sunday Wrapped cron):
--   1. Vault secret `cron_secret` exists and equals the edge function's
--      CRON_SECRET env var. If you already did this for 0017 (Sunday Wrapped),
--      nothing more to do — this reuses the same secret. Otherwise:
--        select vault.create_secret('cron_secret', '<your-random-string>');
--      and set the SAME value as the Edge Function secret CRON_SECRET
--      (for BOTH generate-weekly-wrapped and featured-lists-refresh).
--   2. Deploy featured-lists-refresh with JWT verification disabled
--      (`supabase functions deploy featured-lists-refresh --no-verify-jwt`),
--      matching the Sunday Wrapped function — the cron sends the shared secret,
--      not a JWT.
--   3. Run this migration.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any prior schedule so re-running this migration is idempotent. Handles
-- both the 0025 job and any partial re-run of this one.
do $$
declare
  job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'featured_lists_refresh_nightly';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end$$;

-- Nightly at 04:00 UTC. Sends the shared cron secret as `x-cron-secret` (which
-- the function checks for refresh_all_active) plus a matching Authorization
-- bearer so the request shape mirrors the working Sunday Wrapped cron (0017).
-- The secret is read from Vault so it never appears in the migration text.
select cron.schedule(
  'featured_lists_refresh_nightly',
  '0 4 * * *',
  $cron$
    select net.http_post(
      url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/featured-lists-refresh',
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
      body := jsonb_build_object('action', 'refresh_all_active')
    ) as request_id;
  $cron$
);
