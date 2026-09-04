-- ============================================================================
-- 0077_open_feed.sql — everyone sees everyone, without adding friends first.
-- ----------------------------------------------------------------------------
-- The social features could not be evaluated because nothing was visible: the
-- feed required an ACCEPTED FRIENDSHIP with the author, whatever that author's
-- profile visibility said. A public profile's posts were public to nobody. In a
-- beta where almost nobody has sent a friend request, that meant every feed was
-- empty and the whole social layer looked broken rather than unused.
--
-- The rule becomes what the visibility setting already claims it is:
--
--   public   -> anyone signed in
--   friends  -> accepted friends only     (unchanged)
--   private  -> nobody but the owner      (unchanged)
--
-- This does not redefine anybody's setting. 'friends' still means friends. What
-- changes is that 'public' now actually means public, which is what the profile
-- editor has been telling people it means: "Anyone on Palate can see your
-- profile and persona."
--
-- Blocks still cut both directions, and per-visit curation still governs: a
-- post whose visit has been hidden is now invisible at the DATABASE, not merely
-- deleted by the client that hid it (see below).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Visibility means what it says.
-- ----------------------------------------------------------------------------
create or replace function public.can_view_feed_author(author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.profiles p
      where p.id = author
        and (
          p.profile_visibility = 'public'
          or (
            p.profile_visibility = 'friends'
            and exists (
              select 1 from public.friendships f
              where f.status = 'accepted'
                and (
                  (f.requester_id = auth.uid() and f.addressee_id = author)
                  or (f.addressee_id = auth.uid() and f.requester_id = author)
                )
            )
          )
        )
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = author)
         or (b.blocker_id = author       and b.blocked_id = auth.uid())
    );
$$;

grant execute on function public.can_view_feed_author(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Hiding a visit retracts its post, enforced here rather than by the client.
-- ----------------------------------------------------------------------------
-- Until now the retraction was a `delete from feed_events where visit_id = ...`
-- issued by the app right after flipping `is_public` (mobile/lib/visits.ts).
-- That is one network call away from leaving an announcement up for a visit the
-- user just hid -- survivable while the audience was a handful of accepted
-- friends, not survivable now that the audience is everyone. The policy makes
-- the visit the source of truth: an event linked to a hidden visit is invisible
-- to everyone but its author, whether or not the delete ever landed.
drop policy if exists "feed_events: own + friends" on public.feed_events;
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

-- ----------------------------------------------------------------------------
-- 3. Bring existing accounts up to the default new accounts already get.
-- ----------------------------------------------------------------------------
-- 0056 set the column default to 'public' but never backfilled, so every
-- account created before it sits at 'friends' -- invisible in the directory,
-- invisible in the feed, and unable to see anyone else's.
--
-- 'private' is NEVER touched. That is an explicit, deliberate choice and this
-- migration does not get to overrule it.
--
-- The prior value is recorded so this is reversible: an account can be put back
-- exactly where it was, rather than "back to whatever we guess the default was".
alter table public.profiles
  add column if not exists visibility_before_open_beta text;

comment on column public.profiles.visibility_before_open_beta is
  'profile_visibility as it stood before migration 0077 opened the beta. '
  'Non-null only for rows that migration changed. Exists so the change can be '
  'undone per-account, not to be read by the app.';

do $$
declare
  changed int;
begin
  update public.profiles
     set visibility_before_open_beta = profile_visibility,
         profile_visibility = 'public'
   where profile_visibility = 'friends'
     and visibility_before_open_beta is null;
  get diagnostics changed = row_count;
  raise notice 'opened % profile(s) from friends to public', changed;
end $$;

-- ----------------------------------------------------------------------------
-- 4. list_feed — posts WITH their author.
-- ----------------------------------------------------------------------------
-- The feed client selects feed_events with an embedded
-- `user:profiles!feed_events_user_id_fkey(...)` join, and `profiles` is
-- own-row RLS with no policy that has ever allowed reading somebody else's row.
-- So that join has been returning null for every author but yourself, and the
-- feed has been rendering nameless, faceless posts. It went unnoticed because
-- the feed was almost always empty.
--
-- Widening the profiles policy is not the fix: RLS grants whole rows, and this
-- table carries email, push tokens and Gmail refresh tokens. The sanctioned
-- route past own-row RLS in this schema is a definer function that returns only
-- the columns it means to (browse_profiles, search_users, the snapshot). This
-- is that, for the feed.
--
-- Email is deliberately absent. 0036 removed it from search_users to stop
-- address enumeration; putting it back on every feed post would undo that.
create or replace function public.list_feed(p_limit integer default 50)
returns table (
  id                  uuid,
  user_id             uuid,
  kind                text,
  payload             jsonb,
  created_at          timestamptz,
  author_display_name text,
  author_username     text,
  author_avatar_url   text,
  like_count          integer,
  i_liked             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.user_id,
    e.kind::text,
    e.payload,
    e.created_at,
    p.display_name,
    p.username,
    p.avatar_url,
    (select count(*)::int from public.feed_likes l where l.feed_event_id = e.id),
    exists (
      select 1 from public.feed_likes l
       where l.feed_event_id = e.id and l.user_id = auth.uid()
    )
  from public.feed_events e
  join public.profiles p on p.id = e.user_id
  where auth.uid() is not null
    and (
      e.user_id = auth.uid()
      or (
        public.can_view_feed_author(e.user_id)
        -- Curation is authoritative here too: an announcement outlives the
        -- client-side delete that was supposed to retract it.
        and (
          e.visit_id is null
          or exists (
            select 1 from public.visits v
            where v.id = e.visit_id and v.is_public
          )
        )
      )
    )
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.list_feed(integer) from public;
grant execute on function public.list_feed(integer) to authenticated;
