-- SCRATCH DESIGN ONLY. Not a numbered/active migration. Defaults authorize $0.
-- Fresh-schema prototype; existing llm_spend is intentionally not repurposed.
begin;
create schema llm_budget_private;
revoke all on schema llm_budget_private from public, anon, authenticated, service_role;
create table llm_budget_private.gate(singleton boolean primary key check(singleton), serial bigint not null default 0);
insert into llm_budget_private.gate values(true,0);
create table llm_budget_private.policy(
 scope text primary key check(scope in ('all','proxy_blurb','proxy_classify','cuisine_backfill')),
 enabled boolean not null default false,
 approved_until timestamptz,
 -- Explicit cutover reconciliation required; absence is NOT guessed zero.
 opening_micros bigint check(opening_micros between 0 and 9007199254740991),
 opening_calls bigint check(opening_calls between 0 and 9007199254740991),
 opening_day date,
 opening_daily_micros bigint check(opening_daily_micros between 0 and 9007199254740991),
 opening_daily_calls bigint check(opening_daily_calls between 0 and 9007199254740991),
 daily_micros bigint not null default 0 check(daily_micros between 0 and 9007199254740991),
 lifetime_micros bigint not null default 0 check(lifetime_micros between 0 and 9007199254740991),
 daily_calls bigint not null default 0 check(daily_calls between 0 and 9007199254740991),
 lifetime_calls bigint not null default 0 check(lifetime_calls between 0 and 9007199254740991)
);
insert into llm_budget_private.policy(scope) values('all'),('proxy_blurb'),('proxy_classify'),('cuisine_backfill');
create table llm_budget_private.reservation(
 id uuid primary key,
 action text not null check(action in ('proxy_blurb','proxy_classify','cuisine_backfill')),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 profile text not null check(profile='haiku45-text-20260929'),
 model text not null check(model='claude-haiku-4-5-20251001'),
 max_tokens integer not null check(max_tokens between 1 and 64000),
 day date not null,
 admitted_at timestamptz not null,
 expires_at timestamptz not null,
 -- Permanent charge against admission capacity, including failures/unknowns.
 reserved_micros bigint not null check(reserved_micros=720000),
 outcome text check(outcome in ('observed','unknown')),
 provider_id text,
 usage jsonb,
 observed_micros bigint,
 settled_at timestamptz
);
create index on llm_budget_private.reservation(day,action);
create unique index on llm_budget_private.reservation(provider_id) where provider_id is not null;
alter table llm_budget_private.gate enable row level security;
alter table llm_budget_private.policy enable row level security;
alter table llm_budget_private.reservation enable row level security;
revoke all on all tables in schema llm_budget_private from public, anon, authenticated, service_role;

create function public.reserve_llm_v1(p_id uuid,p_action text,p_hash text,p_profile text,p_model text,p_max_tokens integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 pol llm_budget_private.policy%rowtype;
 at_time timestamptz; day_utc date; expires timestamptz;
 sc text; dm numeric; lm numeric; dc bigint; lc bigint;
 bound constant bigint := 720000;
begin
 -- Read-committed statement snapshots are part of this prototype's contract.
 if current_setting('transaction_isolation') <> 'read committed' then
   return jsonb_build_object('admitted',false,'reason','unsupported_isolation');
 end if;
 if p_id is null or p_action is null or p_action not in ('proxy_blurb','proxy_classify','cuisine_backfill')
 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
 or p_profile is distinct from 'haiku45-text-20260929'
 or p_model is distinct from 'claude-haiku-4-5-20251001'
 or p_max_tokens is null or p_max_tokens not between 1 and 64000 then
   return jsonb_build_object('admitted',false,'reason','unsupported_request');
 end if;
 -- ALL admission transactions take the same lock before inspecting usage.
 perform 1 from llm_budget_private.gate where singleton for update;
 if not found then return jsonb_build_object('admitted',false,'reason','missing_gate'); end if;
 -- Repeating a committed ID never issues another dispatch permit, even to its owner.
 if exists(select 1 from llm_budget_private.reservation where id=p_id) then
   return jsonb_build_object('admitted',false,'reason','already_reserved');
 end if;
 -- Lock policy in fixed global->action order. No caller-supplied caps or dates.
 foreach sc in array array['all',p_action] loop
   select * into pol from llm_budget_private.policy where scope=sc for share;
   if not found then return jsonb_build_object('admitted',false,'reason','missing_policy'); end if;
   if pol.opening_micros is null or pol.opening_calls is null or pol.opening_day is null
      or pol.opening_daily_micros is null or pol.opening_daily_calls is null
      or not pol.enabled or pol.approved_until is null or pol.approved_until<=clock_timestamp()
      or pol.daily_micros=0 or pol.lifetime_micros=0 or pol.daily_calls=0 or pol.lifetime_calls=0 then
     return jsonb_build_object('admitted',false,'reason','disabled_policy');
   end if;
 end loop;
 -- Recompute time after any lock waits. Admission-day, not provider invoice-day.
 at_time:=clock_timestamp(); day_utc:=(at_time at time zone 'UTC')::date;
 expires:=least(at_time+interval '10 seconds',((day_utc+1)::timestamp at time zone 'UTC'));
 foreach sc in array array['all',p_action] loop
   select * into pol from llm_budget_private.policy where scope=sc;
   if pol.approved_until<=at_time then return jsonb_build_object('admitted',false,'reason','expired_policy'); end if;
   expires:=least(expires,pol.approved_until);
   select coalesce(sum(reserved_micros) filter(where day=day_utc),0),coalesce(sum(reserved_micros),0),
          count(*) filter(where day=day_utc),count(*)
     into dm,lm,dc,lc from llm_budget_private.reservation where sc='all' or action=p_action;
   lm:=lm+pol.opening_micros; lc:=lc+pol.opening_calls;
   if pol.opening_day=day_utc then
     dm:=dm+pol.opening_daily_micros; dc:=dc+pol.opening_daily_calls;
   end if;
   if dm+bound>pol.daily_micros or lm+bound>pol.lifetime_micros
      or dc+1>pol.daily_calls or lc+1>pol.lifetime_calls then
     return jsonb_build_object('admitted',false,'reason','capacity');
   end if;
 end loop;
 insert into llm_budget_private.reservation(id,action,request_hash,profile,model,max_tokens,day,admitted_at,expires_at,reserved_micros)
 values(p_id,p_action,p_hash,p_profile,p_model,p_max_tokens,day_utc,at_time,expires,bound);
 update llm_budget_private.gate set serial=serial+1 where singleton;
 return jsonb_build_object('admitted',true,'id',p_id,'action',p_action,'request_hash',p_hash,
   'profile',p_profile,'model',p_model,'max_tokens',p_max_tokens,'reserved_micros',bound,
   'admitted_at_ms',floor(extract(epoch from at_time)*1000),
   'expires_at_ms',floor(extract(epoch from expires)*1000));
end $$;

-- Settlement is an idempotent observation, NEVER a release/refund of capacity.
-- Only exact repeat evidence is accepted. Unknown outcomes are terminal here;
-- resolving them later requires a separate independently reviewed admin process.
create function public.settle_llm_v1(p_id uuid,p_hash text,p_outcome text,p_provider_id text,p_usage jsonb)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare r llm_budget_private.reservation%rowtype; k text; n numeric;
 inp bigint; outp bigint; cr bigint; cw5 bigint; cw1 bigint; amount bigint;
begin
 if p_id is null or p_hash is null or p_outcome is null or p_outcome not in ('observed','unknown') then return false; end if;
 select * into r from llm_budget_private.reservation where id=p_id for update;
 if not found or r.request_hash<>p_hash then return false; end if;
 if r.outcome is not null then
   return r.outcome=p_outcome and r.provider_id is not distinct from p_provider_id and r.usage is not distinct from p_usage;
 end if;
 if p_outcome='unknown' then
   if p_provider_id is not null or p_usage is not null then return false; end if;
 else
   if p_provider_id is null or p_provider_id !~ '^msg_[A-Za-z0-9_-]{1,180}$'
      or p_usage is null or jsonb_typeof(p_usage)<>'object'
      or (select count(*) from jsonb_object_keys(p_usage))<>5 then return false; end if;
   foreach k in array array['input','output','cache_read','cache_write_5m','cache_write_1h'] loop
     if not p_usage ? k or jsonb_typeof(p_usage->k)<>'number' then return false; end if;
     n:=(p_usage->>k)::numeric;
     if n<0 or n>200000 or trunc(n)<>n then return false; end if;
   end loop;
   inp:=(p_usage->>'input')::bigint; outp:=(p_usage->>'output')::bigint;
   cr:=(p_usage->>'cache_read')::bigint; cw5:=(p_usage->>'cache_write_5m')::bigint; cw1:=(p_usage->>'cache_write_1h')::bigint;
   if inp+cr+cw5+cw1>200000 or outp>r.max_tokens or outp>64000 then return false; end if;
   amount:=ceil(inp+outp*5+cr*0.1+cw5*1.25+cw1*2)::bigint;
   if amount>r.reserved_micros then return false; end if;
 end if;
 update llm_budget_private.reservation set outcome=p_outcome,provider_id=p_provider_id,usage=p_usage,
 observed_micros=amount,settled_at=clock_timestamp() where id=p_id;
 return true;
end $$;
revoke all on function public.reserve_llm_v1(uuid,text,text,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.settle_llm_v1(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.reserve_llm_v1(uuid,text,text,text,text,integer) to service_role;
grant execute on function public.settle_llm_v1(uuid,text,text,text,jsonb) to service_role;
commit;
