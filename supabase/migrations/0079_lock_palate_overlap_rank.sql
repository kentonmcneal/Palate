-- ============================================================================
-- 0079_lock_palate_overlap_rank.sql — actually revoke the internal helper.
-- ----------------------------------------------------------------------------
-- 0078 said palate_overlap_rank was "NOT granted to authenticated" and revoked
-- it from PUBLIC and from authenticated. Calling it over PostgREST with the
-- anon key still returned 200 and a result set.
--
-- Supabase's `public` schema carries ALTER DEFAULT PRIVILEGES granting EXECUTE
-- on new functions to anon, authenticated and service_role individually. Those
-- are explicit grants to named roles, so `revoke ... from public` does not
-- touch them — PUBLIC is a separate grantee, not an umbrella over the others.
-- The revoke from `authenticated` landed; `anon` was never named.
--
-- This matters because the helper takes a user id as a parameter and answers
-- "who eats like this person". Exposed directly it is an overlap oracle for
-- arbitrary accounts, bypassing every viewer-side check palate_matches applies
-- on top of it. It should be reachable only from palate_matches, which runs as
-- this function's owner.
--
-- The lesson generalises: in this schema, a definer function meant to stay
-- internal must revoke from anon AND authenticated by name, and be verified by
-- calling it — a revoke that does not do what it reads like fails silently.
-- ============================================================================

revoke all on function public.palate_overlap_rank(uuid, integer) from public;
revoke all on function public.palate_overlap_rank(uuid, integer) from anon;
revoke all on function public.palate_overlap_rank(uuid, integer) from authenticated;
