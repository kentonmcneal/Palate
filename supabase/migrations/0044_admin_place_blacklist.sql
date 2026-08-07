-- ============================================================================
-- 0044_admin_place_blacklist.sql
-- ----------------------------------------------------------------------------
-- An admin curation override for the untypeable tail: venues that Google labels
-- as a legitimate food type (e.g. a music venue typed `bar`) and therefore slip
-- past the classifier's primaryType food-gate. An admin can force such a place
-- out of recommendations, and the exclusion is STICKY — the DB pins its
-- eligibility to 0 on every write, so re-classification (which re-scores rows on
-- each nearby fetch) can never revive it. Every recommendation surface already
-- filters `recommendation_eligibility > 0`, so they all inherit this for free.
-- ============================================================================

alter table public.restaurants
  add column if not exists admin_blacklisted boolean not null default false;

-- Pin eligibility whenever the blacklist flag is set. Keyed off NEW (not OLD) so
-- that an explicit un-blacklist (NEW.admin_blacklisted = false) is honored, while
-- any re-classification upsert — which leaves admin_blacklisted untouched, so it
-- retains its previous true value — is forced back to 0.
create or replace function public.enforce_admin_blacklist()
returns trigger
language plpgsql
as $$
begin
  if new.admin_blacklisted then
    new.recommendation_eligibility := 0;
    new.ineligibility_reason := 'admin_blacklisted';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_admin_blacklist on public.restaurants;
create trigger trg_enforce_admin_blacklist
  before insert or update on public.restaurants
  for each row execute function public.enforce_admin_blacklist();

-- Admin: force a place out of (or back into) recommendations by Google place id.
-- Un-blacklisting clears the flag; the row re-scores naturally on its next fetch.
create or replace function public.admin_blacklist_place(gpid text, blacklisted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized';
  end if;
  update public.restaurants
     set admin_blacklisted = blacklisted
   where google_place_id = gpid;
end;
$$;
grant execute on function public.admin_blacklist_place(text, boolean) to authenticated;

-- Admin: list places currently blacklisted, for review/undo. Empty for non-admins.
create or replace function public.admin_list_blacklisted()
returns table (google_place_id text, name text, neighborhood text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    return;
  end if;
  return query
    select r.google_place_id, r.name, r.neighborhood
    from public.restaurants r
    where r.admin_blacklisted
    order by r.name;
end;
$$;
grant execute on function public.admin_list_blacklisted() to authenticated;
