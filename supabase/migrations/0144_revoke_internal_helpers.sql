-- ============================================================================
-- 0144 — internal helpers stop being callable by anyone with the anon key.
-- ----------------------------------------------------------------------------
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase
-- maps anon and authenticated into that. So a helper written to be called by
-- one wrapper is, from the moment it is created, an API endpoint. This project
-- already learned that once with palate_overlap_rank, which was documented as
-- locked and answered the anon key anyway, and CLAUDE.md says to revoke from
-- each grantee BY NAME. These four were never revoked from at all.
--
-- The one that matters:
--
--   generate_weekly_wrapped_for(p_user_id uuid, p_week_start date)
--
-- SECURITY DEFINER, no auth.uid() anywhere in its body — it checks only that
-- p_user_id is not null — and it returns a whole weekly_wrapped row: total
-- visits, unique restaurants, TOP RESTAURANT, category, personality. Anyone
-- holding a user's uuid and the anon key could read that person's dining
-- summary without signing in, and the call writes a row while doing it.
--
-- Verified against production before this migration, not inferred: an
-- unauthenticated POST to /rest/v1/rpc/generate_weekly_wrapped_for with a
-- random uuid returned HTTP 400 P0001 "No visits this week" — the function's
-- OWN exception, raised from inside its body, which is proof it executed.
--
-- Safe to revoke because every legitimate caller is SECURITY DEFINER and so
-- runs as the owner regardless of the caller's grants:
--   generate_weekly_wrapped_for  <- generate_weekly_wrapped [DEFINER, auth.uid()-guarded]
--   broadcast_recipients         <- enqueue_wrapped_push, enqueue_join_push,
--                                   enqueue_join_push_on_insert [all DEFINER]
--   refresh_chain_brands         <- cron only (service_role)
--   get_waitlist_count           <- nothing at all
--
-- Deliberately NOT touching are_friends. It is called from 31 places including
-- RLS policy bodies, where the querying role needs execute, and its exposure
-- is a mutual-follow boolean that already requires knowing both uuids.
-- ============================================================================

revoke all on function public.generate_weekly_wrapped_for(uuid, date) from public, anon, authenticated;
revoke all on function public.broadcast_recipients(uuid)             from public, anon, authenticated;
revoke all on function public.refresh_chain_brands()                 from public, anon, authenticated;
revoke all on function public.get_waitlist_count()                   from public, anon, authenticated;

-- ---- prove the denial, and prove the front door still opens ----------------
do $$
declare
  locked text[] := array[
    'public.generate_weekly_wrapped_for(uuid, date)',
    'public.broadcast_recipients(uuid)',
    'public.refresh_chain_brands()',
    'public.get_waitlist_count()'
  ];
  fn text;
  grantee text;
begin
  foreach fn in array locked loop
    foreach grantee in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(grantee, fn, 'execute') then
        raise exception '0144: % is still executable by %', fn, grantee;
      end if;
    end loop;
  end loop;

  -- The wrapper is the public entry point and must keep working. It guards on
  -- auth.uid() itself, so an unauthenticated call gets nothing.
  if not has_function_privilege('authenticated', 'public.generate_weekly_wrapped(date)', 'execute') then
    raise exception '0144: the guarded wrapper lost its grant — Wrapped would break';
  end if;

  raise notice '0144: four internal helpers locked; generate_weekly_wrapped still open to authenticated';
end $$;
