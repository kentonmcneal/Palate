-- ============================================================================
-- 0086_enable_discovery_pings.sql — turn the weekly nudges on.
-- ----------------------------------------------------------------------------
-- The three pings (Friday date night 4pm, Saturday brunch 10am, Thursday
-- stretch 6pm) were built to a tester's request and have never fired. Two
-- independent reasons, both now addressed:
--
--   1. refreshDiscoveryPings() was only called by the Settings toggle, so
--      unless somebody flipped that switch nothing was ever registered with
--      iOS — while the switch read ON, because it defaults to enabled. Fixed
--      in the client: it now runs on every authed launch.
--
--   2. This flag, which refreshDiscoveryPings checks and FAILS CLOSED on, has
--      been false. So even after fixing (1) the function returned 0 before
--      scheduling anything.
--
-- Turning it on is the second half. Kept as a migration rather than a console
-- click so a rebuilt project gets the same behaviour, and so the change has a
-- date and a reason attached.
--
-- To undo: update public.feature_flags set enabled = false where key =
-- 'discovery_pings'. Takes effect on each client's next launch, and the client
-- cancels before it schedules, so flipping it off unschedules them too.
-- ============================================================================

insert into public.feature_flags (key, enabled)
values ('discovery_pings', true)
on conflict (key) do update set enabled = true;

do $$
declare
  on_now boolean;
begin
  select enabled into on_now from public.feature_flags where key = 'discovery_pings';
  if on_now is not true then
    raise exception 'discovery_pings did not end up enabled';
  end if;
end $$;
