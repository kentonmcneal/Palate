-- The backfill runs as the service role and must be able to read its own
-- ledger to enforce the cap. 0153 revoked the helper from public/anon/
-- authenticated, which is right, but a cap the enforcing process cannot read
-- is not a cap.
grant execute on function public.llm_spend_total_usd(text) to service_role;
grant all on public.llm_spend to service_role;
grant usage, select on sequence public.llm_spend_id_seq to service_role;
