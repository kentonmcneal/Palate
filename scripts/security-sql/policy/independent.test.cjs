// Offline SQL review: no Supabase client, HTTP, credentials, or repo writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(process.argv[2]);
const candidate=__dirname;
const sql=fs.readFileSync(path.join(candidate,'google-budget-policy.sql'),'utf8');
const db=new PGlite(); let passed=0;
const exec=s=>db.exec(s), rows=async(s,p)=>(await db.query(s,p)).rows;
async function deny(s,code='42501'){await assert.rejects(()=>exec(s),e=>e.code===code);}
async function test(name,f){await exec('reset role');await f();passed++;console.log('PASS',name);}
const call="select * from public.bump_google_spend('2026-09-29',1,50000)";
(async()=>{
 await exec('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;');
 for(const n of ['0033_cost_controls.sql','0179_budget_in_dollars_not_calls.sql'])await exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations',n),'utf8'));
 const before=(await rows("select oid,prosrc,proowner,proargtypes::text,proallargtypes::text,proargnames,proconfig,prosecdef from pg_proc where oid='public.bump_google_spend(date,integer,bigint)'::regprocedure"))[0];
 // Supabase-style explicit default grants must be removed, not just PUBLIC.
 await exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
 await exec(sql);
 await test('internal retains exact OID/body/owner/signature/config/security mode',async()=>{
 const after=(await rows("select oid,prosrc,proowner,proargtypes::text,proallargtypes::text,proargnames,proconfig,prosecdef from pg_proc where oid='public.reserve_google_spend_internal(date,integer,bigint)'::regprocedure"))[0];assert.deepEqual(after,before);
 });
 await test('zero default denies even exact zero and creates no counter',async()=>{await exec('set role service_role');await deny("select * from public.bump_google_spend('2026-09-29',0,0)");await exec('reset role');assert.equal((await rows('select count(*)::int n from google_usage_counter'))[0].n,0);});
 await test('all table privileges and internal execution revoked despite explicit defaults',async()=>{
 for(const role of ['anon','authenticated','service_role']){
 for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.equal((await rows('select has_table_privilege($1,$2,$3) ok',[role,'public.google_spend_policy',privilege]))[0].ok,false,role+privilege);
 assert.equal((await rows('select has_function_privilege($1,$2,\'EXECUTE\') ok',[role,'public.reserve_google_spend_internal(date,integer,bigint)']))[0].ok,false);
 }
 });
 await test('only service role public RPC; named roles and inherited PUBLIC cannot invoke',async()=>{
 await exec('create role stranger;grant usage on schema public to stranger;');
 for(const r of ['anon','authenticated','stranger']){await exec(`set role ${r}`);await deny(call);await deny("select * from public.reserve_google_spend_internal('2026-09-29',1,50000)");await exec('reset role');}
 await exec('update google_spend_policy set daily_cap_micros=50000;set role service_role');assert.equal((await rows(call))[0].new_count,1);
 });
 await test('missing row disables and no new reservation occurs',async()=>{await exec('delete from google_spend_policy;set role service_role');await deny(call);await exec('reset role');assert.equal((await rows('select billable_calls from google_usage_counter'))[0].billable_calls,1);await exec('insert into google_spend_policy values(true,50000)');});
 await test('null day/cost and negative cost reject without mutation',async()=>{await exec('set role service_role');for(const args of ["null,1,50000","'2026-09-29',null,50000","'2026-09-29',-1,50000"])await deny(`select * from public.bump_google_spend(${args})`,'22023');});
 await test('null/lower/higher cap rejects without mutation',async()=>{await exec('set role service_role');for(const cap of ['null','49999','50001'])await deny(`select * from public.bump_google_spend('2026-09-29',1,${cap})`);await exec('reset role');assert.equal((await rows('select billable_calls from google_usage_counter'))[0].billable_calls,1);});
 await test('temporary policy and counter cannot shadow qualified protected tables',async()=>{await exec('create temp table google_spend_policy(singleton boolean,daily_cap_micros bigint);insert into pg_temp.google_spend_policy values(true,123);create temp table google_usage_counter(day date);set role service_role');await deny("select * from public.bump_google_spend('2026-09-29',1,123)");assert.equal((await rows(call))[0].new_count,2);await exec('reset role;drop table pg_temp.google_spend_policy;drop table pg_temp.google_usage_counter;');});
 await test('policy share relation lock held until rollback; reservation rolls back too',async()=>{await exec('begin;set local role service_role');await rows(call);const locks=await rows("select mode from pg_locks where relation='public.google_spend_policy'::regclass and granted");assert(locks.some(x=>x.mode==='RowShareLock'));await exec('rollback');assert.equal((await rows('select billable_calls from google_usage_counter'))[0].billable_calls,2);assert.equal((await rows("select count(*)::int n from pg_locks where relation='public.google_spend_policy'::regclass and mode='RowShareLock'"))[0].n,0);});
 await test('safe integer maximum policy executes without threshold overflow',async()=>{await exec('update google_spend_policy set daily_cap_micros=9007199254740991;set role service_role');assert.equal((await rows("select * from public.bump_google_spend('2026-09-30',2147483647,9007199254740991)"))[0].new_count,1);});
 await test('duplicate migration fails atomically with working guard retained',async()=>{await deny(sql,'42P07');await exec('rollback;set role service_role');await deny(call);});
 console.log(JSON.stringify({passed,postgres:(await rows('select version() v'))[0].v,multisession:false}));
 await db.close();
})().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
