/* All SQL is local. SQL statements autocommit to exercise lost replies AFTER commit.
 * HTTP/auth/clock are mocks; no real fetch or credentials enter the VM.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const ts=createRequire(path.join(root,'mobile/package.json'))('typescript');
const notices=[],db=new PGlite({onNotice:n=>notices.push(n.message)}),results=[];
const file=n=>fs.readFileSync(path.join(root,n),'utf8');
const migration=file('supabase/migrations/0179_budget_in_dollars_not_calls.sql');
const helper=file('supabase/functions/_shared/google-spend.ts');
const newFn=migration.match(/create or replace function public\.bump_google_spend[\s\S]*?\$\$;/)[0];
const exec=s=>db.exec(s),rows=async(s,p)=>(await db.query(s,p)).rows,scalar=async s=>Object.values((await rows(s))[0])[0];
const day='2026-09-29',next='2026-09-30';
const bump=async(micros,cap=1000000,d=day)=>(await rows('select * from bump_google_spend($1::date,$2::integer,$3::bigint)',[d,micros,cap]))[0];
const meter=async(d=day)=>(await rows('select * from google_usage_counter where day=$1::date',[d]))[0];
const seed=async(spend,extra='')=>exec(`reset role;insert into google_usage_counter(day,spend_micros${extra?', '+extra.split('=')[0]:''}) values('${day}',${spend}${extra?', '+extra.split('=')[1]:''});set role service_role;`);
async function deny(f,code='42501'){let err;try{await f();}catch(e){err=e;}assert.equal(err?.code,code,err?.message||'unexpected success');}
async function test(name,f){await exec('reset role;drop trigger if exists fail_budget on google_usage_counter;truncate google_usage_counter;set role service_role;');try{await f();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);}}
function harness(o={}){
 const fetched=[],alerts=[],attempts=[],reads=[],errors=[],events=[];let clock=o.time||day+'T23:59:59.000Z',rpcIndex=0;
 class Clock extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return new Date(clock).getTime();}}
 const admin={from(table){assert.equal(table,'google_usage_counter');let d;
  return{select(){return this;},eq(key,value){assert.equal(key,'day');d=value;reads.push(d);return this;},async maybeSingle(){
   events.push('read');if(o.readError)return{data:null,error:{message:'injected read failure'}};
   try{const r=await rows('select tripped,spend_micros from google_usage_counter where day=$1::date',[d]);if(o.afterReadTime)clock=o.afterReadTime;return{data:o.staleRead?null:r[0]||null,error:null};}catch(e){return{data:null,error:{message:e.message}};}
  }};},async rpc(name,args){assert.equal(name,'bump_google_spend');attempts.push(args);events.push('reserve');const i=rpcIndex++;
   if(o.failBefore?.includes(i))return{data:null,error:{message:'not submitted'}};
   let r;try{r=await bump(args.p_micros,args.p_cap_micros,args.p_day);}catch(e){return{data:null,error:{message:e.message}};}
   if(o.afterRpcTime)clock=o.afterRpcTime;
   if(o.lostReply?.includes(i)){events.push('committed-lost-reply');return{data:null,error:{message:'response lost after commit'}};}
   if(o.malformed?.includes(i))return{data:{},error:null};
   events.push('confirmed');return{data:[r],error:null};
  }};
 const exports={};vm.runInNewContext(ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
  exports,Date:Clock,console:{error:(...x)=>errors.push(x)},Deno:{env:{get:key=>key==='GOOGLE_DAILY_BUDGET_USD'?(o.budget??'1'):key==='ALERT_PUSH_TOKEN'?'fake-token':'offline-fixture'}},
  require(name){assert.equal(name,'https://esm.sh/@supabase/supabase-js@2');return{createClient:()=>admin};},
  async fetch(url,init){if(url==='https://exp.host/--/api/v2/push/send'){alerts.push(JSON.parse(init.body));return{status:200};}assert.equal(url,'https://google.fixture.invalid');events.push('fetch');fetched.push(url);if(o.fetchThrows)throw Error('synthetic network throw');return{status:o.httpStatus||200};}
 });
 return{api:exports,fetched,alerts,attempts,reads,errors,events,spend:sku=>exports.spendGoogle({sku:sku||'details_enterprise_atmosphere',url:'https://google.fixture.invalid'})};
}
(async()=>{
 await exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public to anon,authenticated,service_role;');
 await exec(file('supabase/migrations/0033_cost_controls.sql'));
 await exec('grant select,insert,update,delete on google_usage_counter to anon,authenticated,service_role;revoke all on function bump_google_usage(date,integer) from public,anon,authenticated;');
 await exec(migration); // Executes full ORIGINAL migration, including embedded DO self-tests.
 assert.equal(Number(await scalar("select count(*) from google_usage_counter where day='2999-01-01'")),0);
 results.push({name:'Original full 0179 migration including embedded self-tests executes and cleans probe row',pass:true});
 console.log('PASS Original full 0179 migration including embedded self-tests');
 await test('SQL: exact own totals, warning at 80%, trip at cap, flags once',async()=>{let warns=0,trips=0;for(let i=1;i<=6;i++){const r=await bump(200000);assert.equal(r.new_spend_micros,i*200000);assert.equal(r.new_count,i);warns+=+r.crossed_warn;trips+=+r.crossed_trip;}assert.equal(warns,1);assert.equal(trips,1);assert.equal((await meter()).tripped,true);});
 await test('SQL: mixed SKU costs retain integer micro-dollar weighting',async()=>{await bump(5000);const r=await bump(25000);assert.equal(r.new_spend_micros,30000);assert.equal(r.new_count,2);});
 await test('SQL: RPC itself reserves past cap; caller must reject returned total',async()=>{const r=await bump(25000,17000);assert.equal(r.new_spend_micros,25000);assert.equal(r.crossed_trip,true);assert.equal((await meter()).spend_micros,25000);});
 await test('SQL: separate caller-supplied days reset totals and alert flags',async()=>{await bump(1000000);const r=await bump(25000,1000000,next);assert.equal(r.new_spend_micros,25000);assert.equal(r.new_count,1);assert.equal(r.crossed_trip,false);assert.equal((await meter()).spend_micros,1000000);});
 await test('SQL: zero, negative and null micros cost zero but increment count',async()=>{for(const m of [0,-25,null]){const r=await bump(m);assert.equal(r.new_spend_micros,0);}assert.equal((await meter()).billable_calls,3);});
 await test('SQL: lowered cap already over 80% does not emit retroactive warning',async()=>{await bump(500000);const r=await bump(1,600000);assert.equal(r.crossed_warn,false);assert.equal(r.crossed_trip,false);assert.equal((await meter()).warned,false);});
 await test('SQL: lowered cap can trip immediately; raising cap does not clear latch',async()=>{await bump(500000);let r=await bump(1,400000);assert.equal(r.crossed_trip,true);r=await bump(1,1000000);assert.equal(r.crossed_trip,false);assert.equal((await meter()).tripped,true);});
 await test('SQL: invalid null cap returns unknown flags; raw RPC is not input validation',async()=>{const r=await bump(25000,null);assert.equal(r.crossed_warn,null);assert.equal(r.crossed_trip,null);assert.equal(r.new_spend_micros,25000);});
 await test('SQL: zero/negative cap still reserves and trips; helper must disable first',async()=>{assert.equal((await bump(1,0)).crossed_trip,true);assert.equal((await bump(1,-1,next)).crossed_trip,true);});
 await test('SQL: huge cap multiplication overflow rolls back whole statement',async()=>{await deny(()=>bump(25000,'9223372036854775807'),'22003');assert.equal(await meter(),undefined);});
 await test('SQL: count overflow rolls back spend increment',async()=>{await seed(25000,'billable_calls=2147483647');await deny(()=>bump(25000),'22003');assert.equal((await meter()).spend_micros,25000);});
 await test('SQL: null day fails before reservation',async()=>{await deny(()=>bump(25000,1000000,null),'23502');assert.equal(await meter(),undefined);});
 await test('SQL: anon/authenticated cannot invoke RPC or mutate/read RLS rows',async()=>{await bump(25000);for(const role of ['anon','authenticated']){await exec(`set role ${role}`);await deny(()=>bump(25000));assert.equal(Number(await scalar('select count(*) from google_usage_counter')),0);await deny(()=>exec(`insert into google_usage_counter(day) values('${next}')`));}await exec('set role service_role');assert.equal((await meter()).spend_micros,25000);});
 await test('HELPER+SQL: exact cap reservation fetches once; subsequent preflight refuses',async()=>{const h=harness({budget:'0.025'});assert.equal((await h.spend()).status,200);assert.equal(await h.spend(),null);assert.equal(h.fetched.length,1);assert.equal(h.attempts.length,1);assert.deepEqual(h.events.slice(0,4),['read','reserve','confirmed','fetch']);assert.equal(h.alerts.length,2);});
 await test('HELPER+SQL: stale preflight over-cap reservation never fetches',async()=>{await seed(900000);const h=harness({staleRead:true});const r=await h.spend();assert.ok(r,JSON.stringify(h.errors));assert.equal(r.status,200); // 925000 fits
 await bump(60000);assert.equal(await h.spend(),null);assert.equal(h.fetched.length,1);assert.equal((await meter()).spend_micros,1010000);});
 await test('HELPER+SQL: committed lost reply retries reservation but fetches only once',async()=>{const h=harness({lostReply:[0]});await h.spend();assert.equal((await meter()).spend_micros,50000);assert.equal((await meter()).billable_calls,2);assert.equal(h.attempts.length,2);assert.equal(h.fetched.length,1);});
 await test('HELPER+SQL: both replies lost retain two committed reservations, no fetch',async()=>{const h=harness({lostReply:[0,1]});assert.equal(await h.spend(),null);assert.equal((await meter()).spend_micros,50000);assert.equal(h.fetched.length,0);});
 await test('HELPER+SQL: lost fitting reservation then over-cap retry refuses fetch',async()=>{const h=harness({budget:'0.025',lostReply:[0]});assert.equal(await h.spend(),null);assert.equal((await meter()).spend_micros,50000);assert.equal(h.fetched.length,0);assert.equal(h.alerts.length,0);});
 await test('HELPER+SQL: malformed replies after commit never authorize fetch',async()=>{const h=harness({malformed:[0,1]});assert.equal(await h.spend(),null);assert.equal((await meter()).spend_micros,50000);assert.equal(h.fetched.length,0);});
 await test('HELPER+SQL: failure before SQL then successful retry reserves once',async()=>{const h=harness({failBefore:[0]});await h.spend();assert.equal((await meter()).spend_micros,25000);assert.equal(h.fetched.length,1);});
 await test('HELPER+SQL: actual database exception rolls back both retries and no fetch',async()=>{await exec("reset role;create or replace function reject_budget_update() returns trigger language plpgsql as $$begin raise exception 'fixture database failure';end$$;create trigger fail_budget before update on google_usage_counter for each row execute function reject_budget_update();set role service_role;");const h=harness();assert.equal(await h.spend(),null);assert.equal(await meter(),undefined);assert.equal(h.attempts.length,2);assert.equal(h.fetched.length,0);});
 await test('HELPER+SQL: network throw retains committed reservation',async()=>{const h=harness({fetchThrows:true});await assert.rejects(()=>h.spend(),/synthetic/);assert.equal((await meter()).spend_micros,25000);assert.equal(h.fetched.length,1);});
 await test('HELPER+SQL: HTTP failure returned once with reservation retained',async()=>{const h=harness({httpStatus:503});assert.equal((await h.spend()).status,503);assert.equal((await meter()).spend_micros,25000);assert.equal(h.fetched.length,1);});
 await test('HELPER+SQL: read failure refuses before reservation',async()=>{const h=harness({readError:true});assert.equal(await h.spend(),null);assert.equal(await meter(),undefined);assert.equal(h.attempts.length,0);});
 await test('HELPER+SQL: retry crossing midnight keeps original admission day',async()=>{const h=harness({lostReply:[0],afterRpcTime:next+'T00:00:00.100Z'});await h.spend();assert.deepEqual(h.attempts.map(x=>x.p_day),[day,day]);assert.equal((await meter(day)).spend_micros,50000);assert.equal(await meter(next),undefined);assert.equal(h.fetched.length,1);});
 await test('HELPER+SQL: midnight after preflight attributes reservation to new day',async()=>{const h=harness({afterReadTime:next+'T00:00:00.100Z'});await h.spend();assert.deepEqual(h.reads,[day]);assert.equal(h.attempts[0].p_day,next);assert.equal(await meter(day),undefined);assert.equal((await meter(next)).spend_micros,25000);});
 await test('HELPER+SQL: midnight stale old-day rejection is conservative',async()=>{await bump(1000000);const h=harness({afterReadTime:next+'T00:00:00.100Z'});assert.equal(await h.spend(),null);assert.equal(h.attempts.length,0);assert.equal(await meter(next),undefined);});
 await test('HELPER+SQL: raised config cap remains closed after old trip latch',async()=>{await bump(1000000);const h=harness({budget:'2'});assert.equal(await h.spend(),null);assert.equal(h.attempts.length,0);});
 await test('HELPER+SQL: lowered cap closes without old tripped flag',async()=>{await bump(500000);const h=harness({budget:'0.4'});assert.equal(await h.spend(),null);assert.equal(h.attempts.length,0);});
 await test('HELPER+SQL: zero SKU records count at zero cost, but cannot bypass trip',async()=>{let h=harness();await h.spend('ids_only');assert.equal((await meter()).spend_micros,0);assert.equal((await meter()).billable_calls,1);assert.equal(h.fetched.length,1);await bump(1000000);h=harness();assert.equal(await h.spend('ids_only'),null);assert.equal(h.fetched.length,0);});
 for(const [sku,micros]of [['details_enterprise',20000],['search_text_enterprise',35000],['search_nearby_enterprise',35000],['details_enterprise_atmosphere',25000]])await test(`CURRENT SKU: ${sku} reserves ${micros} through actual SQL`,async()=>{const h=harness();assert.equal((await h.spend(sku)).status,200);assert.equal((await meter()).spend_micros,micros);assert.equal(h.attempts[0].p_micros,micros);assert.equal(h.fetched.length,1);});
 await test('CURRENT SKU: unknown, retired and inherited keys refuse before SQL or fetch',async()=>{const h=harness();for(const sku of ['future_search','details_pro','search_text_pro','search_nearby_pro','toString','__proto__'])assert.equal(await h.spend(sku),null);assert.equal(await meter(),undefined);assert.equal(h.reads.length,0);assert.equal(h.attempts.length,0);assert.equal(h.fetched.length,0);});
 await test('COMPAT: new helper with missing spend RPC fails closed',async()=>{await exec('reset role;drop function bump_google_spend(date,integer,bigint);set role service_role;');try{const h=harness();assert.equal(await h.spend(),null);assert.equal(h.attempts.length,2);assert.equal(h.fetched.length,0);}finally{await exec('reset role;'+newFn+'revoke all on function bump_google_spend(date,integer,bigint) from public,anon,authenticated;grant execute on function bump_google_spend(date,integer,bigint) to service_role;');}});
 await test('COMPAT: pre-0179 counter missing spend column refuses before RPC',async()=>{await exec('reset role;alter table google_usage_counter drop column spend_micros;set role service_role;');try{const h=harness();assert.equal(await h.spend(),null);assert.equal(h.attempts.length,0);assert.equal(h.fetched.length,0);}finally{await exec('reset role;alter table google_usage_counter add column spend_micros bigint not null default 0;');}});
 await test('COMPAT: old call RPC remains callable but does not dollar-meter; flags shared',async()=>{const r=(await rows('select * from bump_google_usage($1::date,1)',[day]))[0];assert.equal(r.crossed_trip,true);assert.equal((await meter()).spend_micros,0);const h=harness();assert.equal(await h.spend(),null);assert.equal(h.fetched.length,0);});
 await test('COMPAT: old RPC consumes one-shot warning and suppresses later dollar warning',async()=>{await rows('select * from bump_google_usage($1::date,2)',[day]);assert.equal((await meter()).warned,true);const r=await bump(800000);assert.equal(r.crossed_warn,false);assert.equal(r.new_count,2);});
 await test('LIMIT: sequential differing cap workers can exceed smaller cap',async()=>{const small=harness({budget:'0.025',staleRead:true}),large=harness({budget:'0.05',staleRead:true});await small.spend();await large.spend();assert.equal(small.fetched.length+large.fetched.length,2);assert.equal((await meter()).spend_micros,50000);});
 await exec('reset role');
 console.log(JSON.stringify({postgres:await scalar('select version()'),sourceHashes:{migration:crypto.createHash('sha256').update(migration).digest('hex'),helper:crypto.createHash('sha256').update(helper).digest('hex')},passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));
 await db.close();if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
