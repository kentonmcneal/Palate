import { readFileSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';
import ts from 'typescript';
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
function harness(){
 const result={data:{id:'A',push_social_activity:false,push_post_likes:false,push_post_comments:true},error:null} as any;
 const maybeSingle=jest.fn(async()=>result),eq=jest.fn(()=>({maybeSingle})),select=jest.fn(()=>({eq}));
 const supabase={auth:{getUser:jest.fn(async()=>({data:{user:{id:'A'}},error:null}))},from:jest.fn(()=>({select}))};
 const cache:Record<string,any>={};function load(name:string):any{if(cache[name])return cache[name];const exports=cache[name]={};vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname,'../'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:(id:string)=>id==='./supabase'?{supabase}:load(id.slice(2))});return exports;}
 const gate=load('username-gate');gate.setUsernameGateAccount('A');return {result,maybeSingle,eq,select,supabase,load,gate};
}
const readers=[['friend-push','readFriendActivityPushEnabled',[], 'push_social_activity',false],['social-notifications','readSocialPushPref',['likes'],'push_post_likes',false],['social-notifications','readSocialPushPref',['comments'],'push_post_comments',true]] as const;
for(const [file,name,args,column] of readers){
 test(column+': deferred getUser from A cannot query after ABA',async()=>{const h=harness(),pending=deferred();h.supabase.auth.getUser.mockReturnValueOnce(pending.promise);const read=h.load(file)[name](...args,h.gate.usernameGateSession());h.gate.setUsernameGateAccount('B');h.gate.setUsernameGateAccount('A');pending.resolve({data:{user:{id:'A'}},error:null});await expect(read).rejects.toThrow(/Account changed/);expect(h.supabase.from).not.toHaveBeenCalled();});
 test(column+': in-flight row from A is rejected after ABA',async()=>{const h=harness(),pending=deferred();h.maybeSingle.mockReturnValueOnce(pending.promise);const read=h.load(file)[name](...args,h.gate.usernameGateSession());for(let i=0;i<10;i++)await Promise.resolve();expect(h.select).toHaveBeenCalledTimes(1);h.gate.setUsernameGateAccount('B');h.gate.setUsernameGateAccount('A');pending.resolve(h.result);await expect(read).rejects.toThrow(/Account changed/);});
 test(column+': stale token is rejected before auth work',async()=>{const h=harness(),token=h.gate.usernameGateSession();h.gate.setUsernameGateAccount('B');h.gate.setUsernameGateAccount('A');await expect(h.load(file)[name](...args,token)).rejects.toThrow(/Account changed/);expect(h.supabase.auth.getUser).not.toHaveBeenCalled();expect(h.supabase.from).not.toHaveBeenCalled();});
 test(column+': returned auth error with user is still rejected',async()=>{const h=harness();const error={message:'auth failure'};h.supabase.auth.getUser.mockResolvedValueOnce({data:{user:{id:'A'}},error} as any);await expect(h.load(file)[name](...args,h.gate.usernameGateSession())).rejects.toBe(error);expect(h.supabase.from).not.toHaveBeenCalled();});
 test(column+': thrown query error has no enabled fallback',async()=>{const h=harness();h.maybeSingle.mockRejectedValueOnce(Error('network'));await expect(h.load(file)[name](...args,h.gate.usernameGateSession())).rejects.toThrow('network');});
 test(column+': same-account notification preserves a pending valid read',async()=>{const h=harness(),pending=deferred(),token=h.gate.usernameGateSession();h.maybeSingle.mockReturnValueOnce(pending.promise);const read=h.load(file)[name](...args,token);for(let i=0;i<10;i++)await Promise.resolve();h.gate.setUsernameGateAccount('A');pending.resolve(h.result);await expect(read).resolves.toBe(h.result.data[column]);});
}
