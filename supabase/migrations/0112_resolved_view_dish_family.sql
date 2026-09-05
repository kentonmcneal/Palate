-- ============================================================================
-- 0112_resolved_view_dish_family.sql — the view was frozen before dish_family.
-- ----------------------------------------------------------------------------
-- restaurants_resolved was created in 0027 as `select r.*, …`. Postgres
-- expands `r.*` once, at creation, so the column list is frozen: dish_family
-- (0099) is not in it. LIVE: 0 rows in information_schema for that column.
--
-- That view is what places-proxy serves on a nearby CACHE HIT — which is most
-- requests — and what Discover's search panel and group-recs read. So the
-- candidate pool never carried a dish family, every dish chip found nothing
-- in it, and the app fell through to the catalogue on every single tap.
--
-- `create or replace` cannot do it: the new columns land mid-list and Postgres
-- refuses to rename existing ones. Drop and recreate. Verified first that
-- nothing depends on the view — no views, no functions — and grants are
-- restored explicitly afterwards (select only; the blanket insert/update/
-- delete Supabase adds by default were never used, and a view nobody writes
-- through should not offer it).
-- ============================================================================
drop view if exists public.restaurants_resolved;

create view public.restaurants_resolved as
select
  r.*,
  coalesce(o_cuisine.value,    r.cuisine_type)      as resolved_cuisine_type,
  coalesce(o_subregion.value,  r.cuisine_subregion) as resolved_cuisine_subregion,
  coalesce(o_region.value,     r.cuisine_region)    as resolved_cuisine_region,
  coalesce(o_format.value,     r.format_class)      as resolved_format_class,
  coalesce(o_chain.value,      r.chain_type)        as resolved_chain_type
from public.restaurants r
left join public.restaurant_overrides o_cuisine
  on o_cuisine.restaurant_id = r.id and o_cuisine.field = 'cuisine_type'
left join public.restaurant_overrides o_subregion
  on o_subregion.restaurant_id = r.id and o_subregion.field = 'cuisine_subregion'
left join public.restaurant_overrides o_region
  on o_region.restaurant_id = r.id and o_region.field = 'cuisine_region'
left join public.restaurant_overrides o_format
  on o_format.restaurant_id = r.id and o_format.field = 'format_class'
left join public.restaurant_overrides o_chain
  on o_chain.restaurant_id = r.id and o_chain.field = 'chain_type';

grant select on public.restaurants_resolved to anon, authenticated, service_role;

do $$
declare n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'restaurants_resolved' and column_name = 'dish_family') then
    raise exception '0112: the view still has no dish_family';
  end if;
  select count(*) into n from public.restaurants_resolved
   where dish_family is not null and cardinality(dish_family) > 0;
  raise notice '0112: view carries dish_family on % rows', n;
end $$;
