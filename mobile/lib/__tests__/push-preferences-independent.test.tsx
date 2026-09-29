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
  let localRequire:any;const exports:any={};vm.runInNewContext(compile('../../app/settings.tsx'),{exports,console,require:localRequire=(id:string)=>{
    if(id==='react')return React;
    if(id==='react/jsx-runtime')return require('react/jsx-runtime');
    if(id==='react-native')return {View:'View',Switch:'Switch',ScrollView:'ScrollView',Pressable:'Pressable',Modal:'Modal',Platform:{OS:'ios'},UIManager:{},LayoutAnimation:{configureNext:()=>{},Presets:{easeInEaseOut:{}}},StyleSheet:{create:(x:any)=>x},Alert:{alert},Linking:{},Share:{}};
    if(id==='react-native-safe-area-context')return {SafeAreaView:'SafeAreaView'};
    if(id==='expo-router')return {useRouter:()=>({}),useFocusEffect:()=>{}};
    if(id==='@react-native-async-storage/async-storage')return {getItem:async()=>null};
    if(id==='../components/CollapsibleSection'){const e:any={};vm.runInNewContext(compile('../../components/CollapsibleSection.tsx'),{exports:e,require:localRequire});return e;}
    if(id==='../theme')return {colors:{},spacing:{},type:{}};
    if(id==='../lib/account-write')return {accountWriteSession:gate.usernameGateSession,isAccountWriteSession:gate.isUsernameGateSession};
    if(id==='../lib/supabase')return {supabase:{auth:{getUser:async()=>({data:{user:{id:'A'}}}),onAuthStateChange:(fn:()=>void)=>{listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};}}}};
    if(id==='../lib/friend-push')return {readFriendActivityPushEnabled:reads[0],setFriendActivityPushEnabled:writes[0],isFriendActivityPushEnabled:reads[0]};
    if(id==='../lib/social-notifications')return {readSocialPushPref:(which:string,t:any)=>reads[which==='likes'?1:2](t),setSocialPushPref:(which:string,v:boolean,t:any)=>writes[which==='likes'?1:2](v,t),getSocialPushPrefs:async()=>({likes:true,comments:true})};
    return named;
  }});
  return {Screen:exports.default,gate,reads,writes,alert,changeAccount:(id:string|null)=>{gate.setUsernameGateAccount(id);listeners.forEach(fn=>fn());}};
}
const section=(tree:any)=>tree.root.findAllByType('Pressable').find((n:any)=>n.findAllByType('Text').some((t:any)=>t.props.children==='Wrapped & reminders'));
async function flip(tree:any){await act(async()=>{section(tree).props.onPress();await flush();});}
async function mount(h:any){let tree:any;await act(async()=>{tree=create(<h.Screen/>);await flush();});await flip(tree);return tree;}
const toggle=(tree:any,index:number)=>tree.root.findAllByType('Switch').find((x:any)=>x.props.accessibilityLabel===labels[index]);
const retry=(tree:any,index:number)=>tree.root.findAllByType('Button').find((x:any)=>x.props.title==='Retry '+labels[index]);
async function close(tree:any){await act(async()=>tree.unmount());}
for(const index of [0,1,2]) {
 test(labels[index]+': real section collapse/reopen retains the pending write slot',async()=>{
  const h=harness(),tree=await mount(h),write=deferred();
  h.writes[index].mockReturnValueOnce(write.promise);
  const stale=toggle(tree,index).props.onValueChange;
  await act(async()=>{stale(false);await flush();});
  await flip(tree);expect(toggle(tree,index)).toBeUndefined();await flip(tree);
  await act(async()=>{toggle(tree,index).props.onValueChange(false);stale(false);await flush();});
  expect(h.writes[index]).toHaveBeenCalledTimes(1);
  expect(toggle(tree,index).props.disabled).toBe(true);expect(h.reads[index]).toHaveBeenCalledTimes(1);
  h.reads[index].mockResolvedValueOnce(false);
  await act(async()=>{write.resolve(undefined);await flush();});
  expect(toggle(tree,index).props.value).toBe(false);expect(toggle(tree,index).props.disabled).toBe(false);
  await close(tree);
 });
 test(labels[index]+': collapse during readback preserves reconciliation and its result',async()=>{
  const h=harness(),tree=await mount(h),readback=deferred();h.reads[index].mockReturnValueOnce(readback.promise);
  await act(async()=>{toggle(tree,index).props.onValueChange(false);await flush();});
  expect(h.reads[index]).toHaveBeenCalledTimes(2);await flip(tree);await flip(tree);
  expect(toggle(tree,index).props.disabled).toBe(true);
  expect(h.reads[index]).toHaveBeenCalledTimes(2);
  await act(async()=>{readback.resolve(false);await flush();});
  expect(toggle(tree,index).props.value).toBe(false);expect(retry(tree,index)).toBeUndefined();await close(tree);
 });
 test(labels[index]+': collapse after ambiguous failure does not erase uncertainty',async()=>{
  const h=harness(),tree=await mount(h);h.writes[index].mockRejectedValueOnce(Error('uncertain'));
  await act(async()=>{toggle(tree,index).props.onValueChange(false);await flush();});expect(retry(tree,index)).toBeDefined();
  await flip(tree);await flip(tree);expect(retry(tree,index)).toBeDefined();expect(h.reads[index]).toHaveBeenCalledTimes(2);await close(tree);
 });
 test(labels[index]+': same-tick failures and in-flight readback retain gate until reconciliation settles',async()=>{
  const h=harness(),tree=await mount(h),reconcile=deferred();
  h.writes[index].mockRejectedValueOnce(Error('first')).mockRejectedValueOnce(Error('second'));
  h.reads[index].mockReturnValueOnce(reconcile.promise);
  const stale=toggle(tree,index).props.onValueChange;
  await act(async()=>{stale(false);stale(false);await flush();stale(false);await flush();});
  expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(toggle(tree,index).props.disabled).toBe(true);
  await act(async()=>{reconcile.resolve(true);await flush();});
  expect(toggle(tree,index).props.value).toBe(true);
  await act(async()=>{toggle(tree,index).props.onValueChange(false);await flush();});
  expect(h.writes[index]).toHaveBeenCalledTimes(2);expect(toggle(tree,index).props.value).toBe(true);expect(retry(tree,index)).toBeDefined();await close(tree);
 });
 test(labels[index]+': ABA old write and retained callback cannot read or modify new A',async()=>{
  const h=harness(),tree=await mount(h),write=deferred(),stale=toggle(tree,index).props.onValueChange;
  h.writes[index].mockReturnValueOnce(write.promise);
  await act(async()=>{stale(false);h.changeAccount('B');h.changeAccount('A');await flush();});
  // Replacing the account generation may also reset the surrounding section.
  if(!toggle(tree,index))await flip(tree);
  const before=h.reads[index].mock.calls.length;
  await act(async()=>{write.reject(Error('old A'));stale(false);await flush();});
  expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(h.reads[index]).toHaveBeenCalledTimes(before);expect(toggle(tree,index).props.value).toBe(true);expect(retry(tree,index)).toBeUndefined();await close(tree);
 });
 test(labels[index]+': ABA old initial result cannot overwrite new A read',async()=>{
  const h=harness(),initial=deferred();h.reads[index].mockReturnValueOnce(initial.promise);const tree=await mount(h);
  h.reads[index].mockResolvedValueOnce(false);
  await act(async()=>{h.changeAccount('B');h.changeAccount('A');await flush();});if(!toggle(tree,index))await flip(tree);
  expect(toggle(tree,index).props.value).toBe(false);
  await act(async()=>{initial.resolve(true);await flush();});expect(toggle(tree,index).props.value).toBe(false);await close(tree);
 });
 test(labels[index]+': unmount during readback prevents publication and further work',async()=>{
  const h=harness(),tree=await mount(h),read=deferred(),stale=toggle(tree,index).props.onValueChange;h.reads[index].mockReturnValueOnce(read.promise);
  await act(async()=>{stale(false);await flush();});await close(tree);
  await act(async()=>{read.reject(Error('late read'));stale(false);await flush();});
  expect(h.reads[index]).toHaveBeenCalledTimes(2);expect(h.writes[index]).toHaveBeenCalledTimes(1);expect(h.alert).not.toHaveBeenCalled();
 });
}
for(const index of [0,1,2]) {
 test(labels[index]+': collapse during initial read keeps one request and publishes that result',async()=>{
  const h=harness(),initial=deferred();h.reads[index].mockReturnValueOnce(initial.promise);const tree=await mount(h);await flip(tree);await flip(tree);
  expect(h.reads[index]).toHaveBeenCalledTimes(1);expect(toggle(tree,index)).toBeUndefined();
  await act(async()=>{initial.resolve(false);await flush();});expect(toggle(tree,index).props.value).toBe(false);await close(tree);
 });
 test(labels[index]+': same-ID auth event leaves pending gate and warning intact',async()=>{
  const h=harness(),tree=await mount(h),write=deferred();h.writes[index].mockReturnValueOnce(write.promise);
  await act(async()=>{toggle(tree,index).props.onValueChange(false);h.changeAccount('A');await flush();});
  expect(toggle(tree,index).props.disabled).toBe(true);expect(h.reads[index]).toHaveBeenCalledTimes(1);
  await act(async()=>{write.reject(Error('uncertain'));await flush();h.changeAccount('A');await flush();});
  expect(retry(tree,index)).toBeDefined();expect(h.reads[index]).toHaveBeenCalledTimes(2);await close(tree);
 });
}
