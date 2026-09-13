-- ============================================================================
-- 0152_cuisine_from_name.sql — the second free tier.
-- ----------------------------------------------------------------------------
-- 0113 fills cuisine_type from Google's own types[] and is permanent, by
-- trigger. It cannot help the 1,251 rows where Google returned only generic
-- types: `restaurant`, `food`, `bar`, `cafe`, `point_of_interest`. Those skew
-- American, independent, bars and cafes -- precisely the places the "best
-- restaurant in the city for you" thesis leans on hardest, and every one of
-- them is currently invisible to the recommender.
--
-- Before paying a model to read them, read their NAMES. mobile/lib/
-- palate-insights.ts has carried a keyword table for exactly this since long
-- before the classifier existed, but it only ever ran on the client, for
-- display. Running the same idea server-side, once, costs nothing.
--
-- Rules of engagement, same as 0113:
--   • only ever fills a NULL; never overwrites an existing classification
--   • deterministic, no model, no Google call, no cost
--   • high precision over recall. A wrong cuisine is worse than none: it
--     pollutes the taste graph, which is what every recommendation is computed
--     from. Where a word is ambiguous ("grill", "kitchen", "house") it is left
--     out entirely rather than guessed.
--
-- Word boundaries throughout. Without them "crab" matches "Crabtree" and
-- "thai" matches "Thailand Travel"; \m and \M are Postgres's.
-- ============================================================================

create or replace function public.cuisine_from_name(p_name text)
returns text
language sql
immutable
as $$
  select c from (
    values
      -- Ordered: the first match wins, so put the specific before the generic.
      ('italian',        '\m(pizz(a|eria)|trattoria|osteria|ristorante|pasta|italiano)\M'),
      ('japanese',       '\m(sushi|ramen|izakaya|udon|omakase|teriyaki|hibachi|yakitori|donburi)\M'),
      ('mexican',        '\m(taqueria|taco[s]?|burrito[s]?|cantina|tortilla|birria|mexicana?)\M'),
      ('chinese',        '\m(dim\s*sum|szechuan|sichuan|cantonese|wok|chow|dumpling[s]?|peking)\M'),
      ('korean',        '\m(kbbq|bibimbap|bulgogi|korean)\M'),
      ('thai',           '\m(thai|pad\s*thai)\M'),
      ('vietnamese',     '\m(pho|banh\s*mi|vietnamese)\M'),
      ('indian',         '\m(tandoor[i]?|masala|biryani|curry|naan|dosa|punjab[i]?)\M'),
      ('mediterranean',  '\m(gyro[s]?|falafel|hummus|souvlaki|mediterranean)\M'),
      ('middle-eastern', '\m(shawarma|kebab|kabob|halal|lebanese|persian)\M'),
      ('caribbean',      '\m(jerk|caribbean|jamaican|island\s*vibes?)\M'),
      ('french',         '\m(patisserie|brasserie|creperie|boulangerie|bistro\s*francais)\M'),
      ('bbq',            '\m(bbq|barbecue|barbeque|smokehouse|brisket|smoke\s*house)\M'),
      ('steakhouse',     '\m(steakhouse|chophouse|steak\s*house|chop\s*house)\M'),
      ('seafood',        '\m(seafood|oyster[s]?|lobster|crab\s*(shack|house)|fish\s*(house|market)|shrimp)\M'),
      ('dessert',        '\m(ice\s*cream|gelato|creamery|frozen\s*yogurt|froyo|cupcake[s]?|donut[s]?|doughnut[s]?)\M'),
      ('bakery',         '\m(bakery|bakeshop|bake\s*shop|bagel[s]?|croissant)\M'),
      -- 'cafe' last among the drinks: plenty of restaurants are called Cafe X.
      -- Only the unambiguous coffee words qualify.
      ('café',           '\m(coffee|espresso|roaster[sy]?|coffeehouse|coffee\s*house)\M'),
      ('american',       '\m(burger[s]?|smashburger|cheesesteak|hoagie|sub\s*shop|wings|diner|deli|delicatessen|soul\s*food|southern\s*kitchen)\M')
  ) as m(c, pat)
  where p_name is not null and p_name ~* m.pat
  limit 1;
$$;

comment on function public.cuisine_from_name(text) is
  'High-precision cuisine guess from a restaurant name. Used only to fill a '
  'NULL cuisine_type, never to overwrite one. Deliberately omits ambiguous '
  'words (grill, kitchen, house, bar) -- a wrong cuisine pollutes the taste '
  'graph, and no cuisine is the safer failure.';

-- ----------------------------------------------------------------------------
-- Backfill, and keep it filled.
-- ----------------------------------------------------------------------------
do $$
declare before_n int; after_n int; filled int;
begin
  select count(*) into before_n from public.restaurants
   where cuisine_type is null or cuisine_type = '';

  update public.restaurants
     set cuisine_type = public.cuisine_from_name(name)
   where (cuisine_type is null or cuisine_type = '')
     and public.cuisine_from_name(name) is not null;
  get diagnostics filled = row_count;

  select count(*) into after_n from public.restaurants
   where cuisine_type is null or cuisine_type = '';

  raise notice 'cuisine_from_name: % filled, % -> % still missing', filled, before_n, after_n;
end $$;

-- New rows get the same treatment, after the types rule has had its turn.
create or replace function public.set_cuisine_from_name()
returns trigger language plpgsql as $$
begin
  if (new.cuisine_type is null or new.cuisine_type = '') then
    new.cuisine_type := public.cuisine_from_name(new.name);
  end if;
  return new;
end $$;

drop trigger if exists restaurants_cuisine_from_name on public.restaurants;
create trigger restaurants_cuisine_from_name
  before insert or update of name, cuisine_type on public.restaurants
  for each row execute function public.set_cuisine_from_name();
