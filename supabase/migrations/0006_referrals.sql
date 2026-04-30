-- ============================================================================
-- 0006_referrals.sql
-- ----------------------------------------------------------------------------
-- Adds referral tracking to the waitlist. The referral_code is computed
-- automatically by a BEFORE INSERT trigger using pgcrypto, so the client
-- never has to hash anything (avoids shipping a SHA-256 polyfill to the
-- browser).
--
-- waitlist_referral_count(code) lets the UI show "X friends joined via you"
-- without exposing the underlying rows.
-- ============================================================================

alter table public.waitlist
  add column if not exists referral_code text,
  add column if not exists referred_by   text;

create unique index if not exists waitlist_referral_code_idx
  on public.waitlist (referral_code)
  where referral_code is not null;

create index if not exists waitlist_referred_by_idx
  on public.waitlist (referred_by);

-- Server-side hash so callers don't need crypto.subtle.
create or replace function public.compute_waitlist_referral_code()
returns trigger
language plpgsql
as $$
begin
  if new.referral_code is null and new.email is not null then
    new.referral_code := substr(
      encode(digest(lower(trim(new.email)), 'sha256'), 'hex'),
      1, 8
    );
  end if;
  return new;
end;
$$;

drop trigger if exists waitlist_set_referral_code on public.waitlist;
create trigger waitlist_set_referral_code
  before insert on public.waitlist
  for each row execute function public.compute_waitlist_referral_code();

-- Public counter — RLS still hides raw rows, this gives just the count.
create or replace function public.waitlist_referral_count(code text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.waitlist where referred_by = code;
$$;

grant execute on function public.waitlist_referral_count(text) to anon, authenticated;
