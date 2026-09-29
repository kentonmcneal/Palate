-- Social privacy and feed/thread integrity hardening.
-- Validated in the accompanying minimal local PGlite fixture; NOT deployed.
-- Do not edit historical migrations. Existing malformed replies are not repaired.
begin;

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
  if not is_me and public.is_blocked_either_way(auth.uid(), target_id) then
    return jsonb_build_object('authorized', false, 'reason', 'not_authorized');
  end if;

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
       and public.can_view_feed_author(target_id)
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
       and public.can_view_feed_author(target_id)
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
     and v.is_public
     and not public.is_blocked_either_way(auth.uid(), v.user_id)
     and public.are_friends(auth.uid(), v.user_id)
     and coalesce(p.profile_visibility::text, 'public') <> 'private'
     and r.city is not null
     and v.visited_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
   group by p.id, p.display_name, p.username, p.avatar_url, r.city, r.region
  having count(*) >= 2
   order by max(v.visited_at) desc;
$$;

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
       and (e.visit_id is null or exists (
         select 1 from public.visits linked
          where linked.id = e.visit_id and linked.user_id = e.user_id
       ))
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
       -- Keep feed selection independent of the visibility/integrity helper.
       and (e.visit_id is null or exists (
         select 1 from public.visits linked
          where linked.id = e.visit_id and linked.user_id = e.user_id
       ))
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

-- Reject forged visit links at write time and hide any already-forged events.
drop policy if exists "feed_events: insert own" on public.feed_events;
create policy "feed_events: insert own" on public.feed_events for insert to authenticated
with check (user_id = auth.uid() and (visit_id is null or exists (
  select 1 from public.visits v where v.id = feed_events.visit_id and v.user_id = auth.uid()
)));
drop policy if exists "feed_events: own + friends" on public.feed_events;
create policy "feed_events: own + friends" on public.feed_events for select to authenticated
using (public.can_view_feed_event(id));

-- A user's identity alone does not authorize interaction with a hidden post.
drop policy if exists "feed_likes: insert own" on public.feed_likes;
create policy "feed_likes: insert own" on public.feed_likes for insert to authenticated
with check (user_id = auth.uid() and public.can_view_feed_event(feed_event_id));

-- FK existence alone does not make a parent a valid reply target.
create or replace function public.validate_feed_comment_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_row public.feed_comments%rowtype;
begin
  -- Comments have no client UPDATE policy. Keep their thread identity immutable
  -- for privileged writes too: moving a root otherwise strands existing children.
  -- This also removes the insert/reparent race without a check-then-act scan.
  if TG_OP = 'UPDATE' and (
    new.id is distinct from old.id or
    new.feed_event_id is distinct from old.feed_event_id or
    new.parent_id is distinct from old.parent_id
  ) then
    raise exception 'comment thread identity is immutable' using errcode = '23514';
  end if;
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'invalid reply target' using errcode = '23514';
  end if;
  select * into parent_row from public.feed_comments where id = new.parent_id for key share;
  if not found or parent_row.feed_event_id <> new.feed_event_id
     or parent_row.parent_id is not null
     or (auth.uid() is not null and public.is_blocked_either_way(auth.uid(), parent_row.user_id)) then
    raise exception 'invalid reply target' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.validate_feed_comment_parent() from public, anon, authenticated;
drop trigger if exists feed_comments_validate_parent on public.feed_comments;
create trigger feed_comments_validate_parent before insert or update of id, parent_id, feed_event_id
on public.feed_comments for each row execute function public.validate_feed_comment_parent();

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
  if not new.is_public or actor_vis is null or actor_vis not in ('public', 'friends') then
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
    and (actor_vis = 'public' or public.are_friends(f.follower_id, new.user_id))
    and p.push_social_activity
    and p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and not public.is_blocked_either_way(p.id, new.user_id)
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end $$;

revoke all on function public.friend_taste_features(uuid) from public, anon;
grant execute on function public.friend_taste_features(uuid) to authenticated;

revoke all on function public.shared_places(uuid, integer) from public, anon;
grant execute on function public.shared_places(uuid, integer) to authenticated;

revoke all on function public.top_ranked_places(uuid, integer) from public, anon;
grant execute on function public.top_ranked_places(uuid, integer) to authenticated;

revoke all on function public.friends_cities(integer) from public, anon;
grant execute on function public.friends_cities(integer) to authenticated;

revoke all on function public.can_view_feed_event(uuid) from public, anon;
grant execute on function public.can_view_feed_event(uuid) to authenticated;

revoke all on function public.list_feed(integer) from public, anon;
grant execute on function public.list_feed(integer) to authenticated;

commit;
