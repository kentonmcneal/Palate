const fs=require('node:fs'),path=require('node:path'),{ts,root}=require('./llm-admission/runtime.cjs');
const options={strict:true,noEmit:true,allowJs:true,checkJs:false,allowImportingTsExtensions:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,types:[]};
const host=ts.createCompilerHost(options);
const program=ts.createProgram([root+'/supabase/functions/_shared/llm-admission-edge.ts'],options,host);const ds=ts.getPreEmitDiagnostics(program);
for(const d of ds)console.log((d.file?.fileName??'')+': TS'+d.code+' '+ts.flattenDiagnosticMessageText(d.messageText,'\n'));
console.log(JSON.stringify({diagnostics:ds.length,scope:'adapter and actual shared classifier types; not pinned Deno'}));process.exitCode=ds.length?1:0;
