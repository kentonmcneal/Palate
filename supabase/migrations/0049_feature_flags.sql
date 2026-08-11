-- ============================================================================
-- 0049_feature_flags.sql
-- ----------------------------------------------------------------------------
-- Client-readable remote feature flags — the "kill switch per phase" the
-- passive-capture build requires. Anyone (anon/authenticated) may READ flags;
-- only the service role may write them (Dashboard / admin), so a client can
-- never flip its own gate.
--
-- Flags default to FALSE (off/killed). Passive capture ships dark and is turned
-- on deliberately from the Supabase dashboard once a build is verified.
-- ============================================================================

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean     not null default false,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

-- Read-only to everyone; no insert/update/delete policy => writes are
-- service-role-only (RLS denies by default).
drop policy if exists "feature_flags readable by all" on public.feature_flags;
create policy "feature_flags readable by all"
  on public.feature_flags for select
  using (true);

grant select on public.feature_flags to anon, authenticated;

-- Seed the passive-capture phase flags (all OFF until a verified build ships).
insert into public.feature_flags (key, enabled, description) values
  ('passive_capture_detection', false, 'Phase 1: CLVisit background visit detection'),
  ('passive_capture_funnel',    false, 'Phase 2: permission funnel + instrumentation'),
  ('passive_capture_resolve',   false, 'Phase 3: visit qualification + Places resolution'),
  ('passive_capture_confirm',   false, 'Phase 4: departure confirmation notifications')
on conflict (key) do nothing;
