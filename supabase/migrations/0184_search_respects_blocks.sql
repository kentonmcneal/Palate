-- Search privacy; original matching, output and 20-row cap preserved.
-- Local PGlite proof only; not deployed.
begin;

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
    and not public.is_blocked_either_way(auth.uid(), p.id)
  limit 20;
$$;

revoke all on function public.search_users(text) from public, anon;
grant execute on function public.search_users(text) to authenticated;

commit;
