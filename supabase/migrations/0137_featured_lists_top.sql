-- ============================================================================
-- 0137 — "Top 10 Burgers" becomes "Top Burgers".
-- ----------------------------------------------------------------------------
-- Not every list has ten. The refresh function writes the new form from now
-- on and the app normalises at read time; this fixes the rows already cached
-- so the two agree.
-- ============================================================================
update public.featured_lists_cache
   set category_title = regexp_replace(category_title, '^Top 10\s*', 'Top ')
 where category_title ~ '^Top 10';

do $$
declare n int;
begin
  select count(*) into n from public.featured_lists_cache where category_title ~ '^Top 10';
  if n <> 0 then raise exception '0137: % cached titles still say Top 10', n; end if;
end $$;
