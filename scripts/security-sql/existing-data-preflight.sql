-- Optional READ-ONLY inventory. NOT executed against any live database.
-- Thread immutability prevents NEW corruption; it does not repair old rows.
select c.id, c.feed_event_id, c.parent_id,
       p.feed_event_id as parent_event_id, p.parent_id as grandparents_id
  from public.feed_comments c
  left join public.feed_comments p on p.id = c.parent_id
 where c.parent_id is not null
   and (p.id is null or p.id = c.id or p.feed_event_id <> c.feed_event_id
        or p.parent_id is not null);

-- Candidate hides these existing forged events; it does not delete them.
select e.id, e.user_id, e.visit_id
  from public.feed_events e join public.visits v on v.id = e.visit_id
 where e.user_id <> v.user_id;
