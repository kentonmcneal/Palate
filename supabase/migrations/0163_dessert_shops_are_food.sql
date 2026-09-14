-- ============================================================================
-- 0163 — a cookie shop is a place you eat.
-- ----------------------------------------------------------------------------
-- classifier.ts's RESTAURANT_TYPES listed ice_cream_shop and
-- dessert_restaurant but not dessert_shop, so Google's `dessert_shop` places
-- fell through to `not_a_restaurant` -- which passive capture treats as NOT A
-- DINING STOP and filters out of candidates before ranking.
--
-- Reported from a real meal: a stop on Winchester Road offered Sonic Drive-In
-- and China Taste and never mentioned the Insomnia Cookies between them, which
-- the person said they would have accepted. It was not ranked low; it was
-- never a candidate.
--
-- The same brand is in the catalogue four times with THREE different verdicts
-- -- not_a_restaurant twice, national_chain twice -- because the answer
-- depended on which primary_type Google happened to return that day. A brand
-- classified inconsistently is a brand nobody can reason about.
--
-- The code fix is deployed. This repairs the rows already written, and only
-- the ones whose primary_type says they are food: `not_a_restaurant` is
-- cleared so the eligibility rules can decide honestly, and a chain stays a
-- chain -- excluded from RECOMMENDATIONS, still loggable as somewhere you ate.
-- ============================================================================

do $$
declare n int;
begin
  update public.restaurants
     set ineligibility_reason = case
           when chain_name is not null then 'national_chain'
           else null
         end,
         recommendation_eligibility = case
           when chain_name is not null then 0
           else 1
         end
   where ineligibility_reason in ('not_a_restaurant', 'non_food_primary_type', 'not_a_food_venue')
     and primary_type in (
       'dessert_shop', 'donut_shop', 'cake_shop', 'bagel_shop',
       'sandwich_shop', 'juice_shop', 'tea_house', 'deli',
       'ice_cream_shop', 'bakery', 'cafe', 'coffee_shop'
     );
  get diagnostics n = row_count;
  raise notice 'reclassified % food venues out of not_a_restaurant', n;
end $$;
