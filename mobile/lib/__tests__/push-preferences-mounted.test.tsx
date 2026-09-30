import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import vm from "vm";
import ts from "typescript";
const { create, act } = require("react-test-renderer");
const labels = ["Activity from other people", "Likes on your posts", "Comments and replies"];
function deferred() { let resolve!: (v: any) => void, reject!: (e: any) => void; const promise = new Promise<any>((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
const flush = async () => { for(let i=0;i<20;i++) await Promise.resolve(); };
function harness() {
  const compile=(file:string)=>ts.transpileModule(readFileSync(resolve(__dirname,file),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
  const gate:any={};vm.runInNewContext(compile('../username-gate.ts'),{exports:gate});gate.setUsernameGateAccount('A');
  const reads=labels.map(()=>jest.fn(async(_token:any)=>true));
  const writes=labels.map(()=>jest.fn(async(_value:boolean,_token:any)=>undefined));
  const listeners=new Set<()=>void>();const alert=jest.fn();
  const named=new Proxy({}, {get:(_t,key)=>{
    if(['Text','TextInput','Button','Spacer','CollapsibleSection'].includes(String(key)))return String(key);
    if(key==='FORWARDING_LIVE')return false;
    if(key==='getGmailStatus')return async()=>({connected:false});
    if(key==='buildInfoLine')return ()=> 'test build';
    return async()=>false;
  }});
  const exports:any={};vm.runInNewContext(compile('../../app/settings.tsx'),{exports,console,require:(id:string)=>{
    // Unrelated capture control has its own real-component mounted suites.
    // Keep this explicit: the generic async helper proxy is not a React component.
    if (id === "../components/PassiveCaptureToggle") return { PassiveCaptureToggle: () => null };
    if(id==='react')return React;
    if(id==='react/jsx-runtime')return require('react/jsx-runtime');
    if(id==='react-native')return {View:'View',Switch:'Switch',ScrollView:'ScrollView',Pressable:'Pressable',Modal:'Modal',StyleSheet:{create:(x:any)=>x},Alert:{alert},Linking:{},Share:{}};
    if(id==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
    if(id==='expo-router')return {useRouter:()=>({}),useFocusEffect:()=>{}};
    if(id==='@react-native-async-storage/async-storage')return {getItem:async()=>null};
    if(id==='../theme')return {colors:{},spacing:{},type:{}};
    if(id==='../lib/account-write')return {accountWriteSession:gate.usernameGateSession,isAccountWriteSession:gate.isUsernameGateSession};
    if(id==='../lib/supabase')return {supabase:{auth:{getUser:async()=>({data:{user:{id:'A'}}}),onAuthStateChange:(fn:()=>void)=>{listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};}}}};
    if(id==='../lib/friend-push')return {readFriendActivityPushEnabled:reads[0],setFriendActivityPushEnabled:writes[0],isFriendActivityPushEnabled:reads[0]};
    if(id==='../lib/social-notifications')return {readSocialPushPref:(which:string,t:any)=>reads[which==='likes'?1:2](t),setSocialPushPref:(which:string,v:boolean,t:any)=>writes[which==='likes'?1:2](v,t),getSocialPushPrefs:async()=>({likes:true,comments:true})};
    return named;
  }});
  return {Screen:exports.default,gate,reads,writes,alert,changeAccount:(id:string|null)=>{gate.setUsernameGateAccount(id);listeners.forEach(fn=>fn());}};
}
async function mount(h:any){let tree:any;await act(async()=>{tree=create(<h.Screen/>);await flush();});return tree;}
const toggle=(tree:any,index:number)=>tree.root.findAllByType('Switch').find((x:any)=>x.props.accessibilityLabel===labels[index]);
const retry=(tree:any,index:number)=>tree.root.findAllByType('Button').find((x:any)=>x.props.title==='Retry '+labels[index]);
async function close(tree:any){await act(async()=>tree.unmount());}
for(const index of [0,1,2]){
 test(labels[index]+': initial unknown blocks writes and success enables actual value',async()=>{const h=harness(),read=deferred();h.reads[index].mockReturnValueOnce(read.promise);const tree=await mount(h);expect(toggle(tree,index)).toBeUndefined();expect(tree.root.findAllByType('Text').find((x:any)=>x.props.accessibilityLabel===labels[index]).props.accessibilityValue.text).toBe('Loading');expect(h.writes[index]).not.toHaveBeenCalled();await act(async()=>{read.resolve(false);await flush();});expect(toggle(tree,index).props.value).toBe(false);await close(tree);});
 test(labels[index]+': same-tick two-success overlap submits only first; readback wins',async()=>{const h=harness(),write=deferred();const tree=await mount(h);const stale=toggle(tree,index).props.onValueChange;h.writes[index].mockReturnValueOnce(write.promise);h.reads[index].mockResolvedValueOnce(false);await act(async()=>{stale(false);stale(true);await flush();});expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(toggle(tree,index).props.disabled).toBe(true);await act(async()=>{write.resolve(undefined);await flush();});expect(toggle(tree,index).props.value).toBe(false);expect(h.writes[index].mock.calls[0][1]).toBe(h.gate.usernameGateSession());await close(tree);});
 test(labels[index]+': two attempted overlapping failures cannot blind-roll back',async()=>{const h=harness(),first=deferred(),second=deferred();const tree=await mount(h);h.writes[index].mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const stale=toggle(tree,index).props.onValueChange;await act(async()=>{stale(false);stale(true);await flush();});expect(h.writes[index]).toHaveBeenCalledTimes(1);await act(async()=>{first.reject(Error('first'));await flush();});expect(toggle(tree,index).props.value).toBe(true);expect(retry(tree,index)).toBeDefined();await act(async()=>{toggle(tree,index).props.onValueChange(false);await flush();second.reject(Error('second'));await flush();});expect(toggle(tree,index).props.value).toBe(true);expect(h.writes[index]).toHaveBeenCalledTimes(2);expect(h.alert).not.toHaveBeenCalled();await close(tree);});
 test(labels[index]+': initial failure stays unknown; retry resets loading without a default',async()=>{const h=harness();h.reads[index].mockRejectedValueOnce(Error('read'));const tree=await mount(h);expect(toggle(tree,index)).toBeUndefined();const pending=deferred();h.reads[index].mockReturnValueOnce(pending.promise);const press=retry(tree,index).props.onPress;await act(async()=>{press();press();await flush();});expect(h.reads[index]).toHaveBeenCalledTimes(2);expect(toggle(tree,index)).toBeUndefined();await act(async()=>{pending.resolve(false);await flush();});expect(toggle(tree,index).props.value).toBe(false);expect(retry(tree,index)).toBeUndefined();await close(tree);});
 test(labels[index]+': failed reconciliation hides value and stale handler cannot write; retry reads only',async()=>{const h=harness();const tree=await mount(h),stale=toggle(tree,index).props.onValueChange;h.writes[index].mockRejectedValueOnce(Error('write'));h.reads[index].mockRejectedValueOnce(Error('reconcile'));await act(async()=>{stale(false);await flush();});expect(toggle(tree,index)).toBeUndefined();await act(async()=>{stale(false);await flush();});expect(h.writes[index]).toHaveBeenCalledTimes(1);h.reads[index].mockResolvedValueOnce(false);await act(async()=>{retry(tree,index).props.onPress();await flush();});expect(toggle(tree,index).props.value).toBe(false);expect(h.writes[index]).toHaveBeenCalledTimes(1);await close(tree);});
 test(labels[index]+': readback is required after successful zero-row-shaped write',async()=>{const h=harness(),tree=await mount(h);await act(async()=>{toggle(tree,index).props.onValueChange(false);await flush();});expect(h.reads[index]).toHaveBeenCalledTimes(2);expect(toggle(tree,index).props.value).toBe(true);expect(retry(tree,index)).toBeDefined();await close(tree);});
 test(labels[index]+': A read cannot overwrite B mutation; old handlers are inert',async()=>{const h=harness(),initial=deferred();h.reads[index].mockReturnValueOnce(initial.promise);const tree=await mount(h);await act(async()=>{h.changeAccount('B');await flush();});const token=h.gate.usernameGateSession();h.reads[index].mockResolvedValueOnce(false);await act(async()=>{toggle(tree,index).props.onValueChange(false);await flush();});expect(h.writes[index].mock.calls[0][1]).toBe(token);await act(async()=>{initial.resolve(true);await flush();});expect(toggle(tree,index).props.value).toBe(false);await close(tree);});
 test(labels[index]+': unmount blocks retained handler and pending completion/reconciliation',async()=>{const h=harness(),tree=await mount(h),write=deferred(),stale=toggle(tree,index).props.onValueChange;h.writes[index].mockReturnValueOnce(write.promise);await act(async()=>{stale(false);await flush();});await close(tree);await act(async()=>{write.reject(Error('late'));stale(false);await flush();});expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(h.reads[index]).toHaveBeenCalledTimes(1);expect(h.alert).not.toHaveBeenCalled();});
 test(labels[index]+': same mount account replacement invalidates pending A completion',async()=>{const h=harness(),tree=await mount(h),write=deferred(),stale=toggle(tree,index).props.onValueChange;h.writes[index].mockReturnValueOnce(write.promise);await act(async()=>{stale(false);h.changeAccount('B');await flush();});expect(toggle(tree,index).props.value).toBe(true);const reads=h.reads[index].mock.calls.length;await act(async()=>{write.resolve(undefined);stale(false);await flush();});expect(h.reads[index]).toHaveBeenCalledTimes(reads);expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(toggle(tree,index).props.value).toBe(true);await close(tree);});
}
for(const index of [0,1,2])test(labels[index]+': duplicate identical callback has one synchronous write slot',async()=>{const h=harness(),tree=await mount(h),write=deferred(),stale=toggle(tree,index).props.onValueChange;h.writes[index].mockReturnValue(write.promise);await act(async()=>{stale(false);stale(false);await flush();});expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(toggle(tree,index).props.disabled).toBe(true);await act(async()=>{write.resolve(undefined);await flush();});await close(tree);});
test('signed-out reset shows unknown for all three; next account reads fresh',async()=>{const h=harness(),tree=await mount(h),stale=toggle(tree,0).props.onValueChange;await act(async()=>{h.changeAccount(null);stale(false);await flush();});for(const i of [0,1,2]){expect(toggle(tree,i)).toBeUndefined();expect(retry(tree,i)).toBeDefined();expect(h.writes[i]).not.toHaveBeenCalled();h.reads[i].mockResolvedValueOnce(false);}await act(async()=>{h.changeAccount('B');await flush();});for(const i of [0,1,2])expect(toggle(tree,i).props.value).toBe(false);await close(tree);});
test('different preferences can overlap without changing each other or accepting duplicates',async()=>{const h=harness(),tree=await mount(h),a=deferred(),b=deferred();h.writes[0].mockReturnValueOnce(a.promise);h.writes[1].mockReturnValueOnce(b.promise);h.reads[0].mockResolvedValueOnce(false);await act(async()=>{toggle(tree,0).props.onValueChange(false);toggle(tree,1).props.onValueChange(false);await flush();});expect(h.writes[0]).toHaveBeenCalledTimes(1);expect(h.writes[1]).toHaveBeenCalledTimes(1);expect(toggle(tree,2).props.disabled).toBe(false);await act(async()=>{b.reject(Error('likes failed'));await flush();a.resolve(undefined);await flush();});expect(toggle(tree,0).props.value).toBe(false);expect(toggle(tree,1).props.value).toBe(true);expect(toggle(tree,2).props.value).toBe(true);await close(tree);});
