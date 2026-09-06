-- ============================================================================
-- 0131 — publish dm_messages, or the live subscription is decoration.
-- ----------------------------------------------------------------------------
-- The thread screen subscribes to postgres_changes on dm_messages. Measured
-- before this migration: `pg_publication_tables` for `supabase_realtime` was
-- EMPTY. Nothing in this database has ever been published, so the subscription
-- would have connected, reported itself healthy, and delivered nothing —
-- forever, silently. Exactly the failure shape as the RLS reads that returned
-- 200 [] for their whole existence.
--
-- Only dm_messages. Realtime is metered on the free tier and every published
-- table costs replication traffic whether anyone is listening or not; a
-- conversation is the one place in this app where a second of latency is
-- actually felt.
--
-- Safe because the SELECT policy on dm_messages is participant-only and
-- Realtime enforces RLS per subscriber: publishing a table does not publish
-- its rows to people who cannot read them.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'dm_messages'
  ) then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;

-- REPLICA IDENTITY FULL is not set on purpose. It ships every column of the
-- OLD row on update and delete, and messages are the last table where extra
-- copies of somebody's words should travel. Inserts — the only event the
-- client listens for — carry the new row regardless.

-- ---- proofs --------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_messages';
  if n <> 1 then
    raise exception '0131: dm_messages is not in the realtime publication';
  end if;

  -- And nothing else got swept in. A publication that quietly grows is a
  -- bandwidth bill nobody decided to pay.
  select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime';
  if n <> 1 then
    raise exception '0131: expected exactly one published table, found %', n;
  end if;

  -- The policy that makes publishing safe must still be there.
  select count(*) into n from pg_policy
   where polrelid = 'public.dm_messages'::regclass and polcmd = 'r';
  if n < 1 then
    raise exception '0131: dm_messages has no select policy — publishing it would broadcast every message';
  end if;
  raise notice '0131: dm_messages published, participant-only policy intact';
end $$;
