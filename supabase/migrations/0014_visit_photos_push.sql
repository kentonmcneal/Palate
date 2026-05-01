-- ============================================================================
-- 0014_visit_photos_push.sql
-- ----------------------------------------------------------------------------
-- Adds:
--   1. visits.photo_url + visits storage bucket (per-user folder, RLS-gated)
--   2. profiles.push_token + push_platform for Expo push notifications
--
-- The push token is set by the mobile app on launch; it's used by the
-- notify-feed-post edge function to push when a friend shares a Wrapped.
-- ============================================================================

-- ---------- visits.photo_url --------------------------------------------------

alter table public.visits
  add column if not exists photo_url text;

-- ---------- visit-photos storage bucket --------------------------------------

insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "visit-photos: public read" on storage.objects;
create policy "visit-photos: public read"
  on storage.objects for select
  using (bucket_id = 'visit-photos');

drop policy if exists "visit-photos: own upload" on storage.objects;
create policy "visit-photos: own upload"
  on storage.objects for insert
  with check (
    bucket_id = 'visit-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "visit-photos: own delete" on storage.objects;
create policy "visit-photos: own delete"
  on storage.objects for delete
  using (
    bucket_id = 'visit-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------- profiles.push_token ----------------------------------------------

alter table public.profiles
  add column if not exists push_token text,
  add column if not exists push_platform text check (push_platform in ('ios','android') or push_platform is null);

create index if not exists profiles_push_token_idx
  on public.profiles (push_token)
  where push_token is not null;
