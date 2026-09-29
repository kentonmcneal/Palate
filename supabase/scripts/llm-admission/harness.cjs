// Actual Node-transpiled handlers and installed Supabase SDK.
// All HTTP is injected; SQL suites use an in-memory PGlite backend.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {root,repo,ts,dependency}=require('./runtime.cjs');
const {createClient}=dependency('@supabase/supabase-js');
const crypto=require('node:crypto').webcrypto;
global.fetch=()=>{throw Error('Uninjected live fetch forbidden');};
const json=(x,status=200,headers={})=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json',...headers}});
function setup(o={}){
 const state={paid:0,meterHTTP:0,ledgerHTTP:0,ledger:[],updates:[],logs:[],auth:0,options:[],days:[],daily:o.daily??0};const modules=new Map(),handlers={};
 const rows=Array.from({length:o.rows??2},(_,i)=>({id:String(i),google_place_id:String(i),name:'Unknown Example',types:['restaurant'],cuisine_type:null,review_snippets:['A meal'],llm_backfill_at:null,...o.row}));
 async function transport(url,init={}){
  const u=new URL(String(url)),method=init.method??'GET',body=init.body?JSON.parse(init.body):null;
  if(u.hostname!=='offline.invalid')throw Error('Unexpected SDK host '+u.hostname);
  if(u.pathname==='/auth/v1/user'){state.auth++;return o.authError?json({message:'Invalid JWT'},401):json({id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid'});}
  if (u.pathname.endsWith('/reserve_llm_v1') || u.pathname.endsWith('/settle_llm_v1') || u.pathname.endsWith('/confirm_llm_v1')) { state.rpc ??= []; state.rpc.push({init,name:u.pathname.split('/').pop(),body}); if(o.databaseHTTP)return await o.databaseHTTP({name:u.pathname.split('/').pop(),body,init}); return json(await o.rpc(u.pathname.split('/').pop(),body)); }
  if(u.pathname==='/rest/v1/rpc/llm_spend_total_usd')return o.totalError?json({message:'denied',code:'42501'},403):json(Object.hasOwn(o,'total')?o.total:0);
  if(u.pathname==='/rest/v1/rpc/record_api_usage'){
   state.meterHTTP++;state.days.push(body.p_day);if(o.meterThrow)throw Error('synthetic lost meter response');if(o.meterError)return json({message:'permission denied',code:'42501'},403);state.daily++;return new Response(null,{status:204});
  }
  if(u.pathname==='/rest/v1/api_usage_daily')return o.dailyError?json({message:'permission denied',code:'42501'},403):json(Object.hasOwn(o,'dailyRows')?o.dailyRows:[{count:state.daily}]);
  if(u.pathname==='/rest/v1/llm_spend'){
   if(method==='HEAD')return new Response(null,{status:200,headers:o.missingCount?{}:{'content-range':`*/${o.calls??0}`}});
   assert.equal(method,'POST');state.ledgerHTTP++;if(o.ledgerThrow)throw Error('synthetic lost ledger response');if(o.ledgerError)return json({message:'permission denied',code:'42501'},403);state.ledger.push(body);return new Response(null,{status:201});
  }
  if(u.pathname==='/rest/v1/proxy_calls') return method==='HEAD'?new Response(null,{status:200,headers:{'content-range':'*/0'}}):new Response(null,{status:201});
  if(u.pathname==='/rest/v1/restaurants'){
   if(method==='POST')return new Response(null,{status:201});
   if(method==='PATCH'){
    state.updates.push(body);
    if(o.patchBackend)return await o.patchBackend({body,url:u,init});
    if(o.updateThrow)throw Error('synthetic cache/stamp transport lost');
    if(o.updateError || o.updateErrorAfter1&&state.updates.length>1)return json({message:'permission denied',code:'42501'},403);
    if(o.updateZero)return json({message:'JSON object requested, multiple (or no) rows returned',code:'PGRST116',details:'The result contains 0 rows'},406);
    const id=(u.searchParams.get('id')??'eq.0').slice(3);Object.assign(rows.find(r=>r.id===id)||rows[0],body);
    if(o.updateAppliedThenThrow)throw Error('synthetic acknowledgment lost after applied write');
    if(u.searchParams.get('select')==='id')return json({id:o.updateWrongId?'wrong-row':id});
    return new Response(null,{status:204});
   }
   if(method==='HEAD')return new Response(null,{status:200,headers:{'content-range':'*/0'}});
   if(o.readBackend)return json(await o.readBackend(u));
   return json(u.searchParams.has('google_place_id')?[rows[0]]:rows.filter(r=>r.cuisine_type===null&&r.llm_backfill_at===null));
  }
  throw Error('Unexpected database request '+method+' '+u.pathname);
 }
 const supabase=(url,key,opts={})=>createClient(url,key,{...opts,auth:{...opts.auth,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{...opts.global,fetch:transport}});
 async function modelTransport(url,init){
   if(new URL(url).hostname==='offline.invalid')return await transport(url,init);
   state.paid++;state.requests ??= [];state.requests.push({url,init});
   assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(init.redirect,'error');
   if(o.modelThrow)throw Error('synthetic model lost');if(o.model500)return json({error:'synthetic'},500);
   return json({id:'msg_'+crypto.randomUUID(),model:'claude-haiku-4-5-20251001',usage:o.usage??{input_tokens:1000,output_tokens:20,cache_read_input_tokens:0,cache_creation_input_tokens:0,server_tool_use:null,output_tokens_details:null,cache_creation:null,service_tier:null,inference_geo:null},content:o.content??[{type:'text',text:o.badJSON?'bad JSON':o.empty?'':JSON.stringify({cuisine_type:o.abstain?null:'italian',confidence:{cuisine_type:o.abstain?0:.9}})}]});
 }
 function load(file){if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);let source=fs.readFileSync(file,'utf8');if(file.endsWith('places-proxy/index.ts'))source+='\nexport {handleBlurb,classifyAndBuildRow};';const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const req=id=>{if(id.startsWith('https://deno'))return {serve:f=>{handlers[file.includes('places-proxy')?'proxy':'backfill']=f;}};if(id.startsWith('https://esm'))return {createClient:supabase};if(id.startsWith('npm:'))throw Error('SDK bypass forbidden');if(id.includes('google-spend'))return {spendGoogle:async()=>{if(!o.syntheticGoogle)throw Error('Google forbidden');state.google=(state.google??0)+1;return json(o.syntheticGoogle);},isGoogleBudgetSpent:async()=>{if(!o.syntheticGoogle)throw Error('Google forbidden');return false;}};if(id.startsWith('.')){let f=path.resolve(path.dirname(file),id);return load(f);}throw Error('Unexpected import '+id);};
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{URL,Request,Response,Headers,Date:o.clock||Date,setTimeout,crypto,TextEncoder,AbortSignal,console:{log(){},error(...a){state.logs.push(a.map(String).join(' '));}},Deno:{env:{get:k=>({ANTHROPIC_API_KEY:o.noKey?'':'offline-fake',CRON_SECRET:'offline-fake',SUPABASE_URL:'https://offline.invalid',SUPABASE_SERVICE_ROLE_KEY:'offline-fake'})[k]}},fetch:modelTransport})(req,m,m.exports);return m.exports;
 }
 const proxy=load(root+'/supabase/functions/places-proxy/index.ts');load(root+'/supabase/functions/classify-cuisine-backfill/index.ts');
 const admin=supabase('https://offline.invalid','offline-fake');
 return {state,admin,proxy,rows,async backfill(headers={'x-cron-secret':'offline-fake'}){const r=await handlers.backfill(new Request('https://offline.invalid',{method:'POST',headers,body:JSON.stringify({commit:o.commit!==false,limit:o.rows??2})}));return {status:r.status,body:await r.json()};},async details(headers={authorization:'Bearer offline-fake'}){const r=await handlers.proxy(new Request('https://offline.invalid',{method:'POST',headers,body:JSON.stringify({action:'details',place_id:'0'})}));return {status:r.status,body:await r.json()};},async blurb(headers={authorization:'Bearer offline-fake'}){const r=await handlers.proxy(new Request('https://offline.invalid',{method:'POST',headers,body:JSON.stringify({action:'blurb',place_id:'0'})}));return {status:r.status,body:await r.json()};}};
}

module.exports={setup,json,ts,repo,createClient};
