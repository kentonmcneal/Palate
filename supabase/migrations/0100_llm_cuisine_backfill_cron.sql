-- ============================================================================
-- 0100_llm_cuisine_backfill_cron.sql — the Haiku pass, approved 2026-09-05.
-- ----------------------------------------------------------------------------
-- 373 rows have no cuisine because Google only calls them "restaurant". The
-- founder approved a Haiku pass over name + types (no Google call, ~$0.50).
-- The function refuses to run without ANTHROPIC_API_KEY, which is not set
-- yet; once the founder sets it, this cron drains the null rows in batches
-- of 40 and then costs nothing (it returns "nothing to do" in a millisecond).
-- Hard cap inside the function: 500 model calls per UTC day.
-- ============================================================================
select cron.unschedule(jobid) from cron.job where jobname = 'llm_cuisine_backfill';
select cron.schedule(
  'llm_cuisine_backfill',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/classify-cuisine-backfill',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), '')
      ),
      body := jsonb_build_object('limit', 40, 'commit', true),
      timeout_milliseconds := 120000
    ) as request_id;
  $cron$
);
