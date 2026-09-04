-- ============================================================================
-- 0085_link_legacy_feed_posts.sql — make the oldest posts retractable.
-- ----------------------------------------------------------------------------
-- feed_events.visit_id arrived in 0072. Every visit_logged post written before
-- that has none, which means hiding the visit does not pull its post: both the
-- RLS policy and list_feed check `visit_id is null or the visit is public`, and
-- a null visit_id passes. Thirty posts on the founder's account were in that
-- state — the exact people whose curation the 0071/0077 work was for.
--
-- During the 0083 backfill this was left alone on the grounds that matching a
-- post to a visit by timestamp is a guess, and a wrong guess retracts somebody
-- else's dinner. That was the right call then and the objection is answered
-- now by measuring rather than assuming. A dry run over the live data:
--
--   unlinked=30  with_place_id=30  unique_match=30  ambiguous=0
--
-- Every post matches exactly one visit and every matched visit has exactly one
-- post, so there is nothing to guess between. The match requires all four of:
-- same user, same google_place_id, the post written within two minutes of the
-- visit row (the emitter runs immediately after the insert), and the visit not
-- already claimed by another post.
--
-- The uniqueness requirement is enforced in the statement, not just observed in
-- the dry run: a post with two candidate visits, or a visit with two candidate
-- posts, is skipped and stays unlinked. If the data ever stops being this
-- clean, this does less rather than something wrong.
-- ============================================================================

with cand as (
  select e.id as event_id, v.id as visit_id
    from public.feed_events e
    join public.restaurants r
      on r.google_place_id = e.payload ->> 'google_place_id'
    join public.visits v
      on v.user_id = e.user_id
     and v.restaurant_id = r.id
     and abs(extract(epoch from (e.created_at - v.created_at))) < 120
   where e.visit_id is null
     and e.kind::text = 'visit_logged'
     and not exists (select 1 from public.feed_events e2 where e2.visit_id = v.id)
),
unique_pairs as (
  select event_id, visit_id
    from (
      select event_id, visit_id,
             count(*) over (partition by event_id) as per_event,
             count(*) over (partition by visit_id) as per_visit
        from cand
    ) c
   where per_event = 1 and per_visit = 1
)
update public.feed_events e
   set visit_id = u.visit_id
  from unique_pairs u
 where e.id = u.event_id;

do $$
declare
  still_unlinked int;
  duplicated int;
  orphaned int;
begin
  select count(*) into still_unlinked
    from public.feed_events
   where visit_id is null and kind::text = 'visit_logged';

  -- One post per visit. Two would mean somebody's dinner is in the feed twice
  -- and hiding it retracts only one of them.
  select count(*) into duplicated
    from (
      select visit_id from public.feed_events
       where visit_id is not null group by visit_id having count(*) > 1
    ) d;
  if duplicated > 0 then
    raise exception 'linking produced % duplicated visit post(s)', duplicated;
  end if;

  select count(*) into orphaned
    from public.feed_events e
   where e.visit_id is not null
     and not exists (select 1 from public.visits v where v.id = e.visit_id);
  if orphaned > 0 then
    raise exception 'linking produced % post(s) pointing at no visit', orphaned;
  end if;

  raise notice 'legacy feed posts linked; % still unlinked', still_unlinked;
end $$;
