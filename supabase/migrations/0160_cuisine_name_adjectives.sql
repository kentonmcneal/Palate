-- ============================================================================
-- 0160 — the cuisine words themselves.
-- ----------------------------------------------------------------------------
-- 0152's name rules matched the DISHES (pizzeria, sushi, taqueria, tandoori)
-- and, through an oversight, only some of the plain adjectives. It matched
-- `italiano` but not `italian`, so "BellaRosa Free Style Italian Restaurant"
-- was queued for a paid model that would have read the word Italian in its
-- name and charged for the privilege. Same gap for chinese, japanese, indian
-- and several others.
--
-- A cuisine adjective in a restaurant's own name is about as unambiguous as
-- this gets. Still only fills a NULL, still never overwrites.
-- ============================================================================

create or replace function public.cuisine_from_name(p_name text)
returns text
language sql
immutable
as $$
  select c from (
    values
      ('italian',        '\m(pizz(a|eria)|trattoria|osteria|ristorante|pasta|italiano?)\M'),
      ('japanese',       '\m(sushi|ramen|izakaya|udon|omakase|teriyaki|hibachi|yakitori|donburi|japanese)\M'),
      ('mexican',        '\m(taqueria|taco[s]?|burrito[s]?|cantina|tortilla|birria|mexicana?)\M'),
      ('chinese',        '\m(dim\s*sum|szechuan|sichuan|cantonese|wok|chow|dumpling[s]?|peking|chinese)\M'),
      ('korean',         '\m(kbbq|bibimbap|bulgogi|korean)\M'),
      ('thai',           '\m(thai|pad\s*thai)\M'),
      ('vietnamese',     '\m(pho|banh\s*mi|vietnamese)\M'),
      ('indian',         '\m(tandoor[i]?|masala|biryani|curry|naan|dosa|punjab[i]?|indian)\M'),
      ('mediterranean',  '\m(gyro[s]?|falafel|hummus|souvlaki|mediterranean|greek)\M'),
      ('middle-eastern', '\m(shawarma|kebab|kabob|halal|lebanese|persian|turkish)\M'),
      ('caribbean',      '\m(jerk|caribbean|jamaican|cuban|haitian|trinidad)\M'),
      ('latin-american', '\m(peruvian|colombian|venezuelan|arepa[s]?|empanada[s]?|salvadoran)\M'),
      ('african',        '\m(ethiopian|injera|nigerian|senegalese|west\s*african)\M'),
      ('spanish',        '\m(tapas|paella|spanish)\M'),
      ('filipino',       '\m(filipino|lumpia|adobo\s*house)\M'),
      ('french',         '\m(patisserie|brasserie|creperie|boulangerie|french\s*bistro)\M'),
      ('bbq',            '\m(bbq|barbecue|barbeque|smokehouse|brisket|smoke\s*house)\M'),
      ('steakhouse',     '\m(steakhouse|chophouse|steak\s*house|chop\s*house)\M'),
      ('seafood',        '\m(seafood|oyster[s]?|lobster|crab\s*(shack|house)|fish\s*(house|market)|shrimp)\M'),
      ('dessert',        '\m(ice\s*cream|gelato|creamery|frozen\s*yogurt|froyo|cupcake[s]?|donut[s]?|doughnut[s]?)\M'),
      ('bakery',         '\m(bakery|bakeshop|bake\s*shop|bagel[s]?|croissant)\M'),
      ('café',           '\m(coffee|espresso|roaster[sy]?|coffeehouse|coffee\s*house)\M'),
      ('american',       '\m(burger[s]?|smashburger|cheesesteak|hoagie|sub\s*shop|wings|diner|deli|delicatessen|soul\s*food|southern\s*kitchen)\M')
  ) as m(c, pat)
  where p_name is not null and p_name ~* m.pat
  limit 1;
$$;

do $$
declare before_n int; after_n int; filled int; paid int;
begin
  select count(*) into before_n from public.restaurants where cuisine_type is null or cuisine_type='';
  update public.restaurants
     set cuisine_type = public.cuisine_from_name(name)
   where (cuisine_type is null or cuisine_type = '')
     and public.cuisine_from_name(name) is not null;
  get diagnostics filled = row_count;
  select count(*) into after_n from public.restaurants where cuisine_type is null or cuisine_type='';
  select count(*) into paid from public.restaurants
   where (cuisine_type is null or cuisine_type='') and ineligibility_reason is null and types is not null;
  raise notice 'adjectives filled %, % -> % missing, % left for the model', filled, before_n, after_n, paid;
end $$;
