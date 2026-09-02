-- ============================================================================
-- 0067_gmail_token_plaintext_nullable.sql
-- ----------------------------------------------------------------------------
-- 0066 stopped writing gmail_tokens.refresh_token and started writing the
-- encrypted column instead. The plaintext column is NOT NULL, so the very first
-- encrypted write failed:
--
--   null value in column "refresh_token" violates not-null constraint
--
-- Caught by the round-trip check the work was supposed to end with, before any
-- real token existed — which is the entire argument for doing that check.
--
-- Relaxing the constraint rather than dropping the column: dropping it would
-- break the currently-deployed function the instant this applies, and the
-- column's retirement belongs in a later, deliberate step once the encrypted
-- path has run in production.
-- ============================================================================

alter table public.gmail_tokens
  alter column refresh_token drop not null;
