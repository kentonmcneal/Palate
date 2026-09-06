-- ============================================================================
-- 0134 — the nearby cache can finally answer the question it was asked.
-- ----------------------------------------------------------------------------
-- Two independent bugs made a hit structurally impossible on the paths that
-- repeat, and both come from the same misunderstanding of what this table is.
--
-- nearby_cache_regions does NOT store places. It records COVERAGE: "we asked
-- Google about this area recently, so what it knows is already in
-- public.restaurants." The read then serves from restaurants by bounding box.
-- Once that is clear, both fixes are obviously correct rather than trades.
--
-- BUG 1 — CACHE_MIN_RESULTS = 15, applied to a 75m radius.
--
-- The threshold is a proxy for "was this a COMPLETE answer", and it is a bad
-- proxy. Measured: at 75m across 19 cells Google's own maximum return was 4,
-- and at 250m across 18 cells it was 14. So every small-radius row ever
-- written is permanently unservable — a 0% hit rate that no amount of repeat
-- visiting can improve. Those two radii are passive-capture resolve (75) and
-- auto-detect (250): the two paths that hit the same coordinates day after day
-- and the most expensive path in the product.
--
-- The honest test for completeness is TRUNCATION, not density. Google returns
-- at most NEARBY_MAX_RESULTS (20). If a fetch came back with fewer, we saw
-- everything in that radius and the answer is complete — even when it is
-- three, even when it is zero. If it came back with exactly 20 it may have
-- been cut off, and only then does density matter.
--
-- BUG 2 — the radius is in the key, so one cell is bought up to five times.
--
-- Coverage was matched with `.eq("radius_m", radius)`, so a cell already
-- fetched at 3000m did not answer the same cell asked at 75m. Measured: 63
-- coverage rows over 27 distinct cells; one cell covered at five radii; pairs
-- written 6-10ms apart by a single Home mount, because Home asks 3000 while
-- RightNow and Discover ask 2500.
--
-- The fix is a SUPERSET test, not dropping the radius. A fetch at radius R
-- covers any query at radius r <= R, because the wider fetch already put those
-- restaurants in the table. Dropping the radius entirely would be wrong in the
-- other direction — a 75m fetch cannot answer a 3000m query — and that is what
-- an earlier reviewer correctly refused.
-- ============================================================================

alter table public.nearby_cache_regions
  -- What Google actually returned, before the eligibility filter. result_count
  -- became the POST-filter count when the miss loop was fixed, which is right
  -- for the density test and useless for the truncation test.
  add column if not exists raw_count integer;

-- Backfill conservatively: rows written before this column existed have an
-- unknown raw count. Treating unknown as "possibly truncated" keeps the old
-- behaviour for them rather than serving something we cannot vouch for.
update public.nearby_cache_regions set raw_count = null where raw_count is not null and false;

-- The read looks for the SMALLEST covering radius, so it prefers the tightest
-- guarantee available rather than the widest.
create index if not exists nearby_cache_regions_cover_idx
  on public.nearby_cache_regions (lat_bucket, lng_bucket, radius_m);

comment on column public.nearby_cache_regions.result_count is
  'Places surviving the recommendation-eligibility filter. Used for the density test on a possibly-truncated fetch.';
comment on column public.nearby_cache_regions.raw_count is
  'What Google returned before filtering. raw_count < 20 means the answer was complete at that radius. Null on rows predating 0134.';

-- ---- proofs --------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='nearby_cache_regions' and column_name='raw_count';
  if n <> 1 then raise exception '0134: raw_count is missing'; end if;

  -- Every existing row must read as "unknown", so none of them changes
  -- behaviour until it is next written.
  select count(*) into n from public.nearby_cache_regions where raw_count is not null;
  if n <> 0 then
    raise exception '0134: % pre-existing rows already claim a raw_count', n;
  end if;

  select count(*) into n from public.nearby_cache_regions;
  raise notice '0134: % coverage rows, all pending a raw_count on next write', n;
end $$;
