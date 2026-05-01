-- ============================================================================
-- 0010_quiz_persona.sql
-- ----------------------------------------------------------------------------
-- Stores the result of the in-app Starter Palate quiz so the persona engine
-- can fall back to it when there's not enough visit data yet.
-- ============================================================================

alter table public.profiles
  add column if not exists quiz_persona     text,
  add column if not exists quiz_chips       text[] default '{}'::text[],
  add column if not exists quiz_completed_at timestamptz;
