-- ============================================================================
-- 0175 — the backfill must not eat the budget at dinner time.
-- ----------------------------------------------------------------------------
-- 0174 scheduled the sweep every ten minutes, all day. That is 600 calls an
-- hour against a SHARED 1500/day counter whose day rolls over at 00:00 UTC —
-- which is 7pm Central. So from tomorrow the job would wake exactly at the
-- dinner peak, drain the entire day's budget by about 9:30pm Central, and
-- leave every real user on the degraded path (`{places: [], degraded: true}`)
-- for the rest of the day.
--
-- It would have done that while working perfectly: nothing would fail, the
-- kill switch would trip precisely as designed, and the only symptom would be
-- that search quietly stopped finding things during the busiest hours of a
-- restaurant app. Tonight it was invisible because it started at 11pm Central
-- with the app asleep.
--
-- Restricted to 06:00-12:59 UTC, which is 1am-8am Central:
--
--   * The UTC day opens at 7pm Central, so evening diners spend from a FRESH
--     1500 before this job wakes at all. They get first claim, not leftovers.
--   * The window closes at 8am Central, well before lunch, so the remaining
--     budget is there for the day.
--   * Seven hours x 6 runs is 42 fires, far more than the leftover budget
--     allows, so the daily cap — not the schedule — is what actually bounds
--     the spend. The schedule only decides WHEN, never how much.
--
-- Same self-terminating guard as 0174: once no row has a null
-- reviews_refreshed_at, it stops firing rather than becoming a perpetual
-- 30-day refresh cycle.
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'reviews_backfill';
select cron.schedule(
  'reviews_backfill',
  '*/10 6-12 * * *',
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
declare sched text; remaining int;
begin
  select schedule into sched from cron.job where jobname='reviews_backfill' and active;
  if sched is null then raise exception '0175: reviews_backfill is not scheduled'; end if;
  if sched <> '*/10 6-12 * * *' then
    raise exception '0175: unexpected schedule %', sched;
  end if;
  select count(*) into remaining from public.restaurants where reviews_refreshed_at is null;
  raise notice '0175: window 06:00-12:59 UTC; % rows left (~% nights at ~1400/night)',
    remaining, round(remaining / 1400.0, 1);
end $$;
