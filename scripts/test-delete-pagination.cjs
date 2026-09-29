// Executes the actual endpoint with all SDK/server modules replaced by fixtures.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.PALATE_TEST_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(process.env.PALATE_MODULES||path.join(root,'mobile/node_modules'),'typescript'));
function harness(count,mode){
 let handler,rpcCalls=0,listCalls=0;const objects=Array.from({length:count},(_,i)=>'photo-'+String(i).padStart(4,'0'));const foreign=['B/keep'];const offsets=[];
 const storage={from:bucket=>({list:async(uid,{limit,offset})=>{
  assert.equal(uid,'A');offsets.push(offset);listCalls++;
  if(mode==='error'||(mode==='late-error'&&listCalls===2))return {data:null,error:{message:'synthetic listing failure'}};
  if(mode==='missing')return {data:null,error:null};
  return {data:bucket==='avatars'?objects.slice(offset,offset+limit).map(name=>({name})):[],error:null};
 },remove:async paths=>{
  assert.ok(paths.every(p=>p.startsWith('A/')));
  if(mode==='remove-error')return {error:{message:'synthetic remove failure'}};
  for(const p of paths){const i=objects.indexOf(p.slice(2));if(i>=0)objects.splice(i,1);}return {error:null};
 }})};
 const client={storage,auth:{getUser:async(jwt)=>{assert.equal(jwt,'synthetic-A');return {data:{user:{id:'A'}},error:null};}},rpc:async name=>{assert.equal(name,'delete_my_account');rpcCalls++;return {error:null};}};
 const exports={};const source=fs.readFileSync(path.join(root,'supabase/functions/delete-account/index.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Request,Response,Deno:{env:{get:k=>'synthetic-'+k}},require:id=>id.includes('/http/server')?{serve:h=>handler=h}:id.includes('supabase-js')?{createClient:()=>client}:id.endsWith('err-text.ts')?{errText:e=>e.message}:(()=>{throw Error(id)})()});
 return {run:()=>handler(new Request('https://offline.invalid/delete-account',{method:'POST',headers:{Authorization:'Bearer synthetic-A'}})),objects,foreign,offsets,rpc:()=>rpcCalls};
}
for(const count of [0,99,100,200,250,1000])test(`deletes ${count} objects without skipping pages`,async()=>{const h=harness(count);const r=await h.run();assert.equal(r.status,200);assert.equal(h.objects.length,0);assert.equal(h.rpc(),1);assert.ok(h.offsets.every(x=>x===0));assert.deepEqual(h.foreign,['B/keep']);assert.equal((await r.json()).removed.avatars,count);});
for(const mode of ['error','missing','late-error','remove-error'])test(mode+' refuses row deletion',async()=>{const h=harness(250,mode);const r=await h.run();assert.equal(r.status,500);assert.equal((await r.json()).error,'storage_delete_failed');assert.equal(h.rpc(),0);assert.ok(h.objects.length>0);});
