-- ============================================================================
-- 0005_taste_preferences.sql
-- ----------------------------------------------------------------------------
-- Per-user cuisine preferences captured during onboarding.
-- Used to seed personalization on day 1, before the user has any visits.
-- ============================================================================

alter table public.profiles
  add column if not exists taste_preferences text[] not null default '{}';

create index if not exists profiles_taste_preferences_gin
  on public.profiles using gin (taste_preferences);
