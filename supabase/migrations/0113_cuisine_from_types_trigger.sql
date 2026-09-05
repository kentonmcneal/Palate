-- ============================================================================
-- 0113_cuisine_from_types_trigger.sql — the free half, permanently.
-- ----------------------------------------------------------------------------
-- 0097 mapped Google's own food-naming types (italian_restaurant,
-- caribbean_restaurant, …) onto cuisine_type. It ran ONCE, as a backfill, so
-- every row that has arrived since — 468 of them today alone — missed it.
-- LIVE: 6 caribbean_restaurant rows and a handful of others sit unclassified
-- for no reason but timing.
--
-- Same map, now a function, applied by trigger to every row on the way in and
-- re-run over what is already here. Deterministic, no model, no Google call,
-- no cost. Only fills a NULL; never overwrites a classification.
-- ============================================================================
create or replace function public.cuisine_from_types(p_types text[])
returns text language sql immutable as $$
  select m.cuisine
    from unnest(coalesce(p_types, '{}'::text[])) with ordinality as t(name, ord)
    join (values
      ('italian_restaurant','italian'), ('pizza_restaurant','italian'),
      ('american_restaurant','american'), ('hamburger_restaurant','american'),
      ('chicken_restaurant','american'), ('chicken_wings_restaurant','american'),
      ('soul_food_restaurant','american'), ('californian_restaurant','american'),
      ('barbecue_restaurant','bbq'), ('steak_house','steakhouse'),
      ('seafood_restaurant','seafood'), ('oyster_bar_restaurant','seafood'),
      ('sushi_restaurant','japanese'), ('ramen_restaurant','japanese'),
      ('japanese_restaurant','japanese'), ('chinese_restaurant','chinese'),
      ('korean_restaurant','korean'), ('thai_restaurant','thai'),
      ('vietnamese_restaurant','vietnamese'), ('indian_restaurant','indian'),
      ('pakistani_restaurant','indian'), ('mexican_restaurant','mexican'),
      ('tex_mex_restaurant','mexican'), ('taco_restaurant','mexican'),
      ('latin_american_restaurant','latin-american'), ('brazilian_restaurant','latin-american'),
      ('peruvian_restaurant','latin-american'), ('cuban_restaurant','caribbean'),
      ('caribbean_restaurant','caribbean'), ('african_restaurant','african'),
      ('ethiopian_restaurant','african'), ('mediterranean_restaurant','mediterranean'),
      ('greek_restaurant','mediterranean'), ('turkish_restaurant','middle-eastern'),
      ('lebanese_restaurant','middle-eastern'), ('middle_eastern_restaurant','middle-eastern'),
      ('israeli_restaurant','middle-eastern'), ('french_restaurant','french'),
      ('spanish_restaurant','spanish'), ('tapas_restaurant','spanish'),
      ('vegan_restaurant','healthy'), ('vegetarian_restaurant','healthy'),
      ('dessert_restaurant','dessert'), ('dessert_shop','dessert'),
      ('ice_cream_shop','dessert'), ('donut_shop','dessert'), ('cake_shop','dessert')
    ) as m(gtype, cuisine) on m.gtype = t.name
   order by t.ord
   limit 1;
$$;

create or replace function public.restaurants_set_cuisine_from_types()
returns trigger language plpgsql as $$
begin
  if new.cuisine_type is null then
    new.cuisine_type := public.cuisine_from_types(new.types);
  end if;
  return new;
end $$;
drop trigger if exists restaurants_set_cuisine_from_types on public.restaurants;
create trigger restaurants_set_cuisine_from_types
  before insert or update of types, cuisine_type on public.restaurants
  for each row execute function public.restaurants_set_cuisine_from_types();

update public.restaurants
   set cuisine_type = public.cuisine_from_types(types)
 where cuisine_type is null and public.cuisine_from_types(types) is not null;

do $$
declare remaining int; generic int;
begin
  select count(*) into remaining from public.restaurants where cuisine_type is null;
  select count(*) into generic from public.restaurants
   where cuisine_type is null and coalesce(recommendation_eligibility,1) > 0
     and primary_type in ('restaurant','fine_dining_restaurant','family_restaurant','diner','food','food_court','buffet_restaurant');
  raise notice '0113: % rows still null, of which % are recommendable places Google only calls "restaurant"', remaining, generic;
end $$;
