-- ============================================================================
-- 0056_social_profiles.sql — profiles worth looking at, and people to find.
-- ----------------------------------------------------------------------------
-- Beli's social graph is why people stay. Ours has friendships and a feed but
-- no profile worth visiting and no way to find anyone you don't already know.
-- This adds the fields (bio, school, Instagram, TikTok) and a directory.
--
-- DISCOVERABILITY: new accounts are now PUBLIC by default, which is the call
-- the founder made — it grows the network fastest and is what Beli does.
--
-- The 13 existing accounts are deliberately NOT flipped. They signed up under
-- `friends`, and retroactively making someone's profile public is precisely the
-- change you cannot walk back. They keep what they chose and get asked once,
-- in-app (see profiles.discovery_prompted_at). "Default" governs the people who
-- have not decided yet; it is not a licence to decide for the ones who have.
-- ============================================================================

alter table public.profiles
  add column if not exists bio                  text,
  add column if not exists school               text,
  add column if not exists instagram_handle     text,
  add column if not exists tiktok_handle        text,
  add column if not exists discovery_prompted_at timestamptz;

comment on column public.profiles.discovery_prompted_at is
  'When we asked this existing user whether to become discoverable. Null = never asked. New accounts default to public and are never prompted.';

-- Length ceilings so a profile row cannot become an essay or a payload. Handles
-- are stored bare (no @, no URL) — the client renders the link.
alter table public.profiles
  drop constraint if exists profiles_bio_len,
  add constraint profiles_bio_len check (bio is null or char_length(bio) <= 160);
alter table public.profiles
  drop constraint if exists profiles_school_len,
  add constraint profiles_school_len check (school is null or char_length(school) <= 60);
alter table public.profiles
  drop constraint if exists profiles_ig_handle,
  add constraint profiles_ig_handle check (
    instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9._]{1,30}$'
  );
alter table public.profiles
  drop constraint if exists profiles_tt_handle,
  add constraint profiles_tt_handle check (
    tiktok_handle is null or tiktok_handle ~ '^[A-Za-z0-9._]{1,24}$'
  );

-- New accounts are discoverable. Existing rows are untouched by a default.
alter table public.profiles
  alter column profile_visibility set default 'public';

-- ----------------------------------------------------------------------------
-- The directory
-- ----------------------------------------------------------------------------
-- Returns public profiles the caller may see. Enforced server-side rather than
-- filtered in the client, because "who is visible" is not a UI concern.
--
--   • only profile_visibility = 'public'
--   • never the caller
--   • never anyone in blocked_users, in either direction
--   • only approved accounts (the waitlist gate still applies)
--
-- Ordering is left to the client: it ranks by palate match, which the server
-- cannot compute without reading everyone's taste vector.
create or replace function public.browse_profiles(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id               uuid,
  display_name     text,
  username         text,
  avatar_url       text,
  bio              text,
  school           text,
  current_city     text,
  instagram_handle text,
  tiktok_handle    text,
  quiz_persona     text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id, p.display_name, p.username, p.avatar_url, p.bio, p.school,
    p.current_city, p.instagram_handle, p.tiktok_handle, p.quiz_persona
  from public.profiles p
  where p.profile_visibility = 'public'
    and p.id <> auth.uid()
    and coalesce(p.approval_status, 'approved') = 'approved'
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

revoke all on function public.browse_profiles(integer, integer) from public;
grant execute on function public.browse_profiles(integer, integer) to authenticated;
