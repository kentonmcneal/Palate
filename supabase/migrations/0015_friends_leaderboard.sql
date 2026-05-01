-- ============================================================================
-- 0015_friends_leaderboard.sql
-- ----------------------------------------------------------------------------
-- RPC for the Friends Leaderboard view. Returns each accepted friend with:
--   - latest persona label (from weekly_wrapped)
--   - all-time visit count
--   - this-week visit count
--   - unique cuisines
--
-- Uses SECURITY DEFINER so we can read friends' visits/wrapped without
-- relaxing the existing RLS policies. Only returns rows where the requesting
-- user is friends with the target AND target's profile_visibility allows it.
-- ============================================================================

create or replace function public.friends_leaderboard()
returns table (
  user_id            uuid,
  display_name       text,
  email              text,
  avatar_url         text,
  persona_label      text,
  total_visits       int,
  visits_this_week   int,
  unique_cuisines    int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  week_start date := date_trunc('week', now())::date;
begin
  return query
  with friend_ids as (
    select case when f.requester_id = me then f.addressee_id else f.requester_id end as fid
    from public.friendships f
    where f.status = 'accepted'
      and (f.requester_id = me or f.addressee_id = me)
  ),
  visible_friends as (
    select fid
    from friend_ids
    join public.profiles p on p.id = friend_ids.fid
    where p.profile_visibility in ('friends', 'public')
  )
  select
    p.id,
    p.display_name,
    p.email,
    p.avatar_url,
    ww.personality_label,
    coalesce(stats.total_visits, 0)::int,
    coalesce(stats.this_week, 0)::int,
    coalesce(stats.unique_cuisines, 0)::int
  from visible_friends vf
  join public.profiles p on p.id = vf.fid
  left join lateral (
    select
      count(*)::int as total_visits,
      count(*) filter (where v.visited_at >= week_start)::int as this_week,
      count(distinct r.cuisine_type)::int as unique_cuisines
    from public.visits v
    left join public.restaurants r on r.id = v.restaurant_id
    where v.user_id = vf.fid
  ) stats on true
  left join lateral (
    select w.personality_label
    from public.weekly_wrapped w
    where w.user_id = vf.fid
    order by w.week_start desc
    limit 1
  ) ww on true
  order by stats.this_week desc nulls last, stats.total_visits desc nulls last;
end;
$$;

grant execute on function public.friends_leaderboard() to authenticated;
