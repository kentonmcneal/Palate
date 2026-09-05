-- ============================================================================
-- 0101_guard_privileged_profile_columns.sql — nobody makes themselves admin.
-- ----------------------------------------------------------------------------
-- LIVE, 2026-09-05: the only UPDATE policy on profiles is
--   "profiles: own update" USING (auth.uid() = id)
-- with no WITH CHECK and no column restriction. Any signed-in user could run
--   update profiles set is_admin = true where id = auth.uid()
-- and unlock every admin RPC — including admin_set_feature_flag (0093), which
-- turns on push notifications to every tester. Found by the code review.
--
-- Fix: a BEFORE UPDATE trigger that refuses a change to is_admin or
-- approval_status unless the caller is either the service role (no JWT
-- subject: crons, edge functions) or already an admin. The policy also gets
-- the WITH CHECK it should have had.
-- ============================================================================

create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_is_admin boolean;
begin
  if new.is_admin is distinct from old.is_admin
     or new.approval_status is distinct from old.approval_status then
    -- Service role / cron: no subject claim. Allowed.
    if caller is null then
      return new;
    end if;
    select p.is_admin into caller_is_admin from public.profiles p where p.id = caller;
    if coalesce(caller_is_admin, false) then
      return new;
    end if;
    raise exception 'is_admin and approval_status can only be changed by an admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_privileged_profile_columns();

drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Prove it: a non-admin trying to promote themselves is refused; an admin
-- changing approval_status is not. Both rolled back.
do $$
declare
  mom uuid; kenton uuid;
begin
  select id into mom from public.profiles where display_name = 'mcldkt';
  select id into kenton from public.profiles where is_admin limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', mom::text)::text, true);
  begin
    update public.profiles set is_admin = true where id = mom;
    raise exception '0101: a non-admin promoted themselves';
  exception when insufficient_privilege then
    raise notice '0101: self-promotion refused, as intended';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  begin
    update public.profiles set approval_status = approval_status where id = mom;
    raise notice '0101: admin write allowed';
    raise exception 'rollback' using errcode = 'P0002';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claims', null, true);
end $$;
