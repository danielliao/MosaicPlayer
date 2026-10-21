import {requestProvider,requestBytes} from './outbound.js';
import {httpError} from './db.js';
const decode=(value,encoding='base64')=>{if(typeof value!=='string'||!value.length||value.length>180*1024**2||!(encoding==='hex'?/^(?:[a-f0-9]{2})+$/i:/^[A-Za-z0-9+/]+={0,2}$/).test(value))throw httpError(502,'Invalid generated asset');return Buffer.from(value,encoding);};
export async function generate(model,job,key,{request=requestProvider,allowHosts=[],signal}={}){
 const base=model.base_url.replace(/\/$/,''),headers={Authorization:`Bearer ${key}`};
 const call=(suffix,json,raw=false)=>request(base+suffix,{method:json===undefined?'GET':'POST',headers,json,raw,allowHosts,signal});
 let result;
 if(model.provider==='gateway'){
 result=await call('/generate',{model:model.model,kind:model.kind,prompt:job.prompt,lyrics:job.lyrics,max_output_tokens:job.max_output_tokens,request_id:job.id});
 if(model.kind==='text'){if(typeof result.text!=='string'||result.text.length>100000)throw httpError(502,'Invalid generated text');return {text:result.text,providerTokens:result.usage?.total_tokens};}
 return {bytes:decode(result.base64),providerTokens:result.usage?.total_tokens};
 }
 if(model.provider==='minimax'){
 if(model.kind!=='music')throw httpError(400,'MiniMax adapter supports music');
 result=await call('/music_generation',{model:model.model,prompt:job.prompt,...(job.lyrics?{lyrics:job.lyrics}:{is_instrumental:true}),output_format:'hex',stream:false,audio_setting:{sample_rate:44100,bitrate:256000,format:'mp3'}});
 if(result.base_resp?.status_code!==0)throw httpError(502,'Music provider rejected generation');return {bytes:decode(result.data?.audio,'hex')};
 }
 if(model.kind==='text'){
 result=await call('/chat/completions',{model:model.model,messages:[{role:'user',content:job.prompt}],max_tokens:job.max_output_tokens,stream:false});const text=result.choices?.[0]?.message?.content;if(typeof text!=='string'||text.length>100000)throw httpError(502,'Invalid generated text');return {text,providerTokens:result.usage?.total_tokens};
 }
 if(model.kind==='image'){
 result=await call('/images/generations',{model:model.model,prompt:job.prompt,n:1});const item=result.data?.[0];return {bytes:item?.b64_json?decode(item.b64_json):await requestBytes(item?.url,{allowHosts:[],signal}),providerTokens:result.usage?.total_tokens};
 }
 if(model.kind==='video'){
 if(!job.provider_id){const form=new FormData();form.set('model',model.model);form.set('prompt',job.prompt);form.set('seconds','4');form.set('size','1280x720');const prepared=new Request(base+'/videos',{method:'POST',body:form});result=await request(base+'/videos',{method:'POST',headers:{...headers,'Content-Type':prepared.headers.get('content-type')},body:Buffer.from(await prepared.arrayBuffer()),allowHosts,signal});if(!/^[A-Za-z0-9_-]{1,200}$/.test(result.id||''))throw httpError(502,'Invalid video job ID');return {providerId:result.id};}
 const id=encodeURIComponent(job.provider_id);result=await call('/videos/'+id);if(result.status==='failed')throw httpError(502,'Video generation failed');if(result.status!=='completed')return {providerId:job.provider_id};return {bytes:await call('/videos/'+id+'/content',undefined,true)};
 }
 throw httpError(400,'Unsupported provider capability');
}
