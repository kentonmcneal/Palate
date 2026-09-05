-- ============================================================================
-- smoke.sql — execute every security-definer reader once, against a real user.
-- ----------------------------------------------------------------------------
-- PL/pgSQL parses the SQL inside `return query` only when that statement RUNS.
-- `get_friend_profile_snapshot` therefore deployed cleanly for 65 migrations
-- while raising 42702 on its first statement, and every profile screen in the
-- app rendered "Profile not found" the entire time. A migration applying is not
-- evidence a function works; only calling it is.
--
-- Row counts are irrelevant here — a bad column reference fails at parse/plan
-- on the first execution whether or not any rows match. What matters is that
-- each function is entered on its MAIN branch, which is why this seeds a
-- profile first: without one, the visibility lookup returns null and every
-- function returns early through a branch that proves nothing.
--
-- Everything runs inside a transaction that is rolled back.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Two users: a viewer and a target. auth.users is written directly because
-- there is no signup flow in a migration test.
insert into auth.users (id, email, instance_id, aud, role)
values
  ('00000000-0000-0000-0000-0000000000a1', 'viewer@example.test',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'target@example.test',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- The handle_new_user trigger may already have made these; upsert either way.
insert into public.profiles (id, email, display_name, profile_visibility)
values
  ('00000000-0000-0000-0000-0000000000a1', 'viewer@example.test', 'Viewer', 'public'),
  ('00000000-0000-0000-0000-0000000000b2', 'target@example.test', 'Target', 'public')
on conflict (id) do update
  set display_name = excluded.display_name,
      profile_visibility = excluded.profile_visibility;

-- Become the viewer. auth.uid() reads this setting.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1')::text,
  true
);

-- Each of these must execute its main branch without raising. A 42702-class
-- error here fails the build, which is the entire point of the file.
select count(*) from public.get_friend_profile_snapshot('00000000-0000-0000-0000-0000000000b2');
-- Added by the 2026-09-05 review: every reader written since 0077, executed
-- on its main branch. friends_leaderboard is plpgsql with `return query`,
-- the exact shape this file exists to catch, and nothing called it.
select count(*) from public.list_feed(5);
select count(*) from public.friends_leaderboard();
select count(*) from public.list_friendships('accepted');
select count(*) from public.list_friendships('pending_in');
select count(*) from public.list_blocked();
select count(*) from public.gmail_connection_status();
select count(*) from public.compatible_people(5);
select count(*) from public.cuisines_near(35.098, -89.841, 8000);
select count(*) from public.dishes_near(35.098, -89.841, 8000);
select count(*) from public.restaurants_by_cuisine(35.098, -89.841, 'american', 8000, 5);
select count(*) from public.restaurants_by_dish(35.098, -89.841, 'tacos', 8000, 5);
select count(*) from public.place_heat(35.098, -89.841, 6000, 5);

select count(*) from public.get_friend_profile_snapshot('00000000-0000-0000-0000-0000000000a1');
select public.friend_taste_features('00000000-0000-0000-0000-0000000000b2');
select public.friend_taste_features_batch(array['00000000-0000-0000-0000-0000000000b2']::uuid[]);
select count(*) from public.shared_places('00000000-0000-0000-0000-0000000000b2', 5);
select count(*) from public.top_ranked_places('00000000-0000-0000-0000-0000000000b2', 5);
select count(*) from public.palate_matches('00000000-0000-0000-0000-0000000000b2', 3);
select count(*) from public.list_feed(10);
select count(*) from public.browse_profiles(10, 0, null, null);
select count(*) from public.search_users('Target');

-- An anonymous caller must reach none of the profile readers. Verified live
-- with the anon key too, but pinning it here means a future migration that
-- re-grants execute fails the build instead of shipping.
do $$
declare
  fn text;
begin
  for fn in select unnest(array[
    'friend_taste_features',
    'friend_taste_features_batch',
    'get_friend_profile_snapshot',
    'browse_profiles',
    'search_users'
  ]) loop
    if has_function_privilege('anon', (
      select p.oid from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
      limit 1
    ), 'execute') then
      raise exception 'anon can execute %() — see migrations 0079/0080/0081', fn;
    end if;
  end loop;
end $$;

-- palate_overlap_rank answers "who eats like this person" for any id passed to
-- it, so it is callable only from palate_matches, which runs as its owner.
do $$
begin
  if has_function_privilege('authenticated', 'public.palate_overlap_rank(uuid, integer)', 'execute')
     or has_function_privilege('anon', 'public.palate_overlap_rank(uuid, integer)', 'execute') then
    raise exception 'palate_overlap_rank is directly callable — see migration 0079';
  end if;
end $$;

rollback;
