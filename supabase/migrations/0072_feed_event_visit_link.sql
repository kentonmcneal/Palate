-- ============================================================================
-- 0072_feed_event_visit_link.sql
-- ----------------------------------------------------------------------------
-- Link a visit_logged feed post back to the visit that produced it.
--
-- Feed events are emitted app-side at save time and are otherwise decoupled
-- from the visits row: the payload carries a name and a google_place_id, and
-- nothing else. That was fine while every visit was public. With per-visit
-- visibility (0071) it is not — hiding a visit has to retract the post that
-- announced it, and matching on payload + timestamp proximity would be a guess
-- that quietly retracts the wrong one.
--
-- ON DELETE CASCADE: deleting a visit should take its announcement with it.
-- Today that leaves an orphaned post referencing a visit that no longer exists.
-- ============================================================================

alter table public.feed_events
  add column if not exists visit_id uuid references public.visits(id) on delete cascade;

comment on column public.feed_events.visit_id is
  'The visit this post announces, for visit_logged events only. Null for every '
  'other kind. Lets a visit being hidden or deleted retract its own post.';

create index if not exists feed_events_visit_idx
  on public.feed_events (visit_id)
  where visit_id is not null;
