import {Temporal} from '@js-temporal/polyfill';
import {randomUUID} from 'node:crypto';
export function validTimezone(value){try{Temporal.Now.zonedDateTimeISO(value);return value;}catch{throw new Error('无效时区');}}
export function compileProgram(body,timezone,now=Date.now(),options={}){
  validTimezone(timezone);const today=Temporal.Instant.fromEpochMilliseconds(Math.trunc(now)).toZonedDateTimeISO(timezone).toPlainDate();
  const horizon=today.add({days:90}),intervals=[];
  for(const slot of body.slots||[]){
    if(!/^\d{2}:\d{2}$/.test(slot.startTime)||!/^\d{2}:\d{2}$/.test(slot.endTime)||slot.startTime===slot.endTime)throw new Error('时段起止时间无效');
    const startTime=Temporal.PlainTime.from(slot.startTime),endTime=Temporal.PlainTime.from(slot.endTime);
    const first=Temporal.PlainDate.from(slot.startDate),last=Temporal.PlainDate.from(slot.endDate);
    if(Temporal.PlainDate.compare(first,last)>0)throw new Error('生效日期顺序无效');
    if(!Array.isArray(slot.weekdays)||!slot.weekdays.length||slot.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))throw new Error('星期无效');
    let day=Temporal.PlainDate.compare(first,today.subtract({days:1}))<0?today.subtract({days:1}):first;
    const end=Temporal.PlainDate.compare(last,horizon)>0?horizon:last;
    for(;Temporal.PlainDate.compare(day,end)<=0;day=day.add({days:1})){
      if(!slot.weekdays.includes(day.dayOfWeek))continue;
      const overnight=Temporal.PlainTime.compare(endTime,startTime)<0;
      const zoned=(date,time)=>Temporal.ZonedDateTime.from({timeZone:timezone,year:date.year,month:date.month,day:date.day,hour:time.hour,minute:time.minute},{disambiguation:'compatible'}).epochMilliseconds;
      const start=zoned(day,startTime),finish=zoned(overnight?day.add({days:1}):day,endTime);
      if(finish>start&&finish>now&&start<horizon.toZonedDateTime(timezone).epochMilliseconds)intervals.push({start,end:finish,program:slot.program,slotId:slot.id||slot.name});
    }
  }
  intervals.sort((a,b)=>a.start-b.start);for(let i=1;i<intervals.length;i++)if(intervals[i].start<intervals[i-1].end)throw new Error('时段重叠 overlap');
  return {id:options.id||randomUUID(),versionId:options.versionId||null,generatedAt:now,activateAt:now,validUntil:horizon.toZonedDateTime(timezone).epochMilliseconds,defaultProgram:body.defaultProgram,intervals};
}
export function resolveProgram(manifest,serverTime){
  const interval=serverTime<manifest.validUntil?manifest.intervals.find(i=>i.start<=serverTime&&serverTime<i.end):null;
  const program=interval?.program||manifest.defaultProgram,anchor=interval?.start??manifest.activateAt;
  const cursor=items=>{if(!items?.length)return null;const length=items.reduce((n,i)=>n+i.durationMs,0);let at=((serverTime-anchor)%length+length)%length;for(let index=0;index<items.length;index++){if(at<items[index].durationMs)return {...items[index],index,position:at/1000};at-=items[index].durationMs;}};
  return {program,anchor,...cursor(program.playlist),music:program.audioMode==='music'?cursor(program.music):null};
}
export function dependencies(body){const result=new Set();const add=p=>{for(const item of [...(p?.playlist||[]),...(p?.music||[])])result.add(item.mediaId);};add(body?.defaultProgram);for(const slot of body?.slots||body?.intervals||[])add(slot.program);return [...result];}
