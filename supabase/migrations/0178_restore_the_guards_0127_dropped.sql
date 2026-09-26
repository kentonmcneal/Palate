-- ============================================================================
-- 0178 — restore the enrichment guards 0127 silently dropped.
-- ----------------------------------------------------------------------------
-- THE ACTUAL ROOT CAUSE OF THE $300, found while reviewing the 0176/0177 fix.
--
-- 0110 taught restaurants_preserve_enrichment to keep a known value when a
-- cheap upsert arrives with nulls. 0127 added business_status by rewriting the
-- whole function with `create or replace` — and the rewrite silently lost
-- EIGHT guards that 0110 had:
--
--     review_snippets, editorial_summary, reviews_refreshed_at,
--     tags, classification_confidence, google_raw,
--     editorial_blurb, editorial_blurb_generated_at
--
-- places-proxy upserts EVERY place it sees on the nearby and search paths
-- (index.ts:344/347 and :497/500) via classifyAndBuildRow(..., useLLM:false),
-- which by design writes `review_snippets: null, editorial_summary: null,
-- reviews_refreshed_at: null` because the cheap field mask never asked Google
-- for that text. With the guards gone, those nulls LAND.
--
-- So ordinary browsing erases the exact data the backfill was paying for:
--
--   1. DATA LOSS. Review text and review-derived `tags` — which gems.ts scores
--      on — are wiped by any user opening the home screen near that place.
--   2. A MONEY LOOP. Nulling reviews_refreshed_at puts the row straight back
--      into the backfill queue at $0.025 a re-fetch. This is very likely the
--      dominant reason a 5,137-row sweep never terminated — bigger than the
--      dead-place_id pinning fixed in 0177 — and it is WORST inside the metro
--      scope, because that is precisely where the users browse.
--
-- Fixing 0176/0177 without this would have re-run the backfill into the same
-- loop, just with a tidier queue.
--
-- THE PRUNE STILL HAS TO WIN. 0173 worried a coalesce guard would silently
-- revert the 30-day expiry; it was right in principle and only safe because
-- 0127 had already removed the guard. Restoring it revives that conflict, so
-- the prune now announces itself with a transaction-local GUC and the trigger
-- stands aside for it. Nothing else can set that flag: prune_stale_review_text
-- is security definer and not executable by anon/authenticated.
-- ============================================================================

create or replace function public.restaurants_preserve_enrichment()
returns trigger language plpgsql as $$
declare
  pruning boolean := coalesce(current_setting('palate.pruning_review_text', true), '') = 'on';
begin
  -- Kept by 0127.
  new.cuisine_type      := coalesce(new.cuisine_type, old.cuisine_type);
  new.cuisine_region    := coalesce(new.cuisine_region, old.cuisine_region);
  new.cuisine_subregion := coalesce(new.cuisine_subregion, old.cuisine_subregion);
  new.cultural_context  := coalesce(new.cultural_context, old.cultural_context);
  new.vibe              := coalesce(new.vibe, old.vibe);
  new.menu_style        := coalesce(new.menu_style, old.menu_style);
  new.price_feel        := coalesce(new.price_feel, old.price_feel);
  new.ambiance_notes    := coalesce(new.ambiance_notes, old.ambiance_notes);
  new.llm_backfill_at   := coalesce(new.llm_backfill_at, old.llm_backfill_at);
  new.business_status   := coalesce(new.business_status, old.business_status);
  if new.occasion_tags is null or cardinality(new.occasion_tags) = 0 then new.occasion_tags := old.occasion_tags; end if;
  if new.flavor_tags   is null or cardinality(new.flavor_tags)   = 0 then new.flavor_tags   := old.flavor_tags;   end if;
  if new.crowd_energy  is null or cardinality(new.crowd_energy)  = 0 then new.crowd_energy  := old.crowd_energy;  end if;

  -- Restored. Derived from paid text and NOT re-derivable from a cheap mask.
  new.classification_confidence    := coalesce(new.classification_confidence, old.classification_confidence);
  new.google_raw                   := coalesce(new.google_raw, old.google_raw);
  new.editorial_blurb              := coalesce(new.editorial_blurb, old.editorial_blurb);
  new.editorial_blurb_generated_at := coalesce(new.editorial_blurb_generated_at, old.editorial_blurb_generated_at);
  if new.tags is null or cardinality(new.tags) = 0 then new.tags := old.tags; end if;

  -- Restored, but the 30-day prune must still be able to clear the two text
  -- columns. reviews_refreshed_at is guarded unconditionally: 0176 made the
  -- prune stop nulling it, so nothing legitimate ever clears the paid cursor.
  new.reviews_refreshed_at := coalesce(new.reviews_refreshed_at, old.reviews_refreshed_at);
  if not pruning then
    new.editorial_summary := coalesce(new.editorial_summary, old.editorial_summary);
    if new.review_snippets is null or cardinality(new.review_snippets) = 0 then
      new.review_snippets := old.review_snippets;
    end if;
  end if;

  return new;
end $$;

create or replace function public.prune_stale_review_text()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  -- Transaction-local: tells restaurants_preserve_enrichment to stand aside so
  -- the terms-mandated expiry is not coalesced back into place (0178).
  perform set_config('palate.pruning_review_text', 'on', true);
  update public.restaurants
     set review_snippets   = null,
         editorial_summary = null
   where reviews_refreshed_at is not null
     and reviews_refreshed_at < now() - interval '30 days'
     and (review_snippets is not null or editorial_summary is not null);
  get diagnostics n = row_count;
  perform set_config('palate.pruning_review_text', 'off', true);
  return n;
end $$;

revoke all on function public.prune_stale_review_text() from public, anon, authenticated;

-- ---- proofs ----------------------------------------------------------------
-- Probed against a SYNTHETIC row that is inserted and deleted here, never a
-- real one. Mutating a real row and then "restoring" it cannot work now: the
-- guards this migration installs would coalesce the restore-to-null straight
-- back to the probe values. That trap is exactly what these guards exist to
-- create, so the probe must not rely on being able to clear a row.
do $$
declare
  probe_id  text := '__0178_probe__';
  snips     text[]; stamp timestamptz; tg text[]; summ text;
begin
  delete from public.restaurants where google_place_id = probe_id;

  insert into public.restaurants (google_place_id, name, review_snippets,
                                  editorial_summary, reviews_refreshed_at, tags)
  values (probe_id, '0178 probe', array['paid snippet'],
          'paid summary', now(), array['rooftop']);

  -- THE REGRESSION: exactly what places-proxy's nearby/search upsert writes
  -- (classifyAndBuildRow with useLLM:false nulls all three text fields).
  update public.restaurants
     set review_snippets = null, editorial_summary = null,
         reviews_refreshed_at = null, tags = null
   where google_place_id = probe_id;

  select review_snippets, editorial_summary, reviews_refreshed_at, tags
    into snips, summ, stamp, tg
    from public.restaurants where google_place_id = probe_id;

  if snips is null then raise exception '0178: a cheap upsert still erases review_snippets'; end if;
  if summ  is null then raise exception '0178: a cheap upsert still erases editorial_summary'; end if;
  if stamp is null then raise exception '0178: a cheap upsert still erases reviews_refreshed_at — the money loop is live'; end if;
  if tg    is null then raise exception '0178: a cheap upsert still erases tags'; end if;

  -- And the prune must STILL win over the guard.
  update public.restaurants
     set reviews_refreshed_at = now() - interval '31 days'
   where google_place_id = probe_id;

  perform public.prune_stale_review_text();

  select review_snippets, editorial_summary, reviews_refreshed_at
    into snips, summ, stamp
    from public.restaurants where google_place_id = probe_id;

  if snips is not null then raise exception '0178: the guard now blocks the 30-day expiry — terms obligation broken'; end if;
  if summ  is not null then raise exception '0178: editorial_summary survived the expiry'; end if;
  if stamp is null then raise exception '0178: the prune nulled the cursor again'; end if;

  -- The flag must not leak past the prune and leave text unprotected.
  if coalesce(current_setting('palate.pruning_review_text', true), '') = 'on' then
    raise exception '0178: the prune left its bypass flag set';
  end if;

  delete from public.restaurants where google_place_id = probe_id;
  if exists (select 1 from public.restaurants where google_place_id = probe_id) then
    raise exception '0178: probe row was not cleaned up';
  end if;

  raise notice '0178: guards restored; cheap upserts no longer erase paid data; prune still expires text';
end $$;
