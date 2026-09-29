-- Minimal faithful columns/roles only; actual 0081 search and 0108 block helper.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
create table auth.users(id uuid primary key);
create table profiles(id uuid primary key references auth.users on delete cascade,email text,display_name text,username text,avatar_url text,profile_visibility text not null check(profile_visibility in ('public','friends','private')));
create table blocked_users(blocker_id uuid not null references profiles on delete cascade,blocked_id uuid not null references profiles on delete cascade,primary key(blocker_id,blocked_id));
alter table profiles enable row level security;
alter table blocked_users enable row level security;
create policy profiles_own on profiles for select using(id=auth.uid());
create policy blocked_own on blocked_users for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());
grant usage on schema public,auth to anon,authenticated,service_role;
grant select on profiles to authenticated;
grant select,insert,delete on blocked_users to authenticated;
grant all on profiles,blocked_users to service_role;
create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocked_users x
     where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a)
  );
$$;
revoke all on function public.is_blocked_either_way(uuid,uuid) from public,anon;
grant execute on function public.is_blocked_either_way(uuid,uuid) to authenticated;
