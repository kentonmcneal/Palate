-- ============================================================================
-- 0096_feed_with_stats.sql — a visit in the feed is a card, not a sentence.
-- ----------------------------------------------------------------------------
-- "Logged Ecco, an Italian spot in Midtown" is a log line. Strava's feed
-- works because every activity carries numbers, and the numbers are partly
-- about the reader: their pace, your PR. Beli's works because a place comes
-- with a relationship to you. So each visit post now carries:
--
--   author_visit_ordinal  their nth time here, as of that visit ("4th visit")
--   viewer_visit_count    how many times YOU have been (0 = "never been")
--   visited_at, meal_type, photo_url   from the visit itself
--   restaurant            the row's tags as jsonb, so the client can score
--                         "your match" on the same graph as everywhere else
--
-- Same visibility as 0077: nothing here is readable that was not already.
-- The restaurant jsonb is catalogue data, not personal; the viewer count is
-- the viewer's own. Legacy posts with no visit_id resolve the restaurant by
-- the payload's google_place_id and carry null visit fields.
-- ============================================================================

drop function if exists public.list_feed(integer);

create function public.list_feed(p_limit integer default 50)
returns table (
  id                   uuid,
  user_id              uuid,
  kind                 text,
  payload              jsonb,
  created_at           timestamptz,
  author_display_name  text,
  author_username      text,
  author_avatar_url    text,
  like_count           integer,
  i_liked              boolean,
  visited_at           timestamptz,
  meal_type            text,
  photo_url            text,
  author_visit_ordinal integer,
  viewer_visit_count   integer,
  restaurant           jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select e.*, p.display_name, p.username, p.avatar_url
      from public.feed_events e
      join public.profiles p on p.id = e.user_id
     where auth.uid() is not null
       and (
         e.user_id = auth.uid()
         or (
           public.can_view_feed_author(e.user_id)
           and (
             e.visit_id is null
             or exists (select 1 from public.visits v where v.id = e.visit_id and v.is_public)
           )
         )
       )
     order by e.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select
    b.id,
    b.user_id,
    b.kind::text,
    b.payload,
    b.created_at,
    b.display_name,
    b.username,
    b.avatar_url,
    (select count(*)::int from public.feed_likes l where l.feed_event_id = b.id),
    exists (select 1 from public.feed_likes l where l.feed_event_id = b.id and l.user_id = auth.uid()),
    v.visited_at,
    v.meal_type::text,
    v.photo_url,
    case when r.id is null then null else (
      select count(*)::int from public.visits x
       where x.user_id = b.user_id and x.restaurant_id = r.id
         and x.is_public
         and x.visited_at <= coalesce(v.visited_at, b.created_at)
    ) end,
    case when r.id is null then null else (
      select count(*)::int from public.visits x
       where x.user_id = auth.uid() and x.restaurant_id = r.id
    ) end,
    case when r.id is null then null else jsonb_build_object(
      'google_place_id', r.google_place_id,
      'name', r.name,
      'cuisine_type', r.cuisine_type,
      'cuisine_region', r.cuisine_region,
      'cuisine_subregion', r.cuisine_subregion,
      'format_class', r.format_class,
      'occasion_tags', r.occasion_tags,
      'neighborhood', r.neighborhood,
      'price_level', r.price_level,
      'rating', r.rating,
      'user_rating_count', r.user_rating_count,
      'latitude', r.latitude,
      'longitude', r.longitude
    ) end
  from base b
  left join public.visits v on v.id = b.visit_id
  left join public.restaurants r
    on r.id = coalesce(v.restaurant_id,
         (select r2.id from public.restaurants r2
           where r2.google_place_id = b.payload ->> 'google_place_id' limit 1))
  order by b.created_at desc;
$$;

revoke all on function public.list_feed(integer) from public;
revoke all on function public.list_feed(integer) from anon;
grant execute on function public.list_feed(integer) to authenticated;
