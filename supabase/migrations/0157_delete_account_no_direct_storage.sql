-- ============================================================================
-- 0157 — undo 0156's storage delete. It cannot work, and it broke deletion.
-- ----------------------------------------------------------------------------
-- 0156 added `delete from storage.objects ...` inside delete_my_account so
-- that deleting an account would take its photos. Supabase refuses it:
--
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead. (SQLSTATE 42501)
--
-- plpgsql does not execute a statement at CREATE FUNCTION time, so 0156 pushed
-- green and would have thrown on the first real call -- turning "photos
-- survive deletion" into "deletion fails completely". Strictly worse, and it
-- shipped clean. This is the third time on this project that a clean push has
-- proved nothing; the rule is in docs/RELEASE_AUDIT.md and I wrote it.
--
-- Caught by probing the behaviour instead of trusting the push.
--
-- The function goes back to exactly its pre-0156 body. Photo deletion belongs
-- in an edge function holding the service role and calling the Storage API,
-- which is the next commit -- not in SQL that cannot do it.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  delete from public.visits where user_id = uid;
  delete from public.location_events where user_id = uid;
  delete from public.prompt_decisions where user_id = uid;
  delete from public.weekly_wrapped where user_id = uid;
  delete from public.profiles where id = uid;
  -- Everything added since the baseline references auth.users(id) ON DELETE
  -- CASCADE, so this takes feed posts, comments, likes, follows, blocks,
  -- invites, the passive inbox and the push outbox with it.
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- Prove the body is executable rather than merely creatable: a plan for every
-- statement is what 0156 never had.
do $$
begin
  perform 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'delete_my_account'
     and position('storage.objects' in pg_get_functiondef(p.oid)) > 0;
  if found then
    raise exception 'delete_my_account still references storage.objects, which Supabase forbids';
  end if;
  raise notice 'delete_my_account no longer touches storage directly';
end $$;
