-- ============================================================================
-- 0048_fix_admin_list_pending_ambiguous_id.sql
-- ----------------------------------------------------------------------------
-- Bugfix: the Admin -> Waitlist approvals screen errored with
--   "column reference \"id\" is ambiguous" (SQLSTATE 42702)
-- and never rendered the list.
--
-- Cause: admin_list_pending() (migration 0043) declares RETURNS TABLE(id uuid,
-- ...). That makes `id` a PL/pgSQL OUT variable. The admin-check guard on the
-- first line ran `select 1 from public.profiles where id = auth.uid()` with a
-- BARE `id`, which Postgres could not disambiguate between the OUT variable and
-- profiles.id. The guard runs for every caller, so the RPC threw before it ever
-- reached the (correctly qualified) return query -> the screen always errored.
--
-- Fix: qualify the guard's column reference as profiles.id. Function is
-- otherwise unchanged. admin_set_approval() does NOT have this bug (it returns
-- void, so there is no colliding OUT variable) and is left as-is.
-- ============================================================================

create or replace function public.admin_list_pending()
returns table (id uuid, email text, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.is_admin
  ) then
    return;
  end if;
  return query
    select p.id, p.email, p.display_name
    from public.profiles p
    where p.approval_status = 'pending'
    order by p.email nulls last;
end;
$$;
grant execute on function public.admin_list_pending() to authenticated;
