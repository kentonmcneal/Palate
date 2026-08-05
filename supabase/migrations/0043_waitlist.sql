-- 0043_waitlist.sql
-- ----------------------------------------------------------------------------
-- Invite-only gate. New signups land on a waitlist (approval_status='pending')
-- until an admin approves them. Existing users AND the App Store review account
-- are auto-approved so nobody already in — including Apple's reviewer or current
-- testers — is ever locked out.
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected'));

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Everyone who already exists is already using the app → approve them, so the
-- gate only affects NEW signups from here forward.
update public.profiles set approval_status = 'approved' where approval_status <> 'approved';

-- Belt-and-suspenders: never waitlist the App Store review account.
update public.profiles set approval_status = 'approved' where email = 'palate.review1@gmail.com';

-- Founder can approve others.
update public.profiles set is_admin = true where email = 'kentonmcneal@gmail.com';

-- Admin: list users awaiting approval. Empty for non-admins.
create or replace function public.admin_list_pending()
returns table (id uuid, email text, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
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

-- Admin: approve / reject / reset a user's access.
create or replace function public.admin_set_approval(target_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  if new_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid status';
  end if;
  update public.profiles set approval_status = new_status where id = target_id;
end;
$$;
grant execute on function public.admin_set_approval(uuid, text) to authenticated;
