import {randomUUID} from 'node:crypto';
import {one,rows,tx,httpError,requireValue,audit,camel} from './db.js';
import {secret,digest,requireRole,allowedStore,limiter} from './auth.js';
import {tenantActive,groupFor,viewers,operators,managers,publicDevice,name} from './admin.js';
import {authorizedMedia,permittedMedia,mediaPublic} from './media.js';
import {dependencies} from './schedule.js';
const safeKey=k=>{const {keyHash,...out}=camel(k);return out;};
const scopes=['read','control','ai'];
export async function identifyIntegration(pool,req){const token=req.headers.authorization?.match(/^Bearer (mosaic_api_[A-Za-z0-9_-]+)$/)?.[1];if(!token)return null;const row=await one(pool,'SELECT * FROM auth_api_key($1)',[digest(token)]);if(!row)return null;const user=camel(row.user_data),key=camel(row.key_data);return {...user,platform:false,apiKeyId:key.id,apiScopes:key.scopes};}
export function installIntegrations({app,route,pool,programs,ai}){
 route('get','/api/integrations/keys',['tenant_admin'],async(c,i)=>(await rows(c,'SELECT * FROM api_keys ORDER BY created_at DESC')).map(safeKey));
 route('post','/api/integrations/keys',['tenant_admin'],async(c,i,r)=>{if(i.support)throw httpError(403,'Support sessions cannot issue integration keys');await tenantActive(c,i);const b=r.body;if(!Array.isArray(b.scopes)||!b.scopes.length||b.scopes.some(s=>!scopes.includes(s))||!Number.isInteger(b.expiresInDays)||b.expiresInDays<1||b.expiresInDays>365)throw httpError(400,'Invalid scopes or expiration');const count=await one(c,'SELECT count(*) AS n FROM api_keys WHERE revoked_at IS NULL AND expires_at>now()');if(Number(count.n)>=50)throw httpError(409,'Too many active integration keys');const id=randomUUID(),key='mosaic_api_'+secret();await c.query('INSERT INTO api_keys(id,tenant_id,user_id,name,key_hash,scopes,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7)',[id,i.tenantId,i.id,name(b.name),digest(key),[...new Set(b.scopes)],new Date(Date.now()+b.expiresInDays*86400e3)]);await audit(c,i,'integration.key.create',id,{scopes:b.scopes});return {status:201,value:{key,record:safeKey(await one(c,'SELECT * FROM api_keys WHERE id=$1',[id]))}};});
 route('delete','/api/integrations/keys/:id',['tenant_admin'],async(c,i,r)=>{requireValue(await one(c,'UPDATE api_keys SET revoked_at=now() WHERE id=$1 RETURNING id',[r.params.id]));await audit(c,i,'integration.key.revoke',r.params.id);return {ok:true};});
 const listGroups=async(c,i)=>(await rows(c,'SELECT * FROM groups ORDER BY created_at')).filter(g=>allowedStore(i,g.store_id)).map(camel);
 const listDevices=async(c,i)=>(await rows(c,'SELECT * FROM devices ORDER BY created_at')).filter(d=>allowedStore(i,d.store_id)).map(publicDevice);
 const listMedia=async(c,i)=>{const allowed=await permittedMedia(c,i);return (await rows(c,'SELECT * FROM media WHERE NOT archived ORDER BY created_at DESC')).filter(m=>!allowed||allowed.has(m.id)).map(mediaPublic);};
 async function preview(c,i,id){const g=await groupFor(c,i,id);const ids=[...new Set([...dependencies(g.program),...(g.playback?.mediaId?[g.playback.mediaId]:[])])];const media=[];for(const id of ids)media.push(mediaPublic(await authorizedMedia(c,i,id)));return {group:camel(g),media,serverTime:Date.now()};}
 async function control(c,i,r){requireRole(i,operators);if(!['pause','resume','play'].includes(r.body.action))throw httpError(400,'Unsupported controller action');if(r.body.action==='play'&&typeof r.body.mediaId!=='string')throw httpError(400,'mediaId required');return programs.control(c,i,r);}
 route('get','/api/groups/:id/preview',viewers,(c,i,r)=>preview(c,i,r.params.id));route('post','/api/groups/:id/control',operators,control);
 const rate=limiter(120,60000);
 async function authorize(req,res,next){try{const origin=req.headers.origin;if(origin&&origin!==`${req.protocol}://${req.headers.host}`)throw httpError(403,'Invalid request origin');req.identity=await identifyIntegration(pool,req);if(!req.identity)throw httpError(401,'Invalid or expired API key');rate(req.identity.apiKeyId);next();}catch(e){next(e);}}
 function api(method,url,scope,roles,handler){app[method](url,authorize,async(req,res,next)=>{try{if(!req.identity.apiScopes.includes(scope))throw httpError(403,'API scope required: '+scope);requireRole(req.identity,roles);req.afterCommit=[];const value=await tx(pool,req.identity,c=>handler(c,req.identity,req));for(const fn of req.afterCommit)await fn();res.json(value);}catch(e){next(e);}});}
 api('get','/api/v1/ai/models','ai',managers,(c,i)=>ai.listModels(c,i));
 api('get','/api/v1/groups','read',viewers,listGroups);api('get','/api/v1/devices','read',viewers,listDevices);api('get','/api/v1/media','read',viewers,listMedia);api('get','/api/v1/groups/:id/preview','read',viewers,(c,i,r)=>preview(c,i,r.params.id));api('post','/api/v1/groups/:id/control','control',operators,control);api('post','/api/v1/ai/jobs','ai',managers,(c,i,r)=>ai.createJob(c,i,r.body));api('get','/api/v1/ai/jobs/:id','ai',managers,(c,i,r)=>ai.getJob(c,i,r.params.id));
 const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false}),uuid={type:'string',format:'uuid'},tools=[
 ['mosaic_groups','read',viewers,object({}),(c,i)=>listGroups(c,i),'List authorized playback groups'],
 ['mosaic_devices','read',viewers,object({}),(c,i)=>listDevices(c,i),'List authorized devices'],
 ['mosaic_media','read',viewers,object({}),(c,i)=>listMedia(c,i),'List authorized media'],
 ['mosaic_preview','read',viewers,object({groupId:uuid}),(c,i,a)=>preview(c,i,a.groupId),'Preview group timeline; does not contact devices'],
 ['mosaic_control','control',operators,{...object({groupId:uuid,action:{type:'string',enum:['pause','resume','play']},mediaId:{type:'string'}}),required:['groupId','action']},(c,i,a,r)=>control(c,i,{...r,params:{id:a.groupId},body:a}),'Control a group after user confirmation; play needs mediaId'],
 ['mosaic_models','ai',managers,object({}),(c,i)=>ai.listModels(c,i),'List enabled models available to this tenant; no credentials'],
 ['mosaic_generate','ai',managers,object({modelId:uuid,prompt:{type:'string',minLength:1,maxLength:12000},requestId:uuid}),(c,i,a)=>ai.createJob(c,i,a),'Generate using a configured model; consumes quota and may incur charges'],
 ['mosaic_job','ai',managers,object({jobId:uuid}),(c,i,a)=>ai.getJob(c,i,a.jobId),'Read generation status']
 ];
 const available=(i,t)=>i.apiScopes.includes(t[1])&&t[2].includes(i.role);
 const protocol='2025-11-25';
 app.post('/mcp',authorize,async(req,res,next)=>{try{
 const b=req.body;if(!b||Array.isArray(b)||b.jsonrpc!=='2.0'||typeof b.method!=='string'||b.id!==undefined&&typeof b.id!=='number'&&typeof b.id!=='string')return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});
 if(!req.headers.accept?.includes('application/json')||!req.headers.accept?.includes('text/event-stream'))throw httpError(406,'Accept application/json and text/event-stream required');
 if(req.headers['mcp-protocol-version']&&req.headers['mcp-protocol-version']!==protocol)throw httpError(400,'Unsupported MCP protocol version');
 if(b.id===undefined){if(b.method==='notifications/initialized')return res.sendStatus(202);return res.sendStatus(202);}
 const send=result=>res.json({jsonrpc:'2.0',id:b.id,result});
 if(b.method==='initialize')return send({protocolVersion:protocol,capabilities:{tools:{listChanged:false}},serverInfo:{name:'mosaic-player',version:'0.3.0'}});
 if(b.method==='ping')return send({});
 if(b.method==='tools/list')return send({tools:tools.filter(t=>available(req.identity,t)).map(t=>({name:t[0],description:t[5],inputSchema:t[3],annotations:{readOnlyHint:t[1]==='read'||['mosaic_job','mosaic_models'].includes(t[0]),destructiveHint:t[0]==='mosaic_control',idempotentHint:t[1]==='read',openWorldHint:t[1]==='ai'}}))});
 if(b.method==='tools/call'){
 try{const tool=tools.find(t=>t[0]===b.params?.name);if(!tool||!available(req.identity,tool))throw httpError(403,'Tool unavailable or forbidden');const a=b.params?.arguments??{};if(!a||typeof a!=='object'||Array.isArray(a)||tool[3].required.some(k=>a[k]===undefined)||Object.keys(a).some(k=>!Object.hasOwn(tool[3].properties,k))||Object.entries(a).some(([k,v])=>typeof v!=='string'))throw httpError(400,'Invalid tool arguments');req.afterCommit=[];const value=await tx(pool,req.identity,c=>tool[4](c,req.identity,a,req));for(const fn of req.afterCommit)await fn();return send({content:[{type:'text',text:JSON.stringify(value)}],isError:false});}catch(e){return send({content:[{type:'text',text:e.status?e.message:'Tool request failed'}],isError:true});}}
 res.json({jsonrpc:'2.0',id:b.id,error:{code:-32601,message:'Method not found'}});
 }catch(e){next(e);}});
 app.get('/mcp',authorize,(req,res)=>res.set('Allow','POST').sendStatus(405));app.delete('/mcp',authorize,(req,res)=>res.set('Allow','POST').sendStatus(405));
 app.get('/api/v1/openapi.json',(req,res)=>res.json(openapi));
}
const responses={'200':{description:'Success'},'400':{description:'Invalid request'},'401':{description:'Missing, expired or revoked key'},'403':{description:'Insufficient scope or role'},'404':{description:'Unavailable in authorized tenant/store'},'409':{description:'State conflict or quota exceeded'}};
const operation=(summary,scope,body)=>({summary,security:[{bearerAuth:[]}],'x-required-scope':scope,responses,...(body?{requestBody:{required:true,content:{'application/json':{schema:body}}}}:{})});
export const openapi={openapi:'3.1.0',info:{title:'Mosaic integrations',version:'0.3.0'},components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Scoped tenant API key, not a playback device key'}}},paths:{
 '/api/v1/groups':{get:operation('List authorized groups','read')},'/api/v1/devices':{get:operation('List authorized devices','read')},'/api/v1/media':{get:operation('List authorized media','read')},
 '/api/v1/groups/{id}/preview':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],get:operation('Preview without controlling devices','read')},
 '/api/v1/groups/{id}/control':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],post:operation('Control playback','control',{type:'object',required:['action'],properties:{action:{enum:['pause','resume','play']},mediaId:{type:'string'}}})},
 '/api/v1/ai/models':{get:operation('List enabled AI models without credentials','ai')},
 '/api/v1/ai/jobs':{post:operation('Create idempotent paid generation job','ai',{type:'object',required:['modelId','prompt','requestId'],properties:{modelId:{type:'string',format:'uuid'},prompt:{type:'string',maxLength:12000},lyrics:{type:'string',maxLength:3500},requestId:{type:'string',format:'uuid'},maxOutputTokens:{type:'integer',minimum:1,maximum:8192}}})},
 '/api/v1/ai/jobs/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],get:operation('Get generation result','ai')}
}};
