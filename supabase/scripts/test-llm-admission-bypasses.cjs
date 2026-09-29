// AST inventory of first-party TS/TSX/JS/MJS in the selected source tree.
// Does not certify obfuscated/dynamically generated code, dependencies or old deployments.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,ts}=require('./llm-admission/runtime.cjs');
const files=new Map();function walk(dir,prefix=''){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','.next','.expo','dist','build','coverage','outputs','ios','android'].includes(ent.name)||ent.isSymbolicLink())continue;const rel=prefix+ent.name;if(ent.isDirectory())walk(path.join(dir,ent.name),rel+'/');else if(/\.(ts|tsx|js|mjs)$/.test(rel))files.set(rel,fs.readFileSync(path.join(dir,ent.name),'utf8'));}}
walk(root);
const allowed='supabase/functions/_shared/llm-admission.mjs';
const prop=n=>ts.isPropertyAccessExpression(n)?n.name.text:ts.isElementAccessExpression(n)&&ts.isStringLiteralLike(n.argumentExpression)?n.argumentExpression.text:null;
function problems(file,text){const out=[],sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);function visit(n){
 if(ts.isStringLiteralLike(n)&&(/@anthropic-ai\/sdk|api\.anthropic\.com|api\.openai\.com/.test(n.text))&&file!==allowed)out.push('vendor import/endpoint');
 if(prop(n)==='create'&&prop(n.expression)==='messages')out.push('direct messages.create reference');
 if(ts.isNewExpression(n)&&/Anthropic/.test(n.expression.getText(sf)))out.push('direct SDK constructor');
 ts.forEachChild(n,visit);
 }visit(sf);return out;}
let passed=0;const violations=[...files].flatMap(([f,s])=>problems(f,s).map(x=>f+': '+x));assert.deepEqual(violations,[]);passed++;console.log('PASS AST vendor/direct-create scan '+files.size+' first-party files');
for(const code of ['import X from "npm:@anthropic-ai/sdk@0.32.1";','const x = import("@anthropic-ai/sdk");','fetch("https://api.anthropic.com/v1/messages");','client.messages.create.bind(client.messages);','client["messages"]["create"]({});']){assert(problems('supabase/functions/new-route/index.ts',code).length);passed++;}
const proxy=files.get('supabase/functions/places-proxy/index.ts'),back=files.get('supabase/functions/classify-cuisine-backfill/index.ts');
for(const [source,actions] of [[proxy,['proxy_blurb','proxy_classify']],[back,['cuisine_backfill']]]){const sf=ts.createSourceFile('x.ts',source,ts.ScriptTarget.Latest,true);const found=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(sf)==='admittedCreate')found.push(n.arguments[2]?.text);ts.forEachChild(n,visit)}visit(sf);assert.deepEqual(found.sort(),actions.sort());passed++;}
assert(!/messages\.create|new Anthropic/.test(proxy+back));assert(proxy.includes('editorial_blurb: blurb ?? ""'));assert(back.includes('if (lastDispatched) await persistRestaurant'));passed++;
const adapter=files.get('supabase/functions/_shared/llm-admission-edge.ts');
assert(adapter.includes('database: Database,') && !adapter.includes('rpc: (name:'));
assert(adapter.includes('await databaseRpc(database, "confirm_llm_v1"'));
assert(adapter.includes('if (confirmed !== true) throw'));
assert(adapter.includes('cache: "no-store"'));
passed++;
// Execute the disabled operator function itself, even if the outer flag guard is removed.
const script=files.get('supabase/scripts/backfill-classifier.ts');const body=script.slice(script.indexOf('async function getLLMCreate()'),script.indexOf('\nmain().catch'));
const vm=require('node:vm');const fn=vm.runInNewContext(ts.transpileModule(body+'\ngetLLMCreate;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{fetch(){throw Error('Forbidden transport')}});
(async()=>{await assert.rejects(fn(),/Paid operator classification disabled/);passed++;
// Mobile callback likewise throws even if a future runner invokes the skipped body.
const mobile=files.get('mobile/lib/__tests__/classifier-llm-eval.test.ts');const cb=mobile.slice(mobile.indexOf('const create:'),mobile.indexOf('\n(ARMED ?'));
const create=vm.runInNewContext(ts.transpileModule(cb+'\ncreate;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{fetch(){throw Error('Forbidden transport')}});await assert.rejects(create({}),/Paid evaluation disabled/);assert(mobile.includes('const ARMED = false'));passed++;
assert(script.indexOf('if (WITH_LLM) throw')<script.indexOf('const supabase = createClient'));const evalSource=files.get('supabase/eval/run.ts');assert(evalSource.includes('throw new Error("Paid evaluation disabled'));assert(!evalSource.includes('await classifyWithLLM'));passed++;
console.log(JSON.stringify({passed,files:files.size,negativeControls:5,scope:'AST source inventory plus disabled callbacks; not an arbitrary-code sandbox'}));})().catch(e=>{console.error(e);process.exit(1)});
