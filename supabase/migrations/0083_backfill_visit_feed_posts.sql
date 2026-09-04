-- ============================================================================
-- 0083_backfill_visit_feed_posts.sql — give the feed somebody other than its
-- owner in it.
-- ----------------------------------------------------------------------------
-- 0077 opened the feed so everyone sees everyone. It then showed 30 posts, all
-- written by one account, because feed events are emitted at logVisit time and
-- that code landed 2026-05-01. One user has 30 visits and 30 posts; another has
-- 18 visits and none, so their entire history is invisible to the product that
-- is supposed to be about sharing where people eat.
--
-- Scope is deliberately narrow: users with ZERO feed events, and only their
-- PUBLIC visits. Matching post-to-visit by timestamp proximity would be a
-- guess, and a wrong guess here means double-posting somebody's dinner.
--
-- Three things this does that the live emitter did not:
--
--   visit_id is set. The 30 existing posts have none (the column arrived in
--   0072), so hiding one of those visits cannot retract its post. Every
--   backfilled post can be retracted, by the RLS policy and by list_feed.
--
--   created_at is the VISIT time, not now. Backdating is the honest choice —
--   stamping eighteen meals from the last four months as having happened
--   tonight would put fiction at the top of everyone's feed.
--
--   Restaurants that resolve to nothing are skipped rather than posted with a
--   null name.
--
-- Notifications: pushes for feed posts are invoked from the CLIENT
-- (mobile/lib/feed.ts calls the notify-feed-post function). There is no trigger
-- on this table, so a SQL insert notifies nobody — which is what you want when
-- writing eighteen backdated rows at once. That is asserted below rather than
-- assumed, because being wrong means eighteen 1am pushes to every user.
-- ============================================================================

do $$
declare
  trigger_count int;
begin
  select count(*) into trigger_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'feed_events'
     and not t.tgisinternal;

  if trigger_count > 0 then
    raise exception
      'feed_events has % non-internal trigger(s); a bulk insert could fan out notifications. Inspect before backfilling.',
      trigger_count;
  end if;
end $$;

insert into public.feed_events (user_id, kind, visit_id, payload, created_at)
select
  v.user_id,
  'visit_logged',
  v.id,
  jsonb_build_object(
    'restaurant_name', rr.name,
    'cuisine', rr.resolved_cuisine_type,
    'neighborhood', rr.neighborhood,
    'google_place_id', rr.google_place_id
  ),
  v.visited_at
from public.visits v
join public.restaurants_resolved rr on rr.id = v.restaurant_id
where v.is_public
  and rr.name is not null
  -- Only users who have never posted. Anyone with existing events is left
  -- entirely alone rather than partially reconciled.
  and not exists (
    select 1 from public.feed_events e where e.user_id = v.user_id
  );

do $$
declare
  orphaned int;
  duplicated int;
begin
  -- Every backfilled post must be retractable.
  select count(*) into orphaned
    from public.feed_events e
   where e.kind::text = 'visit_logged'
     and e.visit_id is not null
     and not exists (select 1 from public.visits v where v.id = e.visit_id);
  if orphaned > 0 then
    raise exception 'backfill produced % post(s) pointing at no visit', orphaned;
  end if;

  -- One post per visit, or somebody's dinner is in the feed twice.
  select count(*) into duplicated
    from (
      select visit_id from public.feed_events
       where visit_id is not null
       group by visit_id having count(*) > 1
    ) d;
  if duplicated > 0 then
    raise exception 'backfill produced % duplicated visit post(s)', duplicated;
  end if;

  raise notice 'feed backfill complete';
end $$;
