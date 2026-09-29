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
for(const [file,name,args,column,value] of readers){
 test(name+' '+column+' reads exact account/column and preserves false',async()=>{const h=harness();expect(await h.load(file)[name](...args,h.gate.usernameGateSession())).toBe(value);expect(h.select).toHaveBeenCalledWith('id, '+column);expect(h.eq).toHaveBeenCalledWith('id','A');});
 test.each(['returned-error','missing-row','wrong-row','null-column','missing-column','wrong-type'])(name+' '+column+' rejects %s without a default',async mode=>{const h=harness();if(mode==='returned-error')h.result.error={message:'synthetic'};if(mode==='missing-row')h.result.data=null;if(mode==='wrong-row')h.result.data.id='B';if(mode==='null-column')h.result.data[column]=null;if(mode==='missing-column')delete h.result.data[column];if(mode==='wrong-type')h.result.data[column]='false';await expect(h.load(file)[name](...args,h.gate.usernameGateSession())).rejects.toBeDefined();});
 test(name+' '+column+' rejects account replacement during query',async()=>{const h=harness(),pending=deferred();h.maybeSingle.mockReturnValueOnce(pending.promise);const read=h.load(file)[name](...args,h.gate.usernameGateSession());for(let i=0;i<10;i++)await Promise.resolve();h.gate.setUsernameGateAccount('B');pending.resolve(h.result);await expect(read).rejects.toThrow(/Account changed/);});
 test(name+' '+column+' rejects mismatched authentication before query',async()=>{const h=harness();h.supabase.auth.getUser.mockResolvedValueOnce({data:{user:{id:'B'}},error:null});await expect(h.load(file)[name](...args,h.gate.usernameGateSession())).rejects.toThrow(/Account changed/);expect(h.select).not.toHaveBeenCalled();});
}
test('legacy consumers retain previous fallback semantics',async()=>{const h=harness();h.result.data=null;h.result.error={message:'old fallback'};expect(await h.load('friend-push').isFriendActivityPushEnabled()).toBe(true);expect(await h.load('social-notifications').getSocialPushPrefs()).toEqual({likes:true,comments:true});});
