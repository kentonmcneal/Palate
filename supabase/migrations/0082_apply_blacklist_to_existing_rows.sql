-- ============================================================================
-- 0082_apply_blacklist_to_existing_rows.sql
-- ----------------------------------------------------------------------------
-- Cook Out was added to CHAIN_BRANDS, Topgolf to the entertainment-venue rule,
-- and Scooter's Coffee to the coffee chains — and all three kept appearing in
-- Discover, Cook Out at 58% match. Classifier rules only apply at CLASSIFICATION
-- time, so a row written before the rule keeps the eligibility it was born with.
-- Editing the classifier changed what happens to places we meet in future and
-- nothing at all about the ones already in the table.
--
-- The standing plan was to fix this with the `reclassify` pass. Counting first
-- says that would be the wrong tool: 1,001 restaurants, 742 currently
-- recommendable, and exactly THREE rows affected by these rules —
--
--   Cook Out · Scooter's Coffee · Topgolf Memphis
--
-- so a full pass means ~1,001 Google Place Details calls to change three rows.
-- This is the same outcome for nothing, using the classifier's own vocabulary
-- so a later reclassify agrees with it rather than fighting it.
--
-- Scoped by name to the brands actually named in the rules. It deliberately
-- does NOT invent a general chain sweep — that is what reclassify is for, and
-- guessing at brands in SQL is how a beloved local place quietly disappears.
--
-- Reversible: reclassify recomputes these rows from Google and will restore
-- whatever the current classifier decides.
-- ============================================================================

update public.restaurants
   set recommendation_eligibility = 0,
       ineligibility_reason = 'national_chain'
 where coalesce(recommendation_eligibility, 1) > 0
   and (
     name ilike '%cook out%'
     or name ilike '%cookout%'
     or name ilike '%scooter%coffee%'
   );

update public.restaurants
   set recommendation_eligibility = 0,
       ineligibility_reason = 'entertainment_venue'
 where coalesce(recommendation_eligibility, 1) > 0
   and (
     name ilike '%topgolf%'
     or name ilike '%dave & buster%'
     or name ilike '%main event%'
     or name ilike '%bowlero%'
     or name ilike '%chuck e%cheese%'
   );

do $$
declare
  remaining int;
begin
  select count(*) into remaining
    from public.restaurants
   where coalesce(recommendation_eligibility, 1) > 0
     and (
       name ilike '%cook out%' or name ilike '%cookout%'
       or name ilike '%scooter%coffee%' or name ilike '%topgolf%'
       or name ilike '%dave & buster%'
     );
  if remaining > 0 then
    raise exception 'still recommendable after the update: % row(s)', remaining;
  end if;
end $$;
