-- ============================================================================
-- 0099_dish_family.sql — what people actually crave, as a second axis.
-- ----------------------------------------------------------------------------
-- Nobody is in the mood for "Latin American". They want tacos. A ramen shop
-- and an omakase counter are both `japanese`, and a chip for Japanese cannot
-- tell them apart. cuisine_type stays for the taste graph; dish_family is for
-- the chip row, and it comes almost entirely from Google's own types[], which
-- are on every row and cost nothing. Counted first across 1,043 rows:
-- burgers 98, sandwiches 96, fried chicken 68, pizza 61, brunch 60, seafood
-- 46, dessert 42, steak 40, salads 24, tacos 23, bbq 23, wings 20, sushi 15,
-- ramen 9. A place can carry several (a sports bar: burgers + wings).
-- ============================================================================

alter table public.restaurants add column if not exists dish_family text[];
create index if not exists restaurants_dish_family_gin on public.restaurants using gin (dish_family);

create or replace function public.dish_family_from_types(p_types text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct m.dish order by m.dish), '{}'::text[])
    from unnest(coalesce(p_types, '{}'::text[])) t(name)
    join (values
      ('pizza_restaurant',          'pizza'),
      ('hamburger_restaurant',      'burgers'),
      ('sandwich_shop',             'sandwiches'),
      ('chicken_restaurant',        'fried_chicken'),
      ('chicken_wings_restaurant',  'wings'),
      ('taco_restaurant',           'tacos'),
      ('mexican_restaurant',        'tacos'),
      ('barbecue_restaurant',       'bbq'),
      ('steak_house',               'steak'),
      ('seafood_restaurant',        'seafood'),
      ('sushi_restaurant',          'sushi'),
      ('ramen_restaurant',          'ramen'),
      ('noodle_restaurant',         'noodles'),
      ('dumpling_restaurant',       'dumplings'),
      ('salad_shop',                'salads'),
      ('brunch_restaurant',         'brunch'),
      ('breakfast_restaurant',      'brunch'),
      ('bagel_shop',                'bagels'),
      ('donut_shop',                'donuts'),
      ('ice_cream_shop',            'ice_cream'),
      ('dessert_shop',              'dessert'),
      ('dessert_restaurant',        'dessert'),
      ('bakery',                    'pastries'),
      ('coffee_shop',               'coffee'),
      ('cafe',                      'coffee'),
      ('tea_house',                 'tea'),
      ('juice_shop',                'juice'),
      ('wine_bar',                  'wine'),
      ('cocktail_bar',              'cocktails'),
      ('brewery',                   'beer'),
      ('pub',                       'beer')
    ) as m(gtype, dish) on m.gtype = t.name;
$$;

update public.restaurants set dish_family = public.dish_family_from_types(types);

-- Every row classified from now on gets it too, from the same function, so
-- a fresh row and a backfilled one agree.
create or replace function public.restaurants_set_dish_family()
returns trigger language plpgsql as $$
begin
  new.dish_family := public.dish_family_from_types(new.types);
  return new;
end $$;
drop trigger if exists restaurants_set_dish_family on public.restaurants;
create trigger restaurants_set_dish_family
  before insert or update of types on public.restaurants
  for each row execute function public.restaurants_set_dish_family();

-- Same shape as cuisines_near (0090): signed-in, bounding box, eligible only.
create or replace function public.dishes_near(
  p_lat double precision, p_lng double precision, p_radius_m integer default 8000
)
returns table (dish text, place_count integer)
language sql stable security definer set search_path = public
as $$
  with box as (
    select p_lat - (p_radius_m / 111320.0) as min_lat, p_lat + (p_radius_m / 111320.0) as max_lat,
           p_lng - (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as min_lng,
           p_lng + (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as max_lng
  )
  select d.dish, count(*)::int
    from public.restaurants r, box b, unnest(r.dish_family) d(dish)
   where auth.uid() is not null
     and r.latitude between b.min_lat and b.max_lat
     and r.longitude between b.min_lng and b.max_lng
     and coalesce(r.recommendation_eligibility, 1) > 0
   group by d.dish
   order by count(*) desc, d.dish;
$$;
revoke all on function public.dishes_near(double precision, double precision, integer) from public, anon;
grant execute on function public.dishes_near(double precision, double precision, integer) to authenticated;

create or replace function public.restaurants_by_dish(
  p_lat double precision, p_lng double precision, p_dish text,
  p_radius_m integer default 8000, p_limit integer default 20
)
returns setof public.restaurants
language sql stable security definer set search_path = public
as $$
  with box as (
    select p_lat - (p_radius_m / 111320.0) as min_lat, p_lat + (p_radius_m / 111320.0) as max_lat,
           p_lng - (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as min_lng,
           p_lng + (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as max_lng
  )
  select r.*
    from public.restaurants r, box b
   where auth.uid() is not null
     and r.latitude between b.min_lat and b.max_lat
     and r.longitude between b.min_lng and b.max_lng
     and r.dish_family @> array[lower(trim(p_dish))]
     and coalesce(r.recommendation_eligibility, 1) > 0
   order by coalesce(r.rating, 0) desc, coalesce(r.user_rating_count, 0) desc, r.name
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
revoke all on function public.restaurants_by_dish(double precision, double precision, text, integer, integer) from public, anon;
grant execute on function public.restaurants_by_dish(double precision, double precision, text, integer, integer) to authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.restaurants where cardinality(dish_family) > 0;
  -- Relative, so a from-scratch (empty) database still applies cleanly.
  if (select count(*) from public.restaurants) >= 100 and n < 400 then
    raise exception '0099: only % rows got a dish family', n;
  end if;
  raise notice '0099: % rows carry a dish family', n;
end $$;
