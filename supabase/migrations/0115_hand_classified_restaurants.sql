-- ============================================================================
-- 0115_hand_classified_restaurants.sql — the 160, done by hand, for nothing.
-- ----------------------------------------------------------------------------
-- After 0091 split formats out of cuisine and 0113 made Google's own
-- food-type map permanent, what was left unclassified were places Google
-- only calls "restaurant". No free signal remains in the data, and the paid
-- option (a Haiku pass, ~$1.60 of Anthropic API credit, which a Max plan does
-- not cover) buys exactly what a careful reader can do from the names.
--
-- So: read by hand, and only where the name is genuinely diagnostic. "Le
-- Virtù" is Italian, "Shibam Yemeni Kitchens" is Middle Eastern, "CM Chicken"
-- is Korean fried chicken. "The Lookout", "Secrets", "JEM" and about eighty
-- others are NOT assigned, because a name that could be anything should stay
-- null — the same rule the classifier's confidence threshold enforces. Null
-- means "we looked and could not tell", which the scorer now prices correctly
-- (UNKNOWN_TASTE_PRIOR, shipped today).
--
-- Matched on exact name, only where cuisine_type is still null, so this is
-- idempotent and can never overwrite a classification.
-- ============================================================================
update public.restaurants r
   set cuisine_type = m.cuisine
  from (values
    ('Café Bastille Downtown Miami', 'french'),
    ('Brioche Doree', 'french'),
    ('OLIO E PIÙ', 'italian'),
    ('La Pausa Restaurant', 'italian'),
    ('Le Virtù', 'italian'),
    ('Rock''n Dough Pizza & Brewery', 'italian'),
    ('Rotolo''s Craft & Crust', 'italian'),
    ('Elfo Grisanti’s Italian Restaurant', 'italian'),
    ('David Grisanti''s On Main', 'italian'),
    ('Go Grisanti', 'italian'),
    ('New York Style Pizzeria', 'italian'),
    ('Culaccino Italian Restaurant', 'italian'),
    ('The Flaming Pizza', 'italian'),
    ('Josephine Estelle', 'italian'),
    ('#GetSmoked Pizza Bar', 'italian'),
    ('Pasta Bowls Stockdale', 'italian'),
    ('Umiya Sushi Memphis', 'japanese'),
    ('RYU', 'japanese'),
    ('Ginza Buffet of Gastonia', 'japanese'),
    ('Tokyo Grill', 'japanese'),
    ('ZENSHI Handcrafted Sushi', 'japanese'),
    ('Kim Mama''s Bento Box', 'japanese'),
    ('Lucky Chow - Winchester', 'chinese'),
    ('China Taste', 'chinese'),
    ('CM Chicken Hampton', 'korean'),
    ('Nepali Momo Kitchen', 'indian'),
    ('Karravaan', 'indian'),
    ('CloudChef', 'indian'),
    ('Shibam Yemeni Kitchens', 'middle-eastern'),
    ('Shibam Mix Grill', 'middle-eastern'),
    ('Balqees Restaurant And Grill', 'middle-eastern'),
    ('Mish Mish', 'middle-eastern'),
    ('Jim''s Place Grille', 'mediterranean'),
    ('Esmeralda''s Taco Shop', 'mexican'),
    ('Dos Compadres Mexican Cantina and Grill', 'mexican'),
    ('Mangos Fruteria y Neveria', 'mexican'),
    ('Cowboy Cactus', 'mexican'),
    ('Half Moon Empanadas - Gate D29 - Miami International Airport', 'latin-american'),
    ('El Sabor Catracho', 'latin-american'),
    ('Irie Caribbean Cuisine', 'caribbean'),
    ('Sabor Caribe', 'caribbean'),
    ('Bellgordon''s Caribbean Restaurant', 'caribbean'),
    ('7 Spices Caribbean Soul', 'caribbean'),
    ('Island Paradise Takeout', 'caribbean'),
    ('Yaadvybz Bikkle', 'caribbean'),
    ('Habana Club Bar and Grill', 'caribbean'),
    ('Wah gwaan', 'caribbean'),
    ('De’Flavour LLC Caribbean Restaurant', 'caribbean'),
    ('Sunset caribbean grill', 'caribbean'),
    ('Little Jamaica', 'caribbean'),
    ('HIGHER HEIGHTS CARIBBEAN RESTURANT', 'caribbean'),
    ('A taste of the Caribbean', 'caribbean'),
    ('The Smoke Pit', 'bbq'),
    ('AJ''s Sports Grille & Smokehouse', 'bbq'),
    ('Alex Farms Hickory Smoked Chicken Salad and BBQ Olive Branch', 'bbq'),
    ('E&R Ribs and Wings', 'bbq'),
    ('Cork & Bull Chophouse', 'steakhouse'),
    ('POKE PARADISE', 'seafood'),
    ('honeygrow', 'healthy'),
    ('Wildseed', 'healthy'),
    ('Playa Bowls', 'healthy'),
    ('Rad Radish', 'healthy'),
    ('Bare Fruit Acai Bar', 'healthy'),
    ('Root & Sprig by Tom Colicchio - Philadelphia', 'healthy'),
    ('Farmer''s Fridge', 'healthy'),
    ('Metro Diner and Bar', 'american'),
    ('Mr. Broadway', 'american'),
    ('Sunrise Memphis (Downtown)', 'american'),
    ('Eggs Up Grill', 'american'),
    ('First Watch', 'american'),
    ('Gus''s Hot Dog King', 'american'),
    ('City Winery Philadelphia', 'american'),
    ('Southern Social', 'american'),
    ('The Toasted Yolk Cafe', 'american'),
    ('Victory Brewing Company Philadelphia', 'american'),
    ('Harper''s Garden', 'american'),
    ('SOB Downtown', 'american'),
    ('SOB Collierville', 'american'),
    ('Sugar Grits', 'american'),
    ('NEST Kitchen & Taphouse', 'american'),
    ('Taste Cheesesteak Bar', 'american'),
    ('Dauphine’s', 'american'),
    ('Toast', 'american'),
    ('Peck & Pour, World Class Wings and Beer', 'american'),
    ('Little Ruby''s West Village', 'american'),
    ('Heirloom', 'american'),
    ('Green Eggs Cafe', 'american'),
    ('Mr.J’S Wings', 'american'),
    ('Budweiser Brew House', 'american'),
    ('Circa 1918 Kitchen and Bar', 'american'),
    ('Shark’s Fish & Chicken', 'american'),
    ('America’s Best Wings', 'american'),
    ('Darling Jack''s Tavern', 'american'),
    ('The Bird', 'american'),
    ('The Board and Brew', 'american'),
    ('Magnolia & May', 'american'),
    ('Carving Room NoMa', 'american'),
    ('Hillboyz Wing & Burger Bar', 'american'),
    ('Memphis Toast', 'american'),
    ('Hen House', 'american'),
    ('Wadford''s Rooftop Grille', 'american'),
    ('Tommy’s Burgers California Style', 'american'),
    ('Burger Fusion 305', 'american'),
    ('Jr fish and chicken', 'american'),
    ('The Crazy Coop Ridgeway', 'american'),
    ('Mikes Hot Wings & Such Collierville', 'american'),
    ('Grandstands Grill', 'american'),
    ('Rayford’s Hotwings - Raleigh', 'american'),
    ('Smokin Hot Wings', 'american'),
    ('Down South Wings & Grill', 'american'),
    ('Coventry Deli', 'american'),
    ('Honeysuckle Restaurant', 'american'),
    ('Brunch N Burger', 'american'),
    ('Height Wings', 'american'),
    ('Crumpy''s Hotwings', 'american'),
    ('Burger Prime', 'american'),
    ('Rosie''s Tavern', 'american'),
    ('Memphis Wings', 'american'),
    ('Wingz & Thingz 901', 'american'),
    ('Pine Street Grill', 'american'),
    ('Burger Street', 'american')
  ) as m(name, cuisine)
 where r.name = m.name
   and r.cuisine_type is null;

do $$
declare remaining int; still_generic int;
begin
  select count(*) into remaining from public.restaurants where cuisine_type is null;
  select count(*) into still_generic from public.restaurants
   where cuisine_type is null and coalesce(recommendation_eligibility,1) > 0
     and primary_type in ('restaurant','fine_dining_restaurant','family_restaurant','diner','food',
                          'food_court','buffet_restaurant','meal_takeaway','meal_delivery',
                          'breakfast_restaurant','brunch_restaurant','asian_restaurant',
                          'european_restaurant','sandwich_shop','deli');
  raise notice '0115: %s rows still null overall, %s of them recommendable places Google only calls "restaurant"', remaining, still_generic;
end $$;
