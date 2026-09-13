-- ============================================================================
-- 0149 — how many notifications are waiting.
-- ----------------------------------------------------------------------------
-- push_outbox is service-role only (0055) and correctly so: it holds the text
-- of every pending notification for every user. But the admin screen's whole
-- job is answering "is this working", and the honest answer to that while
-- server_push is off is a number -- rows are accumulating, nothing is being
-- sent, and both of those are the intended behaviour.
--
-- So: a COUNT, and nothing else. No bodies, no recipients, no titles. The
-- table stays unreadable; only its size is visible, and only to an admin.
-- ============================================================================
create or replace function public.admin_queued_push_count()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    -- Not an error: a non-admin asking is answered with "nothing to see",
    -- which is also true from where they are standing.
    return 0;
  end if;
  select count(*)::int into n from public.push_outbox where sent_at is null;
  return n;
end;
$$;

revoke all on function public.admin_queued_push_count() from public, anon;
grant execute on function public.admin_queued_push_count() to authenticated;
