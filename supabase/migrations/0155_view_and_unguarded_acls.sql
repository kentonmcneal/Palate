-- ============================================================================
-- 0155 — close the writable views, and make the hole unable to reopen.
-- ----------------------------------------------------------------------------
-- A cold audit proved this over real HTTP with the shipped anon key,
-- unauthenticated: POST to featured_lists_for_city returned
-- `23502 null value in column "city_label" of relation featured_lists_cache`.
-- A not-null violation on the BASE TABLE. The write went through. The same
-- POST against the base table directly returned 42501, which is what everyone
-- assumed was protecting it.
--
-- Seven of eight views in public are writable by anon AND authenticated, and
-- every one is security_invoker = off — so the write executes as the view's
-- owner and RLS on the underlying table never runs.
--
-- THE MECHANISM MATTERS MORE THAN THE TWO BUGS. Nobody granted this. DROP +
-- CREATE on a view resets its ACL to the database default, and Supabase's
-- default hands anon and authenticated the full set. So a migration that
-- carefully revoked a privilege is silently undone by a LATER migration that
-- recreates the object for an unrelated reason:
--
--   0104 revoked SELECT on featured_lists_for_city  ->  0124 recreated it
--   0108 revoked EXECUTE on ..._unguarded           ->  0117/0118 recreated it
--
-- Revoking again would last exactly until the next person edits a view. So the
-- last section asserts the property and FAILS THE MIGRATION if it is ever
-- untrue again. A rule that is checked is a rule; a rule in a comment is a
-- wish.
--
-- Deliberately NOT changed here: security_invoker stays off. Flipping it makes
-- SELECT respect the caller's RLS, which is stricter and probably right, but
-- the population_* views aggregate across users by design and would go empty.
-- That is a behaviour change needing its own migration and its own evidence.
-- This one removes writes nobody should ever have had.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. No client writes through any view, ever.
-- ----------------------------------------------------------------------------
do $$
declare v record; n int := 0;
begin
  for v in
    select c.oid::regclass::text as rel
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('revoke insert, update, delete, truncate, references on %s from anon, authenticated', v.rel);
    n := n + 1;
  end loop;
  raise notice 'revoked client writes on % views', n;
end $$;

-- ----------------------------------------------------------------------------
-- 2. The *_unguarded functions are internal. The name says so.
-- ----------------------------------------------------------------------------
-- get_friend_profile_snapshot_unguarded still held EXECUTE for authenticated,
-- which meant blocking did not block: a blocked user could POST one JSON body
-- and keep reading the blocker's palate identity, top restaurant, visit
-- counts, school, city and social handles. 0108 revoked it; 0117 and 0118
-- recreated it and re-revoked from `public, anon` only, and `authenticated` is
-- a separate grantee that survives both.
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like '%unguarded%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    n := n + 1;
  end loop;
  raise notice 'revoked EXECUTE on % unguarded function(s)', n;
end $$;

-- ----------------------------------------------------------------------------
-- 3. The assertion. This is the part that lasts.
-- ----------------------------------------------------------------------------
-- Runs at the end of THIS migration, and is meant to be copied to the end of
-- any future migration that touches a view or a definer function. If a DROP +
-- CREATE quietly restores the defaults, the push fails here instead of
-- shipping an open door.
do $$
declare bad text := '';
begin
  select coalesce(string_agg(x.rel || ' (' || x.who || ')', ', '), '')
    into bad
    from (
      select c.oid::regclass::text rel, g.who
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        cross join (values ('anon'), ('authenticated')) g(who)
       where ns.nspname = 'public' and c.relkind = 'v'
         and (has_table_privilege(g.who, c.oid, 'INSERT')
           or has_table_privilege(g.who, c.oid, 'UPDATE')
           or has_table_privilege(g.who, c.oid, 'DELETE'))
    ) x;
  if bad <> '' then
    raise exception 'A view in public is client-writable: %. DROP+CREATE resets ACLs; re-revoke in the same migration.', bad;
  end if;

  select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
    into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like '%unguarded%'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if bad <> '' then
    raise exception 'An *_unguarded function is client-executable: %. These are internal by name.', bad;
  end if;

  raise notice 'ACL assertions passed';
end $$;
