-- ============================================================================
-- 0165 — one person's correction is not everybody's truth.
-- ----------------------------------------------------------------------------
-- restaurant_overrides was UNIQUE (restaurant_id, field) with an INSERT policy
-- checking only `auth.uid() = user_id`. Two consequences, both live:
--
--   1. ANY signed-in user could rewrite ANY restaurant's cuisine FOR EVERYONE,
--      permanently, with one tap. The value is read by the detail screen,
--      Discover suggestions, similar-restaurants, group-recs and feed
--      payloads. Not the ranking core -- the scoring functions do no DB reads
--      -- but everything a person SEES.
--
--   2. Worse than first-writer-wins: the app upserts ON CONFLICT, and there
--      is no UPDATE policy, so the moment any row exists for a (restaurant,
--      field) pair the "Wrong cuisine? Tap to fix" control throws 42501 for
--      EVERYONE INCLUDING ITS AUTHOR. Proved: 42501, "new row violates
--      row-level security policy".
--
-- The comment in 0027 says "No update/delete policy -> only the service role
-- can rewrite... Prevents users overwriting each other." The first half is
-- true and the second is the bug: it does not prevent overwriting, it prevents
-- CORRECTING, and the first writer already overwrote everyone.
--
-- There are zero rows today, which is the only reason the cuisine picker
-- shipped this morning appears to work.
--
-- So: corrections become PER PERSON, and the value everyone sees is the one
-- most people chose. A single correction still applies immediately -- with 19
-- users, requiring agreement would mean the feature never does anything -- but
-- a second person disagreeing now counts instead of erroring.
-- ============================================================================

-- ---- 1. one row per person, not per restaurant ----------------------------
alter table public.restaurant_overrides
  drop constraint if exists restaurant_overrides_restaurant_id_field_key;

-- Deduplicate anything that predates this (none today, but the migration must
-- not assume that): keep the earliest correction per person per field.
delete from public.restaurant_overrides a
 using public.restaurant_overrides b
 where a.restaurant_id = b.restaurant_id
   and a.field = b.field
   and a.user_id is not distinct from b.user_id
   and a.ctid > b.ctid;

alter table public.restaurant_overrides
  add constraint restaurant_overrides_one_per_person
  unique (restaurant_id, field, user_id);

-- ---- 2. you may correct your OWN correction -------------------------------
drop policy if exists "overrides own update" on public.restaurant_overrides;
create policy "overrides own update"
  on public.restaurant_overrides for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---- 3. what everyone sees: the value most people chose -------------------
create or replace view public.restaurant_overrides_agreed as
select restaurant_id, field, value, votes
from (
  select
    restaurant_id,
    field,
    value,
    count(*)::int as votes,
    row_number() over (
      partition by restaurant_id, field
      -- Most votes wins; a tie goes to the most recent, because the newer
      -- correction has seen the older one's effect and still disagreed.
      order by count(*) desc, max(created_at) desc
    ) as rn
  from public.restaurant_overrides
  group by restaurant_id, field, value
) ranked
where rn = 1;

revoke all on public.restaurant_overrides_agreed from anon, authenticated;
grant select on public.restaurant_overrides_agreed to anon, authenticated, service_role;

-- ---- 4. the resolved view reads the agreed value --------------------------
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
left join public.restaurant_overrides_agreed o_cuisine
  on o_cuisine.restaurant_id = r.id and o_cuisine.field = 'cuisine_type'
left join public.restaurant_overrides_agreed o_subregion
  on o_subregion.restaurant_id = r.id and o_subregion.field = 'cuisine_subregion'
left join public.restaurant_overrides_agreed o_region
  on o_region.restaurant_id = r.id and o_region.field = 'cuisine_region'
left join public.restaurant_overrides_agreed o_format
  on o_format.restaurant_id = r.id and o_format.field = 'format_class'
left join public.restaurant_overrides_agreed o_chain
  on o_chain.restaurant_id = r.id and o_chain.field = 'chain_type';

-- DROP + CREATE reset the ACL to Supabase's default, which hands anon and
-- authenticated the full write set. That is the mechanism 0155 was written to
-- stop, and this migration would have reopened it.
revoke insert, update, delete, truncate, references on public.restaurants_resolved from anon, authenticated;
grant select on public.restaurants_resolved to anon, authenticated, service_role;

-- ---- 5. the same assertion 0155 installed, re-run here --------------------
do $$
declare bad text := '';
begin
  select coalesce(string_agg(c.oid::regclass::text || ' (' || g.who || ')', ', '), '') into bad
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) g(who)
   where ns.nspname = 'public' and c.relkind = 'v'
     and (has_table_privilege(g.who, c.oid, 'INSERT')
       or has_table_privilege(g.who, c.oid, 'UPDATE')
       or has_table_privilege(g.who, c.oid, 'DELETE'));
  if bad <> '' then
    raise exception 'A view in public is client-writable: %', bad;
  end if;
  raise notice 'overrides are per-person; no view is client-writable';
end $$;
