-- ============================================================================
-- 0146_feed_comments.sql — the feed could be liked but not answered.
-- ----------------------------------------------------------------------------
-- Kudos has been there since 0007 (feed_likes, surfaced as like_count/i_liked
-- in 0077 and carried through 0096). A comment is the half that was missing:
-- kudos says "I saw this", a comment says "where is that, is it any good, I'm
-- going". The second one is the reason anybody opens the app twice.
--
-- Three things this migration refuses to do:
--
--   1. Widen visibility. A comment is readable exactly when its POST is
--      readable — same rule as 0077/0096, expressed once as
--      can_view_feed_event() instead of copied a fourth time.
--   2. Trust the client for the block check. blocked_users is own-row RLS, so
--      an inline `not exists (... blocker_id = other)` inside a policy sees
--      nothing: the row belongs to them, not to me. 0108 already solved this
--      with is_blocked_either_way(), a definer. Use it.
--   3. Allow edits. A comment can be written and deleted, never rewritten.
--      An editable comment under someone else's post is a moderation problem
--      with no upside (report it, and it has already changed).
--
-- Deletion is deliberately two-sided: the author of the comment can remove it,
-- and so can the author of the POST. Apple Guideline 1.2 wants a user to be
-- able to clear objectionable content off their own content without waiting on
-- us; report + block (0035/0108) already exist and comments inherit both, with
-- content_reports.target_type taking 'comment' as free text — no schema change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. "Can I see this post?" — stated once.
-- ----------------------------------------------------------------------------
create or replace function public.can_view_feed_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.feed_events e
     where e.id = p_event_id
       and auth.uid() is not null
       and (
         e.user_id = auth.uid()
         or (
           public.can_view_feed_author(e.user_id)
           and (
             e.visit_id is null
             or exists (
               select 1 from public.visits v
                where v.id = e.visit_id and v.is_public
             )
           )
         )
       )
  );
$$;

revoke all on function public.can_view_feed_event(uuid) from public, anon;
grant execute on function public.can_view_feed_event(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The table.
-- ----------------------------------------------------------------------------
create table if not exists public.feed_comments (
  id            uuid        primary key default gen_random_uuid(),
  feed_event_id uuid        not null references public.feed_events(id) on delete cascade,
  user_id       uuid        not null references auth.users(id)         on delete cascade,
  body          text        not null,
  created_at    timestamptz not null default now(),
  -- 500 is enough for a recommendation and an address. It is also the cap the
  -- client enforces, and the client is not the one that matters.
  constraint feed_comments_body_len
    check (char_length(btrim(body)) between 1 and 500)
);

-- Oldest-first within a post is the read order; the index matches it so the
-- per-post fetch never sorts.
create index if not exists feed_comments_event_idx
  on public.feed_comments (feed_event_id, created_at);

create index if not exists feed_comments_user_idx
  on public.feed_comments (user_id);

alter table public.feed_comments enable row level security;

-- ----------------------------------------------------------------------------
-- 3. RLS.
-- ----------------------------------------------------------------------------
drop policy if exists "feed_comments: read visible posts" on public.feed_comments;
create policy "feed_comments: read visible posts"
  on public.feed_comments for select
  using (
    public.can_view_feed_event(feed_event_id)
    and not public.is_blocked_either_way(auth.uid(), user_id)
  );

drop policy if exists "feed_comments: insert own on visible posts" on public.feed_comments;
create policy "feed_comments: insert own on visible posts"
  on public.feed_comments for insert
  with check (
    user_id = auth.uid()
    and public.can_view_feed_event(feed_event_id)
    and not public.is_blocked_either_way(auth.uid(), (
      select e.user_id from public.feed_events e where e.id = feed_event_id
    ))
  );

-- Author of the comment, or author of the post it sits under.
drop policy if exists "feed_comments: delete own or on own post" on public.feed_comments;
create policy "feed_comments: delete own or on own post"
  on public.feed_comments for delete
  using (
    user_id = auth.uid()
    or auth.uid() = (
      select e.user_id from public.feed_events e where e.id = feed_event_id
    )
  );

-- No update policy, on purpose. See the header.

-- ----------------------------------------------------------------------------
-- 4. Reading them, with their authors.
-- ----------------------------------------------------------------------------
-- Same reason list_feed is a definer: `profiles` is own-row RLS, so a PostgREST
-- embed returns null for every author but yourself. 0077 learned this the hard
-- way — the feed rendered nameless for weeks. Do not embed profiles here.
--
-- Email is absent, as in list_feed. 0036 took it out of user search to stop
-- address enumeration and a comment list is a wider surface than search.
create or replace function public.list_feed_comments(
  p_event_id uuid,
  p_limit    integer default 100
)
returns table (
  id                  uuid,
  feed_event_id       uuid,
  user_id             uuid,
  body                text,
  created_at          timestamptz,
  author_display_name text,
  author_username     text,
  author_avatar_url   text,
  can_delete          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.feed_event_id,
    c.user_id,
    c.body,
    c.created_at,
    p.display_name,
    p.username,
    p.avatar_url,
    (c.user_id = auth.uid()
       or auth.uid() = (select e.user_id from public.feed_events e where e.id = c.feed_event_id))
  from public.feed_comments c
  join public.profiles p on p.id = c.user_id
  where auth.uid() is not null
    and public.can_view_feed_event(p_event_id)
    and c.feed_event_id = p_event_id
    and not public.is_blocked_either_way(auth.uid(), c.user_id)
  order by c.created_at asc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.list_feed_comments(uuid, integer) from public, anon;
grant execute on function public.list_feed_comments(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. list_feed carries the count, so a card knows what it says before it opens.
-- ----------------------------------------------------------------------------
-- Body is byte-for-byte 0096 with one column added. The return type changes, so
-- this is a drop-and-recreate, not a replace.
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
  comment_count        integer,
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
    -- Blocked authors are subtracted here too, or the count promises replies
    -- that the list will not show.
    (select count(*)::int from public.feed_comments c
      where c.feed_event_id = b.id
        and not public.is_blocked_either_way(auth.uid(), c.user_id)),
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

revoke all on function public.list_feed(integer) from public, anon;
grant execute on function public.list_feed(integer) to authenticated;
