-- ============================================================================
-- 0127 — stop recommending restaurants that have closed down.
-- ----------------------------------------------------------------------------
-- `business_status` appeared NOWHERE in this repo: no field mask asked for it,
-- no column held it, nothing filtered on it. So the app could confidently send
-- somebody to a restaurant that shut months ago, and there was no mechanism by
-- which it would ever find out.
--
-- Google returns it on the same responses we already pay for — it sits in the
-- field-mask tier the nearby and details calls already use — so capturing it
-- costs nothing. Deliberately NOT backfilling: a pass over the catalogue would
-- be a paid run and that is the founder's call.
--
-- Values: OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY, or null when
-- Google did not say. Null is not closed, and the gate must never treat it as
-- closed — most of the catalogue is null today and will be until rows refresh.
-- ============================================================================

alter table public.restaurants
  add column if not exists business_status text;

create index if not exists restaurants_business_status_idx
  on public.restaurants (business_status)
  where business_status is not null;

-- The preserve trigger from 0104 keeps a known value when a cheap upsert omits
-- it. coalesce(new, old) is the right semantics here in BOTH directions: a
-- fresh CLOSED_PERMANENTLY overwrites a stale OPERATIONAL, and a null from a
-- call that did not ask for the field cannot erase what we know.
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
  new.business_status   := coalesce(new.business_status, old.business_status);
  if new.occasion_tags is null or cardinality(new.occasion_tags) = 0 then new.occasion_tags := old.occasion_tags; end if;
  if new.flavor_tags   is null or cardinality(new.flavor_tags)   = 0 then new.flavor_tags   := old.flavor_tags;   end if;
  if new.crowd_energy  is null or cardinality(new.crowd_energy)  = 0 then new.crowd_energy  := old.crowd_energy;  end if;
  return new;
end $$;

-- Server-side surfaces gate too, so a closed place cannot reach a client that
-- has not updated. Null still passes.
create or replace function public.restaurants_near(
  p_lat double precision, p_lng double precision,
  p_radius_m integer default 5000, p_limit integer default 150,
  p_recommendable_only boolean default true
)
returns setof public.restaurants
language sql stable security definer set search_path = public
as $$
  with box as (
    select p_lat - (p_radius_m / 111320.0) as min_lat, p_lat + (p_radius_m / 111320.0) as max_lat,
           p_lng - (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as min_lng,
           p_lng + (p_radius_m / (111320.0 * greatest(0.01, cos(radians(p_lat))))) as max_lng
  )
  select r.*
    from public.restaurants r, box b
   where auth.uid() is not null
     and r.latitude between b.min_lat and b.max_lat
     and r.longitude between b.min_lng and b.max_lng
     and (not p_recommendable_only or coalesce(r.recommendation_eligibility, 1) > 0)
     -- A permanently closed restaurant is never a recommendation. It IS still
     -- a valid answer for passive capture, which is asking where somebody was
     -- last Tuesday, so this rides with the recommendable gate rather than
     -- being unconditional.
     and (not p_recommendable_only or coalesce(r.business_status, 'OPERATIONAL') <> 'CLOSED_PERMANENTLY')
   order by
     ((r.latitude - p_lat) * (r.latitude - p_lat))
     + ((r.longitude - p_lng) * (r.longitude - p_lng) * cos(radians(p_lat)) * cos(radians(p_lat)))
   limit greatest(1, least(p_limit, 300));
$$;
revoke all on function public.restaurants_near(double precision, double precision, integer, integer, boolean) from public, anon;
grant execute on function public.restaurants_near(double precision, double precision, integer, integer, boolean) to authenticated;

-- ---- proofs --------------------------------------------------------------
do $$
declare kenton uuid; victim record; n int;
begin
  select id into kenton from public.profiles where display_name = 'Kenton M';
  if kenton is null then
    raise notice '0127: fresh database — data proofs skipped';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', kenton::text)::text, true);

  -- Almost everything is null today. Null must behave exactly as it did
  -- before, or this migration quietly empties the app.
  select count(*) into n from public.restaurants where business_status is not null;
  raise notice '0127: rows with a known business_status: % (backfill is the founder''s call)', n;

  select count(*) into n from public.restaurants_near(35.098, -89.841, 3000, 200);
  if n = 0 then raise exception '0127: the gate emptied the recommendable pool'; end if;
  raise notice '0127: recommendable near Memphis: %', n;

  -- Mark one row closed and prove it disappears from recommendations but not
  -- from the passive path, then put it back.
  select google_place_id, business_status into victim
    from public.restaurants
   where coalesce(recommendation_eligibility,1) > 0
     and latitude between 35.098-0.02 and 35.098+0.02
     and longitude between -89.841-0.02 and -89.841+0.02
   limit 1;

  if victim is null then
    raise notice '0127: no nearby row to test the gate against';
  else
    update public.restaurants set business_status = 'CLOSED_PERMANENTLY'
     where google_place_id = victim.google_place_id;

    select count(*) into n from public.restaurants_near(35.098, -89.841, 3000, 300)
     where google_place_id = victim.google_place_id;
    if n <> 0 then
      update public.restaurants set business_status = victim.business_status
       where google_place_id = victim.google_place_id;
      raise exception '0127: a CLOSED_PERMANENTLY row was still recommended';
    end if;

    select count(*) into n from public.restaurants_near(35.098, -89.841, 3000, 300, false)
     where google_place_id = victim.google_place_id;
    if n <> 1 then
      update public.restaurants set business_status = victim.business_status
       where google_place_id = victim.google_place_id;
      raise exception '0127: passive capture lost a closed venue it should still resolve';
    end if;

    update public.restaurants set business_status = victim.business_status
     where google_place_id = victim.google_place_id;
    raise notice '0127: closed venue hidden from recommendations, still resolvable by passive capture';
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
