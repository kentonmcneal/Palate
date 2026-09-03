-- ============================================================================
-- 0070_restaurant_opening_hours.sql
-- ----------------------------------------------------------------------------
-- Store each venue's regular weekly opening hours.
--
-- WHY: passive capture's confidence scorer has no way to rule out a venue that
-- was closed when the user stopped nearby. That is the strongest cheap veto
-- available — on a block with four candidates, knowing three were shut turns a
-- coin flip into an answer — and it was the one input in the scoring table with
-- no data behind it (see docs/CAPTURE_SPEC.md).
--
-- COST: none. `regularOpeningHours` sits in the same Places API "Enterprise"
-- SKU tier as `rating`, `userRatingCount` and `priceLevel`, which every nearby
-- call already requests, and Google bills at the highest tier in the field mask.
-- Adding it does not move the tier.
--
-- SHAPE: Google's `regularOpeningHours.periods` verbatim —
--   [{ open: { day: 0-6, hour: 0-23, minute: 0-59 },
--      close: { day, hour, minute } }, ...]
-- Kept as jsonb rather than normalised into columns: it is read as a whole,
-- never queried by field, and Google's shape has edge cases (24-hour venues
-- omit `close`; overnight periods close on the following day) that a flattened
-- schema would quietly lose.
-- ============================================================================

alter table public.restaurants
  add column if not exists regular_opening_hours jsonb;

comment on column public.restaurants.regular_opening_hours is
  'Google Places regularOpeningHours.periods, verbatim. Null when unknown — '
  'callers must treat null as "no information", never as "closed".';
