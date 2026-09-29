// Actual local PostgreSQL functions/RLS/ACLs. No network or repository writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const db=new PGlite(),results=[];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,q=n=>`'${id(n)}'`;
const exec=s=>db.exec(s),rows=async(s,p)=>(await db.query(s,p)).rows;
async function as(n,role='authenticated'){await exec(`reset role;set local role ${role};select set_config('request.jwt.claims','${n?JSON.stringify({sub:id(n)}):'{}'}',true)`);}
async function block(a,b){await exec(`reset role;insert into blocked_users values(${q(a)},${q(b)})`);}
const search=async(s)=>(await rows('select * from search_users($1::text)',[s]));
const ids=async(s)=>(await search(s)).map(x=>x.id).sort();
async function denied(fn){await exec('savepoint denial');let err;try{await fn();}catch(e){err=e;}await exec('rollback to denial;release denial');assert.equal(err?.code,'42501');}
async function test(name,body){await exec('begin');try{await body();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);}finally{await exec('rollback');}}
(async()=>{
 await exec(fs.readFileSync(path.join(__dirname,'fixture.sql'),'utf8'));
 await exec(fs.readFileSync(path.join(__dirname,'baseline-search-users.sql'),'utf8'));
 await exec(`insert into auth.users values(${q(1)}),(${q(2)}),(${q(3)}),(${q(4)});
 insert into profiles values
 (${q(1)},'alice@example.invalid','Alice','alice',null,'public'),
 (${q(2)},'exact-b@example.invalid','Private Target','target_b',null,'private'),
 (${q(3)},'exact-c@example.invalid','Friends Target','target_c',null,'friends'),
 (${q(4)},'exact-d@example.invalid','Public Target','target_d',null,'public');`);
 for(const [name,a,b]of [['outgoing',1,2],['incoming',2,1]])await test(`BASELINE: ${name} block still discloses target through name/username/exact email`,async()=>{await block(a,b);await as(1);for(const term of ['Private Target','target_b','exact-b@example.invalid'])assert.deepEqual(await ids(term),[id(2)]);});
 let original;await test('BASELINE: capture unblocked search contract for all visibility levels',async()=>{await as(1);original=await search('Target');assert.deepEqual(original.map(r=>r.id).sort(),[id(2),id(3),id(4)]);});
 const candidate=fs.readFileSync(path.join(__dirname,'../../../supabase/migrations/0184_search_respects_blocks.sql'),'utf8');await exec(candidate);
 await test('PATCH: unblocked results and output fields identical to baseline',async()=>{await as(1);assert.deepEqual(await search('Target'),original);for(const r of await search('Target'))assert.deepEqual(Object.keys(r).sort(),['avatar_url','display_name','id','profile_visibility','username']);});
 for(const [name,a,b]of [['outgoing',1,2],['incoming',2,1]])await test(`PATCH: ${name} block excludes exact email, name and username prefix`,async()=>{await block(a,b);await as(1);for(const term of ['Private Target','target_b','exact-b@example.invalid'])assert.deepEqual(await ids(term),[]);assert.deepEqual(await ids('Target'),[id(3),id(4)]);});
 await test('PATCH: reciprocal blocks excluded',async()=>{await block(1,2);await block(2,1);await as(1);assert.deepEqual(await ids('target_b'),[]);});
 await test('PATCH: inbound block hidden by raw RLS still enforced by definer',async()=>{await block(2,1);await as(1);assert.equal((await rows('select * from blocked_users')).length,0);assert.deepEqual(await ids('target_b'),[]);});
 await test('PATCH: unrelated users block does not exclude either from caller search',async()=>{await block(2,3);await as(1);assert.deepEqual(await ids('Target'),[id(2),id(3),id(4)]);});
 await test('PATCH: block evaluated for current caller, not a global target ban',async()=>{await block(1,2);await as(3);assert.deepEqual(await ids('target_b'),[id(2)]);});
 await test('PATCH: private/friends bare identities remain discoverable when unblocked',async()=>{await as(1);assert.equal((await search('Private Target'))[0].profile_visibility,'private');assert.equal((await search('Friends Target'))[0].profile_visibility,'friends');});
 await test('PATCH: exact email is trimmed/case insensitive but prefix never matches',async()=>{await as(1);assert.deepEqual(await ids('  EXACT-B@EXAMPLE.INVALID  '),[id(2)]);assert.deepEqual(await ids('exact-b@'),[]);});
 await test('PATCH: display substring and username prefix semantics retained',async()=>{await as(1);assert.deepEqual(await ids('rivate'),[id(2)]);assert.deepEqual(await ids('TARGET_B'),[id(2)]);assert.deepEqual(await ids('arget_b'),[]);});
 await test('PATCH: empty, whitespace, short and NULL queries return no rows',async()=>{await as(1);for(const term of ['', ' ', ' a ', 'ab', null])assert.deepEqual(await ids(term),[]);});
 await test('PATCH: self excluded for display, username and exact email',async()=>{await as(1);for(const term of ['Alice','alice@example.invalid'])assert.deepEqual(await ids(term),[]);});
 await test('PATCH: anon denied execute and missing authenticated subject returns no rows',async()=>{await as(null,'anon');await denied(()=>search('Target'));await as(null);assert.deepEqual(await ids('Target'),[]);});
 await test('PATCH: wildcard query still cannot cross either block direction',async()=>{await block(1,2);await block(3,1);await as(1);assert.deepEqual(await ids('%%%'),[id(4)]);});
 await test('PATCH: remove own block restores identity on next read',async()=>{await block(1,2);await as(1);assert.deepEqual(await ids('target_b'),[]);await exec(`delete from blocked_users where blocker_id=${q(1)} and blocked_id=${q(2)}`);assert.deepEqual(await ids('target_b'),[id(2)]);});
 await test('PATCH: filtering occurs before 20-row cap, preserving 20 allowed results',async()=>{await exec('reset role');for(let n=10;n<60;n++){await exec(`insert into auth.users values(${q(n)});insert into profiles values(${q(n)},'bulk${n}@example.invalid','Bulk result ${n}','bulk${n}',null,'public')`);if(n<35)await block(1,n);}await as(1);const r=await search('Bulk');assert.equal(r.length,20);assert(r.every(p=>Number(p.id.slice(-12))>=35));});
 await test('PATCH: SQL return shape and stable definer/search_path preserved',async()=>{await exec('reset role');const [r]=await rows("select prosecdef,provolatile,proconfig from pg_proc where oid='search_users(text)'::regprocedure");assert.equal(r.prosecdef,true);assert.equal(r.provolatile,'s');assert(r.proconfig.includes('search_path=public'));});
 console.log(JSON.stringify({postgres:(await rows('select version()'))[0].version,candidateSha256:crypto.createHash('sha256').update(candidate).digest('hex'),passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length}));
 await db.close();if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
