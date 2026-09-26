-- ============================================================================
-- 0177 — a row that cannot be fetched must eventually stop being fetched.
-- ----------------------------------------------------------------------------
-- The reviews backfill re-paid for the same rows forever because reclassify
-- stamps `refreshed_at` on a failed fetch and never `reviews_refreshed_at`.
-- In reviews mode the sweep orders by `reviews_refreshed_at` nulls-first, so a
-- permanently-dead google_place_id (404 NOT_FOUND on a place Google has since
-- removed) sat at the head of the queue and was re-fetched on every single run
-- — and kept the cron's `where exists (... is null)` guard true forever, which
-- is why a job billed as self-terminating ran for eight days at the cap.
--
-- Success is already recorded by reviews_refreshed_at. This records FAILURE,
-- so the two together can express "done" and the queue can actually drain.
--
-- Three strikes, not one: a 5xx or a rate-limit is transient and a row should
-- survive it. A place ID that fails three separate runs is dead, and retiring
-- it costs us one row of review text, against $0.025 every ten minutes
-- forever if we do not.
-- ============================================================================

alter table public.restaurants
  add column if not exists reviews_attempts smallint not null default 0;

comment on column public.restaurants.reviews_attempts is
  'Consecutive failed Place Details fetches in reviews mode. Reset to 0 on success. At >= 3 the row is retired from the backfill queue so a dead place_id cannot be re-paid for forever (0177).';

-- The queue the backfill actually walks: unfilled AND not yet retired.
-- Partial, so it stays small and shrinks to nothing as the sweep completes —
-- and `select count(*) from this` is the honest "are we done" signal.
create index if not exists restaurants_reviews_backfill_queue_idx
  on public.restaurants (reviews_refreshed_at)
  where reviews_refreshed_at is null and reviews_attempts < 3;

do $$
declare queued int; retired int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'restaurants'
       and column_name = 'reviews_attempts'
  ) then
    raise exception '0177: reviews_attempts was not added';
  end if;

  select count(*) filter (where reviews_refreshed_at is null and reviews_attempts < 3),
         count(*) filter (where reviews_attempts >= 3)
    into queued, retired
    from public.restaurants;

  raise notice '0177: % rows queued for review text, % retired as unfetchable', queued, retired;
end $$;
