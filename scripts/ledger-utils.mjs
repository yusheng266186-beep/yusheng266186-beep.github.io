export function updateLedger(previous,{daily,forecasts,now,version,methodHash,inputHash,historyAsOf}){
 const entries=structuredClone(previous.entries||[]),last=daily.at(-1),time=Date.parse(now);
 for(const e of entries){
  const origin=daily.findIndex(r=>r.time===e.origin);
  if(origin<0)continue;
  for(const f of e.forecasts){
   const target=daily[origin+f.steps];
   if(f.result||!target||Date.parse(target.time+'T15:30:00+08:00')<=Date.parse(e.createdAt)||Date.parse(target.time+'T15:30:00+08:00')>time)continue;
   const capture=Date.parse(target.observedAt||historyAsOf);if(!Number.isFinite(capture)||capture<Date.parse(target.time+'T15:30:00+08:00')||capture>time)continue;
   f.result={target:target.time,actual:target.close,verifiedAt:now,error:Math.abs(f.center/target.close-1)*100,baselineError:Math.abs(e.start/target.close-1)*100,
    directionHit:Math.sign(f.center-e.start)===Math.sign(target.close-e.start),hit:target.close>=f.low&&target.close<=f.high};
  }
 }
 if(last&&forecasts.length&&Date.parse(last.time+'T15:30:00+08:00')<=time&&time-Date.parse(last.time+'T15:30:00+08:00')<7*86400000&&!entries.some(e=>e.origin===last.time&&e.version===version)){
  entries.push({id:version+'|'+last.time,origin:last.time,start:last.close,createdAt:now,version,methodHash,inputHash,
   forecasts:forecasts.map(f=>({days:f.days,steps:Math.max(1,Math.round(f.days*252/365)),center:f.center,low:f.low,high:f.high}))});
 }
 return {generatedAt:now,entries:entries.slice(-1800)};
}
