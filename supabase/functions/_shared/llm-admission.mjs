// Scratch reference implementation. No default network/client: inject explicitly.
export const MODEL='claude-haiku-4-5-20251001';
export const PROFILE='haiku45-text-20260929';
export const RESERVE_MICROS=720000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const nat=x=>Number.isSafeInteger(x)&&x>=0;
const fail=()=>{throw Error('Unsupported LLM request; no admission attempted');};
export function encodeRequest(value){
 // Serialize before the first await; caller mutation cannot change dispatched bytes.
 const r=JSON.parse(JSON.stringify(value));
 if(!keys(r,['model','max_tokens','temperature','system','messages'])||r.model!==MODEL||!nat(r.max_tokens)||r.max_tokens<1||r.max_tokens>64000)fail();
 if(r.temperature!==undefined&&(typeof r.temperature!=='number'||!Number.isFinite(r.temperature)||r.temperature<0||r.temperature>1))fail();
 if(!Array.isArray(r.system)||r.system.length>4||!Array.isArray(r.messages)||r.messages.length!==1)fail();
 for(const s of r.system){
  if(!keys(s,['type','text','cache_control'])||s.type!=='text'||typeof s.text!=='string')fail();
  if(s.cache_control!==undefined&&(!keys(s.cache_control,['type','ttl'])||s.cache_control.type!=='ephemeral'||!['5m','1h',undefined].includes(s.cache_control.ttl)))fail();
 }
 const m=r.messages[0];if(!keys(m,['role','content'])||m.role!=='user'||typeof m.content!=='string')fail();
 const body=JSON.stringify({...r,service_tier:'standard_only'});
 // Operational size limit only. NOT a character-to-token bound.
 if(new TextEncoder().encode(body).length>1_000_000)fail();
 return {body,maxTokens:r.max_tokens};
}
function normalizedUsage(message,maxTokens){
 const u=message?.usage,c=u?.cache_creation;
 if(!object(u)||message.model!==MODEL||typeof message.id!=='string'||!/^msg_[A-Za-z0-9_-]{1,180}$/.test(message.id))return null;
 // Unknown future billing features must not silently become lower estimates.
 if(!keys(u,['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens','cache_creation','service_tier','inference_geo','output_tokens_details','server_tool_use']))return null;
 if(u.service_tier!=null&&u.service_tier!=='standard')return null;
 if(u.inference_geo!=null&&u.inference_geo!=='global')return null;
 // Documented nullable metadata is not an unknown billing feature. Permit only
 // explicit zero tool/thinking details; retain strict rejection of new fields.
 const tools=u.server_tool_use,details=u.output_tokens_details;
 if(tools!=null&&(!keys(tools,['web_fetch_requests','web_search_requests'])||tools.web_fetch_requests!==0||tools.web_search_requests!==0))return null;
 if(details!=null&&(!keys(details,['thinking_tokens'])||details.thinking_tokens!==0))return null;
 const input=u.input_tokens,output=u.output_tokens,read=u.cache_read_input_tokens,write=u.cache_creation_input_tokens;
 if(![input,output,read,write].every(nat))return null;
 // Old SDK/API without TTL breakdown: price every write at the higher 1h rate.
 let w5=0,w1=write;
 if(c!=null){if(!keys(c,['ephemeral_5m_input_tokens','ephemeral_1h_input_tokens']))return null;
  w5=c.ephemeral_5m_input_tokens;w1=c.ephemeral_1h_input_tokens;
  if(![w5,w1].every(nat)||w5+w1!==write)return null;}
 if(input+read+write>200000||output>maxTokens||output>64000)return null;
 return {input,output,cache_read:read,cache_write_5m:w5,cache_write_1h:w1};
}
export async function admittedMessage({rpc,fetchImpl,apiKey,id,action,request,now=Date.now}){
 if(!['proxy_blurb','proxy_classify','cuisine_backfill'].includes(action)||typeof apiKey!=='string'||!apiKey||typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))fail();
 const {body,maxTokens}=encodeRequest(request);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 const args={p_id:id,p_action:action,p_hash:hash,p_profile:PROFILE,p_model:MODEL,p_max_tokens:maxTokens};
 let result;try{result=await rpc('reserve_llm_v1',args);}catch{return {status:'denied',reason:'unconfirmed_admission'};}
 // Do not retry admission, even on transport errors, and never refund its ID.
 const r=result?.data,t=now();
 if(!nat(t)||result?.error||!object(r)||r.admitted!==true||r.id!==id||r.action!==action||r.request_hash!==hash||r.profile!==PROFILE||r.model!==MODEL||r.max_tokens!==maxTokens||r.reserved_micros!==RESERVE_MICROS||!nat(r.admitted_at_ms)||!nat(r.expires_at_ms)||r.expires_at_ms<=r.admitted_at_ms||r.expires_at_ms-r.admitted_at_ms>10000||t<r.admitted_at_ms||t>=r.expires_at_ms)return {status:'denied',reason:'unconfirmed_admission'};
 let message=null,usage=null;
 try{
  // One raw HTTP invocation, fixed host/version/tier, no SDK retries/redirects,
  // no provider tools, beta headers, batch, streaming, thinking or failover.
  const response=await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body});
  if(response.ok){message=await response.json();usage=normalizedUsage(message,maxTokens);}
 }catch{/* A thrown/timeout response may still have incurred cost. Retain full debit. */}
 const settlement={p_id:id,p_hash:hash,p_outcome:usage?'observed':'unknown',p_provider_id:usage?message.id:null,p_usage:usage};
 let acknowledged=false;
 try{const s=await rpc('settle_llm_v1',settlement);acknowledged=!s?.error&&s?.data===true;}catch{/* retain the reservation */}
 return {status:usage?'response':'uncertain',message:usage?message:null,settlementAcknowledged:acknowledged,settlement};
}
