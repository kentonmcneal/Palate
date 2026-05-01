-- ============================================================================
-- 0019_demographics.sql
-- ----------------------------------------------------------------------------
-- Optional self-reported demographics. ALL fields nullable. Used to power
-- "Top Palates in your demographic" cohort views and richer aggregated
-- "people like you" analytics (when a real aggregator exists).
--
-- IMPORTANT: We never infer these from food behavior. Only from explicit user
-- input. UI must keep them clearly optional.
-- ============================================================================

alter table public.profiles
  add column if not exists age_range       text check (age_range in ('under_18','18_24','25_34','35_44','45_54','55_64','65_plus') or age_range is null),
  add column if not exists gender_identity text,
  add column if not exists race_ethnicity  text[] default '{}'::text[],
  add column if not exists hometown        text,
  add column if not exists current_city    text;

create index if not exists profiles_current_city_idx on public.profiles (lower(current_city));
