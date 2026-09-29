-- Minimal table fixture, not the full migration chain. See LOCAL-SQL-REPORT.md.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub')::uuid $$;

create table auth.users(id uuid primary key);
create table profiles(id uuid primary key references auth.users on delete cascade, email text, display_name text, username text, avatar_url text, profile_visibility text not null default 'friends' check(profile_visibility in ('public','friends','private')), timezone text, push_token text, push_social_activity boolean default false, push_post_likes boolean default true, push_post_comments boolean default true);
create table follows(follower_id uuid references profiles on delete cascade, followee_id uuid references profiles on delete cascade, created_at timestamptz default now(), primary key(follower_id,followee_id), check(follower_id<>followee_id));
create table blocked_users(blocker_id uuid references profiles on delete cascade,blocked_id uuid references profiles on delete cascade,primary key(blocker_id,blocked_id));
create table restaurants(id uuid primary key,google_place_id text unique,name text,cuisine_type text,cuisine_region text,cuisine_subregion text,format_class text,chain_type text,occasion_tags text[],flavor_tags text[],cultural_context text,neighborhood text,latitude double precision,longitude double precision,price_level integer,rating double precision,user_rating_count integer,city text,region text);
create type meal_type as enum ('breakfast','lunch','dinner','snack','unknown');
create type feed_event_kind as enum ('wrapped_shared','persona_change','milestone','visit_logged');
create table visits(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,restaurant_id uuid not null references restaurants,visited_at timestamptz not null default now(),meal_type meal_type,photo_url text,is_public boolean not null default true);
create table place_ratings(user_id uuid references auth.users,restaurant_id uuid references restaurants,rating double precision default 1500,comparisons integer default 0,primary key(user_id,restaurant_id));
create table feed_events(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,kind feed_event_kind not null default 'visit_logged',payload jsonb not null default '{}',created_at timestamptz not null default now(),visit_id uuid references visits on delete cascade);
create table feed_likes(feed_event_id uuid references feed_events on delete cascade,user_id uuid references auth.users on delete cascade,created_at timestamptz default now(),primary key(feed_event_id,user_id));
create table feed_comments(id uuid primary key default gen_random_uuid(),feed_event_id uuid not null references feed_events on delete cascade,user_id uuid not null references auth.users on delete cascade,body text not null check(char_length(btrim(body)) between 1 and 500),created_at timestamptz not null default now(),parent_id uuid references feed_comments on delete cascade);
create table feed_comment_likes(comment_id uuid references feed_comments on delete cascade,user_id uuid references auth.users on delete cascade,created_at timestamptz default now(),primary key(comment_id,user_id));
create table push_outbox(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,title text not null,body text not null,data jsonb not null default '{}',send_after timestamptz not null default now(),dedupe_key text not null,unique(user_id,dedupe_key));

-- Verbatim function from 0108_blocks_cut_both_ways.sql
create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocked_users x
     where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a)
  );
$$;

-- Verbatim function from 0116_follow_model.sql
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = a and followee_id = b)
     and exists (select 1 from public.follows where follower_id = b and followee_id = a);
$$;

-- Verbatim function from 0116_follow_model.sql
create or replace function public.can_view_feed_author(author uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.profiles p
       where p.id = author
         and (p.profile_visibility = 'public'
              or (p.profile_visibility = 'friends' and public.are_friends(auth.uid(), author)))
    )
    and not public.is_blocked_either_way(auth.uid(), author);
$$;

-- Verbatim function from 0055_push_outbox.sql
create or replace function public.next_sendable_at(
  p_timezone text,
  from_ts timestamptz default now()
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  local_ts timestamp;
  local_hour integer;
begin
  if p_timezone is null or p_timezone = '' then
    return null;
  end if;

  begin
    local_ts := from_ts at time zone p_timezone;
  exception when others then
    -- Unrecognised zone string: treat as unknown rather than guessing UTC.
    return null;
  end;

  local_hour := extract(hour from local_ts);

  -- Quiet 22:00-08:00 local, matching the local-notification schedule.
  if local_hour >= 22 then
    return ((date_trunc('day', local_ts) + interval '1 day 8 hours') at time zone p_timezone);
  elsif local_hour < 8 then
    return ((date_trunc('day', local_ts) + interval '8 hours') at time zone p_timezone);
  end if;

  return from_ts;
end;
$$;

-- Verbatim function from 0080_close_anon_profile_reads.sql
create or replace function public.friend_taste_features(target_id uuid)
returns jsonb
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
  -- Assert the caller exists before anything else. This is the line whose
  -- absence exposed every user's dining history to the anon key.
  if auth.uid() is null then
    return jsonb_build_object('authorized', false, 'reason', 'not_authenticated');
  end if;

  is_me := (auth.uid() = target_id);

  select pv.profile_visibility::text into vis
  from public.profiles pv
  where pv.id = target_id;

  if vis is null then
    return jsonb_build_object('authorized', false, 'reason', 'not_found');
  end if;

  is_friends := public.are_friends(auth.uid(), target_id);

  if not is_me and (vis = 'private' or (vis = 'friends' and not is_friends)) then
    return jsonb_build_object('authorized', false, 'reason', 'not_authorized');
  end if;

  -- `is_me or v.is_public` (0073): your own vector is built from your complete
  -- history, a friend's only from the slice they chose to publish.
  return jsonb_build_object(
    'authorized', true,
    'visit_count', (
      select count(*)::int from public.visits v
       where v.user_id = target_id and (is_me or v.is_public)
    ),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'visited_at', v.visited_at,
        'meal_type', v.meal_type,
        'restaurant', jsonb_build_object(
          'id',              r.id,
          'name',            r.name,
          'cuisine_type',    r.cuisine_type,
          'cuisine_region',  r.cuisine_region,
          'cuisine_subregion', r.cuisine_subregion,
          'format_class',    r.format_class,
          'chain_type',      r.chain_type,
          'occasion_tags',   r.occasion_tags,
          'flavor_tags',     r.flavor_tags,
          'cultural_context', r.cultural_context,
          'neighborhood',    r.neighborhood,
          'latitude',        r.latitude,
          'longitude',       r.longitude,
          'price_level',     r.price_level
        )
      ))
      from public.visits v
      join public.restaurants r on r.id = v.restaurant_id
      where v.user_id = target_id
        and (is_me or v.is_public)
    ), '[]'::jsonb)
  );
end;
$$;

-- Verbatim function from 0073_visibility_aware_profile.sql
create or replace function public.shared_places(target_id uuid, p_limit integer default 10)
returns table (
  google_place_id text,
  name            text,
  cuisine_type    text,
  my_visits       integer,
  their_visits    integer
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1
     where auth.uid() is not null
       and target_id <> auth.uid()
       and (
         public.are_friends(auth.uid(), target_id)
         or exists (
           select 1 from public.profiles p
            where p.id = target_id and p.profile_visibility = 'public'
         )
       )
  ),
  mine as (
    select v.restaurant_id, count(*)::int n
      from public.visits v
     where v.user_id = auth.uid()
       and v.is_public
     group by 1
  ),
  theirs as (
    select v.restaurant_id, count(*)::int n
      from public.visits v
     where v.user_id = target_id
       and v.is_public
     group by 1
  )
  select r.google_place_id, r.name, r.cuisine_type, mine.n, theirs.n
    from mine
    join theirs on theirs.restaurant_id = mine.restaurant_id
    join public.restaurants r on r.id = mine.restaurant_id
   where exists (select 1 from allowed)
   order by (mine.n + theirs.n) desc, r.name
   limit greatest(1, least(p_limit, 50));
$$;

-- Verbatim function from 0069_top_ranked_places.sql
create or replace function public.top_ranked_places(
  target_id uuid,
  p_limit integer default 5
)
returns table (
  google_place_id text,
  name            text,
  cuisine_type    text,
  -- Not `position`: that is a col_name_keyword in Postgres and cannot be
  -- used as a bare identifier in a RETURNS TABLE declaration.
  rank_position   integer
)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1
     where auth.uid() is not null
       and target_id <> auth.uid()
       and (
         public.are_friends(auth.uid(), target_id)
         or exists (
           select 1 from public.profiles p
            where p.id = target_id and p.profile_visibility = 'public'
         )
       )
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = auth.uid() and b.blocked_id = target_id)
             or (b.blocker_id = target_id and b.blocked_id = auth.uid())
       )
  )
  select
    r.google_place_id,
    r.name,
    r.cuisine_type,
    row_number() over (order by pr.rating desc, pr.comparisons desc, r.name)::int
    from public.place_ratings pr
    join public.restaurants r on r.id = pr.restaurant_id
   where pr.user_id = target_id
     and exists (select 1 from allowed)
     -- An unanswered place still sits at the default 1500 and would outrank
     -- something the person actually judged worse. A list is only an identity
     -- object if every entry was earned.
     and pr.comparisons > 0
   order by pr.rating desc, pr.comparisons desc, r.name
   limit greatest(1, least(p_limit, 50));
$$;

-- Verbatim function from 0180_friends_in_cities.sql
create or replace function public.friends_cities(p_days integer default 90)
returns table (
  friend_id    uuid,
  display_name text,
  username     text,
  avatar_url   text,
  city         text,
  region       text,
  visit_count  integer,
  last_month   date
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.avatar_url,
         r.city, r.region,
         count(*)::integer,
         date_trunc('month', max(v.visited_at))::date
    from public.visits v
    join public.restaurants r on r.id = v.restaurant_id
    join public.profiles    p on p.id = v.user_id
   where auth.uid() is not null
     and v.user_id <> auth.uid()
     and public.are_friends(auth.uid(), v.user_id)
     and coalesce(p.profile_visibility::text, 'public') <> 'private'
     and r.city is not null
     and v.visited_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
   group by p.id, p.display_name, p.username, p.avatar_url, r.city, r.region
  having count(*) >= 2
   order by max(v.visited_at) desc;
$$;

-- Verbatim function from 0146_feed_comments.sql
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

-- Verbatim function from 0148_comment_threads_and_notifications.sql
create or replace function public.list_feed(p_limit integer default 50)
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

-- Verbatim function from 0148_comment_threads_and_notifications.sql
create or replace function public.list_feed_comments(
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

-- Verbatim function from 0171_private_profiles_do_not_broadcast.sql
create or replace function public.enqueue_friend_visit_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  actor_vis  text;
  place_name text;
begin
  select coalesce(display_name, split_part(email, '@', 1), 'A friend'),
         coalesce(profile_visibility, 'friends')
    into actor_name, actor_vis
    from public.profiles where id = new.user_id;

  -- What you broadcast is yours to decide. See the header.
  if actor_vis = 'private' then
    return new;
  end if;

  -- Still required: a visit we cannot name a venue for is not worth a push.
  select name into place_name
    from public.restaurants where id = new.restaurant_id;
  if place_name is null then
    return new;
  end if;

  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key)
  select
    f.follower_id,
    actor_name || ' ate somewhere new',
    -- Deliberately vague. See 0162: this lands on a lock screen, in front of
    -- whoever is holding the phone.
    'Open Palate to see where.',
    jsonb_build_object('type', 'friend_visit', 'user_id', new.user_id),
    public.next_sendable_at(p.timezone),
    -- One per recipient per ACTOR per THEIR OWN LOCAL DAY.
    'friend_visit:' || new.user_id::text || ':'
      || (timezone(coalesce(p.timezone, 'UTC'), now()))::date::text
  from public.follows f
  join public.profiles p on p.id = f.follower_id
  where f.followee_id = new.user_id
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(p.id, new.user_id)
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end $$;

-- Verbatim function from 0148_comment_threads_and_notifications.sql
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

-- Verbatim function from 0148_comment_threads_and_notifications.sql
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

-- Verbatim function from 0148_comment_threads_and_notifications.sql
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

-- Verbatim function from 0148_comment_threads_and_notifications.sql
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

create policy "visits: own all"
  on public.visits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "feed_events: insert own"
  on public.feed_events for insert
  with check (auth.uid() = user_id);

create policy "feed_events: delete own"
  on public.feed_events for delete
  using (auth.uid() = user_id);

create policy "feed_likes: insert own"
  on public.feed_likes for insert
  with check (auth.uid() = user_id);

create policy "feed_likes: delete own"
  on public.feed_likes for delete
  using (auth.uid() = user_id);

create policy "feed_likes: visible events"
  on public.feed_likes for select
  using (
    exists (
      select 1 from public.feed_events e
      where e.id = feed_likes.feed_event_id
    )
  );

create policy "feed_events: own + friends"
  on public.feed_events for select
  using (
    auth.uid() = user_id
    or (
      public.can_view_feed_author(user_id)
      and (
        feed_events.visit_id is null
        or exists (
          select 1 from public.visits v
          where v.id = feed_events.visit_id
            and v.is_public
        )
      )
    )
  );

create policy "follows: readable by signed in"
  on public.follows for select using (auth.uid() is not null);

create policy "follows: own insert"
  on public.follows for insert to authenticated
  with check (
    auth.uid() = follower_id
    and not public.is_blocked_either_way(follower_id, followee_id)
  );

create policy "follows: own delete"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

create policy "feed_comments: read visible posts"
  on public.feed_comments for select
  using (
    public.can_view_feed_event(feed_event_id)
    and not public.is_blocked_either_way(auth.uid(), user_id)
  );

create policy "feed_comments: insert own on visible posts"
  on public.feed_comments for insert
  with check (
    user_id = auth.uid()
    and public.can_view_feed_event(feed_event_id)
    and not public.is_blocked_either_way(auth.uid(), (
      select e.user_id from public.feed_events e where e.id = feed_event_id
    ))
  );

create policy "feed_comments: delete own or on own post"
  on public.feed_comments for delete
  using (
    user_id = auth.uid()
    or auth.uid() = (
      select e.user_id from public.feed_events e where e.id = feed_event_id
    )
  );

create policy "feed_comment_likes: read visible"
  on public.feed_comment_likes for select
  using (exists (select 1 from public.feed_comments c where c.id = comment_id));

create policy "feed_comment_likes: like as self"
  on public.feed_comment_likes for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.feed_comments c where c.id = comment_id)
  );

create policy "feed_comment_likes: unlike own"
  on public.feed_comment_likes for delete
  using (user_id = auth.uid());

create policy profile_own on profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy block_own on blocked_users for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());
create policy ratings_own on place_ratings for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "feed_events: signed in only" on feed_events as restrictive for select using(auth.uid() is not null);
create trigger visits_notify after insert on visits for each row execute function enqueue_friend_visit_push();
create trigger feed_likes_notify after insert on feed_likes for each row execute function on_feed_like_insert();
create trigger feed_comments_notify after insert on feed_comments for each row execute function on_feed_comment_insert();
create trigger feed_comment_likes_notify after insert on feed_comment_likes for each row execute function on_comment_like_insert();
grant usage on schema public,auth to anon,authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to authenticated,service_role;
grant select on feed_events to anon;
revoke all on push_outbox from anon,authenticated;
revoke all on function are_friends(uuid,uuid) from public,anon,authenticated;
revoke all on function can_view_feed_event(uuid),list_feed(integer),list_feed_comments(uuid,integer),friend_taste_features(uuid),shared_places(uuid,integer),top_ranked_places(uuid,integer),friends_cities(integer) from public,anon;
grant execute on function can_view_feed_event(uuid),list_feed(integer),list_feed_comments(uuid,integer),friend_taste_features(uuid),shared_places(uuid,integer),top_ranked_places(uuid,integer),friends_cities(integer) to authenticated;
alter table profiles enable row level security;
alter table follows enable row level security;
alter table blocked_users enable row level security;
alter table visits enable row level security;
alter table place_ratings enable row level security;
alter table feed_events enable row level security;
alter table feed_likes enable row level security;
alter table feed_comments enable row level security;
alter table feed_comment_likes enable row level security;
alter table push_outbox enable row level security;

create or replace function public.friend_taste_features_batch(target_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  out_obj jsonb := '{}'::jsonb;
  tid uuid;
begin
  if target_ids is null or array_length(target_ids, 1) is null then
    return out_obj;
  end if;

  -- Bounded so one call cannot ask for the whole user table.
  if array_length(target_ids, 1) > 100 then
    raise exception 'too many ids';
  end if;

  foreach tid in array target_ids loop
    out_obj := out_obj || jsonb_build_object(
      tid::text,
      public.friend_taste_features(tid)
    );
  end loop;

  return out_obj;
end;
$function$;
revoke all on function friend_taste_features_batch(uuid[]) from public,anon;
grant execute on function friend_taste_features_batch(uuid[]) to authenticated;
