/* Offline artifact gate. Run AFTER Expo exports with --source-maps --no-bytecode.
 * node THIS_FILE MOBILE_ROOT IOS_EXPORT ANDROID_EXPORT [BASELINE_IOS_EXPORT IOS_HERMES_EXPORT ANDROID_HERMES_EXPORT]
 * No upload/client init on RN; actual Core/Browser transport uses an in-memory executor.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createRequire}=require('node:module');const [mobile,iosRoot,androidRoot,baselineRoot,iosHermesRoot,androidHermesRoot]=process.argv.slice(2);
if(!mobile||!iosRoot||!androidRoot)throw Error('Pass MOBILE_ROOT IOS_EXPORT ANDROID_EXPORT [BASELINE_IOS_EXPORT IOS_HERMES_EXPORT ANDROID_HERMES_EXPORT]');
const req=createRequire(path.resolve(mobile,'package.json')),ts=req('typescript'),core=req('@sentry/core'),browser=req('@sentry/browser');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fixtureId='0123456789abcdef0123456789abcdef';let checks=0;const evidence=[];
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function files(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]);}
function artifact(root,platform){const candidates=files(path.resolve(root)).filter(f=>f.endsWith('.js.map')&&f.includes('/'+platform+'/'));assert.equal(candidates.length,1,'this gate covers one main plain-JS bundle per platform, not split bundles');const mapPath=candidates[0],bundlePath=mapPath.slice(0,-4),code=fs.readFileSync(bundlePath,'utf8'),mapBytes=fs.readFileSync(mapPath),map=JSON.parse(mapBytes);const context={console:{log(){},warn(){},error(){},info(){}},fetch:()=>{throw Error('Network forbidden in artifact VM');}};let bootStop;
try{vm.runInNewContext(code,context,{filename:platform==='ios'?'app:///main.jsbundle':'app:///index.android.bundle',timeout:2000});}catch(e){bootStop={name:e.name,message:String(e.message).slice(0,150)};}
return {bundlePath,mapPath,code,map,registry:context._sentryDebugIds,release:context.SENTRY_RELEASE,bootStop,bundleHash:sha(code),mapHash:sha(mapBytes)};}
function loadPrivacy(){const ex={};const file=path.join(mobile,'lib/observability-privacy.ts');vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:ex});return ex;}
(async()=>{
 const configFile=path.join(mobile,'metro.config.js');let options,installedOptions;
 const installed=req('@sentry/react-native/metro');
 const configModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(configFile,'utf8'),{module:configModule,__dirname:mobile,require:name=>{assert.equal(name,'@sentry/react-native/metro');return {getSentryExpoConfig:(root,opts)=>{options=opts;return installed.getSentryExpoConfig(root,{...opts,getDefaultConfig:(_root,opts)=>{installedOptions=opts;return {};}});}};}});
 check('production config disables release/web replay/annotations/dev source-context additions',()=>{for(const key of ['injectReleaseForWeb','includeWebReplay','annotateReactComponents','enableSourceContextInDevelopment'])assert.equal(options[key],false);assert.equal(installedOptions.unstable_beforeAssetSerializationPlugins.length,1);assert.equal(installedOptions.unstable_beforeAssetSerializationPlugins[0],installed.unstableBeforeAssetSerializationDebugIdPlugin);});
 check('web policy selects debug injection only and resolves replay modules to empty',()=>{
  const resolve=configModule.exports.resolver.resolveRequest;
  for(const name of ['@sentry/replay','@sentry-internal/replay'])assert.equal(resolve({},name,'web').type,'empty');
  assert.equal(resolve({resolveRequest:()=>({type:'sourceFile',filePath:'fixture.js'})},'ordinary-module','web').filePath,'fixture.js');
  assert.equal(configModule.exports.server,undefined);assert.equal(configModule.exports.transformer,undefined);
 });
 const {privateErrorTransport}=loadPrivacy();
 // Core caches registry lookups by entry count; retain generated entries while
 // checking both platforms in this process, as runtime registration is additive.
 const generatedRegistry = {};
 for(const [platform,root]of [['ios',iosRoot],['android',androidRoot]]){
  const a=artifact(root,platform),debugId=a.map.debugId??a.map.debug_id,canonical=platform==='ios'?'app:///main.jsbundle':'app:///index.android.bundle';
  check(platform+' generated registry matches source-map ID and bundle comment',()=>{assert(uuid.test(debugId));assert(a.registry,'generated prelude did not populate runtime registry');assert(Object.values(a.registry).includes(debugId));assert(a.code.includes('//# debugId='+debugId));assert.equal(a.release,undefined);if(a.map.debug_id)assert.equal(a.map.debug_id,debugId);if(a.map.debugId)assert.equal(a.map.debugId,debugId);});
  const prior=global._sentryDebugIds;Object.assign(generatedRegistry,a.registry);global._sentryDebugIds=generatedRegistry;const bodies=[];let prepared;
  try{
   const client=new core.Client({dsn:'https://fixture@example.invalid/1',integrations:[],sendClientReports:false,stackParser:browser.defaultStackParser,
    beforeSend:e=>{prepared=e;return e;},
    transport:options=>privateErrorTransport(browser.makeFetchTransport(options,async(_url,request)=>{bodies.push(request.body);return {status:200,headers:{get:()=>null}};}))});
   client.init();client.captureEvent({event_id:fixtureId,exception:{values:[{type:'Error',value:'synthetic message',stacktrace:{frames:[{filename:canonical,lineno:2,colno:108}]}}]}});await client.flush(500);await client.close(500);
   check(platform+' actual Core consumes generated registry and final transport retains matching identity',()=>{assert(prepared.debug_meta?.images.some(i=>i.debug_id===debugId&&i.code_file===canonical),'Core did not derive debug_meta from generated registry');assert.equal(bodies.length,1);const event=JSON.parse(bodies[0].split('\n')[2]);assert(event.debug_meta.images.some(i=>i.debug_id===debugId&&i.code_file===canonical));assert.equal(event.release,undefined);assert.equal(event.dist,undefined);assert.equal(event.sdk.settings.infer_ip,'never');});
  }finally{if(prior===undefined)delete global._sentryDebugIds;else global._sentryDebugIds=prior;}
  evidence.push({platform,bundle:a.bundlePath,map:a.mapPath,debugId,bundleSha256:a.bundleHash,mapSha256:a.mapHash,runtimeRegistryEntries:Object.keys(a.registry).length,vmBootStop:a.bootStop});
 }
 if(baselineRoot){const a=artifact(baselineRoot,'ios');check('actual default Expo export has map/comment ID but no runtime Sentry registry',()=>{assert(uuid.test(a.map.debugId??a.map.debug_id));assert(a.code.includes('//# debugId='));assert.equal(a.registry,undefined);});evidence.push({platform:'ios-default-control',bundle:a.bundlePath,map:a.mapPath,debugId:a.map.debugId??a.map.debug_id,bundleSha256:a.bundleHash,mapSha256:a.mapHash,registryPresent:!!a.registry,vmBootStop:a.bootStop});}
 if(iosHermesRoot||androidHermesRoot){assert(iosHermesRoot&&androidHermesRoot,'supply both Hermes exports');
  for(const [platform,root]of [['ios',iosHermesRoot],['android',androidHermesRoot]]){
   const maps=files(path.resolve(root)).filter(f=>f.endsWith('.hbc.map')&&f.includes('/'+platform+'/'));assert.equal(maps.length,1);
   const mapBytes=fs.readFileSync(maps[0]),map=JSON.parse(mapBytes),bundle=maps[0].slice(0,-4),bytes=fs.readFileSync(bundle),debugId=map.debugId??map.debug_id;
   check(platform+' compiled Hermes artifact contains the exact composed-map ID and registry identifier',()=>{assert(uuid.test(debugId));assert(bytes.includes(Buffer.from(debugId)));assert(bytes.includes(Buffer.from('_sentryDebugIds')));assert(map.x_hermes_function_offsets,'expected composed Hermes map');});
   evidence.push({platform:platform+'-hermes',bundle,map:maps[0],debugId,bundleSha256:sha(bytes),mapSha256:sha(mapBytes),bytecodeRuntimeExecuted:false});
  }
 }
 console.log(JSON.stringify({passed:checks,evidence,nativeVerified:false,uploaded:false,serverSymbolicationVerified:false},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
