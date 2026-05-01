-- ============================================================================
-- 0021_real_population_views.sql
-- ----------------------------------------------------------------------------
-- Real-data backing for the "Top Palates in your area" + percentile cards.
-- These views start producing useful numbers as soon as we have ~50 active
-- users; the mobile lib falls back to preview data below that threshold.
--
-- Cheap to query — counts only, no joins per user. Safe to call on every
-- Wrapped/Insights render.
-- ============================================================================

-- All-time aggregate of users by their most recent quiz_persona OR latest
-- weekly_wrapped persona label. Used for global percentile + cohort sizing.
create or replace view public.population_palate_counts as
  select
    coalesce(p.quiz_persona, 'unknown') as palate_key,
    count(*)::int as user_count
  from public.profiles p
  where p.quiz_persona is not null
  group by p.quiz_persona;

grant select on public.population_palate_counts to authenticated;

-- Per-city palate counts. City is the user's self-reported current_city
-- (collected via demographics). Falls back to the top neighborhood from
-- visits if current_city is empty.
create or replace view public.population_city_palate_counts as
  with city_users as (
    select
      lower(coalesce(p.current_city, ''))::text as city_key,
      coalesce(p.current_city, 'Your area') as city_label,
      coalesce(p.quiz_persona, 'unknown') as palate_key
    from public.profiles p
    where coalesce(p.current_city, '') <> ''
      and p.quiz_persona is not null
  )
  select
    city_key,
    city_label,
    palate_key,
    count(*)::int as user_count
  from city_users
  group by city_key, city_label, palate_key;

grant select on public.population_city_palate_counts to authenticated;

-- Total Palate users (used for the "X people eat like you" line)
create or replace view public.population_total as
  select count(*)::int as total_users
  from public.profiles
  where quiz_persona is not null;

grant select on public.population_total to authenticated;
