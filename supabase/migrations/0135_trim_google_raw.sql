-- ============================================================================
-- 0135 — trim google_raw to the one key that is not already a column.
-- ----------------------------------------------------------------------------
-- google_raw held Google's whole place object: 796 kB across 749 rows, 14% of
-- the restaurants table. Enumerated live, its keys are types, location,
-- addressComponents, displayName, id, formattedAddress, shortFormattedAddress,
-- primaryType, rating, userRatingCount, priceLevel, regularOpeningHours and
-- businessStatus.
--
-- Every one of those has a dedicated, queryable column on this table EXCEPT
-- addressComponents. So the blob was a second, unindexed copy of data we
-- already had, and the trim is lossless rather than a trade.
--
-- addressComponents stays, and it is the reason the column exists: nothing
-- else can reconstruct a neighbourhood, and 52 rows were measured whose stored
-- `neighborhood` was WORSE than the addressComponents in their own google_raw.
--
-- The trim is GATED on proving that claim per row rather than asserting it:
-- a row is only trimmed when the columns that would replace its keys are
-- actually populated. Anything that fails the check keeps its full blob and is
-- reported, because a row where the column is empty is exactly the row where
-- the raw copy is still doing work.
-- ============================================================================

do $$
declare
  candidates bigint;
  unsafe bigint;
  trimmed bigint;
  before_sz text;
  after_sz text;
begin
  select pg_size_pretty(sum(pg_column_size(google_raw))::bigint) into before_sz
    from public.restaurants where google_raw is not null;

  select count(*) into candidates from public.restaurants where google_raw is not null;

  -- A row is unsafe to trim if the blob carries a key whose replacement column
  -- is null. Those keep everything.
  select count(*) into unsafe from public.restaurants
   where google_raw is not null
     and (
       (google_raw ? 'types'               and types is null)
       or (google_raw ? 'location'            and (latitude is null or longitude is null))
       or (google_raw ? 'displayName'         and name is null)
       or (google_raw ? 'id'                  and google_place_id is null)
       or (google_raw ? 'primaryType'         and primary_type is null)
       or (google_raw ? 'rating'              and rating is null)
       or (google_raw ? 'userRatingCount'     and user_rating_count is null)
       or (google_raw ? 'priceLevel'          and price_level is null)
       or (google_raw ? 'regularOpeningHours' and regular_opening_hours is null)
       or (google_raw ? 'businessStatus'      and business_status is null)
       or ((google_raw ? 'formattedAddress' or google_raw ? 'shortFormattedAddress') and address is null)
     );

  raise notice '0135: % rows carry google_raw (%), % of them are unsafe to trim and keep it',
    candidates, before_sz, unsafe;

  update public.restaurants
     set google_raw = case
       when google_raw ? 'addressComponents'
         then jsonb_build_object('addressComponents', google_raw -> 'addressComponents')
       else null
     end
   where google_raw is not null
     and not (
       (google_raw ? 'types'               and types is null)
       or (google_raw ? 'location'            and (latitude is null or longitude is null))
       or (google_raw ? 'displayName'         and name is null)
       or (google_raw ? 'id'                  and google_place_id is null)
       or (google_raw ? 'primaryType'         and primary_type is null)
       or (google_raw ? 'rating'              and rating is null)
       or (google_raw ? 'userRatingCount'     and user_rating_count is null)
       or (google_raw ? 'priceLevel'          and price_level is null)
       or (google_raw ? 'regularOpeningHours' and regular_opening_hours is null)
       or (google_raw ? 'businessStatus'      and business_status is null)
       or ((google_raw ? 'formattedAddress' or google_raw ? 'shortFormattedAddress') and address is null)
     );
  get diagnostics trimmed = row_count;

  select pg_size_pretty(coalesce(sum(pg_column_size(google_raw)),0)::bigint) into after_sz
    from public.restaurants where google_raw is not null;

  raise notice '0135: trimmed % rows, google_raw % -> %', trimmed, before_sz, after_sz;

  -- The thing this exists to protect must still be there.
  if exists (
    select 1 from public.restaurants
     where google_raw is not null and not (google_raw ? 'addressComponents')
  ) then
    raise exception '0135: a trimmed row lost its addressComponents';
  end if;
end $$;

-- ---- proofs --------------------------------------------------------------
do $$
declare n bigint; sz text;
begin
  -- Nothing may be left holding a key that is not addressComponents, unless it
  -- was deliberately skipped as unsafe.
  select count(*) into n from public.restaurants
   where google_raw is not null
     and exists (
       select 1 from jsonb_object_keys(google_raw) k where k <> 'addressComponents'
     );
  raise notice '0135: % rows retained a full blob (their replacement column was empty)', n;

  select pg_size_pretty(pg_total_relation_size('public.restaurants')) into sz;
  raise notice '0135: restaurants table is now %', sz;

  -- And the catalogue itself is untouched.
  select count(*) into n from public.restaurants;
  if n < 1000 then raise exception '0135: catalogue lost rows (% left)', n; end if;
end $$;
