-- ============================================================================
-- 0143 — remove a feature flag that controls nothing.
-- ----------------------------------------------------------------------------
-- `passive_capture_funnel` was added by 0049 as "Phase 2: permission funnel +
-- instrumentation" and has been false ever since. Nothing reads it. Not the
-- app, not an edge function, not an RPC — verified by searching every .ts,
-- .tsx and .sql in the repo for a read of that key.
--
-- The near-misses are why it survived: 0050 creates a VIEW with the same name,
-- so a grep for the string finds plenty and a grep for a read of the FLAG
-- finds nothing. The view is real and stays; only the flag row goes.
--
-- What makes it worth removing rather than leaving: the instrumentation it was
-- meant to gate shipped anyway. perm_prescreen_shown and perm_always_prompt_shown
-- are firing in analytics_events today, ungated. So the row says a capability
-- is switched off while that capability has been on for months, and a switch
-- that reports the opposite of reality is worse than no switch.
--
-- Admin only surfaces server_push, so nobody could have flipped this and
-- wondered why nothing happened. The next admin screen that lists every flag
-- would have made it a real trap.
--
-- Recreate it in one line if Phase 2 gating is ever built:
--   insert into public.feature_flags (key, enabled, description)
--   values ('passive_capture_funnel', false, '...');
-- ============================================================================

delete from public.feature_flags where key = 'passive_capture_funnel';

do $$
declare remaining text := '';
        r record;
begin
  for r in select key from public.feature_flags order by key loop
    remaining := remaining || r.key || ' ';
  end loop;
  raise notice '0143: feature flags now: %', remaining;

  if exists (select 1 from public.feature_flags where key = 'passive_capture_funnel') then
    raise exception '0143: the dead flag is still there';
  end if;
end $$;
