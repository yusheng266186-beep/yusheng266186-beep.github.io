import {readFile,writeFile,rename} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {decision} from './analysis-ai.mjs';
import {RESEARCH_POLICY} from './research-policy.mjs';
import {VERSION,generateResearch,updateCases,researchInput} from './research-agent.mjs';
import {buildSnapshot} from './news-factor-pipeline.mjs';
import {enrichArticles} from './article-evidence.mjs';
const require=createRequire(import.meta.url),Analysis=require('../assets/analysis-engine.js'),Intelligence=require('../assets/research-intelligence.js'),json=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}},save=async(file,data)=>{await writeFile(file+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(file+'.tmp',file);};
const [history,news,research,publication,previous,oldUsage]=await Promise.all(['data/market-history.json','data/news.json','data/research-factors.json','data/forecast-publication.json','data/analysis-desk.json','data/analysis-ai-usage.json'].map(json)),usage={schema:1,attempts:Array.isArray(oldUsage?.attempts)?oldUsage.attempts.slice(-150):[]};
let now=Date.now(),desk=Analysis.build({history,news,research,publication},now);
const old=previous?.intelligence?.version===VERSION?previous.intelligence:{version:VERSION,reviews:{},relations:[],followUps:[],cases:previous?.intelligence?.cases||[],articles:previous?.intelligence?.articles||[]};
// Original-page collection is independent of paid inference; failures retain dated RSS evidence.
const articles=desk.ready?await enrichArticles(desk,old,{now,captureNow:Date.now}):old.articles||[];
now=Date.now();desk=Analysis.build({history,news,research,publication},now);
const view=Intelligence.current(desk,old,now),work=desk.ready?researchInput(desk,old,articles,now):null;
const compatible=desk.ready&&Intelligence.compatible(desk,previous?.narration)&&previous?.narration?.protocol===VERSION&&['ready','partial'].includes(previous.narration.status),hasWork=!!(work?.backlog||!compatible);
const selection=decision({desk,previous:compatible&&!hasWork?{narration:{...previous.narration,inputKey:desk.inputKey}}:null,usage,now,configured:!!process.env.AURUM_CODEBUDDY_API_KEY,backlog:work?.backlog||0,force:process.argv.includes('--refresh-ai')}),day=selection.day;
desk.narration=compatible?previous.narration:{status:'structured',inputKey:desk.inputKey,reason:selection.reason||'模型正在补齐本轮证据；最新结构化研究继续更新'};
let intelligence={...old,version:VERSION,model:Intelligence.MODEL,articles,reviews:view.reviews,relations:view.relations};
if(selection.call){const attempt={day:selection.day,startedAt:new Date(now).toISOString(),inputKey:desk.inputKey,protocol:VERSION,model:Intelligence.MODEL,status:'dispatched'};usage.attempts.push(attempt);await save('data/analysis-ai-usage.json',usage);
 try{const result=await generateResearch(desk,{key:process.env.AURUM_CODEBUDDY_API_KEY,previous:intelligence,articles,now});const {reviews,relations,followUps,...narration}=result;
  desk.narration=narration;intelligence={...intelligence,reviews:{...intelligence.reviews,...reviews},relations:[...relations,...intelligence.relations].filter((r,i,a)=>a.findIndex(x=>x.type===r.type&&[...x.evidenceIds].sort().join('|')===[...r.evidenceIds].sort().join('|'))===i).slice(0,120),followUps,lastRun:{at:result.generatedAt,submitted:result.submittedCount,accepted:result.reviewedCount,warnings:result.warnings,usage:result.usage}};
  intelligence.cases=updateCases(intelligence.cases,desk,narration,history,Date.now());attempt.status=result.status;attempt.completedAt=new Date().toISOString();attempt.usage=result.usage;attempt.reviewed=result.reviewedCount;attempt.hypotheses=result.hypotheses.length;
 }catch(error){attempt.status='failed';attempt.completedAt=new Date().toISOString();attempt.error=/^[A-Z_0-9]+$/.test(error.message)?error.message:error.name==='TimeoutError'?'MODEL_TIMEOUT':'MODEL_CONTENT_ERROR';if(error.detail)attempt.detail=error.detail;if(error.usage)attempt.usage=error.usage;
  if(!compatible)desk.narration={status:'structured',inputKey:desk.inputKey,reason:'本轮模型审阅暂不可用；价格、采集与已有有效审阅继续更新',lastAttempt:attempt.completedAt,error:attempt.error};intelligence.lastFailure={at:attempt.completedAt,error:attempt.error};}
 await save('data/analysis-ai-usage.json',usage);
}
if(desk.ready)intelligence.cases=updateCases(intelligence.cases,desk,null,history,Date.now());
intelligence.stats=Intelligence.current(desk,intelligence,Date.now()).stats;intelligence.factorSnapshot=buildSnapshot(desk,intelligence,Date.now());desk.intelligence=intelligence;
const pending=desk.ready?researchInput(desk,intelligence,articles,Date.now()).backlog:0,next=decision({desk,previous:!pending&&Intelligence.compatible(desk,desk.narration)?{narration:{...desk.narration,inputKey:desk.inputKey}}:null,usage,now:Date.now(),configured:!!process.env.AURUM_CODEBUDDY_API_KEY,backlog:pending});
desk.aiPolicy={...RESEARCH_POLICY,model:Intelligence.MODEL,toolsRegistered:0,usedToday:usage.attempts.filter(a=>a.day===next.day).length,pendingItems:pending,activeIntervalMinutes:next.intervalMinutes,nextEligibleAt:next.nextEligibleAt,schedulingReason:next.reason,mode:'语义筛选、原文补抓、来源对照、条件观察与前瞻复盘；把经过核对的新闻参数送入有界预测修正'};
await save('data/analysis-desk.json',desk);console.log(JSON.stringify({ready:desk.ready,origin:desk.price?.origin,evidence:desk.facts.length,inputKey:desk.inputKey,narration:desk.narration.status,callMade:selection.call,usedToday:desk.aiPolicy.usedToday,intelligence:intelligence.stats,articles:articles.filter(a=>a.status==='ok').length,cases:intelligence.cases.length}));
