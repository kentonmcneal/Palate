-- ============================================================================
-- 0020_feed_visit_events.sql
-- ----------------------------------------------------------------------------
-- Adds 'visit_logged' to the feed_event_kind enum so we can auto-emit a
-- low-friction "your friend logged X" entry to the feed without it being a
-- real-time push storm.
-- ============================================================================

alter type feed_event_kind add value if not exists 'visit_logged';
