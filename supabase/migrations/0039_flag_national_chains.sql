-- ============================================================================
-- 0039_flag_national_chains.sql
-- ----------------------------------------------------------------------------
-- Backfill: mark well-known national chains as discovery-INELIGIBLE.
--
-- WHY: recommendation_eligibility (0028) is written by the classifier, and it
-- defaults to 1.0. Places ingested before the chain rule — or never
-- re-classified — sit at 1.0, so generic chains (Starbucks, Dunkin', etc.)
-- leak into the "Based on your saves" rail and similar_restaurants results.
-- The filters are correct (`recommendation_eligibility > 0`); the data just
-- isn't tagged. This one-shot backfill tags the obvious national chains by
-- name so they drop out immediately, no app rebuild required.
--
-- Scope is deliberately CONSERVATIVE: fast-food + coffee + casual-dining
-- chains only. Fast-casual "darlings" people actually choose on taste
-- (Shake Shack, Sweetgreen, etc.) are intentionally NOT flagged. The
-- classifier remains the source of truth going forward; this only fills the
-- gap for already-ingested rows.
-- ============================================================================

update public.restaurants
set recommendation_eligibility = 0,
    ineligibility_reason = coalesce(ineligibility_reason, 'national_chain')
where coalesce(recommendation_eligibility, 1) > 0
  and name ilike any (array[
    -- Coffee / breakfast
    'Starbucks%', 'Dunkin%', 'Tim Hortons%', 'Peet''s Coffee%', 'Dutch Bros%',
    'Krispy Kreme%', 'Einstein Bros%',
    -- Burgers / fast food
    'McDonald''s%', 'Burger King%', 'Wendy''s%', 'Jack in the Box%',
    'Carl''s Jr%', 'Hardee''s%', 'Sonic Drive%', 'Whataburger%', 'Checkers%',
    'Krystal%', 'White Castle%',
    -- Chicken
    'KFC%', 'Kentucky Fried Chicken%', 'Chick-fil-A%', 'Popeyes%',
    'Bojangles%', 'Zaxby''s%', 'Church''s%', 'Wingstop%', 'Raising Cane%',
    -- Mexican / other QSR
    'Taco Bell%', 'Chipotle%', 'Qdoba%', 'Del Taco%', 'Moe''s Southwest%',
    'Panda Express%',
    -- Sandwiches / subs
    'Subway%', 'Jimmy John%', 'Jersey Mike%', 'Firehouse Subs%',
    'Quiznos%', 'Which Wich%', 'Potbelly%', 'Arby''s%',
    -- Pizza
    'Domino''s%', 'Pizza Hut%', 'Papa John%', 'Little Caesars%',
    'Papa Murphy%', 'Marco''s Pizza%',
    -- Bakery / cafe chains
    'Panera%', 'Auntie Anne%', 'Cinnabon%',
    -- Ice cream / dessert
    'Dairy Queen%', 'Baskin-Robbins%', 'Cold Stone%',
    -- Casual dining
    'Applebee''s%', 'Chili''s%', 'Olive Garden%', 'IHOP%', 'Denny''s%',
    'TGI Friday%', 'Cracker Barrel%', 'Buffalo Wild Wings%', 'Red Lobster%',
    'Outback Steakhouse%', 'Texas Roadhouse%', 'Red Robin%', 'Waffle House%',
    'Ruby Tuesday%', 'Hooters%', 'Panda Inn%'
  ]);
