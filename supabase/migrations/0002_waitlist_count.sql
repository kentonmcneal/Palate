-- Palate — waitlist count RPC
-- Exposes a public, anon-callable function that returns the row count of
-- the `waitlist` table. RLS on `waitlist` deliberately blocks SELECT for
-- everyone except service_role, so this SECURITY DEFINER function is the
-- correct way to surface a single aggregate to the landing page without
-- leaking individual emails.

create or replace function public.get_waitlist_count()
returns int
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(count(*), 0)::int from public.waitlist;
$$;

-- Allow the unauthenticated landing page (anon role) and any signed-in user
-- to call this. The function returns nothing but a non-negative integer.
grant execute on function public.get_waitlist_count() to anon, authenticated;
