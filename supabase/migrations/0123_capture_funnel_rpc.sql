-- ============================================================================
-- 0123 — let the founder see the capture funnel.
-- ----------------------------------------------------------------------------
-- analytics_events has an INSERT policy and, deliberately, no SELECT policy:
-- 0012's own comment says "Nobody reads from the app." That was the right
-- call for a table any client can write to. The consequence nobody noticed is
-- that lib/activation-funnel.ts, which exists so the question "is passive
-- capture working" takes five seconds instead of four hand-written queries,
-- reads an empty array under RLS and renders a funnel of zeroes. It has been
-- lying since it shipped.
--
-- Meanwhile the table holds 6,825 real rows, and they answer the question
-- precisely. Measured today over 30 days:
--
--   visit_detected 668 -> qualified 238 -> resolved 83 -> notified 20
--   -> confirmed yes 10 / no 13, visit_logged 9
--
--   unqualified: open-visit 288 (transient, re-processed on departure),
--                dwell-too-long 32, low-accuracy 24, dwell-too-short 7
--   unresolved:  no-venue-found 92, suppressed-duplicate 26, recent 14
--   suppressed:  duplicate 26, rate_limit 18, recently_dismissed 14, quiet 6
--
-- So: a definer RPC, admin only, aggregate only. It returns counts, never
-- rows, so reading the funnel can never become a way to read one person's
-- movements. Nothing gains a SELECT policy.
-- ============================================================================

create or replace function public.capture_funnel(p_days integer default 30)
returns table (event text, reason text, n integer)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if not exists (select 1 from public.profiles p where p.id = me and p.is_admin) then
    -- Not an error: a non-admin simply has no funnel. Raising would tell an
    -- attacker that the function exists and is worth attacking.
    return;
  end if;

  return query
  select a.event::text,
         coalesce(a.props->>'reason', '')::text,
         count(*)::int
    from public.analytics_events a
   where a.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
   group by 1, 2
   order by count(*) desc;
end $$;

revoke all on function public.capture_funnel(integer) from public, anon;
grant execute on function public.capture_funnel(integer) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; stranger uuid; n int;
begin
  -- signed out: nothing
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.capture_funnel(30);
  if n <> 0 then raise exception '0123: signed-out caller read the funnel'; end if;

  -- a signed-in non-admin: nothing, and no error
  select id into stranger from public.profiles where coalesce(is_admin, false) = false limit 1;
  if stranger is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', stranger::text)::text, true);
    select count(*) into n from public.capture_funnel(30);
    if n <> 0 then raise exception '0123: a non-admin read the funnel'; end if;
  end if;

  select id into kenton from public.profiles where display_name = 'Kenton M' and is_admin;
  if kenton is null then
    raise notice '0123: no admin profile on this database — admin proof skipped';
    perform set_config('request.jwt.claims', null, true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select count(*) into n from public.capture_funnel(30);
  if n = 0 then raise exception '0123: the admin funnel came back empty'; end if;
  raise notice '0123: admin sees % event/reason pairs', n;
  perform set_config('request.jwt.claims', null, true);
end $$;
