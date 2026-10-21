import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,rename,unlink,stat} from 'node:fs/promises';
import path from 'node:path';
import {one,rows,tx,httpError,requireValue,audit,camel} from './db.js';
import {managers,tenantActive} from './admin.js';
import {authorizedMedia,inspectMedia,probe} from './media.js';

export function intakeReport(meta){
 const v=meta.streams?.find(s=>s.codec_type==='video'),a=meta.streams?.find(s=>s.codec_type==='audio');
 const image=['png','mjpeg','webp'].includes(v?.codec_name),duration=Number(meta.format?.duration),parts=String(v?.r_frame_rate||'0/1').split('/').map(Number),fps=parts[0]/(parts[1]||1),bitrate=Number(v?.bit_rate||0);
 const checks=[
  {code:'dimensions',pass:v?.width===3840&&v?.height===2160,value:v?`${v.width} × ${v.height}`:'—',expected:'3840 × 2160'},
  {code:'codec',pass:image?v.codec_name==='mjpeg':v?.codec_name==='h264',value:v?.codec_name||'—',expected:image?'JPEG RGB':'H.264'},
  {code:'duration',pass:image?null:[15,30].some(n=>Math.abs(duration-n)<=0.15),value:duration||null,expected:'15 / 30 seconds (±0.15)'},
  {code:'frameRate',pass:image?null:Math.abs(fps-30000/1001)<0.02,value:fps||null,expected:'29.97 fps'},
  {code:'bitrate',pass:image?null:bitrate?bitrate>=10e6&&bitrate<=30e6:null,value:bitrate||null,expected:'10–30 Mbps'},
  {code:'audio',pass:!a?true:a.codec_name==='aac'&&Number(a.bit_rate)>=160000,value:a?`${a.codec_name} ${a.bit_rate||'?'}`:'none',expected:'AAC ≥160 kbps, or no audio track'},
  {code:'loudness',pass:null,value:null,expected:'Manual/audio analysis: -24 LKFS and 0.5 second silent edges'},
 ];
 return {profile:'retail-four-quadrants',advisory:true,mappingEligible:checks[0].pass&&Boolean(v),checks};
}
export function conversionArgs(source,target,type,quality){
 if(!['image','video'].includes(type)||!['tv','full'].includes(quality))throw httpError(400,'Invalid conversion type or quality');
 const size=quality==='tv'?'2880:540':'5760:1080';
 const filter=`[0:v]split=3[a][b][c];[a]crop=1920:1080:0:0[l];[b]crop=1920:1080:1920:0[m];[c]crop=1920:1080:0:1080[r];[l][m][r]hstack=inputs=3,scale=${size}[wall]`;
 return ['-nostdin','-v','error','-y','-i',source,'-filter_complex_threads','1','-filter_complex',filter,'-map','[wall]',...(type==='image'?['-frames:v','1','-q:v','2']:['-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-threads','2','-r','30000/1001','-c:a','aac','-b:a','192k','-movflags','+faststart']),target];
}
export function runConversion(args,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(Error('Conversion cancelled'));return;}const p=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{stdio:'ignore'}),timer=setTimeout(()=>p.kill('SIGKILL'),300000);const abort=()=>p.kill('SIGKILL');signal.addEventListener('abort',abort,{once:true});p.on('error',()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('FFmpeg unavailable'));});p.on('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);code===0?resolve():reject(Error('Conversion failed or timed out'));});});}
const publicJob=j=>camel(j);
export function installIntake({route,pool,dataDir}){
 const controller=new AbortController();let active=null,closed=false;
 route('get','/api/media/:id/intake',managers,async(c,i,r)=>{const m=await authorizedMedia(c,i,r.params.id);return intakeReport(await probe(path.join(dataDir,'tenants',i.tenantId,'media',m.filename)));});
 route('post','/api/media/:id/derive',managers,async(c,i,r)=>{
  if(i.support)throw httpError(403,'Use a tenant account to convert media');await tenantActive(c,i);const b=r.body;if(b.mapping!=='quadrants-to-three'||!['tv','full'].includes(b.quality)||!/^[0-9a-f-]{36}$/i.test(b.requestId||''))throw httpError(400,'Invalid mapping, quality or requestId');
  const existing=await one(c,'SELECT * FROM intake_jobs WHERE request_id=$1',[b.requestId]);if(existing){if(existing.source_id!==r.params.id||existing.quality!==b.quality)throw httpError(409,'requestId already used with different content');return publicJob(existing);}
  const m=await authorizedMedia(c,i,r.params.id);if(m.archived||!['image','video'].includes(m.metadata.type)||m.metadata.width!==3840||m.metadata.height!==2160||m.metadata.type==='video'&&m.metadata.duration>60)throw httpError(400,'Use a 3840 × 2160 image or video up to 60 seconds');
  if(Number((await one(c,"SELECT count(*) AS n FROM intake_jobs WHERE status IN('queued','running')")).n)>=10)throw httpError(429,'Too many pending conversions');
  const id=randomUUID();await c.query('INSERT INTO intake_jobs(id,tenant_id,user_id,source_id,request_id,quality,status)VALUES($1,$2,$3,$4,$5,$6,$7)',[id,i.tenantId,i.id,m.id,b.requestId,b.quality,'queued']);await audit(c,i,'intake.create',id,{sourceId:m.id,quality:b.quality});return publicJob(await one(c,'SELECT * FROM intake_jobs WHERE id=$1',[id]));
 });
 route('get','/api/intake/jobs/:id',managers,async(c,i,r)=>publicJob(requireValue(await one(c,'SELECT * FROM intake_jobs WHERE id=$1',[r.params.id]))));
 async function eligible(c,j){await tenantActive(c,{tenantId:j.tenant_id});const u=await one(c,'SELECT role FROM users WHERE id=$1 AND enabled AND NOT must_change_password',[j.user_id]);if(!u||!managers.includes(u.role))throw Error('Conversion creator is no longer authorized');}
 async function work(){if(closed)return;for(const tenant of await rows(pool,'SELECT * FROM worker_tenants()')){if(closed)return;
  const job=await tx(pool,{tenantId:tenant.id},async c=>{await c.query("UPDATE intake_jobs SET status='failed',error='Interrupted conversion; submit a new request',updated_at=now() WHERE status='running' AND updated_at<now()-interval '10 minutes'");const j=await one(c,"SELECT * FROM intake_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED");if(j)await c.query("UPDATE intake_jobs SET status='running',updated_at=now() WHERE id=$1",[j.id]);return j;});if(!job)continue;
  let target,moved;
  try{
   const source=await tx(pool,{tenantId:tenant.id},async c=>{await eligible(c,job);return requireValue(await one(c,'SELECT * FROM media WHERE id=$1 AND NOT archived',[job.source_id]));});
   const folder=path.join(dataDir,'tenants',tenant.id,'media'),tmp=path.join(dataDir,'tmp');await mkdir(tmp,{recursive:true});target=path.join(tmp,job.id+(source.metadata.type==='image'?'.jpg':'.mp4'));
   await runConversion(conversionArgs(path.join(folder,source.filename),target,source.metadata.type,job.quality),controller.signal);
   const info=await inspectMedia(target),size=(await stat(target)).size,id=randomUUID(),filename=id+'.'+info.ext;delete info.ext;
   await tx(pool,{tenantId:tenant.id},async c=>{await eligible(c,job);const liveSource=requireValue(await one(c,'SELECT * FROM media WHERE id=$1 AND NOT archived',[job.source_id]));const t=await one(c,'SELECT limits FROM tenants WHERE id=$1 FOR UPDATE',[tenant.id]);const current=requireValue(await one(c,"SELECT id FROM intake_jobs WHERE id=$1 AND status='running' FOR UPDATE",[job.id]));const usage=await one(c,'SELECT (SELECT coalesce(sum(size),0) FROM media)+(SELECT coalesce(sum(size),0) FROM upload_reservations WHERE expires_at>now()) AS size');if(Number(usage.size)+size>Number(t.limits.storageBytes))throw Error('Tenant storage quota exceeded');
    moved=path.join(folder,filename);await rename(target,moved);await c.query('INSERT INTO media(id,tenant_id,owner_store_id,shared,metadata,filename,size)VALUES($1,$2,$3,$4,$5,$6,$7)',[id,tenant.id,liveSource.owner_store_id,liveSource.shared,{...info,name:source.metadata.name+' · 3 screens',derivedFrom:source.id,mapping:'quadrants-to-three',quality:job.quality},filename,size]);await c.query("UPDATE intake_jobs SET status='completed',result_id=$2,updated_at=now() WHERE id=$1",[current.id,id]);await audit(c,{tenantId:tenant.id,id:job.user_id},'intake.complete',job.id,{mediaId:id});});moved=null;
  }catch{if(moved)await unlink(moved).catch(()=>{});await tx(pool,{tenantId:tenant.id},c=>c.query("UPDATE intake_jobs SET status='failed',error='Conversion failed; check FFmpeg, source, permissions and storage quota',updated_at=now() WHERE id=$1 AND status='running'",[job.id]));}finally{if(target)await unlink(target).catch(()=>{});}
 }}
 return {tick:()=>{if(!active)active=work().finally(()=>{active=null;});return active;},close:async()=>{closed=true;controller.abort();await active?.catch(()=>{});}};
}
