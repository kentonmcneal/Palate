-- ============================================================================
-- 0031_recommendations_from_saves.sql
-- ----------------------------------------------------------------------------
-- Server-side aggregation for the "Based on your saves" rail.
--
-- Before: mobile called `similar_restaurants` once per saved place (N+1 round-
-- trips, then merged client-side).
-- After:  one RPC pulls the user's recent saves, runs similarity against each
-- via a LATERAL join, aggregates totals, returns the top-N matches with the
-- list of anchor names ("Similar to Almyra + Vetri").
--
-- Auth is implicit via `auth.uid()` — no caller-supplied user id, no way for
-- one user to probe another's wishlist.
-- ============================================================================

create or replace function public.recommendations_from_saves(
  result_limit    int default 12,
  per_anchor_limit int default 12,
  max_anchors     int default 5
)
returns table (
  restaurant_id   uuid,
  total_score     numeric,
  matched_against text[]
)
language sql
stable
as $$
  with anchors as (
    select
      w.restaurant_id,
      r.name as anchor_name,
      w.added_at
    from public.wishlist w
    join public.restaurants r on r.id = w.restaurant_id
    where w.user_id = auth.uid()
    order by w.added_at desc
    limit max_anchors
  ),
  matches as (
    select
      a.anchor_name,
      s.restaurant_id as match_id,
      s.similarity_score
    from anchors a
    cross join lateral (
      select restaurant_id, similarity_score
      from public.similar_restaurants(a.restaurant_id, per_anchor_limit, false)
    ) s
    where s.restaurant_id not in (select restaurant_id from anchors)
  )
  select
    match_id as restaurant_id,
    sum(similarity_score)::numeric as total_score,
    array_agg(distinct anchor_name) as matched_against
  from matches
  group by match_id
  order by total_score desc
  limit result_limit;
$$;

grant execute on function public.recommendations_from_saves(int, int, int) to authenticated;
