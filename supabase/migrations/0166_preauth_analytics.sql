-- ============================================================================
-- 0166 — the sign-in funnel has been writing to /dev/null since 2026-09-05.
-- ----------------------------------------------------------------------------
-- 0110 tightened analytics_events by looping over every INSERT policy, dropping
-- them all, and creating one `to authenticated`. That was right for the goal it
-- had — stop anon writing rows attributed to other users — and it also removed
-- the ability to record anything BEFORE somebody signs in.
--
-- Which is exactly where the funnel is worst. sign_in_started, the welcome
-- screen, the permission pre-screen: every event from the part of the app that
-- loses the most people now fails RLS and is discarded.
--
-- And it fails INVISIBLY. supabase-js `.insert()` RESOLVES with `{ error }`
-- rather than throwing, and analytics.ts ignores the return value, so the
-- try/catch around it can never fire. "Wrap it in a catch and log" would not
-- have surfaced this. Nothing anywhere reports it.
--
-- The fix restores the anonymous path with the one constraint that matters: an
-- anonymous row may not CLAIM a user. user_id must be null when there is no
-- session, and must be your own when there is. That is strictly tighter than
-- the pre-0110 policy, which allowed any authenticated caller to write a row
-- attributed to anyone.
-- ============================================================================

drop policy if exists "analytics_events: own insert" on public.analytics_events;
drop policy if exists "analytics_events: anon or own insert" on public.analytics_events;

-- RLS is not the only gate. 0110 left `anon` without the table GRANT at all,
-- so the policy alone yields "permission denied for table analytics_events"
-- (42501) before any policy is consulted. Both are required, and checking only
-- the policy is how this looks fixed and is not.
grant insert on public.analytics_events to anon;

create policy "analytics_events: anon or own insert"
  on public.analytics_events for insert
  to anon, authenticated
  with check (
    -- Signed in: the row is yours, or it is nobody's.
    (auth.uid() is not null and (user_id = auth.uid() or user_id is null))
    -- Signed out: the row may not name anyone.
    or (auth.uid() is null and user_id is null)
  );

-- SELECT stays own-rows-only (0128). Being able to write a breadcrumb before
-- sign-in is not permission to read anybody's.

do $$
declare ok boolean; n int; uid uuid;
begin
  -- Read the id BEFORE switching role. Selecting it inside the insert while
  -- already running as anon returns NULL -- anon cannot read profiles -- so
  -- the row inserts legitimately as unattributed and the assertion "proves"
  -- nothing. That is how the first version of this check failed: it was
  -- testing a null, not a claim.
  select id into uid from public.profiles limit 1;

  -- Anonymous, unattributed: must be allowed.
  perform set_config('role', 'anon', true);
  insert into public.analytics_events(user_id, event, props)
    values (null, 'probe_preauth', '{}'::jsonb);
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.analytics_events where event = 'probe_preauth';
  if n = 0 then raise exception 'pre-auth analytics still blocked'; end if;
  delete from public.analytics_events where event = 'probe_preauth';

  -- Anonymous, claiming a real user: must be refused.
  ok := false;
  perform set_config('role', 'anon', true);
  begin
    insert into public.analytics_events(user_id, event, props)
      values (uid, 'probe_claim', '{}'::jsonb);
  exception when others then ok := true;
  end;
  perform set_config('role', 'postgres', true);
  if not ok then
    delete from public.analytics_events where event = 'probe_claim';
    raise exception 'an anonymous caller could attribute an event to a real user';
  end if;

  raise notice 'pre-auth analytics restored; anonymous rows cannot claim a user';
end $$;
