// Executes the actual endpoint with all SDK/server modules replaced by fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.PALATE_TEST_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(process.env.PALATE_MODULES||path.join(root,'mobile/node_modules'),'typescript'));
function harness(count,mode){
 let handler,rpcCalls=0,listCalls=0;const objects=Array.from({length:count},(_,i)=>'photo-'+String(i).padStart(4,'0'));const foreign=['B/keep'];const offsets=[];
 const storage={from:bucket=>({list:async(uid,{limit,offset})=>{
  assert.equal(uid,'A');offsets.push(offset);listCalls++;
  if((mode==='later-bucket'&&bucket==='visit-photos')||mode==='error'||(mode==='late-error'&&listCalls===2))return {data:null,error:{message:'synthetic listing failure'}};
  if(mode==='missing')return {data:null,error:null};
  return {data:bucket==='avatars'?objects.slice(offset,offset+limit).map(name=>({name})):[],error:null};
 },remove:async paths=>{
  assert.ok(paths.every(p=>p.startsWith('A/')));
  if(mode==='remove-error')return {error:{message:'synthetic remove failure'}};
  for(const p of paths){const i=objects.indexOf(p.slice(2));if(i>=0)objects.splice(i,1);}return {error:null};
 }})};
 const client={storage,auth:{getUser:async(jwt)=>{assert.equal(jwt,'synthetic-A');return mode==='unauthorized'?{data:{user:null},error:{message:'synthetic auth error'}}:{data:{user:{id:'A'}},error:null};}},rpc:async name=>{assert.equal(name,'delete_my_account');rpcCalls++;return mode==='rpc-error'?{error:{message:'synthetic row failure'}}:{error:null};}};
 const exports={};const source=fs.readFileSync(path.join(root,'supabase/functions/delete-account/index.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Request,Response,Deno:{env:{get:k=>'synthetic-'+k}},require:id=>id.includes('/http/server')?{serve:h=>handler=h}:id.includes('supabase-js')?{createClient:()=>client}:id.endsWith('err-text.ts')?{errText:e=>e.message}:(()=>{throw Error(id)})()});
 return {run:(options={})=>handler(new Request('https://offline.invalid/delete-account',{method:'POST',headers:{Authorization:'Bearer synthetic-A'},...options})),objects,foreign,offsets,rpc:()=>rpcCalls};
}

for(const [method,status] of [['OPTIONS',200],['GET',405],['PUT',405]])test(method+' performs no storage or row operations',async()=>{const h=harness(250),r=await h.run({method});assert.equal(r.status,status);assert.equal(h.offsets.length,0);assert.equal(h.rpc(),0);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');});
test('missing auth returns JSON 401 without storage or RPC',async()=>{const h=harness(250),r=await h.run({headers:{}});assert.equal(r.status,401);assert.equal((await r.json()).error,'missing auth');assert.equal(h.offsets.length,0);assert.equal(h.rpc(),0);});
test('rejected authentication returns JSON 401 without deletion',async()=>{const h=harness(250,'unauthorized'),r=await h.run();assert.equal(r.status,401);assert.equal((await r.json()).error,'unauthorized');assert.equal(h.offsets.length,0);assert.equal(h.rpc(),0);});
test('later bucket list failure reports prior deletions but never deletes rows',async()=>{const h=harness(250,'later-bucket'),r=await h.run();assert.equal(r.status,500);const json=await r.json();assert.equal(json.error,'storage_delete_failed');assert.equal(json.removed.avatars,250);assert.equal(h.rpc(),0);assert.equal(h.objects.length,0);});
test('row RPC failure is distinct and follows successful object cleanup',async()=>{const h=harness(250,'rpc-error'),r=await h.run();assert.equal(r.status,500);const json=await r.json();assert.equal(json.error,'row_delete_failed');assert.equal(json.removed.avatars,250);assert.equal(h.rpc(),1);assert.equal(h.objects.length,0);});
test('retrying already-cleared storage does not recount deleted objects',async()=>{const h=harness(250);const first=await h.run();assert.equal((await first.json()).removed.avatars,250);const second=await h.run();assert.equal((await second.json()).removed.avatars,0);assert.equal(h.objects.length,0);});
