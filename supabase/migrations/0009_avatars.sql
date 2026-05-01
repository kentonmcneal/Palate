-- ============================================================================
-- 0009_avatars.sql
-- ----------------------------------------------------------------------------
-- Profile photo support: avatar_url column + public 'avatars' storage bucket
-- with per-user folder isolation via RLS.
-- ============================================================================

alter table public.profiles
  add column if not exists avatar_url text;

-- ============================================================
-- Storage bucket: 'avatars'
-- Public read so feeds and profiles can render images cheaply.
-- Authenticated write, but only inside a folder named after the user's auth.uid().
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Read: anyone can view avatars
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Insert: only the authed user can upload, and only into their own folder
drop policy if exists "avatars: own upload" on storage.objects;
create policy "avatars: own upload"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Update: only the authed user can replace their own files
drop policy if exists "avatars: own update" on storage.objects;
create policy "avatars: own update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Delete: only the authed user can delete their own files
drop policy if exists "avatars: own delete" on storage.objects;
create policy "avatars: own delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- get_friend_profile_snapshot: also surface avatar_url.
-- DROP first because Postgres won't let CREATE OR REPLACE change a return type.
-- ============================================================
drop function if exists public.get_friend_profile_snapshot(uuid);

create function public.get_friend_profile_snapshot(target_id uuid)
returns table (
  id                  uuid,
  display_name        text,
  email               text,
  avatar_url          text,
  profile_visibility  text,
  persona_label       text,
  persona_tagline     text,
  top_restaurant      text,
  unique_restaurants  int,
  total_visits        int,
  is_friend           boolean,
  is_self             boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  vis text;
  is_friends boolean;
  is_me boolean;
begin
  is_me := (auth.uid() = target_id);

  select profile_visibility::text into vis
  from public.profiles
  where profiles.id = target_id;

  if vis is null then
    return;
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  if vis = 'private' and not is_me then
    return query
    select
      p.id,
      p.display_name,
      p.email,
      p.avatar_url,
      p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  if vis = 'friends' and not is_friends and not is_me then
    return query
    select
      p.id,
      p.display_name,
      p.email,
      p.avatar_url,
      p.profile_visibility::text,
      null::text, null::text, null::text,
      null::int, null::int,
      false, false
    from public.profiles p
    where p.id = target_id;
    return;
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.email,
    p.avatar_url,
    p.profile_visibility::text,
    ww.personality_label,
    (ww.wrapped_json ->> 'personality_label')::text,
    ww.top_restaurant,
    ww.unique_restaurants,
    (select count(*)::int from public.visits v where v.user_id = target_id),
    is_friends,
    is_me
  from public.profiles p
  left join lateral (
    select w.personality_label, w.top_restaurant, w.unique_restaurants, w.wrapped_json
    from public.weekly_wrapped w
    where w.user_id = target_id
    order by w.week_start desc
    limit 1
  ) ww on true
  where p.id = target_id;
end;
$$;

grant execute on function public.get_friend_profile_snapshot(uuid) to authenticated;

-- ============================================================
-- search_users: also surface avatar_url.
-- Same DROP-first reason as above.
-- ============================================================
drop function if exists public.search_users(text);

create function public.search_users(q text)
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  profile_visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select id, email, display_name, avatar_url, profile_visibility::text
  from public.profiles
  where length(trim(q)) >= 2
    and (
      email ilike trim(q) || '%'
      or display_name ilike '%' || trim(q) || '%'
    )
    and id <> auth.uid()
  limit 20;
$$;

grant execute on function public.search_users(text) to authenticated;
