-- ============================================================================
-- 0141 — capture the history that already exists, before the prune takes it.
-- ----------------------------------------------------------------------------
-- 0140 starts the weekly snapshot going forward. The app has 129 days of
-- events behind it, and those weeks are just as unrecoverable once
-- prune_analytics_events reaches them. Backfilled once, here, so the series
-- starts at the beginning of the record rather than at the moment somebody
-- thought to keep it.
--
-- Idempotent: snapshot_rec_funnel upserts on (week_start, surface, slot, rank),
-- so re-running this migration recomputes rather than duplicates.
-- ============================================================================

select public.snapshot_rec_funnel(26);
