import {readFile,writeFile,rename} from 'node:fs/promises';import {spawn} from 'node:child_process';
import {historyDue,buildHealth} from './pipeline-utils.mjs';
const json=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch{return {};}};
const previous=await json('data/pipeline-health.json'),started=new Date().toISOString();
const history=await json('data/market-history.json'),force=process.argv.includes('--force-history');
async function run(key,file,timeoutMs=160000,args=[]){
 const begin=Date.now();let output='';
 return new Promise(resolve=>{const child=spawn(process.execPath,[file,...args],{stdio:['ignore','pipe','pipe']});
  const record=data=>{const chunk=data.toString();process.stdout.write(`[${key}] ${chunk}`);output=(output+chunk).slice(-1800);};child.stdout.on('data',record);child.stderr.on('data',record);
  const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs);
  child.on('error',error=>{clearTimeout(timer);resolve({key,status:'failed',checkedAt:new Date().toISOString(),error:error.message,durationMs:Date.now()-begin});});
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({key,status:code===0?'ok':'failed',checkedAt:new Date().toISOString(),durationMs:Date.now()-begin,error:code===0?null:`${signal||code}: ${output.slice(-350)}`});});
 });
}
const historyAttempt=historyDue(history,previous,started,force)?run('history','scripts/fetch-market-history.mjs',210000):Promise.resolve({key:'history',status:'skipped',checkedAt:previous.stages?.history?.checkedAt||null,reason:'Confirmed closes are current; waiting for next capture window'});
const attempts=await Promise.all([run('news','scripts/fetch-official-news.mjs'),run('factors','scripts/fetch-research-factors.mjs'),run('quote','scripts/fetch-market-snapshot.mjs'),run('components','scripts/fetch-components.mjs'),historyAttempt]);
attempts.push(await run('archive','scripts/archive-inputs.mjs'));
attempts.push(await run('analysis','scripts/build-analysis-desk.mjs',125000,process.env.FORCE_ANALYSIS_AI==='true'?['--refresh-ai']:[]));
attempts.push(await run('publication','scripts/build-forecast-publication.mjs'));
attempts.push(await run('ledger','scripts/build-prediction-ledger.mjs'));
const [news,research,latestHistory,market]=await Promise.all(['data/news.json','data/research-factors.json','data/market-history.json','data/market-snapshot.json'].map(json));
const runUrl=process.env.GITHUB_RUN_ID?`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:null;
const service=process.env.AURUM_UPDATE_ROUND?{mode:'continuous-window',intervalSeconds:300,round:Number(process.env.AURUM_UPDATE_ROUND),rounds:Number(process.env.AURUM_UPDATE_ROUNDS),startedAt:process.env.AURUM_UPDATE_STARTED_AT,nextAttemptAt:process.env.AURUM_NEXT_ATTEMPT_AT,sourceSha:process.env.AURUM_SOURCE_SHA}:null;
async function saveHealth(){const health=buildHealth(previous,attempts,new Date().toISOString(),{news,research,history:latestHistory,market,runUrl,service});await writeFile('data/pipeline-health.json.tmp',JSON.stringify(health,null,2)+'\n');await rename('data/pipeline-health.json.tmp','data/pipeline-health.json');return health;}
await saveHealth();attempts.push(await run('assembly','scripts/build-embedded-data.mjs'));const final=await saveHealth();
// Rebuild once with the final assembly receipt so embedded and JSON bundle report the same heartbeat.
if(attempts.at(-1).status==='ok'){const assembled=await run('assembly-final','scripts/build-embedded-data.mjs');if(assembled.status==='failed'){attempts[attempts.length-1]={...assembled,key:'assembly'};await saveHealth();process.exitCode=1;}}
console.log(JSON.stringify({status:final.status,issues:final.issues,runUrl,completedAt:final.generatedAt}));
if(final.status==='failed')console.error('::warning::Collection failed; retained dated inputs and published the failure receipt.');
