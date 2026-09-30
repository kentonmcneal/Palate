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
 const cache=new Map();
 function load(file:string):any{if(cache.has(file))return cache.get(file);const exports:any={};cache.set(file,exports);vm.runInNewContext(compile(file),{exports,console,Date,require:(id:string):any=>{
  if(id==='react')return React;if(id==='react/jsx-runtime')return require('react/jsx-runtime');
  if(id==='react-native')return {View:'View',ScrollView:'ScrollView',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator',Alert:{alert:jest.fn()},StyleSheet:{create:(x:any)=>x}};
  if(id==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
  if(id==='expo-router')return {useRouter:()=>({back}),useFocusEffect:(cb:any)=>React.useEffect(()=>{focusCallback=cb;cleanup=cb();return ()=>{cleanup?.();cleanup=null}},[cb])};
  if(id==='../components/Text')return {Text:'Text'};if(id==='../components/Button')return {Button:'Button',Spacer:'Spacer'};if(id==='../components/Confetti')return {Confetti:'Confetti'};
  if(id==='../theme')return {colors:{},spacing:{},type:{}};
  if(id.endsWith('/account-write'))return {accountWriteSession:gate.usernameGateSession,isAccountWriteSession:gate.isUsernameGateSession};
  if(id.endsWith('/personal-signal'))return {onPersonalSignalInvalidate:(fn:()=>void)=>{listeners.add(fn);return ()=>listeners.delete(fn)}};
  if(id.endsWith('/passive-confirm'))return {getInboxReadResult:read,getInbox:async()=>{const r:any=await read();return r.entries??[]},removeFromInbox:remove};
  if(id.endsWith('/digest-confirm'))return load('../digest-confirm.ts');if(id.endsWith('/passive-digest'))return load('../passive-digest.ts');
  if(id.endsWith('/visits'))return {saveVisit:save,recordPromptDecision:decision,rateVisit:rate};
  if(id.endsWith('/analytics'))return {track};if(id.endsWith('/visit-payoff'))return {loadVisitPayoff:payoff};if(id.endsWith('/haptics'))return {triggerHapticSuccess:haptic};
  if(id==='./passive-confidence')return load('../passive-confidence.ts');if(id==='./passive-inbox-policy')return load('../passive-inbox-policy.ts');
  if(id==='./passive-pipeline')return {mealWindow:()=>{throw Error('Detector outside screen scope')}};
  if(id==='./eating-pattern')return {loadEatingPattern:()=>{throw Error('unexpected schedule')}};
  if(id==='expo-notifications'||id==='./notification-dedupe')return {};
  throw Error('Unexpected import '+id);
 } });return exports;}
 return {Screen:load('../../app/digest.tsx').default,read,save,remove,decision,rate,track,payoff,haptic,back,account:(id:string|null)=>{gate.setUsernameGateAccount(id);listeners.forEach(fn=>fn())},blur:()=>{cleanup?.();cleanup=null},focus:()=>{cleanup=focusCallback()},entries:(e:any[])=>{entries=e}};
}
const text=(tree:any)=>JSON.stringify(tree.toJSON());
const button=(tree:any,title:string)=>tree.root.findAllByType('Button').find((x:any)=>x.props.title===title);
const press=async(tree:any,title:string)=>{const b=button(tree,title);expect(b).toBeDefined();await act(async()=>{b.props.onPress();await flush()})};
let trees:any[]=[];
async function mount(h:any){let tree:any;await act(async()=>{tree=create(<React.StrictMode><h.Screen/></React.StrictMode>);await flush()});trees.push(tree);return tree}
afterEach(async()=>{for(const t of trees)await act(async()=>t.unmount());trees=[]});
beforeEach(()=>jest.spyOn(global,'fetch').mockImplementation(()=>{throw Error('Network forbidden')}));
afterEach(()=>{expect(global.fetch).not.toHaveBeenCalled();jest.restoreAllMocks()});

const rowOf=(t:any,id='a')=>t.root.findAll((n:any)=>typeof n.type==='function'&&n.type.name==='Row').find((n:any)=>n.props.entry.id===id);
test('refocus retains explicit unchecked high stop and selected medium stop',async()=>{const h=harness([entry('a'),entry('b',{confidenceBand:'medium'})]),t=await mount(h);await act(async()=>{rowOf(t,'a').props.onToggle();await flush()});await act(async()=>{rowOf(t,'b').props.onRate('loved');await flush()});expect(rowOf(t,'a').props.checked).toBe(false);expect(rowOf(t,'b').props.checked).toBe(true);await act(async()=>{h.blur();h.focus();await flush()});expect(rowOf(t,'a').props.checked).toBe(false);expect(rowOf(t,'b').props.checked).toBe(true);await press(t,'Confirm 1');expect(h.save.mock.calls.map((x:any)=>x[0].googlePlaceId)).toEqual(['b']);expect(h.rate).toHaveBeenCalledWith('visit-b','loved');});
test('failed dismissed cleanup can be changed to confirmation with matching decision',async()=>{const h=harness([entry('a',{confidenceBand:'medium'})]),t=await mount(h);h.remove.mockRejectedValueOnce(Error('disk'));await press(t,'Confirm 0');expect(h.decision).toHaveBeenLastCalledWith('a','dismissed',null);await act(async()=>{rowOf(t).props.onToggle();await flush()});await press(t,'Confirm 1');expect(h.save).toHaveBeenCalledTimes(1);expect(h.decision).toHaveBeenLastCalledWith('a','confirmed',null);expect(h.decision).toHaveBeenCalledTimes(2)});
test('unchanged dismissal cleanup retry avoids repeat decision',async()=>{const h=harness([entry('a',{confidenceBand:'medium'})]),t=await mount(h);h.remove.mockRejectedValueOnce(Error('disk'));await press(t,'Confirm 0');await press(t,'Confirm 0');expect(h.decision).toHaveBeenCalledTimes(1);expect(h.remove).toHaveBeenCalledTimes(2);expect(h.save).not.toHaveBeenCalled()});
for(const boundary of ['rate','decision','remove'])test('account transition while '+boundary+' is pending blocks all subsequent helpers/entries',async()=>{const h=harness([entry('a'),entry('b')]),t=await mount(h),d=deferred();if(boundary==='rate')await act(async()=>{rowOf(t).props.onRate('loved');await flush()});h[boundary].mockReturnValueOnce(d.promise);await press(t,'Confirm 2');expect(h[boundary]).toHaveBeenCalledTimes(1);await act(async()=>{h.account('B');await flush();d.resolve(undefined);await flush()});expect(h.save).toHaveBeenCalledTimes(1);if(boundary==='rate')expect(h.remove).not.toHaveBeenCalled();if(boundary==='remove')expect(h.decision).not.toHaveBeenCalled();expect(h.haptic).not.toHaveBeenCalled()});
test('save acknowledgement and rating survive failed cleanup plus refocus without duplicate writes',async()=>{const h=harness(),t=await mount(h);await act(async()=>{rowOf(t).props.onRate('loved');await flush()});h.remove.mockRejectedValueOnce(Error('disk'));await press(t,'Confirm 1');await act(async()=>{h.blur();h.focus();await flush()});expect(rowOf(t).props.disabled).toBe(true);await press(t,'Confirm 1');expect(h.save).toHaveBeenCalledTimes(1);expect(h.rate).toHaveBeenCalledTimes(1);expect(h.decision).toHaveBeenCalledTimes(1);expect(h.remove).toHaveBeenCalledTimes(2)});
test('new stops use defaults while retained explicit selections survive failed refresh retry',async()=>{const h=harness(),t=await mount(h);await act(async()=>{rowOf(t).props.onToggle();await flush();h.blur();h.read.mockResolvedValue({status:'unavailable'} as any);h.focus();await flush()});expect(button(t,'Confirm 0').props.disabled).toBe(true);h.read.mockResolvedValue({status:'ready',entries:[entry('a'),entry('new')]});await press(t,'Retry loading stops');expect(rowOf(t).props.checked).toBe(false);expect(rowOf(t,'new').props.checked).toBe(true);await press(t,'Confirm 1');expect(h.save.mock.calls.map((x:any)=>x[0].googlePlaceId)).toEqual(['new'])});
test('account generation discards prior explicit selection',async()=>{const h=harness(),t=await mount(h);await act(async()=>{rowOf(t).props.onToggle();await flush()});expect(rowOf(t).props.checked).toBe(false);await act(async()=>{h.account('B');h.account('A');await flush()});expect(rowOf(t).props.checked).toBe(true)});
test('dismissal changed to corrected venue emits correct guessed-place outcome',async()=>{const other={google_place_id:'other',name:'Coffee'},h=harness([entry('a',{candidateCount:2,alternates:[other]})]),t=await mount(h);h.remove.mockRejectedValueOnce(Error('disk'));await press(t,'Confirm 0');await act(async()=>{rowOf(t).props.onChoose(other);await flush()});await press(t,'Confirm 1');expect(h.save.mock.calls[0][0].googlePlaceId).toBe('other');expect(h.decision.mock.calls.map((args:any)=>args.slice(0,2))).toEqual([['a','dismissed'],['a','wrong_place']])});
