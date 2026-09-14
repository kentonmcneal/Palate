-- ============================================================================
-- 0167 — stop the storage API handing out your user list.
-- ----------------------------------------------------------------------------
-- Proved over real HTTP with the anon key that ships inside the binary, with
-- no session at all:
--
--   POST /storage/v1/object/list/avatars  ->  [{"name":"5e2afc49-…"},
--                                              {"name":"c766a8ba-…"}]
--
-- Those names are user UUIDs. So an unauthenticated stranger can enumerate the
-- people who use this app, and then fetch each of their photographs from the
-- public object route. Meanwhile the published privacy policy says profile and
-- meal photos "live in access-controlled storage", which is false as written.
--
-- The cause is `avatars: public read` / `visit-photos: public read`: SELECT
-- granted to {public} with `using (bucket_id = '…')`, i.e. the whole bucket to
-- everyone. Object READS on a public bucket bypass RLS entirely, so that
-- policy was never what made images load — it only ever enabled listing.
--
-- TWO BUCKETS, TWO ANSWERS, because their risk is not the same:
--
--   avatars — stays a public bucket. A profile picture served by URL is
--     ordinary, every image in the app keeps working, and no client change is
--     needed. Listing is closed, so the user list stops being downloadable.
--
--   visit-photos — becomes PRIVATE. A photograph of your dinner, with a place
--     and a time attached, is not a profile picture. It is EMPTY today (0
--     objects), so this costs nothing now and cannot be done cheaply later.
--     Reads move to signed URLs; the client ships alongside.
-- ============================================================================

-- ---- 1. avatars: readable by URL, not listable ----------------------------
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 2. visit-photos: private, owner-only --------------------------------
update storage.buckets set public = false where id = 'visit-photos';

drop policy if exists "visit-photos: public read" on storage.objects;
create policy "visit-photos: owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- 3. assert it, both directions ---------------------------------------
do $$
declare n int; is_pub boolean;
begin
  select public into is_pub from storage.buckets where id = 'visit-photos';
  if is_pub then raise exception 'visit-photos is still a public bucket'; end if;

  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
     and 'public' = any(roles)
     and (qual like '%avatars%' or qual like '%visit-photos%');
  if n > 0 then
    raise exception 'a photo bucket still grants SELECT to public: % policies', n;
  end if;

  -- The owner clause must be present on both, or "private" means "private
  -- from nobody".
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
     and qual like '%foldername%' and qual like '%auth.uid()%'
     and (qual like '%avatars%' or qual like '%visit-photos%');
  if n < 2 then
    raise exception 'expected owner-scoped SELECT on both photo buckets, found %', n;
  end if;

  raise notice 'photo buckets are no longer enumerable; visit-photos is private';
end $$;
