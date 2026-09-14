-- ============================================================================
-- 0168 — stop collecting race and gender.
-- ============================================================================
-- 0019 added profiles.gender_identity and profiles.race_ethnicity for a cohort
-- feature that never shipped. Two accounts filled them in.
--
-- Special-category data under GDPR Art. 9 and "sensitive info" in Apple's own
-- privacy-label vocabulary. The published privacy policy's "What we collect"
-- list never mentioned either, and APP_STORE.md affirmatively files race,
-- religion and sexuality under DO NOT COLLECT. So the app collected something
-- its policy denied collecting, in the document Apple links from the listing.
--
-- Two ways out: declare it, or stop collecting it. Declaring costs a policy
-- rewrite, a privacy-label change, and a question at review, for a feature
-- nobody built. The founder chose to delete, which is also the answer that
-- needs no promise kept.
--
-- IRREVERSIBLE, and checked first: no view, no function, and no other table
-- references either column -- verified against information_schema and
-- pg_get_functiondef rather than by grep. The client stopped reading and
-- writing them in the same commit, so this cannot strand a running build: an
-- older bundle that still selects them gets a column-does-not-exist error on
-- ONE screen reachable from Edit Profile, not on the app.
--
-- The two values are deleted with the columns. That is the point of the
-- exercise -- keeping a copy "just in case" is exactly the thing being
-- undone.
-- ============================================================================

do $$
declare n int;
begin
  -- Nothing may depend on these. If something does, stop and look rather than
  -- letting CASCADE decide what else to remove.
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and (position('gender_identity' in pg_get_functiondef(p.oid)) > 0
       or position('race_ethnicity'  in pg_get_functiondef(p.oid)) > 0);
  if n > 0 then
    raise exception '% function(s) still read the demographic columns', n;
  end if;
end $$;

alter table public.profiles drop column if exists gender_identity;
alter table public.profiles drop column if exists race_ethnicity;

do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and column_name in ('gender_identity', 'race_ethnicity');
  if n > 0 then
    raise exception 'demographic columns survive in % place(s)', n;
  end if;
  raise notice 'race and gender are no longer collected or stored';
end $$;
