-- ============================================================================
-- 0128 — a user can read their own analytics rows, and only their own.
-- ----------------------------------------------------------------------------
-- 0012 gave analytics_events an INSERT policy and no SELECT policy, with the
-- comment "Nobody reads from the app." That was true of the ADMIN funnel,
-- which 0123 solved with a definer RPC. It was never true of the app itself:
-- two call sites have been reading this table since they were written, and
-- both have silently received an empty array for their entire existence.
--
--   mobile/lib/recommendation-events.ts loadUserRecCounters — the ranker's
--   negative-feedback loop. It exists to penalise places you already
--   dismissed, and it has never once seen a dismissal.
--
--   mobile/lib/personal-signal.ts — dismissesByPlaceId and skipsByPlaceId,
--   which feed the recommendation scorer. Both permanently empty.
--
-- PostgREST answers an RLS-blocked select with 200 and [], not an error, so
-- neither call site had any way to notice. This is the third instance of the
-- same failure in this codebase, after the admin funnel and the friend embeds.
--
-- Own rows only. A user reading their own analytics leaks nothing; they
-- generated every one of these events. The table still has no cross-user read
-- and anon still has nothing.
-- ============================================================================

drop policy if exists "analytics_events: own rows readable" on public.analytics_events;
create policy "analytics_events: own rows readable"
  on public.analytics_events for select
  to authenticated
  using (auth.uid() = user_id);

-- Reading your own rows is a per-user index scan, and there was no index for
-- it because nothing could read.
create index if not exists analytics_events_user_event_idx
  on public.analytics_events (user_id, event, created_at desc);

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; other uuid; n int; mine int;
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'anon', true);
  begin
    select count(*) into n from public.analytics_events;
    if n <> 0 then
      perform set_config('role','postgres', true);
      raise exception '0128: anon can read analytics (% rows)', n;
    end if;
  exception when insufficient_privilege then
    null; -- refusing outright is also fine
  end;
  perform set_config('role', 'postgres', true);

  select id into kenton from public.profiles where display_name = 'Kenton M';
  select id into other from public.profiles where id <> kenton limit 1;
  if kenton is null or other is null then
    raise notice '0128: not enough profiles to prove isolation';
    return;
  end if;

  select count(*) into mine from public.analytics_events where user_id = kenton;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.analytics_events;
  perform set_config('role', 'postgres', true);

  if n <> mine then
    raise exception '0128: expected % own rows, the policy returned %', mine, n;
  end if;
  if mine = 0 then
    raise notice '0128: founder has no analytics rows to prove against';
  else
    raise notice '0128: founder reads % of his own rows', n;
  end if;

  -- and cannot see anybody else's
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.analytics_events where user_id = other;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception '0128: cross-user analytics leak (% rows)', n; end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
