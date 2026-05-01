-- ============================================================================
-- 0018_referrals.sql
-- ----------------------------------------------------------------------------
-- Stores who invited whom. The mobile app's Share button generates a personal
-- invite URL with the user's id as a query param; when a new signup arrives
-- with that param the app calls record_referral() to claim the credit.
-- ============================================================================

create table if not exists public.referrals (
  invitee_id   uuid primary key references auth.users(id) on delete cascade,
  inviter_id   uuid not null references auth.users(id) on delete cascade,
  source       text not null default 'share_link',
  created_at   timestamptz not null default now(),
  check (invitee_id <> inviter_id)
);

create index if not exists referrals_inviter_idx on public.referrals (inviter_id);

alter table public.referrals enable row level security;

-- Both parties can read their own row; nobody else.
drop policy if exists "referrals: own" on public.referrals;
create policy "referrals: own"
  on public.referrals for select
  using (auth.uid() in (invitee_id, inviter_id));

-- Insert: only the invitee can record their own row.
drop policy if exists "referrals: insert own" on public.referrals;
create policy "referrals: insert own"
  on public.referrals for insert
  with check (auth.uid() = invitee_id);

-- Idempotent claim function — call from the mobile app right after signup
-- with the inviter's user_id pulled from the deep-link param.
create or replace function public.record_referral(p_inviter_id uuid, p_source text default 'share_link')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or me = p_inviter_id then return; end if;
  insert into public.referrals (invitee_id, inviter_id, source)
  values (me, p_inviter_id, p_source)
  on conflict (invitee_id) do nothing;
end;
$$;

grant execute on function public.record_referral(uuid, text) to authenticated;

-- View: count referrals per inviter (for the Settings "you've invited X" line).
create or replace view public.my_referral_stats as
  select
    inviter_id as user_id,
    count(*)::int as invitee_count
  from public.referrals
  group by inviter_id;

grant select on public.my_referral_stats to authenticated;
