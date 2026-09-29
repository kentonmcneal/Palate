const {setup,json}=require('./llm-admission/harness.cjs');
const {PGlite}=require('./llm-admission/runtime.cjs').pglite();
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
let passed=0,failed=[];const facts=[];
(async()=>{const db=new PGlite();try{
await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(fs.readFileSync(__dirname+'/llm-admission/llm-admission-draft.sql','utf8'));await db.exec(fs.readFileSync(process.env.CONFIRM_SQL||__dirname+'/llm-admission/CONFIRMATION_DRAFT.sql','utf8'));
const q=(s,p)=>db.query(s,p);
async function reset(){await db.exec(`truncate llm_budget_private.reservation;update llm_budget_private.policy set enabled=true,approved_until=clock_timestamp()+interval '1 hour',daily_micros=2160000,lifetime_micros=2160000,daily_calls=3,lifetime_calls=3,opening_micros=0,opening_calls=0,opening_day=(clock_timestamp() at time zone 'UTC')::date,opening_daily_micros=0,opening_daily_calls=0`);}
async function sqlRpc(n,p){if(n==='reserve_llm_v1')return(await q('select public.reserve_llm_v1($1,$2,$3,$4,$5,$6) r',[p.p_id,p.p_action,p.p_hash,p.p_profile,p.p_model,p.p_max_tokens])).rows[0].r;if(n==='confirm_llm_v1')return(await q('select public.confirm_llm_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[p.p_id,p.p_action,p.p_hash,p.p_profile,p.p_model,p.p_max_tokens,p.p_admitted_at_ms,p.p_expires_at_ms,p.p_reserved_micros])).rows[0].r;if(n==='settle_llm_v1')return(await q('select public.settle_llm_v1($1,$2,$3,$4,$5::jsonb) r',[p.p_id,p.p_hash,p.p_outcome,p.p_provider_id,p.p_usage===null?null:JSON.stringify(p.p_usage)])).rows[0].r;throw Error('Unknown RPC');}
async function rpc(n,p){await db.exec('set role service_role');try{return await sqlRpc(n,p);}finally{await db.exec('reset role');}}
const params=()=>({p_id:randomUUID(),p_action:'proxy_blurb',p_hash:'a'.repeat(64),p_profile:'haiku45-text-20260929',p_model:'claude-haiku-4-5-20251001',p_max_tokens:80});
const cparams=(p,r)=>({...p,p_admitted_at_ms:r.admitted_at_ms,p_expires_at_ms:r.expires_at_ms,p_reserved_micros:r.reserved_micros});
const debit=async()=>(await q('select coalesce(sum(reserved_micros),0)::int total from llm_budget_private.reservation')).rows[0].total;
async function test(name,fn){await reset();try{await fn();passed++;console.log('PASS '+name);}catch(e){failed.push(name);console.error('FAIL '+name+'\n'+e.stack);}}
const google={id:'0',displayName:{text:'Unknown Example'},types:['restaurant'],reviews:[{text:{text:'A friendly and lively place for dinner with very attentive staff'}}]};
const route={proxy_blurb:r=>r.blurb(),proxy_classify:r=>r.details(),cuisine_backfill:r=>r.backfill()};
for(const [action,run]of Object.entries(route)){
 await test(action+' actual entry + service-role SQL positive control',async()=>{const r=setup({rpc,rows:1,syntheticGoogle:google});await run(r);assert.equal(r.state.paid,1);assert.equal(await debit(),720000);assert.deepEqual(r.state.rpc.map(x=>x.name),['reserve_llm_v1','confirm_llm_v1','settle_llm_v1']);for(const x of r.state.rpc){assert.equal(new Headers(x.init.headers).get('authorization'),'Bearer offline-fake');assert.equal(new Headers(x.init.headers).get('prefer'),null);assert.equal(x.init.redirect,'error');assert.equal(x.init.cache,'no-store');}});
 for(const fault of ['missing-404','http-500','empty-204','malformed-json','false','rollback','settled-before-confirm','expired-after-confirm'])await test(action+' raw confirmation fault '+fault,async()=>{
  let late=false;const clock=class extends Date{static now(){return Date.now()+(late?30000:0);}};
  const r=setup({rows:3,syntheticGoogle:google,clock,databaseHTTP:async({name,body})=>{
   if(name==='reserve_llm_v1'&&fault==='rollback'){await db.exec('begin');const data=await rpc(name,body);assert.equal(data.admitted,true);await db.exec('rollback');return json(data);}
   if(name==='confirm_llm_v1'){
    if(fault==='missing-404')return json({message:'missing'},404);
    if(fault==='http-500')return json({error:'synthetic'},500);
    if(fault==='empty-204')return new Response(null,{status:204});
    if(fault==='malformed-json')return new Response('not json',{status:200});
    if(fault==='false')return json(false);
    if(fault==='settled-before-confirm')await rpc('settle_llm_v1',{p_id:body.p_id,p_hash:body.p_hash,p_outcome:'unknown',p_provider_id:null,p_usage:null});
    const result=await rpc(name,body);if(fault==='expired-after-confirm'){assert.equal(result,true);late=true;}return json(result);
   }return json(await rpc(name,body));
  }});
  const result=await run(r);assert.equal(r.state.paid,0);assert.equal(r.state.updates.length,0);assert.equal(r.state.rpc.filter(x=>x.name==='reserve_llm_v1').length,1);assert.equal(r.state.rpc.filter(x=>x.name==='confirm_llm_v1').length,1);assert.equal(await debit(),fault==='rollback'?0:720000);
  if(action==='proxy_blurb'){assert.equal(result.status,200);assert.equal(result.body.blurb,null);assert.equal(result.body.reason,'llm_admission_denied');}
  if(action==='cuisine_backfill'){assert.equal(result.status,200);assert.equal(result.body.failed,1);assert.equal(result.body.processed,1);assert.equal(result.body.admission_denied,true);assert.equal(result.body.written,0);}
 });
}
await test('exact matching expired identity is denied solely by expiration',async()=>{const p=params(),r=await rpc('reserve_llm_v1',p);assert.equal(r.admitted,true);const x=(await q("update llm_budget_private.reservation set admitted_at=clock_timestamp()-interval '20 seconds',expires_at=clock_timestamp()-interval '1 second' returning floor(extract(epoch from admitted_at)*1000)::float8 a,floor(extract(epoch from expires_at)*1000)::float8 e")).rows[0];const c=cparams(p,{...r,admitted_at_ms:x.a,expires_at_ms:x.e});assert.equal(await rpc('confirm_llm_v1',c),false);assert.equal(await debit(),720000);});
for(const field of ['p_id','p_action','p_hash','p_profile','p_model','p_max_tokens','p_admitted_at_ms','p_expires_at_ms','p_reserved_micros'])await test('null confirmation '+field,async()=>{const p=params(),r=await rpc('reserve_llm_v1',p);assert.equal(await rpc('confirm_llm_v1',{...cparams(p,r),[field]:null}),false);assert.equal(await debit(),720000);});
await test('confirmation in read-only new transaction may rollback without refund',async()=>{const p=params(),r=await rpc('reserve_llm_v1',p);await db.exec('begin read only');assert.equal(await rpc('confirm_llm_v1',cparams(p,r)),true);await db.exec('rollback');assert.equal(await debit(),720000);});
for(const [label,row]of [['oversized-name',{name:'x'.repeat(1000100)}],['malformed-types',{types:'restaurant'}]])await test('backfill preflight '+label+' preserves eligibility and stops without spend',async()=>{const r=setup({rpc,rows:3,row});const result=await r.backfill();assert.equal(result.status,200);assert.equal(r.state.paid,0);assert.equal((r.state.rpc||[]).length,0);assert.equal(r.state.updates.length,0);assert.equal(r.state.ledgerHTTP,0);assert.equal(await debit(),0);assert.equal(result.body.processed,1);assert.equal(result.body.failed,1);assert.equal(result.body.written,0);assert.equal(result.body.abstained,0);assert.equal(result.body.accounting_uncertain,true);assert.equal(result.body.admission_denied,false);assert.equal(result.body.persistence_uncertain,false);assert.equal(result.body.remaining_estimate,'unknown');assert(r.rows.every(x=>x.llm_backfill_at===null));facts.push({label,result:result.body,meterHTTP:r.state.meterHTTP,reservations:0,modelCalls:0,restaurantWrites:0});});
await test('oversized blurb preflight does not cache or pay; generic HTTP500 retained',async()=>{const r=setup({rpc,row:{name:'x'.repeat(1000100)}}),result=await r.blurb();assert.equal(result.status,500);assert.equal(r.state.paid,0);assert.equal(r.state.updates.length,0);assert.equal((r.state.rpc||[]).length,0);assert.equal(await debit(),0);facts.push({label:'oversized-blurb',result:result.body,status:result.status});});
await test('unauthorized actual details and cron never reserve',async()=>{const r=setup({rpc,authError:true,syntheticGoogle:google});await r.details();await r.backfill({'x-cron-secret':'wrong'});assert.equal(r.state.paid,0);assert.equal((r.state.rpc||[]).length,0);assert.equal(await debit(),0);});
console.log(JSON.stringify({preflightFacts:facts}));console.log(JSON.stringify({passed,failed,scope:'actual three entry handlers with injected raw HTTP; service-role actual SQL; single-backend only'}));process.exitCode=failed.length?1:0;
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
