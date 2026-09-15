-- ============================================================================
-- 0174 — the reviews backfill, as a job that finishes and then stops.
-- ----------------------------------------------------------------------------
-- All 5,137 restaurants were created by searchNearby, which uses the cheap
-- field mask, and nothing ever upgraded them to a Place Details call. So
-- review_snippets, editorial_summary and vibe were empty on every row, and the
-- qualitative signal the recommendation engine is supposed to read did not
-- exist.
--
-- reclassify now has a reviews mode (rich field mask, writes the review
-- columns, explicitly no LLM). Verified by hand before scheduling this:
-- 25 rows then 100 rows, 125 processed, 125 updated, 0 failed, and
-- google_usage_counter moved by exactly the number of rows each time.
--
-- WHY THIS IS SAFE TO LEAVE RUNNING
--
--   * SELF-TERMINATING. The `where exists` below means the job stops firing
--     the moment no row has a null reviews_refreshed_at. Without it this
--     becomes a perpetual 30-day refresh cycle — recurring spend nobody
--     approved — because expired rows re-enter the queue by design.
--   * The shared kill switch still bounds the day. reclassify re-checks
--     google_usage_counter BEFORE EVERY ROW, so a run that crosses the cap
--     mid-way stops there rather than finishing the batch.
--   * 100 rows per fire, every 10 minutes: 600 calls/hour against a 1500/day
--     cap. It cannot monopolise the budget faster than the cap allows, and it
--     yields to real users because they share the same counter.
--   * One fire at a time. Resumption works by reviews_refreshed_at advancing,
--     so overlapping runs would select the same head rows and pay twice for
--     them. Ten minutes is comfortably longer than a 100-row run measured at
--     well under 150 seconds.
--
-- TO STOP IT EARLY:
--   select cron.unschedule(jobid) from cron.job where jobname = 'reviews_backfill';
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'reviews_backfill';
select cron.schedule(
  'reviews_backfill',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := 'https://oxzsspbojeyeelbjqjdx.supabase.co/functions/v1/reclassify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), '')
      ),
      body := jsonb_build_object('reviews', true, 'limit', 100, 'commit', true),
      timeout_milliseconds := 180000
    )
    where exists (
      select 1 from public.restaurants where reviews_refreshed_at is null
    );
  $cron$
);

do $$
declare remaining int;
begin
  if not exists (select 1 from cron.job where jobname='reviews_backfill' and active) then
    raise exception '0174: reviews_backfill is not scheduled';
  end if;
  select count(*) into remaining from public.restaurants where reviews_refreshed_at is null;
  raise notice '0174: scheduled; % rows still need review text (~% runs, ~% hours)',
    remaining, ceil(remaining / 100.0), round(ceil(remaining / 100.0) / 6.0, 1);
end $$;
