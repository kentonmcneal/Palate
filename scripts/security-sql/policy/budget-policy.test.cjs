// Actual PGlite SQL plus the unchanged real helper, offline-only transport.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const { PGlite } = require(process.argv[2]);
const ts = require(path.join(root, 'mobile/node_modules/typescript'));
const db = new PGlite(), cases = [];
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const helper = read('supabase/functions/_shared/google-spend.ts');
const policy = fs.readFileSync(path.join(__dirname, 'google-budget-policy.sql'), 'utf8');
const day = '2026-09-29';
const exec = sql => db.exec(sql);
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const meter = async () => (await rows('select * from google_usage_counter where day=$1::date', [day]))[0];
const bump = (cost, cap) => rows('select * from bump_google_spend($1::date,$2::integer,$3::bigint)', [day, cost, cap]);
async function expectError(f, code) { let e;try { await f(); } catch (err) { e=err; } assert.equal(e?.code, code, e?.message || 'unexpected success'); }
async function configure(cap) {
  await exec(`reset role; update google_spend_policy set daily_cap_micros=${cap}; truncate google_usage_counter; set role service_role;`);
}
async function test(name, f) {
  try { await configure(50000); await f(); cases.push({name,pass:true}); console.log('PASS',name); }
  catch(e) { cases.push({name,pass:false,error:e.message}); console.error('FAIL',name,e); }
}
function worker(cap, opts={}) {
  const fetches=[], attempts=[], notices=[];let index=0;
  class Clock extends Date { constructor(...args) { super(...(args.length?args:[day+'T12:00:00Z'])); } }
  const admin={from(table) {
    assert.equal(table,'google_usage_counter');
    return {select(){return this;},eq(){return this;},async maybeSingle(){
      if(opts.readError)return {data:null,error:{message:'offline'}};
      return {data:opts.stale?null:(await meter())||null,error:null};
    }};
  },async rpc(name,args) {
    assert.equal(name,'bump_google_spend');attempts.push(args);const n=index++;
    if(opts.failBefore?.includes(n))return {data:null,error:{message:'not submitted'}};
    let data;try {data=await bump(args.p_micros,args.p_cap_micros);}catch(e){return {data:null,error:{message:e.message}};}
    if(opts.changePolicyAfterFirst && n===0)await exec(`reset role; update google_spend_policy set daily_cap_micros=${opts.changePolicyAfterFirst}; set role service_role;`);
    if(opts.lost?.includes(n))return {data:null,error:{message:'reply lost AFTER commit'}};
    if(opts.malformed?.includes(n))return {data:{},error:null};
    return {data,error:null};
  }};
  const exports={};
  vm.runInNewContext(ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
    exports,Date:Clock,console:{error(){}},Deno:{env:{get:key=>key==='GOOGLE_DAILY_BUDGET_USD'?String(cap/1e6):key==='ALERT_PUSH_TOKEN'?'synthetic-token':'offline-fixture'}},
    require(name){assert.equal(name,'https://esm.sh/@supabase/supabase-js@2');return {createClient:()=>admin};},
    async fetch(url,init){
      if(url==='https://exp.host/--/api/v2/push/send'){notices.push(JSON.parse(init.body));return {status:200};}
      assert.equal(url,'https://google.fixture.invalid');fetches.push(url);
      if(opts.fetchThrows)throw Error('synthetic transport failure');return {status:opts.status||200};
    },
  });
  return {fetches,attempts,notices,spend:(sku='details_enterprise_atmosphere')=>exports.spendGoogle({sku,url:'https://google.fixture.invalid'})};
}
(async()=>{
  await exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await exec(read('supabase/migrations/0033_cost_controls.sql'));
  await exec('grant select,insert,update,delete on google_usage_counter to anon,authenticated,service_role; revoke all on function bump_google_usage(date,integer) from public,anon,authenticated;');
  await exec(read('supabase/migrations/0179_budget_in_dollars_not_calls.sql'));
  // Before: two real helper instances with stale reads exceed the smaller cap.
  await exec('set role service_role');
  const small=worker(25000,{stale:true}),large=worker(50000,{stale:true});
  await small.spend();await large.spend();assert.equal(small.fetches.length+large.fetches.length,2);assert.equal((await meter()).spend_micros,50000);
  console.log('REPRODUCED baseline: 50000 reserved and two fetches despite the smaller 25000 cap.');
  await exec('reset role; truncate google_usage_counter;');
  const original=(await rows("select prosrc from pg_proc where oid='public.bump_google_spend(date,integer,bigint)'::regprocedure"))[0].prosrc;
  await exec(policy);
  assert.equal((await rows("select prosrc from pg_proc where oid='public.reserve_google_spend_internal(date,integer,bigint)'::regprocedure"))[0].prosrc,original);
  await exec('set role service_role');
  const disabled=worker(50000);assert.equal(await disabled.spend(),null);assert.equal(disabled.fetches.length,0);assert.equal(await meter(),undefined);
  console.log('PASS original reservation body preserved; policy defaults disabled.');
  await test('mixed caps: stale high caller cannot reserve or fetch',async()=>{await configure(25000);const a=worker(25000,{stale:true}),b=worker(50000,{stale:true});await a.spend();assert.equal(await b.spend(),null);assert.equal(a.fetches.length,1);assert.equal(b.fetches.length,0);assert.equal((await meter()).spend_micros,25000);});
  await test('mismatched caller refused before any fitting reservation',async()=>{const a=worker(100000);assert.equal(await a.spend(),null);assert.equal(await meter(),undefined);assert.equal(a.attempts.length,2);});
  await test('lower stale caller also fails closed rather than creating a second policy',async()=>{const a=worker(25000);assert.equal(await a.spend(),null);assert.equal(await meter(),undefined);});
  await test('same-cap stale-read burst retains conservative over-cap reservations',async()=>{const ws=Array.from({length:6},()=>worker(50000,{stale:true}));await Promise.all(ws.map(w=>w.spend()));assert.equal(ws.reduce((n,w)=>n+w.fetches.length,0),2);assert.equal((await meter()).spend_micros,150000);});
  await test('warning and trip flags retain original once-only behavior',async()=>{await configure(100000);let warns=0,trips=0;for(let i=0;i<6;i++){const [r]=await bump(20000,100000);warns+=+r.crossed_warn;trips+=+r.crossed_trip;}assert.equal(warns,1);assert.equal(trips,1);});
  await test('one lost committed response reserves twice, fetches once',async()=>{const w=worker(50000,{lost:[0]});await w.spend();assert.equal((await meter()).spend_micros,50000);assert.equal(w.fetches.length,1);});
  await test('two lost committed responses fetch nothing and retain both reservations',async()=>{const w=worker(50000,{lost:[0,1]});assert.equal(await w.spend(),null);assert.equal((await meter()).spend_micros,50000);assert.equal(w.fetches.length,0);});
  await test('lost response with a lowered policy refuses old-cap retry',async()=>{const w=worker(50000,{lost:[0],changePolicyAfterFirst:25000});assert.equal(await w.spend(),null);assert.equal((await meter()).spend_micros,25000);assert.equal(w.fetches.length,0);});
  await test('pre-submit failure then confirmed retry reserves once',async()=>{const w=worker(50000,{failBefore:[0]});await w.spend();assert.equal((await meter()).spend_micros,25000);assert.equal(w.fetches.length,1);});
  await test('malformed replies never authorize a fetch',async()=>{const w=worker(50000,{malformed:[0,1]});assert.equal(await w.spend(),null);assert.equal(w.fetches.length,0);assert.equal((await meter()).spend_micros,50000);});
  await test('HTTP failure is not retried and remains reserved',async()=>{const w=worker(50000,{status:503});assert.equal((await w.spend()).status,503);assert.equal(w.fetches.length,1);assert.equal((await meter()).spend_micros,25000);});
  await test('thrown transport retains reservation',async()=>{const w=worker(50000,{fetchThrows:true});await assert.rejects(w.spend(),/synthetic/);assert.equal(w.fetches.length,1);assert.equal((await meter()).spend_micros,25000);});
  await test('unreadable preflight still refuses before reservation',async()=>{const w=worker(50000,{readError:true});assert.equal(await w.spend(),null);assert.equal(w.attempts.length,0);});
  await test('zero-cost helper SKU cannot bypass policy mismatch',async()=>{const w=worker(100000);assert.equal(await w.spend('ids_only'),null);assert.equal(await meter(),undefined);});
  await test('valid zero-cost SKU preserves free reservation behavior',async()=>{const w=worker(50000);await w.spend('ids_only');assert.equal((await meter()).spend_micros,0);assert.equal(w.fetches.length,1);});
  await test('missing policy row fails closed',async()=>{await exec('reset role; delete from google_spend_policy; set role service_role;');try{const w=worker(50000);assert.equal(await w.spend(),null);assert.equal(await meter(),undefined);}finally{await exec('reset role; insert into google_spend_policy values(true,50000); set role service_role;');}});
  for(const role of ['anon','authenticated','service_role'])await test(`${role} cannot alter policy or bypass the guarded RPC`,async()=>{await exec(`reset role; set role ${role};`);await expectError(()=>exec('update google_spend_policy set daily_cap_micros=100000'), '42501');await expectError(()=>rows('select * from reserve_google_spend_internal($1::date,25000,50000)',[day]),'42501');if(role!=='service_role')await expectError(()=>bump(25000,50000),'42501');});
  await test('null or negative direct RPC inputs fail before counter writes',async()=>{await expectError(()=>bump(null,50000),'22023');await expectError(()=>bump(-1,50000),'22023');await expectError(()=>bump(25000,null),'42501');assert.equal(await meter(),undefined);});
  await test('singleton and policy-range constraints reject invalid operator values',async()=>{await exec('reset role');for(const sql of ['insert into google_spend_policy values(false,50000)','update google_spend_policy set daily_cap_micros=-1','update google_spend_policy set daily_cap_micros=9007199254740992'])await expectError(()=>exec(sql),'23514');});
  console.log(JSON.stringify({passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,cases},null,2));
  await db.close();if(cases.some(x=>!x.pass))process.exitCode=1;
})().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
