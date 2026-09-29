// Offline controls: installed SDK, actual application helpers, injected transport.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.PALATE_TEST_ROOT||path.resolve(__dirname,'..');
const modules=process.env.PALATE_MODULES||path.join(root,'mobile/node_modules');
const {createClient}=require(path.join(modules,'@supabase/supabase-js'));
const ts=require(path.join(modules,'typescript'));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function harness(){
 const storage=new Map(),calls=[],logoutStarted=deferred(),logoutRelease=deferred();
 let logoutStatus=204;let holdWrite=null;
 let holdLogout=false,failCredential=false,holdRead=null,failLogout=false,holdRefresh=false,holdRemoval=null;
 const refreshStarted=deferred(),refreshRelease=deferred();
 const client=createClient('https://offline.invalid','synthetic-key',{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage:{
  getItem:async k=>{if(holdRead){const h=holdRead;holdRead=null;h.started.resolve();await h.release.promise;}return storage.get(k)||null;},
  setItem:async(k,v)=>{if(holdWrite){const h=holdWrite;holdWrite=null;h.started.resolve();await h.release.promise;}storage.set(k,v);},removeItem:async k=>{if(holdRemoval){const h=holdRemoval;holdRemoval=null;h.started.resolve();await h.release.promise;}storage.delete(k);}
 }},global:{fetch:async(url,options)=>{
  const u=new URL(url),body=JSON.parse(options.body||'{}');calls.push({path:u.pathname,body});
  if(u.pathname.endsWith('/logout')){logoutStarted.resolve();if(holdLogout)await logoutRelease.promise;return failLogout ? new Response(JSON.stringify({msg:'synthetic logout failure'}),{status:500}) : logoutStatus===204?new Response(null,{status:204}):new Response(JSON.stringify({msg:'deleted or expired session'}),{status:logoutStatus});}
  if(u.pathname.endsWith('/otp'))return new Response('{}',{status:200});
  if(u.pathname.endsWith('/token')||u.pathname.endsWith('/verify')){
   if(body.refresh_token && holdRefresh){refreshStarted.resolve();await refreshRelease.promise;}
   if(failCredential){failCredential=false;return new Response(JSON.stringify({msg:'synthetic credential failure'}),{status:400});}
   const id=body.id_token||body.token||'A';return new Response(JSON.stringify({access_token:'synthetic-'+id,refresh_token:'refresh-'+id,token_type:'bearer',expires_in:3600,user:{id,email:id+'@example.invalid'}}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  throw Error('Unexpected synthetic request '+url);
 }}});
 const cache={};function load(name){if(cache[name])return cache[name];const exports=cache[name]={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'mobile/lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:id=>id==='./supabase'?{supabase:client}:id==='expo-linking'?{createURL:()=> 'palate://auth-callback'}:load(id.slice(2))});return exports;}
 const gate=load('username-gate'),auth=load('auth');await client.auth.getSession();
 client.auth.onAuthStateChange((event,s)=>gate.setUsernameGateAccount(s?.user.id||null));
 await auth.signInWithGoogleIdToken('A');
 return {client,gate,auth,calls,setLogoutStatus:s=>logoutStatus=s,holdNextWrite:()=>{holdWrite={started:deferred(),release:deferred()};return holdWrite;},logoutStarted,logoutRelease,holdRefresh:()=>holdRefresh=true,refreshStarted,refreshRelease,failLogout:()=>failLogout=true,holdLogout:()=>holdLogout=true,fail:()=>failCredential=true,holdNextRemoval:()=>{holdRemoval={started:deferred(),release:deferred()};return holdRemoval;},holdNextRead:()=>{holdRead={started:deferred(),release:deferred()};return holdRead;}};
}

test('A cleanup waits for B credential persistence and then skips B', {timeout:2000},async()=>{const h=await harness(),token=h.gate.usernameGateSession(),write=h.holdNextWrite();const replace=h.auth.signInWithGoogleIdToken('B');await write.started.promise;const cleanup=h.auth.signOutForAccount(token);await new Promise(r=>setImmediate(r));assert.equal(h.calls.filter(c=>c.path.endsWith('/logout')).length,0);write.release.resolve();await replace;assert.equal(await cleanup,false);assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});
test('B cannot submit credentials until delayed SIGNED_OUT subscriber completes', {timeout:2000},async()=>{const h=await harness(),entered=deferred(),release=deferred();h.client.auth.onAuthStateChange(async(event)=>{if(event==='SIGNED_OUT'){entered.resolve();await release.promise;}});const cleanup=h.auth.signOutForAccount(h.gate.usernameGateSession());await entered.promise;const before=h.calls.length,replace=h.auth.verifyEmailCode('b@example.invalid','B');await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,before);release.resolve();await cleanup;await replace;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});
test('current fire-and-forget subscriber pattern does not deadlock public SDK reads', {timeout:2000},async()=>{const h=await harness(),reads=[];h.client.auth.onAuthStateChange((_event,session)=>{if(session?.user)reads.push(h.client.auth.getSession());});await h.auth.signInWithAppleIdToken('B','nonce');await Promise.all(reads);await h.auth.signOut();assert.equal((await h.client.auth.getSession()).data.session,null);});
test('null signed-out token cannot log out established replacement', {timeout:2000},async()=>{const h=await harness();await h.auth.signOut();const token=h.gate.usernameGateSession();await h.auth.signInWithGoogleIdToken('B');const before=h.calls.filter(c=>c.path.endsWith('/logout')).length;assert.equal(await h.auth.signOutForAccount(token),false);assert.equal(h.calls.filter(c=>c.path.endsWith('/logout')).length,before);});

for(const status of [401,403,404])test(`post-deletion logout ${status} still clears A before B`, {timeout:2000},async()=>{const h=await harness();h.setLogoutStatus(status);const cleanup=h.auth.signOutForAccount(h.gate.usernameGateSession());const replacement=h.auth.signInWithGoogleIdToken('B');assert.equal(await cleanup,true);await replacement;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});
