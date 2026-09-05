-- ============================================================================
-- 0104_review_security_batch.sql — what the code review found, verified LIVE.
-- ----------------------------------------------------------------------------
-- Each item below was proven with the anon key or by invoking the function
-- before it was written here.
-- ============================================================================

-- 1. feed_events answered the anon key with rows: who ate where, to anyone
--    with the public key. A RESTRICTIVE policy ANDs with the existing ones.
drop policy if exists "feed_events: signed in only" on public.feed_events;
create policy "feed_events: signed in only"
  on public.feed_events as restrictive for select
  using (auth.uid() is not null);

-- 2. The featured-lists cache view served the whole paid Google cache to anon.
revoke select on public.featured_lists_for_city from anon;
revoke select on public.featured_lists_for_city from public;
grant select on public.featured_lists_for_city to authenticated;

-- 3. Any signed-in user could insert or update any restaurant row. The client
--    never writes this table; places-proxy and the crons use the service role.
drop policy if exists "restaurants: authed insert" on public.restaurants;
drop policy if exists "restaurants: authed update" on public.restaurants;

-- 4. The friendships UPDATE policy let the addressee rewrite requester_id and
--    forge an accepted friendship with anyone. Parties are immutable now.
create or replace function public.friendships_parties_immutable()
returns trigger language plpgsql as $$
begin
  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
    raise exception 'friendship parties cannot change' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists friendships_parties_immutable on public.friendships;
create trigger friendships_parties_immutable
  before update on public.friendships
  for each row execute function public.friendships_parties_immutable();
drop policy if exists "friendships: addressee update" on public.friendships;
create policy "friendships: addressee update"
  on public.friendships for update
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

-- 5. gmail_connection_status raised 42702 on every call (LIVE, anon curl):
--    "email" and "last_scanned_at" are both OUT params and columns. The Gmail
--    screen has never had a working status. Same fix as 0075.
create or replace function public.gmail_connection_status()
returns table (connected boolean, email text, last_scanned_at timestamptz, imported_count int)
language plpgsql stable security definer set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query
  select
    exists(select 1 from public.gmail_tokens t where t.user_id = me),
    (select t.email from public.gmail_tokens t where t.user_id = me)::text,
    (select t.last_scanned_at from public.gmail_tokens t where t.user_id = me),
    (select count(*)::int from public.visits v where v.user_id = me and v.import_source = 'gmail');
end;
$$;
revoke all on function public.gmail_connection_status() from public, anon;
grant execute on function public.gmail_connection_status() to authenticated;

-- 6. The kill-switch counters were revoked from PUBLIC only. By name now.
revoke all on function public.bump_google_usage(date, integer) from public, anon, authenticated;
revoke all on function public.record_api_usage(date, text, text) from public, anon, authenticated;

-- 7. Paid enrichment must survive a free upsert. googleToRestaurantRow writes
--    every classifier column, nulls included, and nearby/search/featured-lists
--    all upsert through it — so a cuisine the Haiku backfill paid for, or 0097
--    filled from types, was erased the next time the place appeared in a
--    nearby fetch. A null never overwrites a value here. Migrations that mean
--    to null a column must `alter table public.restaurants disable trigger
--    restaurants_preserve_enrichment` first.
alter table public.restaurants add column if not exists llm_backfill_at timestamptz;

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
  if new.occasion_tags is null or cardinality(new.occasion_tags) = 0 then new.occasion_tags := old.occasion_tags; end if;
  if new.flavor_tags   is null or cardinality(new.flavor_tags)   = 0 then new.flavor_tags   := old.flavor_tags;   end if;
  if new.crowd_energy  is null or cardinality(new.crowd_energy)  = 0 then new.crowd_energy  := old.crowd_energy;  end if;
  if new.classification_confidence is null then new.classification_confidence := old.classification_confidence; end if;
  return new;
end $$;
drop trigger if exists restaurants_preserve_enrichment on public.restaurants;
create trigger restaurants_preserve_enrichment
  before update on public.restaurants
  for each row execute function public.restaurants_preserve_enrichment();

-- Proofs.
do $$
declare kenton uuid; mom uuid; r record; n int;
begin
  -- 5: the Gmail status executes its main branch.
  select id into kenton from public.profiles where display_name = 'Kenton M';
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);
  select count(*) into n from public.gmail_connection_status();
  raise notice '0104: gmail_connection_status returned % row(s)', n;

  -- 4: an addressee cannot move a friendship onto somebody else.
  select id into mom from public.profiles where display_name = 'mcldkt';
  perform set_config('request.jwt.claims', json_build_object('sub', mom::text)::text, true);
  -- The live row is mcldkt -> Kenton (requester = mom). Move its addressee
  -- and expect the trigger to refuse. Guard the case where no row exists, or
  -- the proof passes vacuously — which is what the first draft of this did.
  if not exists (select 1 from public.friendships where requester_id = mom) then
    raise exception '0104: no friendship row to test the trigger against';
  end if;
  begin
    update public.friendships set addressee_id = mom where requester_id = mom;
    raise exception '0104: parties were rewritable';
  exception when insufficient_privilege then
    raise notice '0104: friendship parties immutable, as intended';
  end;

  -- 7: a null upsert keeps the cuisine.
  select * into r from public.restaurants where cuisine_type is not null limit 1;
  update public.restaurants set cuisine_type = null where id = r.id;
  if (select cuisine_type from public.restaurants where id = r.id) is null then
    raise exception '0104: preserve trigger let a null through';
  end if;
  raise notice '0104: enrichment preserved on null update';
  perform set_config('request.jwt.claims', null, true);
end $$;
