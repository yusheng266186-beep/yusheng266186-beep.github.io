// The runner is finite; one concurrency group and an explicit successor keep it alive.
export async function runUpdateWindow({cycle,handoff,sleep,now=Date.now,rounds=8,intervalMs=300000,continueService=true}) {
 if(!Number.isInteger(rounds)||rounds<1||rounds>8||intervalMs<300000)throw Error('Invalid update window');
 const results=[];let failures=0;
 for(let round=1;round<=rounds;round++){
  const started=now();
  try{const result=await cycle({round,rounds,nextAttemptAt:new Date(started+intervalMs).toISOString()});results.push({round,ok:true,...result});failures=0;if(result?.restart)break;}
  catch(error){results.push({round,ok:false,error:String(error.message).slice(0,250)});failures++;}
  if(round===rounds||failures>=2)break;
  await sleep(Math.max(0,intervalMs-(now()-started)));
 }
 // Even early failures cannot create a rapid dispatch loop.
 if(continueService){if(results.length===1&&!results[0].ok)await sleep(intervalMs);await handoff();}
 return results;
}
export function recoveryDecision({health={},runs=[],now=Date.now(),force=false,failedEvent=false}){
 const age=now-Date.parse(health.generatedAt),active=runs.filter(r=>r.head_branch==='main'&&['queued','in_progress','waiting','requested','pending'].includes(r.status));
 const stalled=active.filter(r=>now-Date.parse(r.run_started_at||r.created_at)>20*60000&&(!Number.isFinite(age)||age>15*60000));
 return {ageMinutes:Number.isFinite(age)?age/60000:null,cancel:stalled.map(r=>r.id),recover:active.length===0&&(force||failedEvent||!Number.isFinite(age)||age>12*60000||health.status==='failed'),active:active.length};
}
export function dataPaths(names){return names.filter(name=>/^[a-z0-9-]+\.json$/.test(name)||name==='embedded-data.js').map(name=>'data/'+name);}
