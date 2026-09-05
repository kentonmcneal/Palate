-- ============================================================================
-- 0111_retire_removed_cities.sql — ten cities came off the picker.
-- ----------------------------------------------------------------------------
-- The picker list IS the cost surface: browsing a city registers it in
-- featured_lists_active_cities, and the nightly refresh spends ~15 Google
-- Text Searches per registered city. Austin, Seattle, Denver, Portland, San
-- Diego, Las Vegas, Phoenix, Minneapolis, Detroit and Honolulu were removed
-- from POPULAR_CITIES on 2026-09-05 because nobody in the beta browsed them.
--
-- Only las-vegas had ever registered (last browsed 2026-05-29). Its
-- registration goes so it can never wake the cron again. The CACHE rows stay:
-- they are already paid for, they cost nothing to store, and if a city ever
-- comes back they are a head start rather than a second bill.
-- ============================================================================
delete from public.featured_lists_active_cities
 where city_key in (
   'austin','seattle','denver','portland','san-diego','las-vegas',
   'phoenix','minneapolis','detroit','honolulu'
 );

do $$
declare left_over int; cached int;
begin
  select count(*) into left_over from public.featured_lists_active_cities
   where city_key in ('austin','seattle','denver','portland','san-diego','las-vegas','phoenix','minneapolis','detroit','honolulu');
  if left_over > 0 then raise exception '0111: % removed cities still registered', left_over; end if;
  select count(*) into cached from public.featured_lists_cache
   where city_key in ('austin','seattle','denver','portland','san-diego','las-vegas','phoenix','minneapolis','detroit','honolulu');
  raise notice '0111: registrations cleared, % paid cache rows kept', cached;
end $$;
