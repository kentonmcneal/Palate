-- ============================================================================
-- 0053_discovery_pings_flag.sql — kill switch for the weekly discovery nudges.
-- ----------------------------------------------------------------------------
-- The Friday date-night / Saturday brunch / Thursday stretch notifications
-- (mobile/lib/notification-schedule.ts) are LOCAL and repeat weekly, so a bad
-- schedule would keep firing on every installed device with no way to stop it
-- short of a new build. This row is that way.
--
-- Ships OFF, like every flag here. Flip it in the Supabase dashboard once a
-- build is verified on a device; clients pick it up within the 5-minute flag
-- cache and reschedule on next launch.
-- ============================================================================

insert into public.feature_flags (key, enabled, description)
values (
  'discovery_pings',
  false,
  'Weekly local notifications pointing at Discover (Fri date-night, Sat brunch, Thu stretch). Off until verified on-device.'
)
on conflict (key) do nothing;
