// Native Node SCRIPT SOURCE_ROOT. Actual handler, Supabase and Anthropic SDKs;
// ALL transport is injected. No credentials, remote fetch, SQL or Google calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname, '../..'),ts=require(repo+'/mobile/node_modules/typescript');
const {createClient}=require(repo+'/mobile/node_modules/@supabase/supabase-js');
const Anthropic=require(repo+'/supabase/eval/node_modules/@anthropic-ai/sdk');
const root=path.resolve(process.argv[2] || repo);
global.fetch=()=>{throw Error('Uninjected live fetch forbidden');};
const json=(x,status=200,headers={})=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json',...headers}});
function setup(o={}){
 const state={paid:0,meterHTTP:0,ledgerHTTP:0,ledger:[],updates:[],logs:[],auth:0,options:[],days:[],daily:o.daily??0};const modules=new Map(),handlers={};
 const rows=Array.from({length:o.rows??2},(_,i)=>({id:String(i),google_place_id:String(i),name:'Unknown Example',types:['restaurant'],cuisine_type:null,review_snippets:['A meal'],llm_backfill_at:null}));
 async function transport(url,init={}){
  const u=new URL(String(url)),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;
  if(u.hostname!=='offline.invalid')throw Error('Unexpected SDK host '+u.hostname);
  if(u.pathname==='/auth/v1/user'){state.auth++;return o.authError?json({message:'Invalid JWT'},401):json({id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid'});}
  if(u.pathname==='/rest/v1/rpc/llm_spend_total_usd')return o.totalError?json({message:'denied',code:'42501'},403):json(Object.hasOwn(o,'total')?o.total:0);
  if(u.pathname==='/rest/v1/rpc/record_api_usage'){
   state.meterHTTP++;state.days.push(body.p_day);if(o.meterThrow)throw Error('synthetic lost meter response');if(o.meterError)return json({message:'permission denied',code:'42501'},403);state.daily++;return new Response(null,{status:204});
  }
  if(u.pathname==='/rest/v1/api_usage_daily')return o.dailyError?json({message:'permission denied',code:'42501'},403):json(Object.hasOwn(o,'dailyRows')?o.dailyRows:[{count:state.daily}]);
  if(u.pathname==='/rest/v1/llm_spend'){
   if(method==='HEAD')return new Response(null,{status:200,headers:o.missingCount?{}:{'content-range':`*/${o.calls??0}`}});
   assert.equal(method,'POST');state.ledgerHTTP++;if(o.ledgerThrow)throw Error('synthetic lost ledger response');if(o.ledgerError)return json({message:'permission denied',code:'42501'},403);state.ledger.push(body);return new Response(null,{status:201});
  }
  if(u.pathname==='/rest/v1/restaurants'){
   if(method==='PATCH'){
    state.updates.push(body);
    if(o.updateThrow)throw Error('synthetic cache/stamp transport lost');
    if(o.updateError || o.updateErrorAfter1&&state.updates.length>1)return json({message:'permission denied',code:'42501'},403);
    if(o.updateZero)return json({message:'JSON object requested, multiple (or no) rows returned',code:'PGRST116',details:'The result contains 0 rows'},406);
    const id=(u.searchParams.get('id')??'eq.0').slice(3);Object.assign(rows.find(r=>r.id===id)||rows[0],body);
    if(o.updateAppliedThenThrow)throw Error('synthetic acknowledgment lost after applied write');
    if(u.searchParams.get('select')==='id')return json({id:o.updateWrongId?'wrong-row':id});
    return new Response(null,{status:204});
   }
   if(method==='HEAD')return new Response(null,{status:200,headers:{'content-range':'*/0'}});
   return json(u.searchParams.has('google_place_id')?[rows[0]]:rows.filter(r=>r.cuisine_type===null&&r.llm_backfill_at===null));
  }
  throw Error('Unexpected database request '+method+' '+u.pathname);
 }
 const supabase=(url,key,opts={})=>createClient(url,key,{...opts,auth:{...opts.auth,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{...opts.global,fetch:transport}});
 class OfflineAnthropic extends Anthropic{
  constructor(opts){state.options.push(opts);super({...opts,fetch:async()=>{
   state.paid++;if(o.modelThrow)throw Error('synthetic model transport lost');if(o.model500)return json({error:{type:'api_error',message:'synthetic'}},500,{'retry-after-ms':'1'});
   return json({id:'msg_synthetic',type:'message',role:'assistant',model:'claude-haiku-4-5-20251001',stop_reason:'end_turn',stop_sequence:null,usage:Object.hasOwn(o,'usage')?o.usage:{input_tokens:1000,output_tokens:100},content:o.content??[{type:'text',text:o.badJSON?'not JSON':o.empty?'':JSON.stringify({cuisine_type:o.abstain?null:'italian',confidence:{cuisine_type:o.abstain?0:.9}})}]});
  }});}
 }
 function load(file){if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);let source=fs.readFileSync(file,'utf8');if(file.endsWith('places-proxy/index.ts'))source+='\nexport {handleBlurb,classifyAndBuildRow};';const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const req=id=>{if(id.startsWith('https://deno'))return {serve:f=>{handlers[file.includes('places-proxy')?'proxy':'backfill']=f;}};if(id.startsWith('https://esm'))return {createClient:supabase};if(id.startsWith('npm:'))return OfflineAnthropic;if(id.includes('google-spend'))return {spendGoogle:()=>{throw Error('Google forbidden');},isGoogleBudgetSpent:()=>{throw Error('Google forbidden');}};if(id.startsWith('.')){let f=path.resolve(path.dirname(file),id);if(!fs.existsSync(f))f=path.resolve(repo+'/supabase/functions/_shared',path.basename(id));return load(f);}throw Error('Unexpected import '+id);};
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{Request,Response,Headers,Date,setTimeout,console:{log(){},error(...a){state.logs.push(a.map(String).join(' '));}},Deno:{env:{get:k=>({ANTHROPIC_API_KEY:'offline-fake',CRON_SECRET:'offline-fake',SUPABASE_URL:'https://offline.invalid',SUPABASE_SERVICE_ROLE_KEY:'offline-fake'})[k]}},fetch:()=>{throw Error('VM fetch forbidden');}})(req,m,m.exports);return m.exports;
 }
 const proxy=load(root+'/supabase/functions/places-proxy/index.ts');load(root+'/supabase/functions/classify-cuisine-backfill/index.ts');
 const admin=supabase('https://offline.invalid','offline-fake');
 return {state,admin,proxy,async backfill(headers={'x-cron-secret':'offline-fake'}){const r=await handlers.backfill(new Request('https://offline.invalid',{method:'POST',headers,body:JSON.stringify({commit:o.commit!==false,limit:o.rows??2})}));return {status:r.status,body:await r.json()};},async blurb(headers={authorization:'Bearer offline-fake'}){const r=await handlers.proxy(new Request('https://offline.invalid',{method:'POST',headers,body:JSON.stringify({action:'blurb',place_id:'0'})}));return {status:r.status,body:await r.json()};}};
}
let passed=0,failed=[];
async function test(name,f){try{await f();passed++;console.log('PASS '+name);}catch(e){failed.push(name);console.error('FAIL '+name+' '+e.stack);}}
(async()=>{
 for(const bad of [false,true,[],[0],' ','\t',{},null,'',-1,'oops'])await test('deny malformed total '+JSON.stringify(bad),async()=>{const r=setup({total:bad});await r.backfill();assert.equal(r.state.paid,0);});
 for(const total of [0,'0','0.001',9.99])await test('accept valid total '+JSON.stringify(total),async()=>{const r=setup({total,rows:1});await r.backfill();assert.equal(r.state.paid,1);});
 for(const kind of ['meterError','meterThrow'])await test(kind+' stops both handlers before model, no write retry',async()=>{const r=setup({[kind]:true});const b=await r.backfill();assert.equal(b.body.accounting_uncertain,true);await r.blurb();assert.equal(r.state.paid,0);assert.equal(r.state.meterHTTP,2);});
 for(const kind of ['ledgerError','ledgerThrow'])await test(kind+' retains uncertainty and stops next call, no ledger retry',async()=>{const r=setup({[kind]:true});const b=await r.backfill();assert.equal(r.state.paid,1);assert.equal(r.state.ledgerHTTP,1);assert.equal(b.body.accounting_uncertain,true);});
 for(const extra of [{badJSON:true},{content:[]},{content:[{type:'tool_use',id:'synthetic',name:'synthetic',input:{}}]}])await test('paid parser failure accounted '+JSON.stringify(extra),async()=>{const r=setup(extra),b=await r.backfill();assert.equal(b.body.failed,2);assert.equal(r.state.ledger.length,2);assert.equal(r.state.ledger[0].est_cost_usd,.0015);assert.equal(b.body.accounting_uncertain,false);});
 for(const usage of [null,{}, {input_tokens:1}, {input_tokens:1,output_tokens:-1},{input_tokens:1.5,output_tokens:1}])await test('invalid usage halts batch '+JSON.stringify(usage),async()=>{const r=setup({usage}),b=await r.backfill();assert.equal(r.state.paid,1);assert.equal(r.state.ledger.length,0);assert.equal(b.body.accounting_uncertain,true);});
 await test('cache token fields survive SDK and are charged independently',async()=>{const r=setup({rows:1,usage:{input_tokens:1000,output_tokens:100,cache_read_input_tokens:2000,cache_creation_input_tokens:3000}});await r.backfill();assert.equal(r.state.ledger[0].est_cost_usd,.00545);});
 for(const kind of ['model500','modelThrow'])await test(kind+' actual Anthropic SDK has one transport attempt',async()=>{const r=setup({[kind]:true}),b=await r.backfill();assert.equal(r.state.paid,1);assert.equal(b.body.accounting_uncertain,true);assert.equal(r.state.ledger.length,0);});
 for(const extra of [{dailyError:true},{totalError:true},{missingCount:true},{dailyRows:[{count:'bad'}]},{dailyRows:[{count:-1}]}])await test('unreadable daily/spend/count denies '+JSON.stringify(extra),async()=>{const r=setup(extra);await r.backfill();assert.equal(r.state.paid,0);});
 await test('missing daily row admits from zero through real maybeSingle',async()=>{const r=setup({dailyRows:[],rows:1});await r.backfill();assert.equal(r.state.paid,1);});
 await test('lifetime last slot stops sequential batch',async()=>{const r=setup({calls:2999});await r.backfill();assert.equal(r.state.paid,1);});
 await test('proxy authorized empty successful generation caches, auth failures do not spend',async()=>{const r=setup({empty:true});assert.equal((await r.blurb({})).status,401);assert.equal(r.state.paid,0);assert.equal((await r.blurb()).status,200);await r.blurb();assert.equal(r.state.paid,1);assert.equal(r.state.auth,2);});
 await test('proxy rejected JWT cannot reach model',async()=>{const r=setup({authError:true});assert.equal((await r.blurb()).status,401);assert.equal(r.state.paid,0);assert.equal(r.state.meterHTTP,0);});
 await test('backfill requires cron secret',async()=>{const r=setup();assert.equal((await r.backfill({})).status,401);assert.equal(r.state.paid,0);});
 await test('details helper without admin cannot spend',async()=>{const r=setup();await r.proxy.classifyAndBuildRow({id:'x',displayName:{text:'Unknown'},types:['restaurant']},{useLLM:true});assert.equal(r.state.paid,0);});
 await test('details helper denied meter retains deterministic fallback',async()=>{const r=setup({meterError:true});const row=await r.proxy.classifyAndBuildRow({id:'x',displayName:{text:'Unknown'},types:['restaurant']},{useLLM:true,admin:r.admin});assert.equal(row.google_place_id,'x');assert.equal(r.state.paid,0);});
 await test('REMAINING concurrent last-slot admission overshoots daily count',async()=>{const r=setup({daily:499,rows:1});await Promise.all([r.backfill(),r.backfill()]);assert.equal(r.state.paid,2);assert.equal(r.state.daily,501);});
 await test('REMAINING unreserved next-call cost overshoots dollars',async()=>{const r=setup({total:9.9999,rows:1}),b=await r.backfill();assert(b.body.spent_usd>10);});
 await test('cache failure preserves successful empty result and flags non-durability; later paid call remains possible',async()=>{const r=setup({empty:true,updateError:true});const response=await r.blurb();assert.equal(response.status,200);assert.equal(response.body.cache_write_confirmed,false);assert.equal(response.body.reason,'cache_write_unconfirmed');await r.blurb();assert.equal(r.state.paid,2);assert.equal(r.state.ledger.length,0);});
 await test('failed abstention stamp is reported; later paid attempt remains possible',async()=>{const r=setup({abstain:true,updateError:true,rows:1}),b=await r.backfill();assert.equal(b.body.failed,1);assert.equal(b.body.abstained,1);assert.equal(b.body.persistence_uncertain,true);await r.backfill();assert.equal(r.state.paid,2);assert.equal(r.state.ledger.length,2);});
 await test('REMAINING later invocation can spend again after uncertain accounting',async()=>{const r=setup({ledgerError:true,updateError:true,rows:1});await r.backfill();await r.backfill();assert.equal(r.state.paid,2);assert.equal(r.state.ledger.length,0);});

 for(const failure of ['updateError','updateThrow','updateZero','updateWrongId','updateAppliedThenThrow']){
  for(const empty of [false,true])await test('paid blurb remains HTTP200 with honest cache result '+failure+' empty='+empty,async()=>{
   const r=setup({[failure]:true,empty}),b=await r.blurb();assert.equal(b.status,200);assert.equal(b.body.cache_write_confirmed,false);assert.equal(b.body.reason,'cache_write_unconfirmed');assert.equal(typeof b.body.blurb,'string');assert.equal(b.body.blurb,empty?'':JSON.stringify({cuisine_type:'italian',confidence:{cuisine_type:.9}}));assert.equal(b.body.error,undefined);assert.equal(r.state.paid,1);assert.equal(r.state.updates.length,1);assert.equal(r.state.meterHTTP,1);
  });
  for(const outcome of ['abstain','badJSON','classification'])await test('backfill '+outcome+' '+failure+' stops once and reports persistence separately',async()=>{
   const r=setup({[failure]:true,[outcome]:true,rows:3}),b=await r.backfill();assert.equal(b.status,200);assert.equal(b.body.persistence_uncertain,true);assert.equal(b.body.accounting_uncertain,false);assert.equal(b.body.failed,1);assert.equal(b.body.written,0);assert.equal(b.body.processed,1);assert.equal(b.body.remaining_estimate,'unknown');assert.equal(r.state.paid,1);assert.equal(r.state.ledger.length,1);assert.equal(r.state.updates.length,1);
  });
 }
 await test('known model failure plus unknown ledger and stamp reports both without double-counting failed row',async()=>{
  const r=setup({badJSON:true,ledgerError:true,updateError:true,rows:3}),b=await r.backfill();assert.equal(b.status,200);assert.equal(b.body.accounting_uncertain,true);assert.equal(b.body.persistence_uncertain,true);assert.equal(b.body.failed,1);assert.equal(r.state.paid,1);assert.equal(r.state.ledgerHTTP,1);assert.equal(r.state.updates.length,1);
 });
 await test('confirmed cache write and cache hit both report saved, with one paid call',async()=>{
  const r=setup();const b=await r.blurb(),hit=await r.blurb();assert.equal(b.body.cache_write_confirmed,true);assert.equal(hit.body.cache_write_confirmed,true);assert.equal(hit.body.blurb,b.body.blurb);assert.equal(r.state.paid,1);assert.equal(r.state.updates.length,1);
 });
 await test('a previous confirmed write remains counted when the next row fails and third is skipped',async()=>{
  const r=setup({updateErrorAfter1:true,rows:3}),b=await r.backfill();assert.equal(b.body.written,1);assert.equal(b.body.failed,1);assert.equal(b.body.processed,2);assert.equal(b.body.persistence_uncertain,true);assert.equal(r.state.paid,2);assert.equal(r.state.ledger.length,2);assert.equal(r.state.updates.length,2);
 });
 await test('successful abstentions are confirmed and allow batch to continue',async()=>{
  const r=setup({abstain:true,rows:3}),b=await r.backfill();assert.equal(b.body.abstained,3);assert.equal(b.body.failed,0);assert.equal(b.body.persistence_uncertain,false);assert.equal(b.body.accounting_uncertain,false);assert.equal(r.state.paid,3);
 });
 await test('commit false keeps no-success-write semantics and remains paid, not a dry run',async()=>{
  const r=setup({commit:false,rows:2}),b=await r.backfill();assert.equal(b.body.persistence_uncertain,false);assert.equal(b.body.written,0);assert.equal(r.state.updates.length,0);assert.equal(r.state.paid,2);assert.equal(r.state.ledger.length,2);
 });
 await test('paid malformed response with successful failure-stamp continues safely accounted batch',async()=>{
  const r=setup({badJSON:true,rows:3}),b=await r.backfill();assert.equal(b.body.failed,3);assert.equal(b.body.persistence_uncertain,false);assert.equal(b.body.accounting_uncertain,false);assert.equal(r.state.ledger.length,3);
 });

 for(const blurb of ['Preserved paid sentence.',''])await test('actual mobile loader keeps HTTP200 partial result, no invocation retry '+JSON.stringify(blurb),async()=>{
  let calls=0;const client=createClient('https://offline.invalid','offline-fake',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async()=>{calls++;return json({blurb,cache_write_confirmed:false,reason:'cache_write_unconfirmed'});}}});
  const file=repo+'/mobile/lib/restaurant-blurb.ts',code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m={exports:{}};
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})')((id)=>{assert.equal(id,'./supabase');return {supabase:client};},m,m.exports);
  assert.equal(await m.exports.loadEditorialBlurb('synthetic'),blurb||null);assert.equal(calls,1);
 });
 console.log(JSON.stringify({supabase:require(repo+'/mobile/node_modules/@supabase/supabase-js/package.json').version,anthropic:require(repo+'/supabase/eval/node_modules/@anthropic-ai/sdk/package.json').version,passed,failed}));process.exitCode=failed.length?1:0;
})();
