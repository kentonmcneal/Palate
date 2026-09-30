import React from 'react';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
const {create,act}=require('react-test-renderer');
const deferred=()=>{let resolve!: (x:any)=>void,reject!:(e:any)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve()};
const entry=(id:string,extra={})=>({id,place_id:id,name:'Stop '+id,address:'',detectedAt:Date.now()-1000,dwellMin:10,accuracyM:10,source:'test',confidenceBand:'high',alternates:[],...extra});
function harness(entries:any[]=[entry('a')]){
 const compile=(p:string)=>ts.transpileModule(fs.readFileSync(path.resolve(__dirname,p),'utf8'),{fileName:p,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 const gate:any={};vm.runInNewContext(compile('../username-gate.ts'),{exports:gate});gate.setUsernameGateAccount('A');
 const listeners=new Set<()=>void>();let focusCallback:any,cleanup:any;
 const read=jest.fn(async()=>({status:'ready',entries}));const save=jest.fn(async(args:any)=>({id:'visit-'+args.googlePlaceId}));const remove=jest.fn(async(id:string)=>{entries=entries.filter(e=>e.id!==id)});const decision=jest.fn(async()=>{}),rate=jest.fn(async()=>{}),track=jest.fn(),payoff=jest.fn(async()=> 'Your diary is growing'),haptic=jest.fn(async()=>{}),back=jest.fn();
 const ratingWrites:any[]=[];const invalidation=jest.fn();let ratingWait:Promise<any>|null=null;
 const supabase={auth:{getUser:async()=>({data:{user:{id:gate.usernameGateSession().accountId}},error:null}),getSession:async()=>({data:{session:{user:{id:gate.usernameGateSession().accountId},access_token:'synthetic-'+gate.usernameGateSession().accountId}},error:null})},from:(table:string)=>{const q:any={table,filters:[],headers:{},update:(body:any)=>{q.body=body;return q},eq:(k:string,v:any)=>{q.filters.push([k,v]);return q},setHeader:(k:string,v:string)=>{q.headers[k]=v;return q},then:(resolve:any,reject:any)=>{ratingWrites.push(q);return (ratingWait??Promise.resolve({error:null})).then(resolve,reject)}};return q}};
 const cache=new Map();
 function load(file:string):any{if(cache.has(file))return cache.get(file);const exports:any={};cache.set(file,exports);vm.runInNewContext(compile(file),{exports,console,Date,require:(id:string):any=>{
  if(id==='react')return React;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='react-native')return {View:'View',ScrollView:'ScrollView',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',Alert:{alert:jest.fn()},StyleSheet:{create:(x:any)=>x}};
  if(id==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
  if(id==='expo-router')return {useRouter:()=>({back}),useFocusEffect:(cb:any)=>React.useEffect(()=>{focusCallback=cb;cleanup=cb();return ()=>{cleanup?.();cleanup=null}},[cb])};
  if(id==='../components/Text')return {Text:'Text'};if(id==='../components/Button')return {Button:'Button',Spacer:'Spacer'};if(id==='../components/Confetti')return {Confetti:'Confetti'};
  if(id==='../theme')return {colors:{},spacing:{},type:{}};
  if(id.endsWith('/account-write'))return load('../account-write.ts');if(id==='./username-gate')return gate;if(id==='./supabase')return {supabase};if(['./storage-urls','./places','./observability'].includes(id))return {};
  if(id.endsWith('/personal-signal'))return {invalidatePersonalSignal:invalidation,onPersonalSignalInvalidate:(fn:()=>void)=>{listeners.add(fn);return ()=>listeners.delete(fn)}};
  if(id.endsWith('/passive-confirm'))return {getInboxReadResult:read,getInbox:async()=>{const r:any=await read();return r.entries??[]},removeFromInbox:remove};
  if(id.endsWith('/digest-confirm'))return load('../digest-confirm.ts');if(id.endsWith('/passive-digest'))return load('../passive-digest.ts');
  if(id.endsWith('/visits'))return {saveVisit:save,recordPromptDecision:decision,rateVisit:load('../visits.ts').rateVisit};
  if(id.endsWith('/analytics'))return {track};if(id.endsWith('/visit-payoff'))return {loadVisitPayoff:payoff};if(id.endsWith('/haptics'))return {triggerHapticSuccess:haptic};
  if(id==='./passive-confidence')return load('../passive-confidence.ts');if(id==='./passive-inbox-policy')return load('../passive-inbox-policy.ts');
  if(id==='./passive-pipeline')return {mealWindow:()=>{throw Error('Detector outside screen scope')}};
  if(id==='./eating-pattern')return {loadEatingPattern:()=>{throw Error('unexpected schedule')}};
  if(id==='expo-notifications'||id==='./notification-dedupe')return {};
  throw Error('Unexpected import '+id);
 } });return exports;}
 return {Screen:load('../../app/digest.tsx').default,ratingWrites,invalidation,pauseRating:(p:Promise<any>)=>{ratingWait=p},read,save,remove,decision,rate,track,payoff,haptic,back,account:(id:string|null)=>{gate.setUsernameGateAccount(id);listeners.forEach(fn=>fn())},blur:()=>{cleanup?.();cleanup=null},focus:()=>{cleanup=focusCallback()},entries:(e:any[])=>{entries=e}};
}
const text=(tree:any)=>JSON.stringify(tree.toJSON());
const button=(tree:any,title:string)=>tree.root.findAllByType('Button').find((x:any)=>x.props.title===title);
const press=async(tree:any,title:string)=>{const b=button(tree,title);expect(b).toBeDefined();await act(async()=>{b.props.onPress();await flush()})};
let trees:any[]=[];
async function mount(h:any){let tree:any;await act(async()=>{tree=create(<React.StrictMode><h.Screen/></React.StrictMode>);await flush()});trees.push(tree);return tree}
afterEach(async()=>{for(const t of trees)await act(async()=>t.unmount());trees=[]});
beforeEach(()=>jest.spyOn(global,'fetch').mockImplementation(()=>{throw Error('Network forbidden')}));
afterEach(()=>{expect(global.fetch).not.toHaveBeenCalled();jest.restoreAllMocks()});

const firstRow=(t:any)=>t.root.findAll((n:any)=>typeof n.type==='function'&&n.type.name==='Row')[0];
test('actual digest calls actual rateVisit with initiating account and preserves diary flow',async()=>{const h=harness(),t=await mount(h);await act(async()=>{firstRow(t).props.onRate('loved');await flush()});await press(t,'Confirm 1');expect(h.ratingWrites).toHaveLength(1);expect(h.ratingWrites[0].headers.Authorization).toBe('Bearer synthetic-A');expect(h.ratingWrites[0].filters).toEqual([['id','visit-a'],['user_id','A']]);expect(h.invalidation).toHaveBeenCalledTimes(1);expect(h.remove).toHaveBeenCalledTimes(1);expect(text(t)).toContain('1 visit saved')});
for(const transition of ['B','ABA','null'])test('actual pending rating after '+transition+' cannot invalidate or initiate cleanup/next entry',async()=>{const h=harness([entry('a'),entry('b')]),t=await mount(h),d=deferred();h.pauseRating(d.promise);await act(async()=>{firstRow(t).props.onRate('loved');await flush()});await press(t,'Confirm 2');expect(h.ratingWrites).toHaveLength(1);await act(async()=>{h.account(transition==='null'?null:'B');if(transition==='ABA')h.account('A');await flush();d.resolve({error:null});await flush()});expect(h.invalidation).not.toHaveBeenCalled();expect(h.save).toHaveBeenCalledTimes(1);expect(h.remove).not.toHaveBeenCalled();expect(h.decision).not.toHaveBeenCalled();expect(h.haptic).not.toHaveBeenCalled()});
