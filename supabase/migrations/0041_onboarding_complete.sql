-- 0041_onboarding_complete.sql
-- Adds an explicit onboarding-complete flag so the sign-in gate no longer keys
-- solely on `quiz_persona` being non-null.
--
-- Bug: accounts created BEFORE the Starter quiz shipped (migration 0010) have a
-- null `quiz_persona`. The sign-in gate (mobile/app/sign-in.tsx) sent any such
-- user back through onboarding on every fresh-session login, even though they
-- are established, populated accounts. This flag + backfill fixes that; the
-- client now gates on `onboarding_complete` (falling back to quiz_persona).
--
-- Additive and backwards-compatible: existing app builds don't read this column.

alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

-- Backfill: treat anyone who finished the quiz OR already has real activity as
-- having completed onboarding, so they are never re-prompted.
update public.profiles p
set onboarding_complete = true
where p.quiz_completed_at is not null
   or p.quiz_persona is not null
   or exists (select 1 from public.visits v where v.user_id = p.id);
