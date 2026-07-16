-- ============================================================================
-- 0034_feedback.sql
-- ----------------------------------------------------------------------------
-- In-app feedback capture. Replaces the mailto: links in Settings with a
-- structured table so every bug report / idea / reaction lands in one place we
-- can export to a single folder (see supabase/scripts/export-feedback.ts).
--
-- A signed-in user can insert their own feedback and read it back. Screenshots
-- live in a PRIVATE 'feedback' storage bucket, one folder per user. The export
-- script uses the service-role key (bypasses RLS) to pull everything.
-- ============================================================================

create table if not exists public.feedback (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references auth.users(id) on delete set null,
  category        text        not null default 'other',  -- bug | idea | confusing | love | other
  message         text        not null,
  screenshot_path text,                                   -- path in the 'feedback' bucket, null if none
  app_version     text,                                   -- from app.json via expo-constants
  platform        text,                                   -- 'ios' | 'android'
  device          text,                                   -- model name, e.g. 'iPhone 14 Pro'
  os_version      text,
  context         jsonb       not null default '{}'::jsonb, -- { route, email, ... } for triage
  status          text        not null default 'new',     -- new | triaged | resolved (our own triage)
  created_at      timestamptz not null default now()
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- A user can only file feedback as themselves.
drop policy if exists "feedback insert own" on public.feedback;
create policy "feedback insert own"
  on public.feedback
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- A user can read their own submissions (nice for a future "your reports" view;
-- the export script reads everything via the service role, which bypasses RLS).
drop policy if exists "feedback select own" on public.feedback;
create policy "feedback select own"
  on public.feedback
  for select
  to authenticated
  using (user_id = auth.uid());

-- Private bucket for optional screenshots.
insert into storage.buckets (id, name, public)
values ('feedback', 'feedback', false)
on conflict (id) do nothing;

-- Users upload to their own folder only: feedback/<uid>/<timestamp>.<ext>
drop policy if exists "feedback screenshots insert own" on storage.objects;
create policy "feedback screenshots insert own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "feedback screenshots read own" on storage.objects;
create policy "feedback screenshots read own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
