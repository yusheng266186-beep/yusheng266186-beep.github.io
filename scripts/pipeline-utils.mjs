export function historyDue(history,health,now,force=false){
 if(force)return true;
 const time=Date.parse(now),last=Date.parse(health?.stages?.history?.checkedAt||0);
 if(Number.isFinite(last)&&time-last<30*60000)return false;
 const generated=Date.parse(history?.generatedAt),china=new Date(time+8*3600000),day=china.toISOString().slice(0,10),weekday=china.getUTCDay();
 const latest=history?.daily?.at(-1)?.time,minutes=china.getUTCHours()*60+china.getUTCMinutes();
 return !Number.isFinite(generated)||time-generated>6*3600000||(weekday>=1&&weekday<=5&&minutes>=16*60+5&&latest<day);
}
export function buildHealth(previous,attempts,now,{news,research,history,market,runUrl}={}){
 const stages={};
 for(const a of attempts){const old=previous?.stages?.[a.key]||{};stages[a.key]={...a,lastSuccessAt:a.status==='ok'?a.checkedAt:old.lastSuccessAt||null,failureStreak:a.status==='failed'?(old.failureStreak||0)+1:a.status==='skipped'?old.failureStreak||0:0};}
 const collectors=['news','factors','quote'],allFailed=collectors.every(k=>stages[k]?.status==='failed'),assemblyFailed=['ledger','assembly','publication','archive'].some(k=>stages[k]?.status==='failed');
 const issues=Object.values(stages).filter(s=>s.status==='failed').map(s=>s.key);
 return {schema:1,generatedAt:now,runUrl:runUrl||null,status:allFailed||assemblyFailed?'failed':issues.length?'partial':'ok',issues,stages,
  news:{checkedAt:news?.checkedAt||news?.generatedAt,lastPublishedAt:news?.items?.[0]?.publishedAt,items:news?.items?.length||0,available:(news?.sourceStatus||[]).filter(s=>s.ok).length,total:news?.sourceStatus?.length||0},
  factors:{checkedAt:research?.generatedAt,available:(research?.status||[]).filter(s=>s.ok).length,total:research?.status?.length||0},
  history:{latest:history?.daily?.at(-1)?.time,count:history?.daily?.length||0},quote:{asOf:market?.asOf||null}};
}
