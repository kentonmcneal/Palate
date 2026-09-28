-- ============================================================================
-- 0180 — where your friends are, at city grain.
-- ----------------------------------------------------------------------------
-- Two users: one in Newport News who is often in DC, one in Philadelphia who
-- spent two months in NYC and is regularly back in Maryland. "Which of my
-- people are in which city lately" is a question this product can already
-- answer from data it has, and currently doesn't.
--
-- COSTS NOTHING. City is derived from addressComponents that are ALREADY
-- STORED in restaurants.google_raw — paid for once, on a Details call that has
-- already happened. A reverse-geocode would be a new Google SKU and a new
-- recurring spend line; after the $300 in September that is not a trade worth
-- making for a convenience column. Nothing here calls Google.
--
-- PRIVACY: THIS REVEALS STRICTLY LESS THAN THE FEED ALREADY DOES.
-- Friends can already see each other's individual visits, restaurant by
-- restaurant, with timestamps. This is an aggregate of the same rows, coarsened
-- in four directions, so it needs no new consent surface — it is a narrower
-- view of data these two people already share:
--
--   * MUTUAL FOLLOW ONLY. are_friends(), the same gate the friends-only
--     profile uses. Following someone is never a way into a private life.
--   * PRIVATE PROFILES EXCLUDED, matching 0171. A private account joins
--     quietly and stays quiet.
--   * CITY, NEVER THE RESTAURANT. No restaurant id, name or coordinate is
--     returned. You learn someone is in Philadelphia, not where they had lunch.
--   * TWO VISITS MINIMUM, and the month rather than the timestamp. One meal
--     never puts anybody anywhere: a single outing in a city the person does
--     not otherwise frequent is exactly the observation worth not making.
-- ============================================================================

alter table public.restaurants
  add column if not exists city   text,
  add column if not exists region text;

comment on column public.restaurants.city is
  'Locality, derived from the addressComponents already stored in google_raw. Never fetched separately — see 0180.';
comment on column public.restaurants.region is
  'admin_area_level_1 (state) short form, so Portland OR and Portland ME are distinguishable.';

-- ---- backfill, from data already bought ------------------------------------
-- google_raw holds the addressComponents array (places-proxy:704).
with parsed as (
  select r.id,
         (select c->>'longText'  from jsonb_array_elements(r.google_raw) c
           where c->'types' ? 'locality' limit 1) as city,
         (select c->>'shortText' from jsonb_array_elements(r.google_raw) c
           where c->'types' ? 'administrative_area_level_1' limit 1) as region
    from public.restaurants r
   where r.google_raw is not null
     and jsonb_typeof(r.google_raw) = 'array'
)
update public.restaurants r
   set city = coalesce(p.city, r.city), region = coalesce(p.region, r.region)
  from parsed p
 where p.id = r.id and (p.city is not null or p.region is not null);

-- Fallback for rows with no stored components: "123 Main St, Philadelphia, PA
-- 19104, USA" — city is third from the end, region the first token of second
-- from the end. Coarse, free, and only applied where nothing better exists.
with split as (
  select id, string_to_array(address, ',') as parts
    from public.restaurants
   where city is null and address is not null
)
update public.restaurants r
   set city   = nullif(btrim(s.parts[array_length(s.parts, 1) - 2]), ''),
       region = nullif(split_part(btrim(s.parts[array_length(s.parts, 1) - 1]), ' ', 1), '')
  from split s
 where s.id = r.id and array_length(s.parts, 1) >= 3;

create index if not exists restaurants_city_idx
  on public.restaurants (city) where city is not null;

-- ---- the query -------------------------------------------------------------
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

revoke all     on function public.friends_cities(integer) from public, anon;
grant  execute on function public.friends_cities(integer) to authenticated;

comment on function public.friends_cities(integer) is
  'Cities a mutual friend has eaten in recently, 2+ visits, month grain, no restaurant identity. Private profiles excluded. See 0180.';

-- ---- proofs ----------------------------------------------------------------
do $$
declare def text; ret text; n int; filled int;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'friends_cities';
  if def is null then raise exception '0180: friends_cities was not created'; end if;

  -- Each privacy gate must be present in the body, not merely intended.
  if def !~ 'are_friends' then
    raise exception '0180: MUTUAL-FOLLOW gate missing — following someone would expose their cities';
  end if;
  if def !~ '<> ''private''' then
    raise exception '0180: private-profile gate missing (0171 regression)';
  end if;
  if def !~ 'having count\(\*\) >= 2' then
    raise exception '0180: the 2-visit floor is missing — one meal would pinpoint somebody';
  end if;
  if def !~ 'date_trunc\(''month''' then
    raise exception '0180: timestamps are not coarsened to the month';
  end if;
  -- No restaurant identity may LEAVE this function. Checked against the
  -- declared RETURN SIGNATURE, not the body: nothing can escape a function
  -- except through its return type, and the body legitimately mentions
  -- restaurant_id in its join. A first draft of this grepped the whole body
  -- and failed on `join restaurants r on r.id = v.restaurant_id` — a join
  -- condition is not an output, and the assertion was wrong, not the function.
  select pg_get_function_result(p.oid) into ret
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'friends_cities';
  if ret ~* 'restaurant|latitude|longitude|place_id|visited_at' then
    raise exception '0180: a restaurant identifier or timestamp is in the return type: %', ret;
  end if;
  if ret !~* 'city' then
    raise exception '0180: the return type has no city column';
  end if;

  -- Executable: with no auth.uid() (as here), it must return nothing at all.
  select count(*) into n from public.friends_cities(90);
  if n <> 0 then
    raise exception '0180: returned % rows to an unauthenticated caller', n;
  end if;

  if has_function_privilege('anon', 'public.friends_cities(integer)', 'execute') then
    raise exception '0180: anon can execute friends_cities';
  end if;

  select count(*) into filled from public.restaurants where city is not null;
  raise notice '0180: city populated on % rows, no Google calls made; friends_cities gated and silent when unauthenticated', filled;
end $$;
