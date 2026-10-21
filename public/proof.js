// Conservative device-observed segment completions, never heartbeat-derived counts.
export class SegmentTracker {
  candidate=null;wrapAt=-Infinity;
  reset(){this.candidate=null;this.wrapAt=-Infinity;}
  observe(s){
    const old=this.candidate;this.candidate=null;
    if(!s?.ready||![s.now,s.startAt,s.durationMs].every(Number.isFinite)||s.durationMs<1000||s.durationMs>3600000||s.now<s.startAt){this.wrapAt=-Infinity;return null;}
    const same=old&&old.mediaId===s.mediaId&&old.programId===s.programId&&old.control===s.control&&old.startAt===s.startAt&&old.durationMs===s.durationMs;
    const continuous=old&&s.now>=old.last&&s.now-old.last<=250&&old.control===s.control;
    if(old&&old.mediaId===s.mediaId&&continuous&&s.video&&s.sourceDurationMs>0&&old.positionMs-s.positionMs>s.sourceDurationMs/2)this.wrapAt=s.now;
    const completedVideo=!old?.video||(old.mediaId===s.mediaId&&s.now-this.wrapAt<=250&&this.wrapAt>=old.startAt+old.durationMs-250);
    let event=null;
    if(continuous&&completedVideo&&old.eligible&&!same&&old.last>=old.startAt+old.durationMs-150&&s.now>=old.startAt+old.durationMs&&s.now<=old.startAt+old.durationMs+150&&s.startAt===old.startAt+old.durationMs){
      event={mediaId:old.mediaId,programId:old.programId||null,startAt:old.startAt,endAt:old.startAt+old.durationMs,durationMs:old.durationMs};
    }
    const boundary=continuous&&old.startAt+old.durationMs===s.startAt&&old.last>=s.startAt-150&&s.now-s.startAt<=150;
    const eligible=same&&continuous?old.eligible:boundary||s.now===s.startAt;
    this.candidate={...s,last:s.now,eligible};
    return event;
  }
}
export function eventUUID(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export class ProofQueue {
 constructor(storage,key,now=Date.now){this.storage=storage;this.key=key;this.now=now;try{this.events=JSON.parse(storage.getItem(key)||'[]');}catch{this.events=[];}if(!Array.isArray(this.events))this.events=[];this.trim();}
 trim(){this.events=this.events.filter(e=>e?.endAt>=this.now()-7*86400e3).slice(-500);}
 save(){this.trim();try{this.storage.setItem(this.key,JSON.stringify(this.events));}catch{}}
 add(event){this.events.push({...event,eventId:event.eventId||eventUUID()});this.save();}
 batch(){this.trim();return this.events.slice(0,50);}
 acknowledge(response){const done=new Set([...(response.accepted||[]),...(response.rejected||[]).map(e=>e.eventId)]);this.events=this.events.filter(e=>!done.has(e.eventId));this.save();}
}
export function proofNamespace(text){let hash=2166136261;for(const c of text)hash=Math.imul(hash^c.charCodeAt(0),16777619);return 'mosaic-proof-'+(hash>>>0).toString(16);}
