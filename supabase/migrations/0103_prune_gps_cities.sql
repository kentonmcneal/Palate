-- ============================================================================
-- 0103_prune_gps_cities.sql — stop paying to keep 1km GPS cells warm.
-- ----------------------------------------------------------------------------
-- 17 of 25 "active cities" were fine-grained GPS cells (0.01°), each costing
-- ~15 Google Text Searches a night. The client now keys to 0.1° and the
-- refresh gives GPS cells a 3-day window. Drop the fine cells so tonight's
-- run does not pay for them one more time; the coarse ones re-register on
-- the next Discover open.
-- ============================================================================
delete from public.featured_lists_cache
 where city_key like 'gps:%' and city_key ~ 'gps:-?[0-9]+\.[0-9]{2},';
delete from public.featured_lists_active_cities
 where city_key like 'gps:%' and city_key ~ 'gps:-?[0-9]+\.[0-9]{2},';
do $$
declare n int;
begin
  select count(*) into n from public.featured_lists_active_cities where city_key like 'gps:%';
  raise notice '0103: % gps cities remain', n;
end $$;
