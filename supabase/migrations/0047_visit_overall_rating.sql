-- ============================================================================
-- 0047_visit_overall_rating.sql
-- ----------------------------------------------------------------------------
-- An overall "how was this place" reaction for a visit, independent of any
-- specific dish. Powers the "What did you get?" screen: tapping Loved / OK /
-- Not for me with no dish name saves the sentiment against the visit itself
-- (dish name stays optional). Same three-value vocabulary as menu_item_ratings.
-- ============================================================================

alter table public.visits
  add column if not exists overall_rating text
    check (overall_rating in ('loved', 'ok', 'not_for_me') or overall_rating is null);
