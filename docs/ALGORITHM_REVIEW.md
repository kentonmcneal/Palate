# How Palate tags and ranks, and what would make it better

Written 2026-09-05 against the live catalogue. Every number below was
counted, not assumed.

## The state of the data

1,043 restaurants across Manhattan, Philadelphia, Memphis, DC and Miami.

| field | populated | notes |
|---|---|---|
| `cuisine_type` | 670 (64%) | was 61% *and* polluted with café/bar/bakery/brunch until 0091; 0097 filled 77 more from Google's own types |
| `format_class` | 1,033 (99%) | reliable; it is what Google types say directly |
| `cuisine_subregion` | ~53% | the heaviest weight in the score |
| `occasion_tags` | ~65% | avg 1.9 tags |
| `flavor_tags` | 54%, but `rich` on two thirds | switched off in scoring today |
| `price_level` | 75% | |
| `rating` / `user_rating_count` | ~97% | the most complete signal we have |

The 373 rows still without a cuisine are mostly places Google itself only
calls `restaurant`, `breakfast_restaurant` or `family_restaurant`. There is
no free way to know what they serve. The classifier's LLM pass reads the
name and review snippets and would recover most of them, but only on a
reclassify run.

## Why the toggle "doesn't change anything" sometimes

Three separate reasons, in order of how often they bite:

1. **Coverage.** In an 8km circle around the founder's last visit there are
   138 recommendable places and 13 cuisines with at least one. Half of
   those have 1 to 4 places. Toggling to a cuisine with two places shows
   two places, and if one of them was already on the list, the list barely
   moves. That is the data, not the filter. The card header now says
   `Indian near you · 5 places` so this is visible instead of mysterious.
2. **Null cuisine.** A place with no `cuisine_type` can never match a
   cuisine chip. Until today 43% of the catalogue was invisible to every
   chip. Now 36%.
3. **Delivery.** Ten OTAs in a day means the phone is usually one update
   behind; a toggle that "does nothing" on a bundle from this morning is
   the old bundle. Settings → About shows the update id.

## How ranking works today

`getCompatibility` in `lib/recommendation/compatibility.ts`: a weighted
sum over taste (subregion 0.5, region 0.3, flavor 0 now), behaviour (format
0.45, occasion 0.30, price 0.25), social (friend visits, popularity) and
quality (rating as a safeguard). Each block normalises over the attributes
that are *present*, then a confidence factor pulls sparse rows toward 50
(the fix from 8c: a place scored on one attribute cannot reach 95).

Moods are a filter over that ranked list. They never re-score. A cuisine
chip keeps only rows whose `cuisine_type` matches; when the nearby pool has
none, the catalogue is asked for the best of that cuisine within 8km and
they are scored on the same graph.

## What is structurally weak

**One column carries the whole mood system.** `cuisine_type` is a single
value from a 22-word vocabulary. A ramen shop is `japanese`; so is an
omakase counter. A chip for "Japanese" returns both and a person in the
mood for a bowl of noodles cannot ask for it. Subregion exists
(`japanese_ramen`) but no surface uses it as a chip.

**Google types are under-used.** They are free, deterministic, and on
every row. `pizza_restaurant`, `sushi_restaurant`, `ramen_restaurant`,
`hamburger_restaurant`, `taco`... The rule classifier reads them at
classification time and then they are forgotten. 0097 shows what they are
worth: 77 cuisines recovered by one SQL statement.

**The LLM is asked 14 questions at once**, including vibe, crowd, menu
style and an ambiance sentence, at the same confidence bar as cuisine. The
eval has 37 cases. Cuisine accuracy on it is 90%; the qualitative fields
have no ground truth at all.

**Flavor never had a vocabulary that discriminates.** Nine words, two of
which (`rich`, `savory`) describe most restaurants on earth.

## The more optimal way

### 1. Tag with what is free first, LLM second

Make Google `types[]` the primary source for cuisine *and* dish family,
by table, in SQL, on every row, every time a row is touched. The LLM runs
only where types are generic (`restaurant`, `food`) and its answer is
recorded with its confidence. This is the order the rule classifier
already tries; the change is that the deterministic half runs on existing
rows too (0097 is the first instance) and the LLM's job shrinks to the
remainder.

### 2. Two axes instead of one: cuisine and *dish*

Add `dish_family text[]` — pizza, burgers, tacos, sushi, ramen, wings,
brunch plates, oysters, bbq plates, fried chicken, noodles, dumplings,
salads, sandwiches. Roughly 20 values, most derivable from Google types
(`pizza_restaurant`, `sushi_restaurant`, `hamburger_restaurant`,
`chicken_wings_restaurant`, `ramen_restaurant`, `bagel_shop`...) and from
subregion where set. The mood row then offers what people actually crave:
"Tacos", "Ramen", "Pizza", not "Latin American". Cuisine stays for the
taste graph; dish is for the chip.

### 3. Chips from the catalogue, ordered by the city

Already done today: chips come from `cuisines_near(lat, lng)` for the
browsing city, most common first, twelve at most. Add `dishes_near` when
(2) exists and prefer it on the row.

### 4. One classification per place, versioned, with a reason

`restaurants.classified_by` (`types` | `rules` | `llm`), `classifier_version`
(exists), and `classification_reason` (exists as `reasoning`). Then the
reclassify can be *selective*: re-run only rows classified by an older
version or below a confidence, which is a few hundred calls instead of a
thousand.

### 5. Retire flavor, promote occasion

Drop `flavor_tags` from the prompt entirely (it is already weight 0).
Occasion is the field that separates two restaurants of the same cuisine,
and the prompt already says so. Spend the LLM's attention there, and build
the eval's qualitative ground truth from the founder's own visits: he knows
which of his 33 places are date night and which are working lunch.

### 6. Score cuisine directly, once it is reliable

Today the taste score uses subregion and region but not `cuisine_type`,
because it was polluted. Once (1) holds, give `cuisine_type` the 0.3 weight
region has and let region be the tiebreaker; region is a coarser version of
the same fact.

## What each step costs

| step | cost | who |
|---|---|---|
| 1, 3, 4, 5, 6 | code + migrations, free | agent |
| 2 from Google types | one SQL backfill, free | agent |
| 2 from the LLM for the generic rows | part of a reclassify | founder's go |
| reclassify all 1,043 | ~1,043 Place Details calls (≈$17 at list price) + ~1,043 Haiku calls (≈$2) | founder's go |
| selective reclassify after (4) | a few hundred of the above | founder's go |

The single highest-value paid action is still the reclassify, and after (4)
it gets cheaper every time.
