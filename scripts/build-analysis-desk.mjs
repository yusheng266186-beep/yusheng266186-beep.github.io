import {readFile,writeFile,rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {decision,RESEARCH_POLICY} from './research-policy.mjs';
import {drainResearchQueue} from './research-queue.mjs';
import {VERSION,generateResearch,updateCases,researchInput} from './research-agent.mjs';
import {buildSnapshot} from './news-factor-pipeline.mjs';
import {enrichArticles} from './article-evidence.mjs';
const require=createRequire(import.meta.url),Analysis=require('../assets/analysis-engine.js'),Intelligence=require('../assets/research-intelligence.js'),json=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}},save=async(file,data)=>{await writeFile(file+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(file+'.tmp',file);};
const [history,news,research,publication,previous,oldUsage]=await Promise.all(['data/market-history.json','data/news.json','data/research-factors.json','data/forecast-publication.json','data/analysis-desk.json','data/analysis-ai-usage.json'].map(json));
// Retain complete recent days so uncapped daily usage remains accurate beyond 150 attempts.
const since=new Date(Date.now()+8*3600000-7*86400000).toISOString().slice(0,10),usage={schema:1,attempts:(Array.isArray(oldUsage?.attempts)?oldUsage.attempts:[]).filter(a=>a.day>=since)};
let now=Date.now(),desk=Analysis.build({history,news,research,publication},now);
const old=previous?.intelligence?.version===VERSION?previous.intelligence:{version:VERSION,reviews:{},relations:[],followUps:[],cases:previous?.intelligence?.cases||[],articles:previous?.intelligence?.articles||[]};
const articles=desk.ready?await enrichArticles(desk,old,{now,captureNow:Date.now}):old.articles||[];
now=Date.now();desk=Analysis.build({history,news,research,publication},now);
const view=Intelligence.current(desk,old,now),work=desk.ready?researchInput(desk,old,articles,now):null;
const compatible=desk.ready&&Intelligence.compatible(desk,previous?.narration)&&previous?.narration?.protocol===VERSION&&['ready','partial'].includes(previous.narration.status);
const selection=decision({desk,previous:compatible?{narration:{...previous.narration,inputKey:desk.inputKey}}:null,usage,now,configured:!!process.env.AURUM_CODEBUDDY_API_KEY,backlog:work?.backlog||0,force:process.argv.includes('--refresh-ai')});
desk.narration=compatible?previous.narration:{status:'structured',inputKey:desk.inputKey,reason:selection.reason||'模型正在补齐本轮证据；最新结构化研究继续更新'};
let intelligence={...old,version:VERSION,model:Intelligence.MODEL,articles,reviews:view.reviews,relations:view.relations},activeAttempt;
async function checkpoint(queue){
 const time=Date.now();
 if(desk.ready)intelligence.cases=updateCases(intelligence.cases,desk,null,history,time);
 intelligence.stats=Intelligence.current(desk,intelligence,time).stats;intelligence.factorSnapshot=buildSnapshot(desk,intelligence,time);desk.intelligence=intelligence;
 const pending=desk.ready?researchInput(desk,intelligence,articles,time).backlog:0,next=decision({desk,previous:Intelligence.compatible(desk,desk.narration)?{narration:{...desk.narration,inputKey:desk.inputKey}}:null,usage,now:time,configured:!!process.env.AURUM_CODEBUDDY_API_KEY,backlog:pending});
 desk.aiPolicy={...RESEARCH_POLICY,model:Intelligence.MODEL,toolsRegistered:0,usedToday:usage.attempts.filter(a=>a.day===next.day).length,pendingItems:pending,activeIntervalMinutes:0,nextEligibleAt:next.nextEligibleAt,schedulingReason:next.reason,queue,continueImmediately:pending>0&&queue.stopReason==='runtime-budget'&&queue.completedItems>0,mode:'新消息到达即研判；连续处理队列，核对新闻参数并送入有界预测修正'};
 await save('data/analysis-desk.json',desk);
}
await checkpoint({callsMade:0,attemptedItems:0,completedItems:0,stopReason:'not-required'});
if(selection.call){
 const suppliedDeadline=Date.parse(process.env.AURUM_ANALYSIS_DEADLINE||''),deadline=Number.isFinite(suppliedDeadline)?suppliedDeadline:Date.now()+300000;
 const queue=await drainResearchQueue({deadline,
  buildInput:(excludeIds,time)=>researchInput(desk,intelligence,articles,time,{excludeIds}),
  run:async input=>{
   const time=Date.now(),day=new Date(time+8*3600000).toISOString().slice(0,10);
   activeAttempt={day,startedAt:new Date(time).toISOString(),inputKey:desk.inputKey,protocol:VERSION,model:Intelligence.MODEL,status:'dispatched',queuedItems:input.workIds.length};usage.attempts.push(activeAttempt);await save('data/analysis-ai-usage.json',usage);
   return generateResearch(desk,{key:process.env.AURUM_CODEBUDDY_API_KEY,previous:intelligence,articles,now:time,input});
  },
  onResult:async(result,input,queue)=>{
   const {reviews,relations,followUps,...narration}=result;
   desk.narration=narration;intelligence={...intelligence,reviews:{...intelligence.reviews,...reviews},relations:[...relations,...intelligence.relations].filter((r,i,a)=>a.findIndex(x=>x.type===r.type&&[...x.evidenceIds].sort().join('|')===[...r.evidenceIds].sort().join('|'))===i).slice(0,120),followUps:[...followUps,...(intelligence.followUps||[])].filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i).slice(0,24),lastRun:{at:result.generatedAt,submitted:result.submittedCount,accepted:result.reviewedCount,warnings:result.warnings,usage:result.usage}};
   intelligence.cases=updateCases(intelligence.cases,desk,narration,history,Date.now());Object.assign(activeAttempt,{status:result.status,completedAt:new Date().toISOString(),usage:result.usage,reviewed:result.reviewedCount,hypotheses:result.hypotheses.length});
   await save('data/analysis-ai-usage.json',usage);await checkpoint(queue);
  },
  onError:async error=>{
   Object.assign(activeAttempt,{status:'failed',completedAt:new Date().toISOString(),error:/^[A-Z_0-9]+$/.test(error.message)?error.message:error.name==='TimeoutError'?'MODEL_TIMEOUT':'MODEL_CONTENT_ERROR'});if(error.detail)activeAttempt.detail=error.detail;if(error.usage)activeAttempt.usage=error.usage;
   if(!['ready','partial'].includes(desk.narration?.status)||!Intelligence.compatible(desk,desk.narration))desk.narration={status:'structured',inputKey:desk.inputKey,reason:'本轮模型审阅暂不可用；价格、采集与已有有效审阅继续更新',lastAttempt:activeAttempt.completedAt,error:activeAttempt.error};
   intelligence.lastFailure={at:activeAttempt.completedAt,error:activeAttempt.error};await save('data/analysis-ai-usage.json',usage);
  }
 });
 await checkpoint(queue);
}
console.log(JSON.stringify({ready:desk.ready,origin:desk.price?.origin,evidence:desk.facts.length,inputKey:desk.inputKey,narration:desk.narration.status,callsMade:desk.aiPolicy.queue.callsMade,usedToday:desk.aiPolicy.usedToday,pending:desk.aiPolicy.pendingItems,queue:desk.aiPolicy.queue,intelligence:intelligence.stats,articles:articles.filter(a=>a.status==='ok').length,cases:intelligence.cases.length}));
