-- ============================================================================
-- 0039_flag_national_chains.sql
-- ----------------------------------------------------------------------------
-- Backfill: mark well-known national/major-regional chains as discovery-
-- INELIGIBLE (recommendation_eligibility = 0).
--
-- WHY: recommendation_eligibility (0028) is written by the classifier and
-- defaults to 1.0. Places ingested before the chain rule — or never
-- re-classified — sit at 1.0, so generic chains (Starbucks, Dunkin', etc.)
-- leak into the "Based on your saves" rail and similar_restaurants results.
-- The filters are correct (`recommendation_eligibility > 0`); the data just
-- isn't tagged. This one-shot backfill tags chains by name so they drop out
-- immediately, no app rebuild required.
--
-- MATCHING: uses case-insensitive SUBSTRING match (`%token%`) so it also
-- catches "The Cheesecake Factory", "Starbucks Coffee Company",
-- "McDonald's #1234", etc. Tokens are chosen to be distinctive enough that
-- false positives are unlikely — but name matching is inherently fuzzy, so
-- REVIEW what got flagged with the query at the bottom and un-flag anything
-- that's actually a local independent.
--
-- The classifier remains the source of truth going forward; this only fills the
-- gap for already-ingested rows.
-- ============================================================================

update public.restaurants
set recommendation_eligibility = 0,
    ineligibility_reason = coalesce(ineligibility_reason, 'national_chain')
where coalesce(recommendation_eligibility, 1) > 0
  and name ilike any (array[
    -- ---- Coffee / bakery / pretzels / cookies -----------------------------
    '%starbucks%', '%dunkin%', '%tim hortons%', '%peet''s coffee%',
    '%dutch bros%', '%krispy kreme%', '%einstein bros%', '%caribou coffee%',
    '%biggby%', '%coffee bean & tea%', '%bruegger%', '%corner bakery%',
    '%panera%', '%au bon pain%', '%cinnabon%', '%auntie anne%',
    '%wetzel''s pretzel%', '%mrs. fields%', '%great american cookie%',
    '%insomnia cookie%', '%crumbl%', '%nothing bundt%', '%la madeleine%',
    -- ---- Burgers / general fast food --------------------------------------
    '%mcdonald%', '%burger king%', '%wendy''s%', '%jack in the box%',
    '%carl''s jr%', '%hardee''s%', '%sonic drive%', '%whataburger%',
    '%white castle%', '%culver%', '%steak ''n shake%', '%fatburger%',
    '%wienerschnitzel%', '%cook out%', '%braum%', '%checkers%', '%krystal%',
    '%a&w%',
    -- ---- Chicken ----------------------------------------------------------
    '%kfc%', '%kentucky fried chicken%', '%chick-fil-a%', '%chick fil a%',
    '%popeyes%', '%bojangles%', '%zaxby%', '%church''s chicken%',
    '%wingstop%', '%raising cane%', '%el pollo loco%', '%slim chickens%',
    '%golden chick%', '%pdq%',
    -- ---- Mexican / TexMex QSR ---------------------------------------------
    '%taco bell%', '%chipotle%', '%qdoba%', '%del taco%', '%moe''s southwest%',
    '%baja fresh%', '%rubio''s%', '%taco john%', '%taco cabana%',
    '%on the border%',
    -- ---- Subs / sandwiches / delis ----------------------------------------
    '%subway%', '%jimmy john%', '%jersey mike%', '%firehouse subs%',
    '%quiznos%', '%which wich%', '%potbelly%', '%arby''s%', '%blimpie%',
    '%charleys%', '%mcalister%', '%jason''s deli%', '%schlotzsky%',
    '%capriotti%', '%penn station%', '%cousins subs%', '%erbert%',
    -- ---- Pizza ------------------------------------------------------------
    '%domino''s%', '%pizza hut%', '%papa john%', '%little caesar%',
    '%papa murphy%', '%marco''s pizza%', '%round table pizza%', '%jet''s pizza%',
    '%hungry howie%', '%cici''s%', '%cicis%', '%sbarro%', '%donatos%',
    '%california pizza kitchen%', '%mellow mushroom%', '%mountain mike%',
    -- ---- Asian ------------------------------------------------------------
    '%panda express%', '%pei wei%', '%p.f. chang%', '%pf chang%',
    '%pick up stix%', '%manchu wok%', '%sarku japan%', '%teriyaki madness%',
    -- ---- Ice cream / frozen / smoothie ------------------------------------
    '%dairy queen%', '%baskin-robbins%', '%baskin robbins%', '%cold stone%',
    '%ben & jerry%', '%tcby%', '%menchie%', '%yogurtland%', '%pinkberry%',
    '%jamba%', '%smoothie king%', '%tropical smoothie%', '%rita''s italian%',
    '%carvel%', '%marble slab%', '%haagen-dazs%', '%häagen%',
    -- ---- Seafood ----------------------------------------------------------
    '%long john silver%', '%captain d%', '%joe''s crab shack%',
    -- ---- BBQ --------------------------------------------------------------
    '%dickey''s barbecue%', '%famous dave%', '%sonny''s bbq%',
    -- ---- Casual / family dining (sit-down chains) -------------------------
    '%applebee%', '%chili''s%', '%olive garden%', '%ihop%', '%denny''s%',
    '%tgi friday%', '%cracker barrel%', '%buffalo wild wings%', '%red lobster%',
    '%outback steakhouse%', '%texas roadhouse%', '%red robin%', '%waffle house%',
    '%ruby tuesday%', '%hooters%', '%longhorn steakhouse%', '%golden corral%',
    '%bj''s restaurant%', '%dave & buster%', '%carrabba%', '%bonefish grill%',
    '%cheddar''s%', '%o''charley%', '%logan''s roadhouse%', '%perkins%',
    '%bob evans%', '%village inn%', '%friendly''s%', '%hard rock cafe%',
    '%yard house%', '%miller''s ale house%', '%twin peaks%', '%first watch%',
    '%another broken egg%', '%chuck e. cheese%', '%sizzler%',
    '%black bear diner%', '%mimi''s cafe%',
    -- ---- Health / salad ---------------------------------------------------
    '%chopt%', '%just salad%', '%saladworks%',
    -- =======================================================================
    -- BORDERLINE — beloved fast-casual "destinations." Many users genuinely
    -- choose these on taste. They are still national chains, so they're
    -- flagged here for completeness — DELETE any line below you'd rather keep
    -- eligible in discovery.
    -- =======================================================================
    '%shake shack%', '%in-n-out%', '%five guys%', '%smashburger%',
    '%the habit burger%', '%sweetgreen%', '%blaze pizza%', '%mod pizza%',
    '%the cheesecake factory%', '%cheesecake factory%', '%portillo%',
    '%freddy''s%', '%dave''s hot chicken%'
  ]);
