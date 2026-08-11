-- ============================================================================
-- 0050_passive_funnel_view.sql
-- ----------------------------------------------------------------------------
-- Phase 2 deliverable: the permission funnel + capture pipeline as a single
-- conversion table, read from the homegrown analytics_events store. Query it in
-- the Supabase SQL editor / dashboard (service role) — it is NOT granted to
-- anon/authenticated, so no client can read aggregate analytics.
--
--   select * from public.passive_capture_funnel;
--
-- Permission funnel reads top-to-bottom; the capture funnel (detected ->
-- qualified -> notified -> confirmed) drives the 50% capture-rate target.
-- ============================================================================

create or replace view public.passive_capture_funnel as
select
  -- Permission funnel (distinct users at each step)
  count(distinct user_id) filter (where event = 'perm_prescreen_shown')     as prescreen_shown,
  count(distinct user_id) filter (where event = 'perm_prescreen_accepted')  as prescreen_accepted,
  count(distinct user_id) filter (where event = 'perm_wheninuse_requested') as wheninuse_requested,
  count(distinct user_id) filter (where event = 'perm_wheninuse_granted')   as wheninuse_granted,
  count(distinct user_id) filter (where event = 'perm_always_prompt_shown') as always_prompted,
  count(distinct user_id) filter (where event = 'perm_always_granted')      as always_granted,
  count(distinct user_id) filter (where event = 'perm_always_revoked')      as always_revoked,
  -- Capture funnel (event volume)
  count(*) filter (where event = 'visit_detected')          as visits_detected,
  count(*) filter (where event = 'visit_qualified')         as visits_qualified,
  count(*) filter (where event = 'visit_suppressed')        as visits_suppressed,
  count(*) filter (where event = 'visit_resolved')          as visits_resolved,
  count(*) filter (where event = 'confirm_notif_sent')      as notifs_sent,
  count(*) filter (where event = 'confirm_notif_suppressed') as notifs_suppressed,
  count(*) filter (where event = 'confirm_yes')             as confirmed_yes,
  count(*) filter (where event = 'confirm_no')              as confirmed_no,
  count(*) filter (where event = 'confirm_corrected')       as confirmed_corrected,
  -- Capture rate = confirmed / detected (the metric Phase 4 exists to move)
  round(
    (count(*) filter (where event = 'confirm_yes'))::numeric
      / nullif(count(*) filter (where event = 'visit_detected'), 0),
    3
  ) as capture_rate
from public.analytics_events;

revoke all on public.passive_capture_funnel from anon, authenticated;
