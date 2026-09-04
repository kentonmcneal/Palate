-- ============================================================================
-- 0076_assert_snapshot_body_runs.sql
-- ----------------------------------------------------------------------------
-- 0075 showed that get_friend_profile_snapshot raised 42702 on its FIRST
-- statement, which means every call since 0008 returned early and the main
-- branch — the persona lateral against weekly_wrapped, and the visit
-- aggregates — has almost certainly never executed against real data.
-- PL/pgSQL does not parse a `return query` until it runs, so "the migration
-- applied" says nothing about whether that branch is valid.
--
-- This migration executes those expressions once, against an id that matches
-- nothing. It writes nothing and returns nothing; it exists so that a bad
-- column reference fails the push instead of failing a user's profile screen.
-- Keeping it in the tree means a future edit to the function has to survive it.
-- ============================================================================

do $$
declare
  probe uuid := '00000000-0000-0000-0000-000000000000';
  n int;
  t text;
begin
  -- The persona lateral.
  perform 1
    from public.profiles p
    left join lateral (
      select w.personality_label, w.wrapped_json
      from public.weekly_wrapped w
      where w.user_id = probe
      order by w.week_start desc
      limit 1
    ) ww on true
   where p.id = probe;

  -- Most-visited visible spot.
  select r.name into t
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
   where v.user_id = probe and v.is_public
   group by r.name
   order by count(*) desc, r.name
   limit 1;

  -- Visible aggregates and the owner-only hidden count.
  select count(distinct v.restaurant_id)::int into n
    from public.visits v where v.user_id = probe and v.is_public;
  select count(*)::int into n
    from public.visits v where v.user_id = probe and v.is_public;
  select count(*)::int into n
    from public.visits v where v.user_id = probe and not v.is_public;

  raise notice 'snapshot body expressions resolve';
end $$;
