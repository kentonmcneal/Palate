-- ============================================================================
-- 0046_approve_pending_waitlist.sql
-- ----------------------------------------------------------------------------
-- One-off admin action (founder request, 2026-08-07): approve everyone
-- currently on the waitlist so no early tester is stuck on the gate. Flips
-- approval_status 'pending' -> 'approved'; the waitlist gate drops for them on
-- next app launch. Reversible from Settings -> Admin -> Waitlist approvals.
-- ============================================================================

do $$
declare
  n integer;
begin
  update public.profiles
     set approval_status = 'approved'
   where approval_status = 'pending';
  get diagnostics n = row_count;
  raise notice 'approved % pending waitlist user(s)', n;
end$$;
