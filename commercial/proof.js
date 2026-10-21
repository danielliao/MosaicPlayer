import {one,rows,httpError} from './db.js';
import {resolveProgram} from './schedule.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const RETENTION_MS=7*86400e3;
export function validEvent(e,now=Date.now()) {
 return e && UUID.test(e.eventId) && typeof e.mediaId==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(e.mediaId) && (e.programId===null || typeof e.programId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(e.programId)) && [e.startAt,e.endAt,e.durationMs].every(Number.isSafeInteger) && e.durationMs>=1000 && e.durationMs<=3600000 && e.startAt>=now-RETENTION_MS && e.endAt<=now+2000 && e.endAt>e.startAt && Math.abs(e.endAt-e.startAt-e.durationMs)<=250;
}
export function matchesProgram(e,manifest) {
 if(!manifest||manifest.id!==e.programId||e.startAt<manifest.activateAt)return false;
 const first=resolveProgram(manifest,e.startAt),last=resolveProgram(manifest,e.endAt-1);
 return first.mediaId===e.mediaId && last.mediaId===e.mediaId && first.index===last.index && Math.abs(first.position*1000)<=250 && first.durationMs===e.durationMs && Math.abs(last.position*1000-(e.durationMs-1))<=250;
}
export async function collectPlayEvents(c,i,body,now=Date.now()) {
 if(!i.isDevice)throw httpError(403,'Device credentials required');
 if(!Array.isArray(body?.events)||body.events.length<1||body.events.length>50)throw httpError(400,'Expected 1–50 playback events');
 // Serializes duplicate/overlap checks and rebinding against the same device row.
 const d=await one(c,'SELECT * FROM devices WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[i.id,i.tenantId]);
 if(!d||d.group_id!==i.groupId||d.screen_id!==i.screenId)throw httpError(409,'Device binding changed');
 const g=await one(c,'SELECT * FROM groups WHERE id=$1 AND tenant_id=$2',[d.group_id,d.tenant_id]);
 const deployments=await rows(c,"SELECT * FROM deployments WHERE group_id=$1 AND tenant_id=$2 AND status IN ('active','partial') AND activate_at IS NOT NULL ORDER BY activate_at DESC LIMIT 1000",[d.group_id,d.tenant_id]);
 const accepted=[],rejected=[];
 for(const e of body.events){
  const reject=reason=>rejected.push({eventId:typeof e?.eventId==='string'?e.eventId.slice(0,100):null,reason});
  if(!validEvent(e,now)){reject('invalid_or_expired');continue;}
  if(await one(c,'SELECT event_id FROM playback_events WHERE tenant_id=$1 AND device_id=$2 AND event_id=$3',[i.tenantId,i.id,e.eventId])){accepted.push(e.eventId);continue;}
  if(e.startAt<new Date(d.binding_changed_at||d.created_at).getTime()){reject('binding_changed');continue;}
  const media=await one(c,'SELECT metadata FROM media WHERE id=$1 AND tenant_id=$2',[e.mediaId,i.tenantId]);
  const deployment=deployments.find(v=>v.activate_at.getTime()<=e.startAt+250);
  let authorized=false;
  if(e.programId){
   const manifest=deployment?.manifest || (g.program?.id===e.programId?g.program:null);
   authorized=matchesProgram(e,manifest);
  } else {
   const seconds=Number(media?.metadata?.duration);
   authorized=media?.metadata?.type==='video'&&Number.isFinite(seconds)&&Math.abs(Math.round(seconds*1000)-e.durationMs)<=100 && (deployment?deployment.media_id===e.mediaId:!g.program&&g.playback?.mediaId===e.mediaId&&e.startAt>=g.playback.epoch);
  }
  if(!media||!authorized){reject('unauthorized_segment');continue;}
  if(await one(c,'SELECT event_id FROM playback_events WHERE tenant_id=$1 AND device_id=$2 AND start_at<$3 AND end_at>$4 LIMIT 1',[i.tenantId,i.id,new Date(e.endAt-250),new Date(e.startAt+250)])){reject('overlapping_segment');continue;}
  await c.query('INSERT INTO playback_events(tenant_id,device_id,store_id,group_id,event_id,media_id,program_id,start_at,end_at,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',[d.tenant_id,d.id,d.store_id,d.group_id,e.eventId,e.mediaId,e.programId,new Date(e.startAt),new Date(e.endAt),e.durationMs]);
  accepted.push(e.eventId);
 }
 return {accepted,rejected};
}
