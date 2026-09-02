-- ============================================================================
-- 0058_drop_wrapped_broadcast.sql — stop broadcasting Wrapped.
-- ----------------------------------------------------------------------------
-- 0057 shipped three activity events. The Wrapped broadcast is withdrawn on
-- the founder's call.
--
-- It was also the one with the worst arithmetic: joins are rare and visits are
-- friends-only, but Wrapped fires once per user per week to EVERY user. That is
-- the only one of the three whose volume grows quadratically with signups, so
-- removing it takes the fan-out risk out of the system rather than relying on
-- the 3-day expiry to absorb it.
--
-- The trigger is dropped; enqueue_wrapped_push() is deliberately LEFT IN PLACE,
-- unwired. Re-enabling is one CREATE TRIGGER, and keeping the function means
-- the copy, the visibility check and the expiry policy don't have to be
-- rewritten from memory if that call changes.
-- ============================================================================

drop trigger if exists weekly_wrapped_enqueue_push on public.weekly_wrapped;

comment on function public.enqueue_wrapped_push() is
  'UNWIRED as of migration 0058 — the Wrapped broadcast was withdrawn. Kept so it can be re-enabled with a single CREATE TRIGGER on public.weekly_wrapped.';

-- Clear anything already queued but not yet sent. Nothing has been delivered
-- (server_push is off and send-push is undeployed), so this is housekeeping
-- rather than a retraction.
delete from public.push_outbox
 where sent_at is null
   and data->>'type' = 'user_wrapped';
