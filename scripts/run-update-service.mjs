import {readFile,writeFile,readdir,appendFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {runUpdateWindow,dataPaths} from './update-service.mjs';
import {dispatchWorkflow} from './actions-api.mjs';
import {buildHealth} from './pipeline-utils.mjs';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Service only runs in its disposable GitHub Actions checkout');
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const git=async(...args)=>(await run('git',args,{maxBuffer:4e6,timeout:90000})).stdout.trim();
const digest=async()=>createHash('sha256').update(await readFile('scripts/run-update-service.mjs')).digest('hex');
const original=await digest(),startedAt=new Date().toISOString(),rounds=Number(process.env.UPDATE_ROUNDS||8);
const json=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch{return {};}};
async function collect(env){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/refresh-research.mjs',...(env.FORCE_HISTORY==='true'?['--force-history']:[])],{stdio:'inherit',env,detached:true});
  let expired=false,hard;const timer=setTimeout(()=>{expired=true;try{process.kill(-child.pid,'SIGTERM');}catch{}hard=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},5000);},360000);
  child.on('error',error=>{clearTimeout(timer);clearTimeout(hard);reject(error);});
  child.on('close',code=>{clearTimeout(timer);clearTimeout(hard);code===0&&!expired?resolve():reject(Error(expired?'Collection exceeded six-minute budget':'Collection process failed: '+code));});
 });
}
async function publish(paths){
 await git('add','--',...paths);
 if(!await git('diff','--cached','--name-only'))return false;
 await git('-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','chore: refresh AURUM inputs and source health');
 for(let attempt=0;attempt<3;attempt++){
  try{await git('push','origin','HEAD:main');return true;}
  catch(error){if(attempt===2)throw error;try{await git('pull','--rebase','origin','main');}catch{try{await git('rebase','--abort');}catch{}throw Error('Concurrent data edit; leaving remote data intact and restarting from main');}}
 }
}
const results=await runUpdateWindow({rounds,continueService:process.env.CONTINUE_SERVICE!=='false',sleep,
 handoff:async()=>{await dispatchWorkflow('refresh-research.yml');console.log('Successor update window requested.');},
 cycle:async({round,nextAttemptAt})=>{
  await git('fetch','origin','main');await git('merge','--ff-only','origin/main');
  if(await digest()!==original)return {restart:true};
  const paths=dataPaths(await readdir('data')),backup=new Map(await Promise.all(paths.map(async p=>[p,await readFile(p)])));
  const env={...process.env,AURUM_SOURCE_SHA:await git('rev-parse','HEAD'),AURUM_UPDATE_STARTED_AT:startedAt,AURUM_UPDATE_ROUND:String(round),AURUM_UPDATE_ROUNDS:String(rounds),AURUM_NEXT_ATTEMPT_AT:nextAttemptAt};
  if(round>1)for(const key of ['FORCE_HISTORY','FORCE_COMPONENTS','FORCE_ANALYSIS_AI'])env[key]='false';
  let failure=null;
  try{await collect(env);}catch(error){
   failure=error;
   for(const [p,bytes] of backup)if(p.endsWith('.json')){try{JSON.parse(await readFile(p,'utf8'));}catch{await writeFile(p,bytes);}}
   const old=JSON.parse(backup.get('data/pipeline-health.json').toString()),h=await json('data/pipeline-health.json');
   const [news,research,history,market]=await Promise.all(['news','research-factors','market-history','market-snapshot'].map(x=>json('data/'+x+'.json')));
   const health=buildHealth(old,[...Object.values(h.stages||{}),{key:'runner',status:'failed',checkedAt:new Date().toISOString(),error:error.message}],new Date().toISOString(),{news,research,history,market,runUrl:'https://github.com/'+process.env.GITHUB_REPOSITORY+'/actions/runs/'+process.env.GITHUB_RUN_ID});
   await writeFile('data/pipeline-health.json',JSON.stringify(health,null,2)+'\n');await run(process.execPath,['scripts/build-embedded-data.mjs']);
  }
  // The public bundle must describe the same receipt as its companion JSON.
  const h=await json('data/pipeline-health.json'),bundle=await json('data/research-bundle.json'),analysis=await json('data/analysis-desk.json');
  if(!h.generatedAt||bundle.health?.generatedAt!==h.generatedAt)throw Error('Collection receipt and public bundle disagree');
  const changed=await publish(dataPaths(await readdir('data')));
  // GITHUB_TOKEN pushes do not trigger Pages; dispatch explicitly each round.
  await dispatchWorkflow('pages.yml');
  console.log(JSON.stringify({round,changed,status:h.status,completedAt:h.generatedAt,newsCheckedAt:h.news?.checkedAt,quoteAsOf:h.quote?.asOf}));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`\nRound ${round}: ${h.status}, collected ${h.generatedAt}, news checked ${h.news?.checkedAt}, quote ${h.quote?.asOf}. Pages requested.\n`);
  if(failure)throw failure;
  if(h.status==='failed')throw Error('Critical collector failure; dated recovery receipt published');
  return {status:h.status,completedAt:h.generatedAt,continueImmediately:analysis.aiPolicy?.continueImmediately===true};
 }
});
console.log(JSON.stringify({rounds:results}));
if(results.length&&results.every(r=>!r.ok))process.exitCode=1;
