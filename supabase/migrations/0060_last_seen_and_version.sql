-- ============================================================================
-- 0060_last_seen_and_version.sql — know who is on what, and when they last came.
-- ----------------------------------------------------------------------------
-- Two questions we could not answer on 2026-09-02, both of which we needed:
--
--   "when did this person last open the app?"  — only answerable by scanning
--   analytics_events, which is a log, not a state.
--
--   "which build are they running?"  — not answerable at all. analytics_events
--   records id/user/event/props/created_at and no version, and the client never
--   sent one.
--
-- The second one blocked a real diagnosis. Passive capture has produced a visit
-- for exactly one user. Quintin L. granted location on 2026-08-07, has been
-- active ever since, and has never had a single detection. The most likely
-- explanation is that he is on a binary predating a41b51c (2026-08-28), which
-- is when the native visit monitor actually started shipping — before that a
-- .gitignore rule excluded it from every build. But "most likely" is where the
-- investigation stopped, because nothing recorded his version.
--
-- These are state columns on the profile, updated on foreground: cheap to read,
-- no log scan, and they make the funnel query answerable at a glance.
-- ============================================================================

alter table public.profiles
  add column if not exists last_seen_at  timestamptz,
  add column if not exists app_version   text,
  add column if not exists app_build     text;

comment on column public.profiles.last_seen_at is
  'Updated when the app comes to the foreground. State, not a log — analytics_events can answer this but only by scanning.';
comment on column public.profiles.app_version is
  'Bundle version the user last ran. Without this, "is this user on a build that even contains the feature?" is unanswerable, which blocked the passive-capture diagnosis on 2026-09-02.';

create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc nulls last);

-- Recording your own heartbeat is the one profile write that should not need a
-- policy exception; RLS already restricts a user to their own row.
