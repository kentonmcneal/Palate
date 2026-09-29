const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const {root,repo,ts}=require('./llm-admission/runtime.cjs');
let paid=0,clients=0,passed=0;
function evaluate(file,argv,extra={}){let text=fs.readFileSync(file,'utf8');text=text.replace('import.meta.url',JSON.stringify(pathToFileURL(repo+'/supabase/eval/run.ts').href));if(file.endsWith('/eval/run.ts'))text=text.slice(0,text.indexOf('main().catch'))+'\nexport {main};';const m={exports:{}};const req=id=>{if(id==='@supabase/supabase-js')return{createClient(){clients++;throw Error('operator client should not be constructed')}};if(id.startsWith('node:'))return require(id);if(id.includes('classifier'))return{CLASSIFIER_VERSION:'offline',deriveClassification:()=>({})};throw Error('Unexpected import '+id)};
vm.runInNewContext('(function(require,module,exports){'+ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'})',{process:{argv:['node','offline',...argv],env:{ANTHROPIC_API_KEY:'synthetic',SUPABASE_URL:'https://offline.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic'},exit(){throw Error('unexpected exit')}},console:{log(){},error(){}},fetch(){paid++;throw Error('forbidden')},...extra})(req,m,m.exports);return m.exports;}
(async()=>{
assert.throws(()=>evaluate(root+'/supabase/scripts/backfill-classifier.ts',['--with-llm','--dry-run']),/Paid operator classification disabled/);assert.equal(clients,0);passed++;
const e=evaluate(root+'/supabase/eval/run.ts',['--with-llm']);await assert.rejects(e.main(),/Paid evaluation disabled/);passed++;
assert.equal(paid,0);console.log(JSON.stringify({passed,paid,clients,scope:'actual operator top-level and eval main; deterministic classifier fixture only'}));
})().catch(e=>{console.error(e);process.exit(1)});
