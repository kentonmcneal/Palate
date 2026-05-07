-- ============================================================
-- 0026_visit_time_meta.sql
-- Adds richer time-of-day metadata to public.visits so Wrapped /
-- Insights can answer "do you eat dinner late?", "are you a brunch
-- person?" without re-deriving from visited_at + a fixed timezone
-- (which we can't trust for travelling users).
--
-- Existing rows keep null fields — Wrapped already tolerates a
-- missing meal_type and will tolerate these.
-- ============================================================

alter table public.visits
  add column if not exists local_date          date,
  add column if not exists local_time          text,        -- HH:mm
  add column if not exists hour_of_day         smallint,    -- 0..23
  add column if not exists day_of_week         text,        -- Sunday..Saturday
  add column if not exists time_of_day_bucket  text;        -- breakfast/lunch/afternoon/dinner/lateNight

-- Quick lookups for "show me your dinner spots".
create index if not exists visits_user_bucket_idx
  on public.visits (user_id, time_of_day_bucket);

create index if not exists visits_user_local_date_idx
  on public.visits (user_id, local_date desc);

comment on column public.visits.time_of_day_bucket is
  'breakfast 5–10:59, lunch 11–14:59, afternoon 15–16:59, dinner 17–21:59, lateNight 22–4:59. Computed client-side in user local timezone.';
