-- ============================================================================
-- 0091_split_cuisine_from_format.sql — a café is not a cuisine.
-- ----------------------------------------------------------------------------
-- Measured across the 1043 live rows: cuisine_type held café 121, bar 121,
-- bakery 71, brunch 48. That is 361 rows, a third of the catalogue, where the
-- field meant to answer "what food" answered "what kind of place" instead —
-- and `bar` was simultaneously a format_class value, so one fact was stored
-- twice under two meanings.
--
-- It reached the user directly. The mood chips are built from cuisine_type, so
-- the founder was offered "Café" and "Bar" as things to be in the mood for,
-- next to Italian and Mexican.
--
-- The classifier is fixed in the same change (v1.8.0): those four values are
-- out of the cuisine vocabulary, bakery is in the format vocabulary, and the
-- rule map that produced most of them no longer maps a format to a cuisine.
-- That only governs rows classified from now on. This migration handles the
-- rows already here.
--
-- Rules for this backfill, in order:
--   1. Nothing is guessed from the name. Only primary_type, which Google set
--      and which is already sitting on the row, is allowed to decide.
--   2. Where primary_type names a real cuisine, take it.
--   3. Otherwise cuisine_type becomes null, which is the honest answer for a
--      coffee shop or a dive bar and does not lose anything: format_class is
--      already populated on 359 of these 361 rows, so the format that was
--      being stored in the wrong column is still stored in the right one.
--   4. No Google call, no LLM call, no cost. Every value used is already here.
-- ============================================================================

-- 1. The two rows whose format only existed in the column we are about to
--    clear. Without this they would lose the fact entirely.
update public.restaurants
   set format_class = case cuisine_type when 'cafe' then 'café' else cuisine_type end
 where cuisine_type in ('café', 'cafe', 'bar')
   and format_class is null;

-- 2. Bakeries get the format they should always have had. `bakery` was a
--    cuisine value and is now a format value, so these rows were carrying it
--    on the wrong side of the split; underneath, format_class had fallen
--    through to a price-derived guess.
update public.restaurants
   set format_class = 'bakery'
 where primary_type in ('bakery', 'bagel_shop', 'donut_shop', 'cake_shop');

-- 3. Rescue the real cuisine where primary_type states one.
--
-- Deliberately short. Every entry is a Google type that names a food, mapped
-- to a value in the cuisine vocabulary. Types that name a place rather than a
-- food (irish_pub, brewery, diner, lounge_bar, breakfast_restaurant) are
-- absent on purpose: "pub" is not a cuisine and neither is "breakfast".
-- Cuisines with no home in the vocabulary (burmese, european) fall through to
-- null rather than being rounded to the nearest thing, which is how `american`
-- became a dumping ground in the first place.
update public.restaurants r
   set cuisine_type = m.cuisine
  from (values
    ('american_restaurant',       'american'),
    ('californian_restaurant',    'american'),
    ('chicken_wings_restaurant',  'american'),
    ('soul_food_restaurant',      'american'),
    ('tex_mex_restaurant',        'mexican'),
    ('latin_american_restaurant', 'latin-american'),
    ('peruvian_restaurant',       'latin-american'),
    ('israeli_restaurant',        'middle-eastern'),
    ('pakistani_restaurant',      'indian'),
    ('oyster_bar_restaurant',     'seafood'),
    ('donut_shop',                'dessert'),
    ('cake_shop',                 'dessert')
  ) as m(ptype, cuisine)
 where r.cuisine_type in ('café', 'cafe', 'bar', 'bakery', 'brunch')
   and r.primary_type = m.ptype;

-- 4. Everything else loses the format that was masquerading as a cuisine.
update public.restaurants
   set cuisine_type = null
 where cuisine_type in ('café', 'cafe', 'bar', 'bakery', 'brunch');

-- ----------------------------------------------------------------------------
-- Prove it, in the same push.
-- ----------------------------------------------------------------------------
do $$
declare
  leftover int;
  rescued int;
  fmt_lost int;
begin
  select count(*) into leftover
    from public.restaurants
   where cuisine_type in ('café', 'cafe', 'bar', 'bakery', 'brunch');
  if leftover > 0 then
    raise exception '0091: % rows still carry a format in cuisine_type', leftover;
  end if;

  -- Nothing may end up with neither a cuisine nor a format. That would be a
  -- row we know less about after the migration than before it, which is the
  -- one outcome this is not allowed to produce.
  select count(*) into fmt_lost
    from public.restaurants
   where cuisine_type is null and format_class is null
     and primary_type in ('coffee_shop', 'cafe', 'bar', 'pub', 'bakery',
                          'bagel_shop', 'donut_shop', 'wine_bar');
  if fmt_lost > 0 then
    raise exception '0091: % rows lost both cuisine and format', fmt_lost;
  end if;

  select count(*) into rescued
    from public.restaurants
   where primary_type in ('american_restaurant', 'californian_restaurant',
                          'chicken_wings_restaurant', 'soul_food_restaurant',
                          'tex_mex_restaurant', 'latin_american_restaurant',
                          'peruvian_restaurant', 'israeli_restaurant',
                          'pakistani_restaurant', 'oyster_bar_restaurant',
                          'donut_shop', 'cake_shop')
     and cuisine_type is not null;
  raise notice '0091: format-as-cuisine rows cleared, % rows carry a rescued cuisine', rescued;
end $$;
