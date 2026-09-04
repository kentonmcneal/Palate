-- ============================================================================
-- 0084_review_account_private.sql — take the App Store review account out of
-- the product.
-- ----------------------------------------------------------------------------
-- palate.review1 is the demo login handed to Apple for Beta App Review. 0077
-- opened every profile including this one, and 0083 then backfilled its 18
-- visits into the feed — so the second person eating in everyone's feed was a
-- test account.
--
-- Setting it private is the narrow fix: `can_view_feed_author` (0077) admits
-- 'public' and admits 'friends' to friends, and never admits 'private'. So its
-- posts and profile drop out for everyone else while the account itself keeps
-- working, which is what Apple needs — a reviewer signs in AS this account and
-- sees their own data regardless of visibility.
--
-- KNOWN CONSEQUENCE, and the reason this is its own migration rather than a
-- quiet edit: the feed returns to a single author. The 18 backfilled posts are
-- not deleted — they stay linked to their visits and reappear intact if this is
-- ever reverted. Nothing about the backfill is undone, only who can see it.
--
-- The row records nothing in visibility_before_open_beta: that column belongs
-- to 0077's automatic backfill, and overwriting it here would corrupt the audit
-- trail of a change this one has nothing to do with.
-- ============================================================================

do $$
declare
  changed int;
begin
  update public.profiles
     set profile_visibility = 'private'
   where email = 'palate.review1@gmail.com'
     and profile_visibility <> 'private';
  get diagnostics changed = row_count;

  if changed = 0 then
    raise notice 'palate.review1 was already private, or the email did not match';
  end if;
end $$;
