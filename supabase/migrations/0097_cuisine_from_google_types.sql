-- ============================================================================
-- 0097_cuisine_from_google_types.sql — the cuisine Google already told us.
-- ----------------------------------------------------------------------------
-- After 0091, 450 rows have no cuisine_type. 445 of them carry Google's
-- types[] on the row, and 90 of those name a specific food in that list
-- (italian_restaurant, seafood_restaurant, ...). The classifier would map
-- these on its next run; a reclassify costs ~1,043 paid calls. This does the
-- deterministic part now, for nothing, from data already here.
--
-- Rules: only types that name a food. Generic types (restaurant, family,
-- fast_food, fine_dining, brunch, breakfast, asian, european, soup, halal)
-- stay null: "asian" is not a cuisine a person is in the mood for, and
-- "breakfast" is a time. No name matching. Same map as CUISINE_TYPE_MAP in
-- the rule classifier, so a row backfilled here and one classified fresh
-- agree.
-- ============================================================================

update public.restaurants r
   set cuisine_type = m.cuisine
  from (
    select r2.id,
           (select m2.cuisine
              from unnest(r2.types) with ordinality as t(name, ord)
              join (values
                ('italian_restaurant',        'italian'),
                ('pizza_restaurant',          'italian'),
                ('american_restaurant',       'american'),
                ('hamburger_restaurant',      'american'),
                ('chicken_restaurant',        'american'),
                ('chicken_wings_restaurant',  'american'),
                ('barbecue_restaurant',       'bbq'),
                ('steak_house',               'steakhouse'),
                ('seafood_restaurant',        'seafood'),
                ('sushi_restaurant',          'japanese'),
                ('ramen_restaurant',          'japanese'),
                ('japanese_restaurant',       'japanese'),
                ('chinese_restaurant',        'chinese'),
                ('korean_restaurant',         'korean'),
                ('thai_restaurant',           'thai'),
                ('vietnamese_restaurant',     'vietnamese'),
                ('indian_restaurant',         'indian'),
                ('mexican_restaurant',        'mexican'),
                ('tex_mex_restaurant',        'mexican'),
                ('latin_american_restaurant', 'latin-american'),
                ('brazilian_restaurant',      'latin-american'),
                ('peruvian_restaurant',       'latin-american'),
                ('cuban_restaurant',          'caribbean'),
                ('caribbean_restaurant',      'caribbean'),
                ('african_restaurant',        'african'),
                ('ethiopian_restaurant',      'african'),
                ('mediterranean_restaurant',  'mediterranean'),
                ('greek_restaurant',          'mediterranean'),
                ('turkish_restaurant',        'middle-eastern'),
                ('lebanese_restaurant',       'middle-eastern'),
                ('middle_eastern_restaurant', 'middle-eastern'),
                ('israeli_restaurant',        'middle-eastern'),
                ('french_restaurant',         'french'),
                ('spanish_restaurant',        'spanish'),
                ('tapas_restaurant',          'spanish'),
                ('vegan_restaurant',          'healthy'),
                ('vegetarian_restaurant',     'healthy'),
                ('dessert_restaurant',        'dessert'),
                ('ice_cream_shop',            'dessert')
              ) as m2(gtype, cuisine) on m2.gtype = t.name
             order by t.ord
             limit 1) as cuisine
      from public.restaurants r2
     where r2.cuisine_type is null
       and r2.types is not null
  ) m
 where m.id = r.id
   and m.cuisine is not null;

do $$
declare filled int; remaining int;
begin
  select count(*) into remaining from public.restaurants where cuisine_type is null;
  filled := 450 - remaining;
  if filled < 60 then
    raise exception '0097: expected ~90 rows filled from types, got %', filled;
  end if;
  raise notice '0097: % rows filled from Google types, % still null', filled, remaining;
end $$;
