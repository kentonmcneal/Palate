-- ============================================================================
-- 0012_analytics_events.sql
-- ----------------------------------------------------------------------------
-- Lightweight first-party analytics. Lets us see funnel completion (onboarding
-- step drop-off), event counts (visits logged, wishlists saved), and adoption
-- without standing up a third-party tool. Read-only via SQL editor for now.
--
-- - Append-only (no updates/deletes from app).
-- - user_id may be null for pre-auth events (e.g., sign_in_started).
-- - props is jsonb so we can iterate event shapes without migrations.
-- ============================================================================

create table if not exists public.analytics_events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete set null,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists analytics_events_event_created_idx
  on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);

alter table public.analytics_events enable row level security;

-- Authed users can insert events keyed to themselves OR with no user_id (pre-auth).
drop policy if exists "analytics: insert own" on public.analytics_events;
create policy "analytics: insert own"
  on public.analytics_events for insert
  with check (auth.uid() = user_id or user_id is null);

-- Nobody reads from the app — analysis happens in SQL editor with the service role.
-- (No SELECT policy = no SELECT from the anon/authed key.)
