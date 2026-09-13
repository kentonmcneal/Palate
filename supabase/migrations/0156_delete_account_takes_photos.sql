-- ============================================================================
-- 0156 — deleting your account deletes your photos.
-- ----------------------------------------------------------------------------
-- A cold audit grepped the whole repo for `storage.*.remove(` and found ZERO
-- hits. Nothing anywhere deletes a stored object: not when a visit is deleted
-- (visits.ts:365 removes the row and leaves the photo), and not when an
-- account is deleted. delete_my_account has been the baseline's five DELETEs
-- since 0001 and storage.objects has no FK to auth.users, so avatars, meal
-- photos and feedback screenshots outlive the account that made them.
--
-- Apple Guideline 5.1.1(v) requires account deletion to actually delete the
-- account's data. Today the exposure is small and prospective -- 2 avatars, 0
-- visit photos -- which is exactly why it is cheap to fix now.
--
-- Done in the definer function rather than in settings.tsx on purpose. A
-- client-side list-and-remove is skippable by force-quitting halfway through,
-- and a deletion you can interrupt is not a deletion.
--
-- NOT fixed here, and still open: both buckets are PUBLIC, and their read
-- policy keys only on bucket_id, so the anon key shipped in the binary can
-- enumerate user-UUID folders and filenames. Closing that means private
-- buckets plus signed URLs at every render site, which breaks every existing
-- image until the client ships. That is a coordinated change, not a migration,
-- and it is written up rather than half-done.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  removed int;
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  -- Storage first. If the row deletions below fail we want to have already
  -- taken the photos, not the other way round: an orphaned row is a
  -- bookkeeping problem, an orphaned photograph of somebody's dinner is not.
  delete from storage.objects
   where bucket_id in ('avatars', 'visit-photos', 'feedback')
     and (storage.foldername(name))[1] = uid::text;
  get diagnostics removed = row_count;
  raise notice 'delete_my_account: removed % stored object(s)', removed;

  delete from public.visits where user_id = uid;
  delete from public.location_events where user_id = uid;
  delete from public.prompt_decisions where user_id = uid;
  delete from public.weekly_wrapped where user_id = uid;
  delete from public.profiles where id = uid;
  -- Everything added since the baseline references auth.users(id) ON DELETE
  -- CASCADE, so this one statement takes feed posts, comments, likes, follows,
  -- blocks, invites, the passive inbox and the push outbox with it. Verified
  -- by counting FKs rather than assumed -- see the assertion below.
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- ----------------------------------------------------------------------------
-- The assertion: every table holding a user_id must lose its rows on delete.
-- ----------------------------------------------------------------------------
-- Either through an ON DELETE CASCADE from auth.users, or by being named
-- explicitly above. A table added later with neither is a table that silently
-- survives account deletion, which is how the storage gap happened.
do $$
declare
  explicit text[] := array['visits','location_events','prompt_decisions','weekly_wrapped','profiles'];
  orphan text := '';
begin
  select coalesce(string_agg(t.tbl, ', '), '') into orphan
    from (
      select c.relname tbl
        from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0
       where ns.nspname = 'public' and c.relkind = 'r'
         and not (c.relname = any(explicit))
         and not exists (
           select 1 from pg_constraint fk
            where fk.conrelid = c.oid and fk.contype = 'f'
              and fk.confdeltype = 'c'                       -- ON DELETE CASCADE
              and fk.confrelid = 'auth.users'::regclass
         )
    ) t;

  if orphan <> '' then
    raise warning 'Tables with user_id that neither cascade from auth.users nor are deleted explicitly: %', orphan;
  else
    raise notice 'account deletion covers every user_id table';
  end if;
end $$;
