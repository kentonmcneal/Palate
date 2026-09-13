-- ============================================================================
-- 0159 — the third free tier, and stop paying to classify car parks.
-- ----------------------------------------------------------------------------
-- Of the 777 rows still without a cuisine after 0113 (Google's food types) and
-- 0152 (the name rules):
--
--   • 265 are ALREADY MARKED INELIGIBLE — not_a_restaurant, non_food_primary_
--     type, national_chain, hotel, airport, lounge_gated, captive_venue. They
--     can never be recommended, and the LLM backfill's query never filtered on
--     eligibility, so a third of the bill was going to read grocery stores.
--
--   • ~200 more carry a primary_type that IS the answer: cafe, coffee_shop,
--     bakery, and the whole bar family. 0113's map only covers Google's
--     `*_restaurant` types, so these fell through to the paid tier for no
--     reason at all.
--
-- Both are fixed for free here. What is left for the model is the genuinely
-- ambiguous middle: `primary_type = 'restaurant'` with a name that says
-- nothing, which is exactly what a model is for.
--
-- Venue types are deliberately WEAKER than food types and are applied only
-- where nothing better exists. A cocktail bar recorded as 'bar' is a true and
-- useful fact; it is not a claim about what is on the menu.
-- ============================================================================

create or replace function public.cuisine_from_venue_type(p_primary_type text)
returns text
language sql
immutable
as $$
  select case p_primary_type
    when 'cafe'            then 'café'
    when 'coffee_shop'     then 'café'
    when 'tea_house'       then 'café'
    when 'bakery'          then 'bakery'
    when 'dessert_shop'    then 'dessert'
    when 'ice_cream_shop'  then 'dessert'
    when 'juice_shop'      then 'healthy'
    when 'bar'             then 'bar'
    when 'pub'             then 'bar'
    when 'irish_pub'       then 'bar'
    when 'sports_bar'      then 'bar'
    when 'cocktail_bar'    then 'bar'
    when 'lounge_bar'      then 'bar'
    when 'wine_bar'        then 'bar'
    when 'bar_and_grill'   then 'american'
    when 'brunch_restaurant' then 'american'
    when 'breakfast_restaurant' then 'american'
    when 'fine_dining_restaurant' then 'american'
    else null
  end;
$$;

comment on function public.cuisine_from_venue_type(text) is
  'Cuisine from Google''s VENUE primary_type, for places whose food types said '
  'nothing. Weaker than cuisine_from_types and applied only when that and the '
  'name rules have both come up empty.';

do $$
declare before_n int; after_n int; filled int;
begin
  select count(*) into before_n from public.restaurants where cuisine_type is null or cuisine_type = '';

  update public.restaurants
     set cuisine_type = public.cuisine_from_venue_type(primary_type)
   where (cuisine_type is null or cuisine_type = '')
     and public.cuisine_from_venue_type(primary_type) is not null;
  get diagnostics filled = row_count;

  select count(*) into after_n from public.restaurants where cuisine_type is null or cuisine_type = '';
  raise notice 'venue types filled %, % -> % still missing', filled, before_n, after_n;
end $$;

-- Keep it filled for new rows, after the food-type and name triggers have had
-- their turn. BEFORE INSERT OR UPDATE, same shape as 0113 and 0152.
create or replace function public.set_cuisine_from_venue_type()
returns trigger language plpgsql as $$
begin
  if (new.cuisine_type is null or new.cuisine_type = '') then
    new.cuisine_type := public.cuisine_from_venue_type(new.primary_type);
  end if;
  return new;
end $$;

drop trigger if exists restaurants_cuisine_from_venue_type on public.restaurants;
create trigger restaurants_cuisine_from_venue_type
  before insert or update of primary_type, cuisine_type on public.restaurants
  for each row execute function public.set_cuisine_from_venue_type();
