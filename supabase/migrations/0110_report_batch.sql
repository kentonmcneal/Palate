-- ============================================================================
-- 0110_report_batch.sql — the pass-two report's remaining database items.
-- ----------------------------------------------------------------------------
-- 1. A garbage timezone on any profile could break signup for everyone.
--    broadcast_recipients filtered "timezone is not null" but not "resolves";
--    next_sendable_at('Not/AZone') is null (LIVE), send_after is NOT NULL,
--    and the join-push trigger runs inside the signup transaction. Filter on
--    the resolved value, and never let a push enqueue abort the row it fires
--    for.
-- 2. can_view_feed_author and purge_old_location_events were callable by the
--    anon key. Revoked.
-- 3. Five cross-user aggregate views were readable by anon. Revoked from
--    anon; authenticated keeps them (they are deliberate aggregates, so no
--    security_invoker — that would collapse them to one row).
-- 4. analytics_events accepted inserts from the anon key.
-- 5. The enrichment-preserving trigger (0104) did not cover the review text
--    and the raw Google payload — the two things a re-enrichment would have
--    to pay for again.
-- 6. featured_lists_mark_city_active accepted any key from any signed-in
--    user; each key is ~15 Text Searches a week.
-- 7. The Sunday Wrapped cron had the same 5s pg_net timeout 0093 fixed for
--    featured lists. refresh_chain_brands ran once at migration time and was
--    never scheduled.
-- ============================================================================

-- 1a. Only recipients whose timezone actually resolves.
create or replace function public.broadcast_recipients(p_actor uuid)
returns table (id uuid, timezone text)
language sql stable security definer set search_path = public as $$
  select p.id, p.timezone
    from public.profiles p
   where p.id <> p_actor
     and p.push_social_activity
     and p.push_token is not null
     and public.next_sendable_at(p.timezone) is not null
     and coalesce(p.approval_status, 'approved') = 'approved'
     and not exists (
       select 1 from public.blocked_users b
       where (b.blocker_id = p.id and b.blocked_id = p_actor)
          or (b.blocker_id = p_actor and b.blocked_id = p.id)
     );
$$;

-- 1b. The two join-push triggers never abort the profile write.
create or replace function public.enqueue_join_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if coalesce(old.approval_status, '') = 'approved'
     or coalesce(new.approval_status, '') <> 'approved' then
    return new;
  end if;
  if coalesce(new.profile_visibility, 'friends') = 'private' then
    return new;
  end if;
  who := coalesce(new.display_name, new.username, 'Someone new');
  begin
    insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
    select r.id, who || ' joined Palate', 'Say hi and see if your palates match.',
           jsonb_build_object('type', 'user_joined', 'user_id', new.id),
           public.next_sendable_at(r.timezone), 'user_joined:' || new.id::text, now() + interval '3 days'
      from public.broadcast_recipients(new.id) r
    on conflict (user_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'enqueue_join_push: % (signup continues)', sqlerrm;
  end;
  return new;
end $$;

create or replace function public.enqueue_join_push_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if coalesce(new.approval_status, '') <> 'approved' then return new; end if;
  if coalesce(new.profile_visibility, 'friends') = 'private' then return new; end if;
  who := coalesce(new.display_name, new.username, 'Someone new');
  begin
    insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
    select r.id, who || ' joined Palate', 'Say hi and see if your palates match.',
           jsonb_build_object('type', 'user_joined', 'user_id', new.id),
           public.next_sendable_at(r.timezone), 'user_joined:' || new.id::text, now() + interval '3 days'
      from public.broadcast_recipients(new.id) r
    on conflict (user_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'enqueue_join_push_on_insert: % (signup continues)', sqlerrm;
  end;
  return new;
end $$;

-- 1c. Comeback: same resolved-timezone guard.
create or replace function public.enqueue_comeback_pushes()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  insert into public.push_outbox (user_id, title, body, data, send_after, dedupe_key, expires_at)
  select p.id, 'You have not been back to ' || fav.name,
    case when fav.last_at >= now() - interval '45 days'
      then 'Not since ' || to_char(fav.last_at, 'FMDay') || '. ' || fav.n || ' visits and counting.'
      else 'Not since ' || to_char(fav.last_at, 'FMMonth') || '. ' || fav.n || ' visits and counting.' end,
    jsonb_build_object('type', 'comeback', 'place_id', fav.google_place_id),
    public.next_sendable_at(p.timezone), 'comeback:' || to_char(now(), 'IYYY-IW'), now() + interval '1 day'
  from public.profiles p
  join lateral (
    select r.name, r.google_place_id, count(*)::int as n, max(v.visited_at) as last_at
      from public.visits v join public.restaurants r on r.id = v.restaurant_id
     where v.user_id = p.id
       and not exists (select 1 from public.place_dislikes d where d.user_id = p.id and d.google_place_id = r.google_place_id)
     group by r.id, r.name, r.google_place_id
     order by count(*) desc, max(v.visited_at) desc limit 1
  ) fav on true
  where p.push_token is not null
    and public.next_sendable_at(p.timezone) is not null
    and coalesce(p.approval_status, 'approved') = 'approved'
    and (select count(*) from public.visits v where v.user_id = p.id) >= 3
    and not exists (select 1 from public.visits v where v.user_id = p.id and v.visited_at >= now() - interval '5 days')
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.enqueue_comeback_pushes() from public, anon, authenticated;

-- 2. Anonymous callers.
revoke all on function public.can_view_feed_author(uuid) from public, anon;
revoke all on function public.purge_old_location_events() from public, anon, authenticated;

-- 3. Aggregate views: signed-in only.
revoke select on public.population_palate_counts, public.population_city_palate_counts,
               public.population_total, public.menu_item_summary, public.my_referral_stats
  from anon, public;
grant select on public.population_palate_counts, public.population_city_palate_counts,
              public.population_total, public.menu_item_summary, public.my_referral_stats
  to authenticated;

-- 4. analytics_events: signed-in, own rows only.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where tablename = 'analytics_events' and cmd = 'INSERT' loop
    execute format('drop policy if exists %I on public.analytics_events', r.policyname);
  end loop;
end $$;
create policy "analytics_events: own insert"
  on public.analytics_events for insert to authenticated
  with check (user_id = auth.uid());

-- 5. Preserve paid text and the raw payload too.
create or replace function public.restaurants_preserve_enrichment()
returns trigger language plpgsql as $$
begin
  new.cuisine_type      := coalesce(new.cuisine_type, old.cuisine_type);
  new.cuisine_region    := coalesce(new.cuisine_region, old.cuisine_region);
  new.cuisine_subregion := coalesce(new.cuisine_subregion, old.cuisine_subregion);
  new.cultural_context  := coalesce(new.cultural_context, old.cultural_context);
  new.vibe              := coalesce(new.vibe, old.vibe);
  new.menu_style        := coalesce(new.menu_style, old.menu_style);
  new.price_feel        := coalesce(new.price_feel, old.price_feel);
  new.ambiance_notes    := coalesce(new.ambiance_notes, old.ambiance_notes);
  new.llm_backfill_at   := coalesce(new.llm_backfill_at, old.llm_backfill_at);
  new.editorial_summary := coalesce(new.editorial_summary, old.editorial_summary);
  new.editorial_blurb   := coalesce(new.editorial_blurb, old.editorial_blurb);
  new.editorial_blurb_generated_at := coalesce(new.editorial_blurb_generated_at, old.editorial_blurb_generated_at);
  new.reviews_refreshed_at := coalesce(new.reviews_refreshed_at, old.reviews_refreshed_at);
  new.google_raw        := coalesce(new.google_raw, old.google_raw);
  if new.review_snippets is null or cardinality(new.review_snippets) = 0 then new.review_snippets := old.review_snippets; end if;
  if new.tags          is null or cardinality(new.tags)          = 0 then new.tags          := old.tags;          end if;
  if new.occasion_tags is null or cardinality(new.occasion_tags) = 0 then new.occasion_tags := old.occasion_tags; end if;
  if new.flavor_tags   is null or cardinality(new.flavor_tags)   = 0 then new.flavor_tags   := old.flavor_tags;   end if;
  if new.crowd_energy  is null or cardinality(new.crowd_energy)  = 0 then new.crowd_energy  := old.crowd_energy;  end if;
  if new.classification_confidence is null then new.classification_confidence := old.classification_confidence; end if;
  return new;
end $$;

-- 6. A city is a gps cell near the caller, or one the app already knows.
create or replace function public.featured_lists_mark_city_active(
  p_city_key text, p_city_label text, p_lat double precision, p_lng double precision
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if p_city_key like 'gps:%' then
    if p_city_key !~ '^gps:-?[0-9]+\.[0-9],-?[0-9]+\.[0-9]$' then return; end if;
  elsif not exists (select 1 from public.featured_lists_active_cities c where c.city_key = p_city_key)
    and not exists (select 1 from public.featured_lists_cache c where c.city_key = p_city_key) then
    return;
  end if;
  insert into public.featured_lists_active_cities (city_key, city_label, city_lat, city_lng)
  values (p_city_key, p_city_label, p_lat, p_lng)
  on conflict (city_key) do update set last_seen_at = now(), city_label = excluded.city_label;
end $$;

-- 7. Crons.
select cron.alter_job(jobid, command := regexp_replace(command, $re$body := '\{\}'(::jsonb)?$re$, $rp$body := '{}'::jsonb, timeout_milliseconds := 60000$rp$))
  from cron.job where jobname = 'palate_sunday_wrapped' and command not like '%timeout_milliseconds%';
select cron.unschedule(jobid) from cron.job where jobname = 'refresh_chain_brands_weekly';
select cron.schedule('refresh_chain_brands_weekly', '0 3 * * 0', 'select public.refresh_chain_brands();');

do $$
declare n int;
begin
  if (select count(*) from public.broadcast_recipients('00000000-0000-0000-0000-000000000000'::uuid)) < 0 then null; end if;
  if not exists (select 1 from cron.job where jobname = 'palate_sunday_wrapped' and command like '%timeout_milliseconds%') then
    raise exception '0110: sunday cron did not take the timeout';
  end if;
  raise notice '0110 applied';
end $$;
