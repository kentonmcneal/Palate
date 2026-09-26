-- ============================================================================
-- 0176 — stop the reviews backfill, and stop it from re-arming itself.
-- ----------------------------------------------------------------------------
-- WHAT HAPPENED
--
-- 0174/0175 scheduled `reviews_backfill` to call reclassify with the rich
-- field mask 42 times a night. That mask bills at Google's Place Details
-- Enterprise + Atmosphere SKU, ~$0.025/call, not the near-free Essentials rate
-- the 1500/day cap was sized against. The cap is denominated in CALLS, so it
-- never noticed the price per call went up ~5x when the mask changed.
--
-- Observed: $300 of Google Cloud charges between Sep 15 and Sep 23 2026
-- ($100 auto-paid Sep 18, $200 Sep 23). $300 / 8 days = $37.50/day, which is
-- exactly 1500 x $0.025. The kill switch was not broken — the job simply
-- pinned it to the ceiling every single night. Run rate ~$1,140/month.
--
-- WHY IT NEVER FINISHED (0174 claimed it was self-terminating; it was not)
--
--   1. reclassify stamps `refreshed_at` on a failed fetch, never
--      `reviews_refreshed_at`. A dead place_id stays null forever, sits at the
--      head of the nulls-first ordering, is re-fetched and re-paid every run,
--      and keeps the `where exists (... is null)` cron guard permanently true.
--   2. The batch query only ORDERS nulls-first; it never FILTERS on null. Once
--      nulls run short each run tops the batch up with already-fresh rows and
--      pays for them again.
--   3. prune_stale_review_text (0173) nulls `reviews_refreshed_at` at 30 days,
--      which re-arms the cron guard wholesale. That is precisely the
--      "perpetual 30-day refresh cycle — recurring spend nobody approved"
--      0174's comment said the guard prevented. First wave would have been
--      ~Oct 15.
--
-- (1) and (2) live in the edge function and are NOT fixed here — this
-- migration's job is to make sure nothing is calling it. Re-running the
-- backfill requires fixing those first AND scoping it: the product has two
-- users, on the Hampton Roads -> DC -> Baltimore -> Philadelphia -> NYC
-- corridor. Sweeping all 5,137 rows nationwide, eligible or not, was the
-- expensive part of the mistake.
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'reviews_backfill';

-- ----------------------------------------------------------------------------
-- The 30-day expiry stays — it is a Google Places terms obligation, not an
-- optimisation. What changes is that it no longer nulls the CURSOR.
--
-- reviews_refreshed_at now means "when we last paid Google for this row's
-- text", which is the honest thing for a spend cursor to mean, and it survives
-- the text it fetched. The pipeline 0173 describes is unchanged: fetch text,
-- derive tags from it, let the text expire, keep the derivation. Re-fetching
-- text we have already derived from buys nothing and costs $0.025 a row.
-- ----------------------------------------------------------------------------
create or replace function public.prune_stale_review_text()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.restaurants
     set review_snippets   = null,
         editorial_summary = null
   where reviews_refreshed_at is not null
     and reviews_refreshed_at < now() - interval '30 days'
     and (review_snippets is not null or editorial_summary is not null);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.prune_stale_review_text() from public, anon, authenticated;

comment on function public.prune_stale_review_text() is
  'Google Places terms cap content caching at 30 days. Nulls review_snippets and editorial_summary past that, keeping the derived tags/vibe, which are ours. Deliberately does NOT null reviews_refreshed_at: that is the paid-fetch cursor, and nulling it re-queued every row for a fresh $0.025 fetch every 30 days (see 0176 header).';

-- ---- proofs ----------------------------------------------------------------
-- 0173's probe clobbered a real row and then nulled its review columns to
-- "leave it as we found it". That was harmless when every row was empty. It is
-- NOT harmless now: eight days of backfill means rows carry real text, and
-- nulling reviews_refreshed_at would also push the victim back into the paid
-- queue. This snapshots the row and restores exactly what was there.
do $$
declare
  victim        uuid;
  o_snips       text[];
  o_summary     text;
  o_stamp       timestamptz;
  snips         text[];
  stamp         timestamptz;
begin
  if exists (select 1 from cron.job where jobname = 'reviews_backfill') then
    raise exception '0176: reviews_backfill is STILL scheduled';
  end if;

  if not exists (select 1 from cron.job where jobname = 'prune_stale_review_text' and active) then
    raise exception '0176: the 30-day expiry cron went missing; terms obligation is unmet';
  end if;

  select id, review_snippets, editorial_summary, reviews_refreshed_at
    into victim, o_snips, o_summary, o_stamp
    from public.restaurants
   order by id
   limit 1;

  if victim is null then
    raise notice '0176: no restaurants to probe against; skipping behavioural proof';
    return;
  end if;

  -- A 31-day-old row: the text must go, the cursor must stay.
  update public.restaurants
     set review_snippets      = array['probe snippet'],
         editorial_summary    = 'probe summary',
         reviews_refreshed_at = now() - interval '31 days'
   where id = victim;

  perform public.prune_stale_review_text();

  select review_snippets, reviews_refreshed_at into snips, stamp
    from public.restaurants where id = victim;

  if snips is not null then
    raise exception '0176: expired text was NOT cleared — terms obligation broken';
  end if;
  if stamp is null then
    raise exception '0176: the prune nulled the cursor; the 30-day re-spend loop is still live';
  end if;

  -- A fresh row must be untouched.
  update public.restaurants
     set review_snippets      = array['fresh snippet'],
         editorial_summary    = 'fresh summary',
         reviews_refreshed_at = now()
   where id = victim;

  perform public.prune_stale_review_text();

  select review_snippets into snips from public.restaurants where id = victim;
  if snips is null then
    raise exception '0176: the prune wrongly cleared a FRESH row';
  end if;

  -- Restore the row's ACTUAL prior contents, not nulls.
  update public.restaurants
     set review_snippets      = o_snips,
         editorial_summary    = o_summary,
         reviews_refreshed_at = o_stamp
   where id = victim;

  if exists (
    select 1 from public.restaurants
     where id = victim
       and (review_snippets is distinct from o_snips
         or editorial_summary is distinct from o_summary
         or reviews_refreshed_at is distinct from o_stamp)
  ) then
    raise exception '0176: probe did not restore the victim row';
  end if;

  raise notice '0176: backfill unscheduled; expiry keeps the terms obligation, no longer re-arms the queue, and the probe row was restored';
end $$;
