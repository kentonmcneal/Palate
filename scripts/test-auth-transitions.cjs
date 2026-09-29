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
 let holdLogout=false,failCredential=false,holdRead=null,failLogout=false,holdRefresh=false,holdRemoval=null;
 const refreshStarted=deferred(),refreshRelease=deferred();
 const client=createClient('https://offline.invalid','synthetic-key',{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage:{
  getItem:async k=>{if(holdRead){const h=holdRead;holdRead=null;h.started.resolve();await h.release.promise;}return storage.get(k)||null;},
  setItem:async(k,v)=>{storage.set(k,v);},removeItem:async k=>{if(holdRemoval){const h=holdRemoval;holdRemoval=null;h.started.resolve();await h.release.promise;}storage.delete(k);}
 }},global:{fetch:async(url,options)=>{
  const u=new URL(url),body=JSON.parse(options.body||'{}');calls.push({path:u.pathname,body});
  if(u.pathname.endsWith('/logout')){logoutStarted.resolve();if(holdLogout)await logoutRelease.promise;return failLogout ? new Response(JSON.stringify({msg:'synthetic logout failure'}),{status:500}) : new Response(null,{status:204});}
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
 return {client,gate,auth,calls,logoutStarted,logoutRelease,holdRefresh:()=>holdRefresh=true,refreshStarted,refreshRelease,failLogout:()=>failLogout=true,holdLogout:()=>holdLogout=true,fail:()=>failCredential=true,holdNextRemoval:()=>{holdRemoval={started:deferred(),release:deferred()};return holdRemoval;},holdNextRead:()=>{holdRead={started:deferred(),release:deferred()};return holdRead;}};
}
const methods={OTP:h=>h.auth.verifyEmailCode('b@example.invalid','B'),Google:h=>h.auth.signInWithGoogleIdToken('B'),Apple:h=>h.auth.signInWithAppleIdToken('B','synthetic-nonce')};
for(const [name,signin] of Object.entries(methods)){
 test(name+': replacement waits for A logout response, B persists',async()=>{
  const h=await harness(),token=h.gate.usernameGateSession();h.holdLogout();const cleanup=h.auth.signOutForAccount(token);await h.logoutStarted.promise;
  const count=h.calls.length;const replacement=signin(h);await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,count);
  h.logoutRelease.resolve();assert.equal(await cleanup,true);await replacement;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');
 });
 test(name+': replacement queued first makes A cleanup a no-op',async()=>{
  const h=await harness(),token=h.gate.usernameGateSession();const replacement=signin(h);const cleanup=h.auth.signOutForAccount(token);await replacement;assert.equal(await cleanup,false);assert.equal(h.calls.filter(x=>x.path.endsWith('/logout')).length,0);assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');
 });
 test(name+': replacement waits through pre-logout storage read',async()=>{
  const h=await harness(),token=h.gate.usernameGateSession();const read=h.holdNextRead();const cleanup=h.auth.signOutForAccount(token);await read.started.promise;
  const count=h.calls.length,replacement=signin(h);await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,count);read.release.resolve();await cleanup;await replacement;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');
 });
}
test('failed credentials do not poison queue',async()=>{const h=await harness();h.fail();await assert.rejects(h.auth.signInWithGoogleIdToken('B'));await h.auth.signInWithAppleIdToken('B','nonce');assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});
test('A to B to A invalidates retained cleanup token',async()=>{const h=await harness(),token=h.gate.usernameGateSession();await h.auth.signInWithGoogleIdToken('B');await h.auth.signInWithGoogleIdToken('A');assert.equal(await h.auth.signOutForAccount(token),false);assert.equal((await h.client.auth.getSession()).data.session.user.id,'A');});
test('ordinary signOut shares queue with replacement',async()=>{const h=await harness();h.holdLogout();const logout=h.auth.signOut();await h.logoutStarted.promise;const replacement=h.auth.signInWithGoogleIdToken('B');h.logoutRelease.resolve();await logout;await replacement;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});

test('logout error releases queue; replacement is retained',async()=>{const h=await harness();h.failLogout();const cleanup=h.auth.signOutForAccount(h.gate.usernameGateSession());const rejection=assert.rejects(cleanup);const replacement=h.auth.signInWithGoogleIdToken('B');await rejection;await replacement;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});
test('in-flight old SDK refresh cannot restore A after cleanup and B sign-in',async()=>{const h=await harness();h.holdRefresh();const refresh=h.client.auth.refreshSession();await h.refreshStarted.promise;await h.auth.signOutForAccount(h.gate.usernameGateSession());await h.auth.signInWithGoogleIdToken('B');h.refreshRelease.resolve();await refresh;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});

for(const [name,signin] of Object.entries(methods))test(name+': replacement waits through actual asynchronous storage removal',async()=>{const h=await harness(),token=h.gate.usernameGateSession(),removal=h.holdNextRemoval();const cleanup=h.auth.signOutForAccount(token);await removal.started.promise;const count=h.calls.length,replacement=signin(h);await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,count);removal.release.resolve();await cleanup;await replacement;assert.equal((await h.client.auth.getSession()).data.session.user.id,'B');});
