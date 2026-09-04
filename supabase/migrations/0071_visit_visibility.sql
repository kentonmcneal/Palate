-- ============================================================================
-- 0071_visit_visibility.sql
-- ----------------------------------------------------------------------------
-- Per-visit visibility: the private ledger / public profile split.
--
-- The product thesis is that passive capture feeds a COMPLETE private history
-- — fast casual, coffee, routine meals included — while the user curates what
-- is publicly visible. Recommendations use the complete data; identity uses the
-- curated slice. Until now there was a single `profiles.profile_visibility`
-- toggle governing the whole account, and no per-visit choice at all: a Shake
-- Shack run was either visible to everyone or the entire profile was private.
--
-- DEFAULT IS TRUE ON PURPOSE, and it is a backfill decision, not a product one.
-- Every existing visit was logged under a world where visits were public to
-- friends. Defaulting them to hidden would silently empty people's profiles and
-- feeds the moment this applies. Additive and non-destructive beats tidy.
--
-- What NEW visits should default to is a separate, deliberate choice made in
-- the app at insert time (see defaultVisitVisibility in mobile/lib/visits.ts).
-- The column default only governs rows that do not specify.
-- ============================================================================

alter table public.visits
  add column if not exists is_public boolean not null default true;

comment on column public.visits.is_public is
  'Whether this visit appears on the user''s public/friends profile. The private '
  'ledger is always complete — recommendations read every visit regardless. '
  'Defaults true so existing history is not retroactively hidden.';

-- Partial index: the only queries that filter on this are the public-facing
-- ones, and they always want the visible subset.
create index if not exists visits_user_public_idx
  on public.visits (user_id, visited_at desc)
  where is_public;
