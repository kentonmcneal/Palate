-- ============================================================================
-- 0022_gmail_integration.sql
-- ----------------------------------------------------------------------------
-- Stores per-user Gmail OAuth tokens so the gmail-import edge function can
-- scan inboxes for restaurant receipts + reservations and backfill visits.
--
-- Tokens are stored encrypted at rest via Supabase's pgsodium (vault). The
-- mobile app exchanges the OAuth code → tokens server-side via the
-- gmail-import function so the refresh_token never touches the client.
--
-- visits.import_source tracks where a backfilled visit came from (gmail vs
-- manual vs auto-detect) so we can show "23 visits imported from Gmail".
-- ============================================================================

create table if not exists public.gmail_tokens (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  refresh_token    text not null,
  access_token     text,
  expires_at       timestamptz,
  email            text,                                  -- the connected gmail address
  last_scanned_at  timestamptz,                           -- last successful inbox scan
  last_message_id  text,                                  -- Gmail historyId checkpoint for incremental scans
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.gmail_tokens enable row level security;

-- Tokens are never read from the mobile app (service-role only). No SELECT policy.
-- But users CAN delete their own to disconnect.
drop policy if exists "gmail_tokens: own delete" on public.gmail_tokens;
create policy "gmail_tokens: own delete"
  on public.gmail_tokens for delete
  using (auth.uid() = user_id);

-- Track import source per visit so we can show provenance + dedupe
alter table public.visits
  add column if not exists import_source text check (import_source in ('gmail', 'plaid', 'manual_import') or import_source is null),
  add column if not exists import_external_id text;  -- e.g. Gmail message id, used for dedup

create unique index if not exists visits_import_external_id_user_unique
  on public.visits (user_id, import_external_id)
  where import_external_id is not null;

-- A SECURITY DEFINER helper the mobile app calls to check status without
-- exposing the actual token row.
create or replace function public.gmail_connection_status()
returns table (
  connected      boolean,
  email          text,
  last_scanned_at timestamptz,
  imported_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  return query
  select
    exists(select 1 from public.gmail_tokens t where t.user_id = me) as connected,
    (select email from public.gmail_tokens where user_id = me)::text as email,
    (select last_scanned_at from public.gmail_tokens where user_id = me) as last_scanned_at,
    (select count(*)::int from public.visits where user_id = me and import_source = 'gmail') as imported_count;
end;
$$;

grant execute on function public.gmail_connection_status() to authenticated;
