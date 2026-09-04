-- ============================================================================
-- 0081_revoke_public_on_directory_fns.sql
-- ----------------------------------------------------------------------------
-- 0080 revoked browse_profiles and search_users from `anon` and both still
-- answered the anon key with HTTP 200. Revoking from a role does not help while
-- PUBLIC still holds the grant, because every role is a member of PUBLIC.
--
-- This is the mirror image of the lesson in 0079. There the grant to `anon` was
-- explicit and revoking PUBLIC missed it; here the grant to PUBLIC is the live
-- one and revoking `anon` misses it. Both are needed, every time, and the only
-- way to know which applies is to call the function afterwards and read the
-- status code.
--
-- Neither function was actually disclosing anything: both carry `id <> auth.uid()`
-- which evaluates to NULL for an anonymous caller and filters every row. But
-- that is an accident of three-valued logic standing in for an authorization
-- check, and it stops protecting anything the moment somebody rewrites the
-- predicate. search_users gets the explicit guard here; browse_profiles got one
-- in 0080.
-- ============================================================================

create or replace function public.search_users(q text)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  profile_visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.avatar_url, p.profile_visibility::text
  from public.profiles p
  where auth.uid() is not null
    and length(trim(q)) >= 3
    and (
      lower(p.email) = lower(trim(q))   -- exact email only: can't harvest by prefix
      or p.display_name ilike '%' || trim(q) || '%'
      or p.username    ilike trim(q) || '%'
    )
    and p.id <> auth.uid()
  limit 20;
$$;

revoke all on function public.search_users(text) from public;
revoke all on function public.search_users(text) from anon;
grant execute on function public.search_users(text) to authenticated;

revoke all on function public.browse_profiles(integer, integer, text, text) from public;
revoke all on function public.browse_profiles(integer, integer, text, text) from anon;
grant execute on function public.browse_profiles(integer, integer, text, text) to authenticated;
