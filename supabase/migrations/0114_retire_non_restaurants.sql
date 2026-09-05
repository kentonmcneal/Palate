-- ============================================================================
-- 0114_retire_non_restaurants.sql — Walmart is not a dinner recommendation.
-- ----------------------------------------------------------------------------
-- The classifier's non-restaurant rule has been unreachable since it was
-- written: it required "no dining type present", but the check above it
-- already returns for that case. So a grocery store or department store whose
-- Google types include `bakery` passed the gate. LIVE: Whole Foods Market,
-- Walmart Supercenter, UNIQLO 5th Avenue and friends are all sitting in the
-- recommendable pool.
--
-- The classifier is fixed in the same change, but classifier edits never touch
-- rows already in the table. This is the sweep. Judged on primary_type only —
-- Google's own word for what the place mainly is — so nothing is guessed from
-- a name.
-- ============================================================================
update public.restaurants
   set recommendation_eligibility = 0,
       ineligibility_reason = 'not_a_restaurant'
 where coalesce(recommendation_eligibility, 1) > 0
   and primary_type in (
     'grocery_store','supermarket','hypermarket','department_store','convenience_store',
     'warehouse_store','wholesaler','liquor_store','drugstore','pharmacy','gas_station',
     'shopping_mall','clothing_store','food_store','market','cafeteria',
     'transit_depot','train_station','subway_station','bus_station','airport',
     'tourist_attraction','museum','art_gallery','movie_theater','stadium','arena',
     'casino','resort_hotel','hotel','lodging','motel','night_club','live_music_venue',
     'performing_arts_theater','concert_hall','event_venue','bowling_alley',
     'miniature_golf_course','indoor_golf_course','golf_course','plaza','park',
     'association_or_organization','manufacturer','school','university','hospital'
   );

do $$
declare removed int; left_in int;
begin
  select count(*) into removed from public.restaurants where ineligibility_reason = 'not_a_restaurant';
  select count(*) into left_in from public.restaurants where coalesce(recommendation_eligibility,1) > 0;
  raise notice '0114: % rows marked not_a_restaurant, % recommendable places remain', removed, left_in;
end $$;
