// Offline actual-source tests. Real installed PostgREST + Supabase fetch wrapper;
// every transport is injected, synthetic and recorded. No real auth/network.
const { test: nodeTest } = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// From repository root: node --test mobile/scripts/visit-write-account.test.cjs
// Deliberately outside Jest discovery: this runner uses node:test.
const mobileRoot = path.resolve(__dirname, '..');
const deps = path.join(mobileRoot, 'node_modules');
const ts = require(path.join(deps, 'typescript'));
globalThis.fetch = () => { throw Error('Unexpected network transport in offline visit-write tests'); };
const { createClient } = require(path.join(deps, '@supabase/supabase-js'));
const root = path.join(mobileRoot, 'lib');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const flush = async () => { for (let i=0;i<5;i++) await new Promise(r=>setImmediate(r)); };
function harness(config={}) {
  const entered = deferred(), released = deferred();
  let current='A', inserts=0, authCalls=0, ready=false;
  const calls=[], effects=[], stages=[];
  async function step(stage) { stages.push(stage); if (config.pause===stage) { entered.resolve(); await released.promise; } }
  const row = { id:'visit-A', user_id:'A', restaurant_id:'restaurant', is_public:config.public!==false };
  const client=createClient('https://synthetic.invalid','synthetic-key',{
    accessToken: async()=> { if(ready) await step(`sdk:${++authCalls}`); return `token-${current}`; },
    global:{fetch:async(input,init)=>{
      const url=new URL(input), table=url.pathname.split('/').pop();
      const method=init.method, body=init.body ? JSON.parse(init.body):null;
      const stage=table==='visits' ? method==='HEAD'?'count':method==='POST'?(++inserts===1?'insert':'fallback'):'dedup'
        :table==='restaurants_resolved'?'feedLookup':table==='feed_events'?'feedInsert':table==='prompt_decisions'?'decision':'analytics';
      calls.push({stage,table,method,body,authorization:new Headers(init.headers).get('Authorization'),query:url.search});
      await step(stage);
      if(config.reject===stage) throw Error(`transport ${stage}`);
      const error=config.error===stage || (config.fallback && stage==='insert');
      if(error) return new Response(JSON.stringify({message:config.fallback&&stage==='insert'?'column local_date does not exist':`failed ${stage}`,code:'TEST'}),{status:400});
      if(method==='HEAD') return new Response(null,{status:200,headers:{'content-range':'0-0/3'}});
      const data=stage==='dedup'?(config.existing?[row]:[]):stage==='feedLookup'?[{name:'synthetic venue',cuisine_type:'coffee',neighborhood:'synthetic'}]:stage==='insert'||stage==='fallback'?row:stage==='feedInsert'?{id:'feed'}:null;
      return new Response(data===null?'':JSON.stringify(data),{status:data===null?201:200});
    }},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  ready=true;
  const supabase={from:client.from.bind(client),auth:{
    getUser:async()=>{await step('user');if(config.reject==='user')throw Error('transport user');return {data:{user:config.noUser?null:{id:config.authUser||current}},error:null};},
    getSession:async()=>{await step('session');return {data:{session:config.noSession?null:{user:{id:config.sessionUser||current},access_token:`token-${current}`}},error:config.sessionError?Error('session failed'):null};},
  }};
  const mocks={
    './supabase':{supabase}, './storage-urls':{},
    './places':{getRestaurantIdByPlaceId:async()=>{await step('restaurant');if(config.reject==='restaurant')throw Error('restaurant failed');return 'restaurant';}},
    './haptics':{triggerHapticSuccess:()=>effects.push('haptic')},
    './personal-signal':{invalidatePersonalSignal:()=>effects.push('invalidate')},
    './observability':{captureError:(e,c)=>effects.push({error:e.message,context:c})},
    // Shared analytics (if used by a regression) loads from actual source too.
  };
  const cache={};
  function load(name) {
    if(cache[name])return cache[name]; const exports=cache[name]={};
    const source=fs.readFileSync(path.join(root,`${name}.ts`),'utf8');
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
      {exports,require:id=>mocks[id]||load(id.slice(2)),Date,console,fetch:()=>{throw Error('No network allowed');}});
    return exports;
  }
  const gate=load('username-gate');gate.setUsernameGateAccount('A');
  const api=load('visits');
  const change=(target)=>{current=target;gate.setUsernameGateAccount(target);};
  return {api,calls,effects,stages,gate,change,release:released.resolve,entered:entered.promise,
    switch:kind=>{change('B');if(kind==='A-B-A')change('A');},
    save:()=>api.saveVisit({googlePlaceId:'synthetic-place',source:config.source||'manual',notes:'retained note',visitedAt:new Date('2026-09-20T12:00:00Z')}),
    decision:()=>api.recordPromptDecision('synthetic-place','wrong_place',{lat:1,lng:2}),
  };
}
const settled=p=>p.then(value=>({value}),error=>({error}));
async function reach(h,p) {
  // A missing guard stage in baseline/mutants is a failed assertion, not a hang.
  const result=await Promise.race([h.entered.then(()=>true),p.then(()=>false),new Promise(r=>setTimeout(()=>r(false),150))]);
  assert.equal(result,true,'expected paused source boundary was reached');
}
function pinned(h) { for(const c of h.calls){assert.equal(c.authorization,'Bearer token-A',c.stage);if(c.body?.user_id)assert.equal(c.body.user_id,'A',c.stage);} }
for (const transition of ['A-B','A-B-A']) {
  for(const stage of ['user','session','restaurant','dedup','count','insert','fallback']) {
    test(`save rejects ${transition} at ${stage}`,async()=>{
      const h=harness({pause:stage,fallback:stage==='fallback'}),p=settled(h.save());
      await reach(h,p);h.switch(transition);h.release();const result=await p;await flush();
      assert.match(result.error?.message||'',/Account changed/);
      const i=h.stages.lastIndexOf(stage);assert.equal(h.stages.slice(i+1).length,0,'no work after stale response');
      assert.deepEqual(h.effects,[]);pinned(h);
    });
  }
  test(`dedup existing result rejects ${transition} while count pending`,async()=>{
    const h=harness({pause:'count',existing:true}),p=settled(h.save());await reach(h,p);h.switch(transition);h.release();assert.match((await p).error?.message||'',/Account changed/);pinned(h);
  });
  for(const stage of ['user','session','decision'])test(`decision abandons ${transition} at ${stage}`,async()=>{
    const h=harness({pause:stage,error:'decision'}),p=settled(h.decision());await reach(h,p);h.switch(transition);h.release();
    assert.equal((await p).error,undefined);await flush();assert.deepEqual(h.effects,[]);
    assert.equal(h.calls.filter(c=>c.stage==='decision').length,stage==='decision'?1:0);assert.equal(h.calls.filter(c=>c.stage==='analytics').length,0);pinned(h);
  });
  test(`feed continuation stops ${transition} after restaurant lookup`,async()=>{
    const h=harness({pause:'feedLookup'}),p=settled(h.save());await h.entered;await p;h.switch(transition);h.release();await flush();
    assert.equal(h.calls.filter(c=>c.stage==='feedInsert').length,0);pinned(h);
  });
  for(const [operation,config,index] of [['save',{},3],['save',{fallback:true},4],['decision',{},1]]) {
    test(`${operation} ${config.fallback?'fallback':'write'} pins JWT through SDK auth await ${transition}`,async()=>{
      const h=harness({...config,pause:`sdk:${index}`}),p=settled(h[operation]());await reach(h,p);h.switch(transition);h.release();await p;await flush();pinned(h);
      const writes=h.calls.filter(c=>c.method==='POST');assert.ok(writes.length>0,'request in flight still sent with A credentials');
    });
  }
}
for(const source of ['manual','auto'])test(`ordinary ${source} save preserves payload, reward, feed and pinned analytics`,async()=>{
  const h=harness({source});const row=await h.save();await flush();assert.equal(row.totalVisits,4);assert.equal(row.isFirstVisit,false);
  const c=h.calls.find(c=>c.stage==='insert');assert.equal(c.body.notes,'retained note');assert.equal(c.body.detection_source,source);assert.equal(c.body.visited_at,'2026-09-20T12:00:00.000Z');
  assert.ok(c.body.local_date);assert.deepEqual(h.effects,['haptic','invalidate']);assert.equal(h.calls.filter(c=>c.stage==='feedInsert').length,1);assert.equal(h.calls.filter(c=>c.stage==='analytics').length,1);pinned(h);
});
test('same-account refresh keeps generation valid',async()=>{const h=harness({pause:'restaurant'}),p=h.save();await h.entered;h.change('A');h.release();await p;await flush();pinned(h);});
test('existing visit returned without new insert/rewards',async()=>{const h=harness({existing:true});const row=await h.save();await flush();assert.equal(row.isFirstVisit,false);assert.equal(row.totalVisits,3);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert.deepEqual(h.effects,[]);pinned(h);});
test('legacy-column retry preserves owner and original legacy fields',async()=>{const h=harness({fallback:true});await h.save();await flush();const a=h.calls.find(c=>c.stage==='insert').body,b=h.calls.find(c=>c.stage==='fallback').body;assert.equal(b.local_date,undefined);for(const k of Object.keys(b))assert.equal(b[k],a[k]);pinned(h);});
test('private visit has no feed publication',async()=>{const h=harness({public:false});await h.save();await flush();assert.equal(h.calls.filter(c=>c.stage==='feedLookup'||c.stage==='feedInsert').length,0);});
for(const stage of ['restaurant','insert','fallback'])test(`save preserves ${stage} failure`,async()=>{const h=harness({error:stage,fallback:stage==='fallback',reject:stage==='restaurant'?stage:undefined});const r=await settled(h.save());assert.ok(r.error);await flush();assert.deepEqual(h.effects,[]);});
test('decision preserves coordinates and no success analytics',async()=>{const h=harness();await h.decision();assert.deepEqual(h.calls[0].body,{user_id:'A',google_place_id:'synthetic-place',outcome:'wrong_place',lat:1,lng:2});pinned(h);});
test('decision database failure reported but not thrown',async()=>{const h=harness({error:'decision'});await h.decision();await flush();assert.equal(h.effects.length,1);assert.equal(h.calls.find(c=>c.stage==='analytics').body.event,'prompt_decision_failed');pinned(h);});
test('decision auth transport failure still rejects',async()=>{const h=harness({reject:'user'});await assert.rejects(h.decision(),/transport user/);assert.equal(h.calls.length,0);});
test('signed-out save rejects and decision skips without restaurant lookup',async()=>{const h=harness();h.change(null);await assert.rejects(h.save(),/Not signed in/);await h.decision();assert.equal(h.stages.length,0);});
test('missing auth user decision skips as before',async()=>{const h=harness({noUser:true});await h.decision();assert.equal(h.calls.length,0);});
test('mismatched auth user never writes',async()=>{const h=harness({authUser:'B'});await assert.rejects(h.save(),/Account changed/);await h.decision();assert.equal(h.calls.length,0);});
test('mismatched session never starts restaurant or writes',async()=>{const h=harness({sessionUser:'B'});await assert.rejects(h.save(),/Account changed/);assert.equal(h.stages.includes('restaurant'),false);assert.equal(h.calls.length,0);});
test('Authorization is acquired before restaurant work',async()=>{const h=harness({pause:'restaurant'}),p=h.save();await h.entered;assert.deepEqual(h.stages.slice(0,3),['user','session','restaurant']);h.release();await p;await flush();});
// Known boundary: payload origin cannot be proven by a function invocation token.
test('ownerless old payload newly initiated under B still belongs to B (not solved)',async()=>{const h=harness();h.change('B');await h.save();await flush();assert.equal(h.calls.find(c=>c.stage==='insert').body.user_id,'B');});
for(const transition of ['A-B','A-B-A'])for(const [stage,index] of [['analytics',4],['feedInsert',6]])test(`${stage} pins JWT during SDK token lookup ${transition}`,async()=>{
 const h=harness({pause:`sdk:${index}`});await h.save();await h.entered;h.switch(transition);h.release();await flush();
 assert.ok(h.calls.some(c=>c.stage===stage));pinned(h);
});
for(const cfg of [{noSession:true},{sessionError:true}])test(`unavailable pinned session stops before restaurant: ${JSON.stringify(cfg)}`,async()=>{
 const h=harness(cfg);await assert.rejects(h.save());assert.equal(h.stages.includes('restaurant'),false);assert.equal(h.calls.length,0);
});
