/* Offline actual PostgreSQL via existing PGlite. No network or repo writes.
 * node local-sql.test.cjs [path/to/pglite]
 */
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {PGlite}=require(process.argv[2] || '@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, q=n=>`'${id(n)}'`;
const A=1,B=2,C=3,D=4;
const exec=s=>db.exec(s), rows=async s=>(await db.query(s)).rows, scalar=async s=>Object.values((await rows(s))[0])[0];
async function owner(s){await exec('reset role');return exec(s);}
async function as(n,role='authenticated'){await exec(`reset role;set local role ${role};select set_config('request.jwt.claims','${n?JSON.stringify({sub:id(n)}):'{}'}',true);`);}
async function deny(sql,code='42501') {await exec('savepoint bad');let err;try{await exec(sql);}catch(e){err=e;}await exec('rollback to bad;release bad');assert.equal(err?.code,code,err?.message||'unexpected success');}
const results=[];
async function test(name,body){await exec('begin');try{await body();results.push({name,pass:true});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.error('FAIL',name,e.message);}finally{await exec('rollback');}}
const visit=(v,u,pub=true,when="now() - interval '35 days'")=>`insert into visits(id,user_id,restaurant_id,is_public,visited_at) values(${q(v)},${q(u)},${q(50)},${pub},${when});`;
const event=(e,u,v='null')=>`insert into feed_events(id,user_id,visit_id) values(${q(e)},${q(u)},${v==='null'?'null':q(v)});`;
const comment=(c,u,e,parent=null)=>`insert into feed_comments(id,user_id,feed_event_id,body,parent_id) values(${q(c)},${q(u)},${q(e)},'test',${parent?q(parent):'null'});`;
const like=(u,e)=>`insert into feed_likes(user_id,feed_event_id) values(${q(u)},${q(e)});`;
async function visibility(v){await owner(`update profiles set profile_visibility='${v}' where id=${q(B)}`);}
async function block(direction='out'){await owner(`insert into blocked_users values(${q(direction==='out'?A:B)},${q(direction==='out'?B:A)})`);}
async function oneWay(){await owner(`delete from follows where follower_id=${q(B)} and followee_id=${q(A)}`);}
async function count(sql,n){assert.equal(Number(await scalar(sql)),n);}
(async()=>{
 await exec(fs.readFileSync(path.join(__dirname,'minimal-fixture.sql'),'utf8'));
 await exec(`insert into auth.users values(${q(A)}),(${q(B)}),(${q(C)}),(${q(D)});
 insert into profiles(id,display_name,profile_visibility,timezone,push_token,push_social_activity) select id,'person','public','UTC','fake-token',true from auth.users;
 insert into follows(follower_id,followee_id) values(${q(A)},${q(B)}),(${q(B)},${q(A)});
 insert into restaurants(id,google_place_id,name,city,region) values(${q(50)},'fake-place','Fixture place','Fixture city','Fixture region');
 ${visit(101,A)}${visit(102,B)}${visit(103,B,false)}${visit(104,B)}
 ${event(201,A,101)}${event(202,B,102)}${event(203,B,103)}${event(204,C)}${event(205,B)}
 insert into place_ratings values(${q(B)},${q(50)},1600,3);
 ${comment(301,B,202)}${comment(302,C,204)}${comment(303,B,203)}${comment(304,C,202)}
 delete from push_outbox;`);
 // Negative controls exercise original migration functions/policies with the same real roles.
 await test('BASELINE: own forged event exposes another user hidden visit through list_feed',async()=>{await as(A);await exec(event(299,A,103));assert.equal((await rows(`select photo_url,visited_at from list_feed() where id=${q(299)}`)).length,1);});
 await test('BASELINE: blocked taste reader still authorizes',async()=>{await block();await as(A);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).authorized,true);});
 await test('BASELINE: private mutual shared/ranked readers leak rows',async()=>{await visibility('private');await as(A);await count(`select count(*) from shared_places(${q(B)})`,1);await count(`select count(*) from top_ranked_places(${q(B)})`,1);});
 await test('BASELINE: hidden city visit contributes to count',async()=>{await as(A);assert.equal((await rows('select * from friends_cities()'))[0].visit_count,3);});
 await test('BASELINE: hidden post accepts like and enqueues notification',async()=>{await as(A);await exec(like(A,203));await owner('');await count('select count(*) from push_outbox',1);});
 await test('BASELINE: cross-post reply allowed',async()=>{await as(A);await exec(comment(399,A,202,302));});
 await test('BASELINE: hidden visit enqueues friend push',async()=>{await owner(visit(199,B,false));await count('select count(*) from push_outbox',1);});
 let before;
 await test('BASELINE: capture independent feed-selection set',async()=>{await as(A);before=(await rows('select id from list_feed() order by id')).map(r=>r.id);assert(before.includes(id(204)),'0148 already includes public non-followed author');});
 await exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/0183_social_privacy_integrity.sql'),'utf8'));
 await test('PATCH: selection parity with 0148; non-followed public author unchanged',async()=>{await as(A);assert.deepEqual((await rows('select id from list_feed() order by id')).map(r=>r.id),before);});
 await test('PATCH: forged own visit link insert refused even when target visit public',async()=>{await as(A);await deny(event(299,A,102));await deny(event(299,A,103));});
 await test('PATCH: seeded forged event hidden from author raw/RPC/comments and likes',async()=>{await owner(event(299,A,103)+comment(399,B,299));await as(A);await count(`select count(*) from feed_events where id=${q(299)}`,0);await count(`select count(*) from list_feed() where id=${q(299)}`,0);assert.equal(await scalar(`select can_view_feed_event(${q(299)})`),false);await count(`select count(*) from list_feed_comments(${q(299)})`,0);await deny(like(A,299));await deny(comment(398,A,299));});
 await test('PATCH: owner retains hidden visit event; other viewer denied',async()=>{await as(B);assert.equal(await scalar(`select can_view_feed_event(${q(203)})`),true);await count(`select count(*) from list_feed() where id=${q(203)}`,1);await as(A);await count(`select count(*) from feed_events where id=${q(203)}`,0);});
 for(const d of ['out','in'])await test(`PATCH: ${d} block denies taste/shared/rank/cities/raw feed/likes with retained mutual follows`,async()=>{await block(d);await as(A);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).authorized,false);for(const f of [`shared_places(${q(B)})`,`top_ranked_places(${q(B)})`,'friends_cities()'])await count(`select count(*) from ${f}`,0);await count(`select count(*) from feed_events where user_id=${q(B)}`,0);await deny(like(A,202));});
 await test('PATCH: self taste retains full ledger including hidden',async()=>{await as(B);const x=await scalar(`select friend_taste_features(${q(B)})`);assert.equal(x.authorized,true);assert.equal(x.visit_count,3);});
 await test('PATCH: public other taste only public ledger',async()=>{await as(A);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).visit_count,2);});
 await test('PATCH: private mutual reader/like/comment denial',async()=>{await visibility('private');await as(A);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).authorized,false);await count(`select count(*) from shared_places(${q(B)})`,0);await count(`select count(*) from top_ranked_places(${q(B)})`,0);await deny(like(A,202));await deny(comment(399,A,202));});
 await test('PATCH: friends one-way denial',async()=>{await visibility('friends');await oneWay();await as(A);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).authorized,false);await count(`select count(*) from shared_places(${q(B)})`,0);await count(`select count(*) from top_ranked_places(${q(B)})`,0);await count('select count(*) from friends_cities()',0);await deny(like(A,202));});
 await test('PATCH: friends mutual allows readers/likes/replies',async()=>{await visibility('friends');await as(A);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).authorized,true);await count(`select count(*) from shared_places(${q(B)})`,1);await count(`select count(*) from top_ranked_places(${q(B)})`,1);await exec(like(A,202)+comment(399,A,202,301));});
 for(const n of [0,1,2])await test(`PATCH: cities require 2 public visits (${n} public; hidden newer)`,async()=>{await owner(`update visits set is_public=false,visited_at=now() where user_id=${q(B)};update visits set is_public=true,visited_at=now()-interval '35 days' where id in (${[102,104].slice(0,n).map(q).join(',')||'null'});`);await as(A);const r=await rows('select * from friends_cities()');assert.equal(r.length,n===2?1:0);if(n===2){assert.equal(r[0].visit_count,2);assert.equal(String(r[0].last_month).slice(0,10),String(await scalar("select date_trunc('month',now()-interval '35 days')::date")).slice(0,10));}});
 await test('PATCH: hidden like denial leaves no row or outbox',async()=>{await as(A);await deny(like(A,203));await owner('');await count('select count(*) from feed_likes',0);await count('select count(*) from push_outbox',0);});
 await test('PATCH: visible like enqueues one notification; spoofed liker denied',async()=>{await as(A);await deny(like(C,202));await exec(like(A,202));await owner('');await count('select count(*) from push_outbox',1);});
 for(const [name,parent,code]of [['cross-public',302,'23514'],['cross-hidden',303,'23514'],['missing',398,'23514'],['self',399,'23514']])await test(`PATCH: reply ${name} refused`,async()=>{await as(A);await deny(comment(399,A,202,parent),code);await owner('');await count('select count(*) from push_outbox',0);});
 await test('PATCH: reply to reply refused; valid reply and root accepted',async()=>{await as(A);await exec(comment(398,A,202,301));await deny(comment(399,A,202,398),'23514');await exec(comment(397,A,202));});
 await test('PATCH: blocked commenter on otherwise visible post cannot receive reply or like',async()=>{await owner(`insert into blocked_users values(${q(A)},${q(C)})`);await as(A);await deny(comment(399,A,202,304),'23514');await deny(`insert into feed_comment_likes values(${q(304)},${q(A)},now())`);await count(`select count(*) from list_feed_comments(${q(202)}) where id=${q(304)}`,0);});
 await test('PATCH: hidden comment cannot be liked',async()=>{await as(A);await deny(`insert into feed_comment_likes values(${q(303)},${q(A)},now())`);});
 await test('PATCH: visible comment like succeeds; spoofed author denied',async()=>{await as(A);await deny(`insert into feed_comment_likes values(${q(301)},${q(C)},now())`);await exec(`insert into feed_comment_likes values(${q(301)},${q(A)},now())`);});
 await test('PATCH: authenticated comment UPDATE has zero affected rows',async()=>{await as(B);await exec(`update feed_comments set feed_event_id=${q(205)} where id=${q(301)}`);await owner('');assert.equal(await scalar(`select feed_event_id from feed_comments where id=${q(301)}`),id(202));});
 for(const [name,set]of [['move root',`feed_event_id=${q(205)}`],['reparent root',`parent_id=${q(304)}`],['change id',`id=${q(390)}`]])await test(`PATCH: service ${name} with existing children rejected`,async()=>{await owner(comment(399,A,202,301));await as(null,'service_role');await deny(`update feed_comments set ${set} where id=${q(301)}`,'23514');await count(`select count(*) from feed_comments where parent_id=${q(301)} and feed_event_id=${q(202)}`,1);});
 await test('PATCH: service cannot move empty root before later child insert',async()=>{await as(null,'service_role');await deny(`update feed_comments set feed_event_id=${q(205)} where id=${q(301)}`,'23514');await exec(comment(399,A,202,301));});
 await test('PATCH: deleting root cascades existing replies and reply likes',async()=>{await owner(comment(399,A,202,301)+`insert into feed_comment_likes values(${q(399)},${q(C)},now())`);await as(B);await exec(`delete from feed_comments where id=${q(301)}`);await owner('');await count(`select count(*) from feed_comments where id in(${q(301)},${q(399)})`,0);await count(`select count(*) from feed_comment_likes where comment_id=${q(399)}`,0);});
 for(const [name,vis,one,hidden,blocked,expected] of [['hidden','public',false,true,false,0],['friends one-way','friends',true,false,false,0],['friends mutual','friends',false,false,false,1],['public one-way','public',true,false,false,1],['private mutual','private',false,false,false,0],['blocked public','public',false,false,true,0]])await test(`PATCH: visit push ${name}`,async()=>{await visibility(vis);if(one)await oneWay();if(blocked)await block();await owner(visit(199,B,!hidden));await count('select count(*) from push_outbox',expected);});
 await test('PATCH: anonymous reader execution denied and raw feed empty',async()=>{await as(null,'anon');for(const f of [`friend_taste_features(${q(B)})`,`shared_places(${q(B)})`,`top_ranked_places(${q(B)})`,'friends_cities()','list_feed()',`can_view_feed_event(${q(202)})`])await deny('select * from '+f);await count('select count(*) from feed_events',0);});
 await test('PATCH: authenticated cannot execute internal parent trigger/are_friends',async()=>{await as(A);await deny('select validate_feed_comment_parent()');await deny(`select are_friends(${q(A)},${q(B)})`);});

 await test('PATCH: private mutual cities denied',async()=>{await visibility('private');await as(A);await count('select count(*) from friends_cities()',0);});
 await test('PATCH: authenticated role without subject has no reader data',async()=>{await as(null);assert.equal((await scalar(`select friend_taste_features(${q(B)})`)).authorized,false);await count('select count(*) from list_feed()',0);await count('select count(*) from friends_cities()',0);await deny(like(A,202));});
 await test('PATCH: service cannot move or reparent an existing reply',async()=>{await owner(comment(399,A,202,301));await as(null,'service_role');await deny(`update feed_comments set feed_event_id=${q(205)} where id=${q(399)}`,'23514');await deny(`update feed_comments set parent_id=${q(304)} where id=${q(399)}`,'23514');});
 await test('PATCH: unrelated viewer cannot delete another comment; post owner can',async()=>{await as(A);await exec(`delete from feed_comments where id=${q(304)}`);await owner('');await count(`select count(*) from feed_comments where id=${q(304)}`,1);await as(B);await exec(`delete from feed_comments where id=${q(304)}`);await owner('');await count(`select count(*) from feed_comments where id=${q(304)}`,0);});
 await test('PATCH: batch delegates blocked/private gates independently per target',async()=>{await block();await as(A);const r=await scalar(`select friend_taste_features_batch(array[${q(A)},${q(B)},${q(C)}]::uuid[])`);assert.equal(r[id(A)].authorized,true);assert.equal(r[id(B)].authorized,false);assert.equal(r[id(C)].authorized,true);});
 for(const [name,vis,one,blocked,expected]of [['outgoing block','public',false,'out',403],['incoming block','public',false,'in',403],['private mutual','private',false,null,403],['friends one-way','friends',true,null,403],['friends mutual','friends',false,null,200],['public one-way','public',true,null,200]])await test(`GROUP actual SQL authorization: ${name}`,async()=>{
   await visibility(vis);if(one)await oneWay();if(blocked)await block(blocked);await as(null,'service_role');
   const r=await require('./group-sql-adapter.cjs')(db,path.resolve(__dirname,'../..'),id(A),id(B));
   assert.equal(r.status,expected,JSON.stringify(r.body));assert.equal(r.reads.includes('visits'),expected===200);
 });
 console.log(JSON.stringify({postgres:await scalar('select version()'),passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));
 await db.close();if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
