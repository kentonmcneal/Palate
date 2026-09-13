-- ============================================================================
-- 0150 — server push on.
-- ----------------------------------------------------------------------------
-- Turned on at the founder's explicit instruction on 2026-09-13, after
-- checking what it would actually deliver: 27 rows queued, 16 of them already
-- past their expiry and so marked expired rather than sent, leaving at most
-- TWO live notifications for any one person. Not a pile-up.
--
-- Recorded as a migration rather than done by hand so there is a dated,
-- reviewable note of when the app started messaging people unprompted, and
-- what was known at the time. Reversible from Profile -> Admin, which is the
-- normal control; this is not a new mechanism, only the first flip.
-- ============================================================================
update public.feature_flags
   set enabled = true
 where key = 'server_push';

do $$
declare v boolean;
begin
  select enabled into v from public.feature_flags where key = 'server_push';
  if not coalesce(v, false) then
    raise exception 'server_push did not flip -- the flag row is missing or unwritable';
  end if;
  raise notice 'server_push is ON';
end $$;
