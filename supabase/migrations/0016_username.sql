-- ============================================================================
-- 0016_username.sql
-- ----------------------------------------------------------------------------
-- Adds profiles.username (case-insensitive, unique) so users can find each
-- other by handle instead of email. Updates search_users() to match against
-- username + display_name + email.
-- ============================================================================

alter table public.profiles
  add column if not exists username text;

-- Case-insensitive unique constraint via a functional index. Allows mixed
-- casing in the column itself but blocks "Joe" + "joe" coexisting.
create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null;

create index if not exists profiles_username_search_idx
  on public.profiles (lower(username));

-- Update search_users to also match on username (and surface the field).
drop function if exists public.search_users(text);

create function public.search_users(q text)
returns table (
  id uuid,
  email text,
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
  select id, email, display_name, username, avatar_url, profile_visibility::text
  from public.profiles
  where length(trim(q)) >= 2
    and (
      lower(username) like lower(trim(q)) || '%'
      or display_name ilike '%' || trim(q) || '%'
      or email ilike trim(q) || '%'
    )
    and id <> auth.uid()
  limit 20;
$$;

grant execute on function public.search_users(text) to authenticated;
