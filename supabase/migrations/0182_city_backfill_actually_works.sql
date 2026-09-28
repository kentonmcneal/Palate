-- ============================================================================
-- 0182 — 0180's city backfill covered 11% of the table. Fixing my own bug.
-- ----------------------------------------------------------------------------
-- Measured after 0180 shipped: city was populated on 685 of 6,344 rows. Two
-- mistakes, both mine, both from assuming the shape of data instead of
-- checking it:
--
--   1. google_raw is NOT a bare addressComponents array. 2,286 rows have it
--      and `jsonb_typeof(google_raw) = 'array'` is true for ZERO of them — the
--      older rows stored the whole place object, so the components are nested
--      under ->'addressComponents'. 0180's guard excluded every single row, so
--      the component path contributed nothing at all.
--   2. The text fallback required >= 3 comma-separated parts. Only 503 of
--      6,344 addresses have that; the rest are "2779 Whitten Rd, Memphis",
--      which is two. Requiring three threw away ~5,800 parseable addresses.
--
-- Still no Google calls: every row already has an address (6,344 of 6,344),
-- and the components are already paid for where they exist.
-- ============================================================================

-- 1. Nested components, wherever google_raw is an object that carries them.
with parsed as (
  select r.id,
         (select c->>'longText'  from jsonb_array_elements(r.google_raw->'addressComponents') c
           where c->'types' ? 'locality' limit 1) as city,
         (select c->>'shortText' from jsonb_array_elements(r.google_raw->'addressComponents') c
           where c->'types' ? 'administrative_area_level_1' limit 1) as region
    from public.restaurants r
   where r.city is null
     and jsonb_typeof(r.google_raw) = 'object'
     and jsonb_typeof(r.google_raw->'addressComponents') = 'array'
)
update public.restaurants r
   set city = coalesce(p.city, r.city), region = coalesce(p.region, r.region)
  from parsed p where p.id = r.id and p.city is not null;

-- 2. A bare array, for any row that ever stored one.
with parsed as (
  select r.id,
         (select c->>'longText'  from jsonb_array_elements(r.google_raw) c
           where c->'types' ? 'locality' limit 1) as city,
         (select c->>'shortText' from jsonb_array_elements(r.google_raw) c
           where c->'types' ? 'administrative_area_level_1' limit 1) as region
    from public.restaurants r
   where r.city is null and jsonb_typeof(r.google_raw) = 'array'
)
update public.restaurants r
   set city = coalesce(p.city, r.city), region = coalesce(p.region, r.region)
  from parsed p where p.id = r.id and p.city is not null;

-- 3. The address text, now handling the two-part form that is the common case.
--    "2779 Whitten Rd, Memphis, TN 38133, USA" -> city 3rd from end, region
--    from the 2nd. "2779 Whitten Rd, Memphis"  -> city is simply the last part.
with split as (
  select id, string_to_array(address, ',') as parts
    from public.restaurants
   where city is null and address is not null
),
picked as (
  select id,
         case when array_length(parts, 1) >= 3
              then nullif(btrim(parts[array_length(parts, 1) - 2]), '')
              else nullif(btrim(parts[array_length(parts, 1)]), '')
         end as city,
         case when array_length(parts, 1) >= 3
              then nullif(split_part(btrim(parts[array_length(parts, 1) - 1]), ' ', 1), '')
              else null
         end as region
    from split
   where array_length(parts, 1) >= 2
)
update public.restaurants r
   set city   = coalesce(p.city, r.city),
       region = coalesce(p.region, r.region)
  from picked p
 where p.id = r.id
   and p.city is not null
   -- A postcode or a country is not a city name.
   and p.city !~ '^[0-9]'
   and lower(p.city) not in ('usa', 'us', 'united states');

-- ---- proofs ----------------------------------------------------------------
-- The coverage target is an ASSERTION, not a notice: a clean apply is the proof
-- that this actually worked, which is precisely what 0180 failed to establish.
do $$
declare total bigint; covered bigint; pct numeric;
begin
  select count(*), count(*) filter (where city is not null) into total, covered
    from public.restaurants;
  pct := round(covered * 100.0 / greatest(1, total), 1);

  if covered < total * 0.5 then
    raise exception '0182: city still only on % of % rows (%%%) — the parse is still wrong',
      covered, total, pct;
  end if;

  raise notice '0182: city on % of % rows (%%%), up from 685', covered, total, pct;
end $$;
