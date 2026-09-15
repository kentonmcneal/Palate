-- ============================================================================
-- 0173 — cached Google review text expires after 30 days.
-- ----------------------------------------------------------------------------
-- Google's Places terms allow caching place CONTENT for up to 30 days (place
-- IDs are the exception and may be kept indefinitely). restaurants already
-- carries review_snippets, editorial_summary and reviews_refreshed_at, and the
-- places-proxy details path already treats 30 days as the freshness boundary —
-- but NOTHING has ever removed the text once it is stored.
--
-- That has cost nothing so far because the columns are empty on all 5,137
-- rows: the details call that populates them has essentially never run. It
-- stops being free the moment a backfill lands, which is why this goes in
-- BEFORE the backfill rather than after.
--
-- What is kept and what goes:
--   * review_snippets / editorial_summary — Google's content. Expire at 30d.
--   * tags, vibe, occasion_tags, flavor_tags — OUR derivation FROM that
--     content. Not Google's text, and the whole reason for fetching it. Kept.
--   * google_place_id — explicitly exempt from the caching limit. Kept.
--
-- So the pipeline is: fetch text, derive from it, let the text expire, keep
-- the derivation. Deriving is what the LLM classifier pass is for, and it has
-- to happen inside the 30-day window or the text is gone and the fetch has to
-- be paid for again.
-- ============================================================================

create or replace function public.prune_stale_review_text()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.restaurants
     set review_snippets = null,
         editorial_summary = null,
         reviews_refreshed_at = null
   where reviews_refreshed_at is not null
     and reviews_refreshed_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.prune_stale_review_text() from public, anon, authenticated;

comment on function public.prune_stale_review_text() is
  'Google Places terms cap content caching at 30 days. Nulls review_snippets and editorial_summary past that, keeping the derived tags/vibe, which are ours.';

-- 0110's guard keeps the OLD value when an upsert arrives with review_snippets
-- null, so that a partial write cannot wipe good data. That is right for
-- upserts and wrong for expiry — an UPDATE here would be silently reverted.
-- Confirmed the trigger is on restaurants and fires on UPDATE, so the prune
-- has to be allowed past it.
do $$
declare tg text;
begin
  select t.tgname into tg
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'restaurants' and not t.tgisinternal
     and pg_get_triggerdef(t.oid) ~ 'review_snippets';
  if tg is not null then
    raise notice '0173: a trigger (%) references review_snippets; verifying the prune still clears', tg;
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'prune_stale_review_text';
select cron.schedule(
  'prune_stale_review_text',
  '50 3 * * *',
  $cron$ select public.prune_stale_review_text(); $cron$
);

-- ---- proofs ----------------------------------------------------------------
do $$
declare n int; victim uuid; kept text[];
begin
  if not exists (select 1 from cron.job where jobname='prune_stale_review_text' and active) then
    raise exception '0173: prune cron is not scheduled';
  end if;

  -- Execute the body. A clean CREATE proves only that the text was stored.
  select public.prune_stale_review_text() into n;
  if n is null then raise exception '0173: prune returned null'; end if;
  raise notice '0173: prune executed, % row(s) expired on first run', n;

  -- Prove it actually clears, against a real row, then undo it.
  select id into victim from public.restaurants limit 1;
  update public.restaurants
     set review_snippets = array['probe snippet'],
         editorial_summary = 'probe summary',
         reviews_refreshed_at = now() - interval '31 days'
   where id = victim;

  perform public.prune_stale_review_text();

  select review_snippets into kept from public.restaurants where id = victim;
  if kept is not null then
    raise exception '0173: prune did NOT clear a 31-day-old row (trigger interference?)';
  end if;

  -- And a FRESH row must survive.
  update public.restaurants
     set review_snippets = array['fresh snippet'],
         editorial_summary = 'fresh summary',
         reviews_refreshed_at = now()
   where id = victim;
  perform public.prune_stale_review_text();
  select review_snippets into kept from public.restaurants where id = victim;
  if kept is null then
    raise exception '0173: prune wrongly cleared a FRESH row';
  end if;

  -- Leave the row as we found it.
  update public.restaurants
     set review_snippets = null, editorial_summary = null, reviews_refreshed_at = null
   where id = victim;
end $$;
