-- ============================================================================
-- 0148 — hearts, threads, previews, and being told about them.
-- ----------------------------------------------------------------------------
-- 0146 gave the feed comments. What it did not give it is the loop: you could
-- write under someone's post and they would never know, and nobody could
-- answer you. A comment nobody is told about is a message in a bottle.
--
-- Four things:
--   1. feed_comments.parent_id      a comment can answer a comment
--   2. feed_comment_likes           a comment can be liked, like a post
--   3. list_feed.top_comments       the first two, inline under the post, so
--                                   the feed shows a conversation rather than
--                                   a number that has to be tapped to mean
--                                   anything
--   4. push on like / comment / reply, through the 0055 outbox
--
-- The push deliberately goes through push_outbox rather than posting to Expo
-- directly. notify-feed-post learned that lesson the hard way: it posted
-- straight to Expo and so bypassed quiet hours, the daily cap and every
-- preference at once. The outbox gets all of that for free, plus dedupe, plus
-- the server_push master switch which is still OFF until it is turned on
-- deliberately.
--
-- Nobody is ever notified about their own action. Liking your own post is
-- allowed; being buzzed about it is absurd.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Replies.
-- ----------------------------------------------------------------------------
alter table public.feed_comments
  add column if not exists parent_id uuid references public.feed_comments(id) on delete cascade;

create index if not exists feed_comments_parent_idx
  on public.feed_comments (parent_id, created_at)
  where parent_id is not null;

comment on column public.feed_comments.parent_id is
  'The comment this answers. One level only -- a reply to a reply is stored '
  'against the same top-level parent, so a thread can never become a tree the '
  'UI has no way to draw.';

-- ----------------------------------------------------------------------------
-- 2. Liking a comment.
-- ----------------------------------------------------------------------------
create table if not exists public.feed_comment_likes (
  comment_id uuid        not null references public.feed_comments(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)           on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists feed_comment_likes_comment_idx
  on public.feed_comment_likes (comment_id);

alter table public.feed_comment_likes enable row level security;

-- Visible when the comment is. The comment's own policy already encodes "the
-- post is visible to me and neither of us has blocked the other", so this
-- defers to it rather than restating the rule a fifth time.
drop policy if exists "feed_comment_likes: read visible" on public.feed_comment_likes;
create policy "feed_comment_likes: read visible"
  on public.feed_comment_likes for select
  using (exists (select 1 from public.feed_comments c where c.id = comment_id));

drop policy if exists "feed_comment_likes: like as self" on public.feed_comment_likes;
create policy "feed_comment_likes: like as self"
  on public.feed_comment_likes for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.feed_comments c where c.id = comment_id)
  );

drop policy if exists "feed_comment_likes: unlike own" on public.feed_comment_likes;
create policy "feed_comment_likes: unlike own"
  on public.feed_comment_likes for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Notification preferences.
-- ----------------------------------------------------------------------------
-- Default TRUE, unlike push_friend_activity which defaults FALSE. The
-- difference is who the event is about: friend activity broadcasts YOUR
-- movements to other people, so it has to be opted into. A like on your post is
-- someone addressing you, and an app that silently swallows replies to you is
-- broken rather than polite. Both are still behind the server_push master
-- switch, so nothing sends until that is flipped.
alter table public.profiles
  add column if not exists push_post_likes    boolean not null default true,
  add column if not exists push_post_comments boolean not null default true;

comment on column public.profiles.push_post_likes is
  'Push when someone hearts your post or your comment.';
comment on column public.profiles.push_post_comments is
  'Push when someone comments on your post or replies to your comment.';

-- ----------------------------------------------------------------------------
-- 4. Reading comments, now with their hearts and their replies.
-- ----------------------------------------------------------------------------
drop function if exists public.list_feed_comments(uuid, integer);

create function public.list_feed_comments(
  p_event_id uuid,
  p_limit    integer default 200
)
returns table (
  id                  uuid,
  feed_event_id       uuid,
  parent_id           uuid,
  user_id             uuid,
  body                text,
  created_at          timestamptz,
  author_display_name text,
  author_username     text,
  author_avatar_url   text,
  like_count          integer,
  i_liked             boolean,
  reply_count         integer,
  can_delete          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select c.*
      from public.feed_comments c
     where auth.uid() is not null
       and public.can_view_feed_event(p_event_id)
       and c.feed_event_id = p_event_id
       and not public.is_blocked_either_way(auth.uid(), c.user_id)
  )
  select
    v.id,
    v.feed_event_id,
    v.parent_id,
    v.user_id,
    v.body,
    v.created_at,
    p.display_name,
    p.username,
    p.avatar_url,
    (select count(*)::int from public.feed_comment_likes l where l.comment_id = v.id),
    exists (select 1 from public.feed_comment_likes l where l.comment_id = v.id and l.user_id = auth.uid()),
    (select count(*)::int from visible r where r.parent_id = v.id),
    (v.user_id = auth.uid()
       or auth.uid() = (select e.user_id from public.feed_events e where e.id = v.feed_event_id))
  from visible v
  join public.profiles p on p.id = v.user_id
  -- Top-level comments in time order, each followed by its replies. Sorting by
  -- (thread root, then time) keeps a reply adjacent to what it answers without
  -- the client having to reassemble the thread.
  order by coalesce(v.parent_id, v.id), (v.parent_id is not null), v.created_at
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.list_feed_comments(uuid, integer) from public, anon;
grant execute on function public.list_feed_comments(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. list_feed carries the first two comments, not just how many there are.
-- ----------------------------------------------------------------------------
-- "3 comments" is a number you have to tap to find out whether it was worth
-- tapping. Two lines of what people actually said is the thing that makes a
-- feed read like a conversation, and it is why Instagram shows them inline.
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
  top_comments         jsonb,
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
    (select count(*)::int from public.feed_comments c
      where c.feed_event_id = b.id
        and not public.is_blocked_either_way(auth.uid(), c.user_id)),
    -- The two most recent TOP-LEVEL comments, oldest of the two first, so the
    -- preview reads in the order they were said. Replies are left out: a reply
    -- without the thing it answers is noise at this size.
    coalesce((
      select jsonb_agg(t order by t.created_at)
        from (
          select c.id, c.body, c.user_id, c.created_at,
                 coalesce(pp.display_name, pp.username, 'Someone') as author
            from public.feed_comments c
            join public.profiles pp on pp.id = c.user_id
           where c.feed_event_id = b.id
             and c.parent_id is null
             and not public.is_blocked_either_way(auth.uid(), c.user_id)
           order by c.created_at desc
           limit 2
        ) t
    ), '[]'::jsonb),
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

-- ----------------------------------------------------------------------------
-- 6. Being told.
-- ----------------------------------------------------------------------------
-- One helper rather than three near-identical triggers. Every rule that makes a
-- push acceptable lives here exactly once: never yourself, never without a
-- token, never without a timezone (quiet hours cannot be honoured blind), never
-- against the recipient's preference, and never twice for the same event.
create or replace function public.enqueue_social_push(
  p_recipient uuid,
  p_actor     uuid,
  p_pref      text,
  p_title     text,
  p_body      text,
  p_data      jsonb,
  p_dedupe    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  if p_recipient is null or p_actor is null or p_recipient = p_actor then
    return;                              -- nobody is notified about themselves
  end if;

  select
    case p_pref
      when 'likes'    then p.push_post_likes
      when 'comments' then p.push_post_comments
      else false
    end
    and p.push_token is not null
    and p.timezone is not null
    -- A block in either direction silences the notification too. Hiding the
    -- comment but still buzzing about it would be worse than doing neither.
    and not public.is_blocked_either_way(p_recipient, p_actor)
  into ok
  from public.profiles p
  where p.id = p_recipient;

  if not coalesce(ok, false) then
    return;
  end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key)
  select p_recipient, p_title, p_body, p_data,
         public.next_sendable_at(p.timezone), p_dedupe
    from public.profiles p
   where p.id = p_recipient
     and public.next_sendable_at(p.timezone) is not null
  on conflict (user_id, dedupe_key) do nothing;
end;
$$;

revoke all on function public.enqueue_social_push(uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- ---- someone hearted your post ----------------------------------------------
create or replace function public.on_feed_like_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; owner_id uuid;
begin
  select e.user_id into owner_id from public.feed_events e where e.id = new.feed_event_id;
  select coalesce(display_name, username, 'Someone') into actor
    from public.profiles where id = new.user_id;

  perform public.enqueue_social_push(
    owner_id, new.user_id, 'likes',
    actor || ' liked your post',
    actor || ' hearted where you ate.',
    jsonb_build_object('type', 'post_like', 'feed_event_id', new.feed_event_id),
    'post_like:' || new.feed_event_id::text || ':' || new.user_id::text
  );
  return new;
end $$;

drop trigger if exists feed_likes_notify on public.feed_likes;
create trigger feed_likes_notify
  after insert on public.feed_likes
  for each row execute function public.on_feed_like_insert();

-- ---- someone hearted your comment -------------------------------------------
create or replace function public.on_comment_like_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; owner_id uuid; ev uuid;
begin
  select c.user_id, c.feed_event_id into owner_id, ev
    from public.feed_comments c where c.id = new.comment_id;
  select coalesce(display_name, username, 'Someone') into actor
    from public.profiles where id = new.user_id;

  perform public.enqueue_social_push(
    owner_id, new.user_id, 'likes',
    actor || ' liked your comment',
    actor || ' hearted what you said.',
    jsonb_build_object('type', 'comment_like', 'feed_event_id', ev, 'comment_id', new.comment_id),
    'comment_like:' || new.comment_id::text || ':' || new.user_id::text
  );
  return new;
end $$;

drop trigger if exists feed_comment_likes_notify on public.feed_comment_likes;
create trigger feed_comment_likes_notify
  after insert on public.feed_comment_likes
  for each row execute function public.on_comment_like_insert();

-- ---- someone commented, or replied to you -----------------------------------
create or replace function public.on_feed_comment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text; post_owner uuid; parent_owner uuid; snippet text;
begin
  select e.user_id into post_owner from public.feed_events e where e.id = new.feed_event_id;
  select coalesce(display_name, username, 'Someone') into actor
    from public.profiles where id = new.user_id;
  snippet := left(new.body, 120);

  if new.parent_id is not null then
    select c.user_id into parent_owner from public.feed_comments c where c.id = new.parent_id;
    perform public.enqueue_social_push(
      parent_owner, new.user_id, 'comments',
      actor || ' replied to you',
      snippet,
      jsonb_build_object('type', 'comment_reply', 'feed_event_id', new.feed_event_id, 'comment_id', new.id),
      'comment_reply:' || new.id::text
    );
  end if;

  -- The post's author hears about it too -- unless they are the one who was
  -- just replied to, who has already been told once and does not need two
  -- buzzes for one sentence.
  if parent_owner is null or parent_owner <> post_owner then
    perform public.enqueue_social_push(
      post_owner, new.user_id, 'comments',
      actor || ' commented on your post',
      snippet,
      jsonb_build_object('type', 'post_comment', 'feed_event_id', new.feed_event_id, 'comment_id', new.id),
      'post_comment:' || new.id::text
    );
  end if;

  return new;
end $$;

drop trigger if exists feed_comments_notify on public.feed_comments;
create trigger feed_comments_notify
  after insert on public.feed_comments
  for each row execute function public.on_feed_comment_insert();
