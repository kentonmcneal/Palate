-- SCRATCH ADDENDUM ONLY: apply after llm-admission-draft.sql in offline review.
-- Not an active/numbered migration. Does not enable policy or release capacity.
begin;
create function public.confirm_llm_v1(
 p_id uuid,p_action text,p_hash text,p_profile text,p_model text,p_max_tokens integer,
 p_admitted_at_ms bigint,p_expires_at_ms bigint,p_reserved_micros bigint
) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 -- This read must be a NEW HTTP request/transaction after reserve returns.
 -- Calling it inside the reservation transaction does not establish commit.
 if current_setting('transaction_isolation') <> 'read committed' then return false; end if;
 return exists (
   select 1 from llm_budget_private.reservation r
   where r.id=p_id and r.action=p_action and r.request_hash=p_hash
     and r.profile=p_profile and r.model=p_model and r.max_tokens=p_max_tokens
     and r.reserved_micros=p_reserved_micros and p_reserved_micros=720000
     and floor(extract(epoch from r.admitted_at)*1000)=p_admitted_at_ms
     and floor(extract(epoch from r.expires_at)*1000)=p_expires_at_ms
     and r.expires_at>clock_timestamp() and r.outcome is null
 );
end $$;
revoke all on function public.confirm_llm_v1(uuid,text,text,text,text,integer,bigint,bigint,bigint)
 from public,anon,authenticated,service_role;
grant execute on function public.confirm_llm_v1(uuid,text,text,text,text,integer,bigint,bigint,bigint)
 to service_role;
commit;
