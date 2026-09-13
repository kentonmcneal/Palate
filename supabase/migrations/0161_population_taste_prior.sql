-- ============================================================================
-- 0161 — a cold-start prior built from what people actually eat.
-- ----------------------------------------------------------------------------
-- The 60-second starter quiz is gone. It seeded the taste vector while
-- visitCount < 3, and the founder tested it and got "The Convenience Loyalist"
-- -- McDonald's, Subway, Starbucks -- from answers that included choosing a
-- new spot over a familiar one.
--
-- It was unfixable in the shape it had. The questions confound independent
-- axes: "a new spot a friend dragged me to" is the only NEW answer and also
-- the only SOCIAL one, so you cannot say one without the other. And it sums a
-- Tuesday question with a Saturday question, so "routine on weekdays,
-- adventurous at weekends" -- coherent, common, and exactly what the founder
-- reported about himself -- averages into neither.
--
-- Deleting it without replacing the prior would drop new users onto a bare
-- distance-and-rating ranker, which is worse than a wrong persona.
--
-- So seed from the POPULATION: what people on Palate actually log, weighted by
-- how they reacted. No hypotheticals, no self-report, and it sharpens on its
-- own as visits accumulate instead of needing a better questionnaire.
--
-- Deliberately weak, like the persona prior it replaces. It applies only while
-- real visits are sparse and a handful of them outweighs it. A prior is a
-- starting guess, not an opinion about somebody.
--
-- NOTE ON THE RATING COLUMN: visits.overall_rating is TEXT -- 'loved' | 'ok' |
-- 'not_for_me' -- not a number. The first version of this migration divided it
-- by 5 and failed to apply, which is the cheapest possible way to find out.
-- ============================================================================

create or replace function public.population_taste_prior(
  p_city  text default null,
  p_limit integer default 6
)
returns table (
  facet  text,     -- 'cuisine_type' | 'format_class' | 'price_tier' | 'occasion'
  value  text,
  weight numeric   -- 0..1, normalised within each facet
)
language sql
stable
security definer
set search_path = public
as $$
  with visited as (
    select r.cuisine_type, r.format_class, r.price_level, r.occasion_tags,
           v.overall_rating, r.neighborhood
      from public.visits v
      join public.restaurants r on r.id = v.restaurant_id
     where v.is_public
       and r.ineligibility_reason is null
  ),
  scored as (
    select *,
           case overall_rating
             when 'loved'       then 1.6
             when 'ok'          then 1.0
             when 'not_for_me'  then 0.2   -- counted, but as evidence against
             -- Unrated still counts. Only 4 of 63 visits carry a reaction, and
             -- discarding the other 59 to honour a signal almost nobody gives
             -- would leave the prior with nothing to stand on.
             else 1.0
           end as w
      from visited
     where p_city is null or neighborhood is not null
  ),
  unioned as (
    select 'cuisine_type' as facet, cuisine_type as value, sum(w) as raw
      from scored where cuisine_type is not null and cuisine_type <> '' group by 2
    union all
    select 'format_class', format_class, sum(w)
      from scored where format_class is not null and format_class <> '' group by 2
    union all
    select 'price_tier', price_level::text, sum(w)
      from scored where price_level is not null group by 2
    union all
    select 'occasion', t.tag, sum(s.w)
      from scored s, unnest(coalesce(s.occasion_tags, '{}'::text[])) as t(tag) group by 2
  ),
  ranked as (
    select facet, value, raw,
           raw / nullif(max(raw) over (partition by facet), 0) as weight,
           row_number() over (partition by facet order by raw desc) as rn
      from unioned
  )
  select facet, value, round(weight, 4)
    from ranked
   where rn <= greatest(1, least(coalesce(p_limit, 6), 20))
     and weight is not null
   order by facet, weight desc;
$$;

revoke all on function public.population_taste_prior(text, integer) from public, anon;
grant execute on function public.population_taste_prior(text, integer) to authenticated;
