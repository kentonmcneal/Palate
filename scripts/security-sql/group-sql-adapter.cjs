// Real working-tree handler; auth/transport mocked, authorization table reads execute
// as service_role in PGlite. Only the query shapes needed for these tests are supported.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
module.exports=async function runGroup(db,repo,caller,peer){
 const ts=createRequire(path.join(repo,'mobile/package.json'))('typescript'),reads=[];
 let handler;
 const admin={auth:{getUser:async()=>({data:{user:{id:caller}},error:null})},from(table){
  reads.push(table);let filters=[],params=[],selected='*',cap='',ordering='';
  const ident=x=>{if(!/^[a-z_]+$/.test(x))throw Error('Unsupported identifier');return `"${x}"`;};
  const val=x=>{params.push(x);return '$'+params.length;};
  const query={select(s){selected=s;return query;},eq(k,v){filters.push(`${ident(k)}=${val(v)}`);return query;},
   in(k,vs){filters.push(`${ident(k)} in (${vs.map(val).join(',')})`);return query;},
   or(s){if(table==='restaurants_resolved')return query;if(table!=='blocked_users')throw Error('Unexpected OR');filters.push('('+s.split(',').map(piece=>{const [k,op,v]=piece.split('.');if(op!=='eq')throw Error('Unexpected operator');return `${ident(k)}=${val(v)}`;}).join(' or ')+')');return query;},
   order(k,{ascending=true}={}){ordering=` order by ${ident(k)} ${ascending?'asc':'desc'}`;return query;},
   limit(n){if(!Number.isInteger(n))throw Error('Invalid limit');cap=` limit ${n}`;return query;},
   gte(){return query;},lte(){return query;},
   then(resolve,reject){
    // Empty candidate/dislike sources suffice for the allowed authorization control.
    // No scoring/candidate filtering claim is made by these cases.
    if(table==='restaurants_resolved'||table==='place_dislikes')return Promise.resolve({data:[],error:null}).then(resolve,reject);
    const cols=table==='visits'?"(select row_to_json(r) from restaurants r where r.id=visits.restaurant_id) as restaurant":selected.split(',').map(x=>ident(x.trim())).join(',');
    return db.query(`select ${cols} from ${ident(table)}${filters.length?' where '+filters.join(' and '):''}${ordering}${cap}`,params)
      .then(r=>({data:r.rows,error:null})).then(resolve,reject);
   }};return query;
 }};
 const file=path.join(repo,'supabase/functions/group-recs/index.ts');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{exports:{},Request,Response,console,Deno:{env:{get:()=> 'offline-fixture'}},fetch(){throw Error('Network forbidden');},require(name){
  if(name.includes('/http/server'))return{serve:f=>handler=f};if(name.includes('supabase-js'))return{createClient:()=>admin};if(name.endsWith('/err-text.ts'))return{errText:e=>String(e)};throw Error('Unexpected import '+name);
 }},{filename:file});
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture', 'Content-Type':'application/json'},body:JSON.stringify({lat:38,lng:-76,member_ids:[peer]})}));
 return{status:response.status,body:await response.json(),reads};
};
