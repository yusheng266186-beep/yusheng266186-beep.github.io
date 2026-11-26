import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {aiInput,canonicalize,transportAudit,MODEL} from './analysis-ai.mjs';
import {readResearchTransport} from './research-transport.mjs';
import {RESEARCH_POLICY} from './research-policy.mjs';
import {SYSTEM} from './research-prompt.mjs';
const require=createRequire(import.meta.url),Intelligence=require('../assets/research-intelligence.js'),Notes=require('../assets/analysis-notebook.js');
export const VERSION=Intelligence.version;
export {SYSTEM};
const dimensions={rates:'利率',fx:'汇率',risk:'风险',inflation:'通胀',flows:'资金',demand:'需求',supply:'供给',price:'价格',other:'待核实'},text=(s,n=180)=>typeof s==='string'?s.trim().slice(0,n):'',unique=a=>[...new Set(Array.isArray(a)?a:[])],forbidden=/https?:|买入|卖出|做多|做空|止盈|止损|保证获利|必然|一定会|目标价|上涨概率|下跌概率/;
export function researchInput(desk,previous={},articles=[],now=Date.now(),{excludeIds=[],targetIds,batchSize=RESEARCH_POLICY.newItemsPerCall}={}){
 const view=Intelligence.current(desk,previous,now),rank=f=>(f.weight||0)+(f.direction?10:0)-f.ageDays*4;
 const bodyChanged=f=>{const a=articles.find(a=>a.key===Intelligence.articleKey(f)&&a.status==='ok'&&Date.parse(a.capturedAt)<=now);return !!(a&&view.reviews[f.id]?.articleHash!==Intelligence.articleKey({id:f.id,label:a.excerpt}));};
 const excluded=new Set(excludeIds),targets=targetIds?new Set(targetIds):null,allPending=desk.events.filter(f=>(!targets||targets.has(f.id))&&(!view.reviews[f.id]||!view.reviews[f.id].factor||bodyChanged(f))),pending=allPending.filter(f=>!excluded.has(f.id)).sort((a,b)=>rank(b)-rank(a)),context=desk.events.filter(f=>view.reviews[f.id]?.factor&&!bodyChanged(f)&&view.reviews[f.id].relevance!=='unrelated').sort((a,b)=>rank(b)-rank(a));
 // Reserve half of each batch for recent arrivals and half for the oldest waiting work.
 // Smaller replies leave room for reasoning without truncating the structured factor output.
 const p=RESEARCH_POLICY,freshCount=Math.floor(batchSize/2),fresh=[...pending].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||rank(b)-rank(a)).slice(0,freshCount),waiting=pending.filter(f=>!fresh.some(x=>x.id===f.id)).sort((a,b)=>Date.parse(a.knownAt||a.publishedAt)-Date.parse(b.knownAt||b.publishedAt)||Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||rank(b)-rank(a)),events=[...fresh,...waiting.slice(0,batchSize-fresh.length)].concat(context.slice(0,p.contextItemsPerCall)),base=aiInput({...desk,events:[]}),eventInput=aiInput({...desk,events,facts:[]},{eventLimit:events.length}).evidence;
 const eventMap=new Map(eventInput.map(f=>[f.id,f]));
 base.evidence.push(...events.map(f=>({...eventMap.get(f.id),id:f.id,type:'event',label:f.label,summary:f.summary,source:f.source,publishedAt:f.publishedAt,knownAt:f.knownAt,conditional:f.conditional,direction:f.direction,articleExcerpt:articles.find(a=>a.key===Intelligence.articleKey(f)&&a.status==='ok'&&Date.parse(a.capturedAt)<=now)?.excerpt||'',previousReview:view.reviews[f.id]?{relevance:view.reviews[f.id].relevance,status:view.reviews[f.id].status}:null})));
 return {...base,protocol:VERSION,scope:'新闻语义审阅、来源对照与价格条件观察；数值预测不由文字输出改写',levels:desk.levels.map(l=>({id:l.id,label:l.label,threshold:l.threshold,invalidation:l.invalidation})),backlog:allPending.length,pendingIds:allPending.map(f=>f.id),workIds:events.filter(f=>allPending.some(p=>p.id===f.id)).map(f=>f.id)};
}
export function validateResearch(value,input,desk,now=Date.now(),model=MODEL){
 const base=canonicalize(value,input,{maxRefs:32}),byId=new Map(input.evidence.map(f=>[f.id,f])),facts=new Map(desk.facts.map(f=>[f.id,f])),warnings=[...base.warnings],reviews={};
 const quote=(q,f)=>typeof q==='string'&&q.trim().length>=8&&q.length<=240&&[f.label,f.summary,f.articleExcerpt].some(s=>typeof s==='string'&&s.includes(q.trim())),clean=(s,n=180)=>text(s,n)&&!forbidden.test(s);
 for(const r of (Array.isArray(value.newsReviews)?value.newsReviews:[]).slice(0,24)){
  const f=byId.get(r?.id);if(!f||f.type!=='event'||reviews[r.id]||!['direct','context','unrelated','uncertain'].includes(r.relevance)||!['reported','statement','proposal','conditional','background'].includes(r.status)||!dimensions[r.dimension]||!['support','pressure','mixed','unclear'].includes(r.effect)||!quote(r.quote,f)||!clean(r.reason)){warnings.push('一项新闻审阅未通过引用或格式核对');continue;}
  let relevance=r.relevance,status=r.status,effect=r.effect;
  if(relevance==='unrelated'&&/黄金|金价|购金|央行.{0,6}金|\bgold\b|\bbullion\b/i.test(f.label)){relevance='uncertain';warnings.push('直接提及黄金的原文保留待核对，未自动隐藏');}
  if(f.conditional&&status==='reported'){status='conditional';warnings.push('含预期的报道保留条件标记');}
  if(status!=='reported'||relevance==='unrelated')effect='unclear';
  const p=r.factor;let factor=null;
  if(p&&['rates','fx','risk','inflation','flows','demand','supply','liquidity','none'].includes(p.dimension)&&['support','pressure','mixed','unclear'].includes(p.effect)&&['weak','moderate','strong'].includes(p.intensity)&&['new','ongoing','priced_in','unknown'].includes(p.novelty)&&['impulse','days','weeks'].includes(p.duration)&&quote(p.quote,f)&&clean(p.mechanism)){
   factor={dimension:relevance==='unrelated'?'none':p.dimension,effect:relevance==='unrelated'||p.dimension==='none'?'unclear':p.effect,intensity:p.intensity,novelty:p.novelty,duration:p.duration,quote:p.quote.trim(),mechanism:text(p.mechanism,160)};
  }else warnings.push('一项新闻缺少可核对的预测参数，保留原文但不参与预测');
  reviews[r.id]={id:r.id,version:VERSION,model,fingerprint:Intelligence.fingerprint(facts.get(r.id)),reviewedAt:new Date(now).toISOString(),factor,relevance,status,dimension:r.dimension,dimensionLabel:dimensions[r.dimension],effect,quote:r.quote.trim(),reason:text(r.reason),articleHash:f.articleExcerpt?Intelligence.articleKey({id:f.id,label:f.articleExcerpt}):null};
 }
 const eventCount=input.evidence.filter(f=>f.type==='event').length;if(eventCount&&Object.keys(reviews).length<Math.ceil(eventCount*.5))throw Error('MODEL_RESEARCH_COVERAGE_LOW');
 for(const field of ['interpretations','questions']){base[field]=base[field].filter(row=>!row.evidenceIds.some(id=>reviews[id]?.relevance==='unrelated'));if(!base[field].length)throw Error('MODEL_NO_RELEVANT_ANALYSIS');}
 const relations=[];for(const r of (Array.isArray(value.relations)?value.relations:[]).slice(0,4)){const ids=unique(r?.evidenceIds);if(ids.length!==2||!ids.every(id=>reviews[id])||!['same_event','different_stage','disagreement'].includes(r.type)||!Array.isArray(r.quotes)||r.quotes.length!==2||!ids.every((id,i)=>quote(r.quotes[i],byId.get(id)))||!clean(r.reason)){warnings.push('一组来源对照未通过核对');continue;}relations.push({type:r.type,evidenceIds:ids,quotes:r.quotes.map(q=>q.trim()),reason:text(r.reason),fingerprints:Object.fromEntries(ids.map(id=>[id,reviews[id].fingerprint])),model,reviewedAt:new Date(now).toISOString(),independent:false});}
 const hypotheses=[];for(const h of (Array.isArray(value.hypotheses)?value.hypotheses:[]).slice(0,2)){const refs=unique(h?.evidenceIds),counter=unique(h?.counterEvidenceIds);if(!['upper','lower'].includes(h.levelId)||![5,21].includes(h.steps)||refs.length<2||!counter.length||counter.some(id=>refs.includes(id))||![...refs,...counter].every(id=>byId.has(id)&&reviews[id]?.relevance!=='unrelated')||!refs.some(id=>byId.get(id).type==='event')||![h.title,h.mechanism,h.invalidation].every(x=>clean(x))){warnings.push('缺少相反依据或机制的观察未发布');continue;}hypotheses.push({id:'H-'+Intelligence.fingerprint({id:h.levelId,label:h.title,summary:refs.sort().join('|')}),title:text(h.title,60),levelId:h.levelId,steps:h.steps,mechanism:text(h.mechanism),evidenceIds:refs.slice(0,16),counterEvidenceIds:counter.slice(0,16),invalidation:text(h.invalidation)});}
 const followUps=(Array.isArray(value.followUps)?value.followUps:[]).slice(0,3).filter(f=>byId.get(f?.id)?.type==='event'&&reviews[f.id]?.relevance!=='unrelated'&&clean(f.reason)).map(f=>({id:f.id,reason:text(f.reason,140),fingerprint:Intelligence.fingerprint(facts.get(f.id))}));
 const ids=unique([...input.evidence.filter(f=>f.type!=='event').map(f=>f.id),...base.interpretations.flatMap(r=>r.evidenceIds),...base.questions.flatMap(r=>r.evidenceIds),...hypotheses.flatMap(h=>[...h.evidenceIds,...h.counterEvidenceIds])]);
 return {headline:base.headline,interpretations:base.interpretations,questions:base.questions,reviews,relations,hypotheses,followUps,warnings:unique(warnings),basis:Object.fromEntries(ids.map(id=>[id,Intelligence.fingerprint(facts.get(id))]))};
}
export async function readResearchConfig(backend){
 const response=await fetch(new URL('/runner/config',backend.url),{
  headers:{Authorization:'Bearer '+backend.token},redirect:'error',signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Error('MODEL_HTTP_'+response.status);
 const configuration=await response.json();
 if(!Number.isSafeInteger(configuration?.revision)||configuration.revision<0)throw Error('MODEL_INVALID_RECEIPT');
 return configuration;
}
export async function generateResearch(desk,{key,backend,expectedRevision,previous={},articles=[],fetchImpl=fetch,now=Date.now(),input=researchInput(desk,previous,articles,now)}={}){
 if(backend){
  const {pendingIds, ...evidence}=input;
  const body={input:evidence,...(expectedRevision===undefined?{}:{expectedRevision})},response=await fetchImpl(new URL('/runner/research',backend.url),{
   method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+backend.token},
   body:JSON.stringify(body),signal:AbortSignal.timeout(270_000)
  });
  let reply;try{reply=await response.json();}catch{throw Error('MODEL_HTTP_'+response.status);}
  if(!response.ok)throw Error(/^(?:MODEL|CODEX)_[A-Z0-9_]{2,58}$/.test(reply?.error)?reply.error:'MODEL_HTTP_'+response.status);
  if(expectedRevision!==undefined&&reply.revision!==expectedRevision)throw Error('MODEL_REVISION_CONFLICT');
  if(!Intelligence.validModel(reply?.model)||!Intelligence.validModel(reply.provider)||typeof reply.output!=='string'
     ||!Number.isSafeInteger(reply.revision)||reply.revision<0)throw Error('MODEL_INVALID_RECEIPT');
  return finalizeResearch(desk,input,body,reply.output,{model:reply.model,returnedModel:reply.model,provider:reply.provider,
   reasoningEffort:reply.reasoningEffort,configRevision:reply.revision},reply.usage);
 }
 if(!key)throw Error('MODEL_NOT_CONFIGURED');const body={model:MODEL,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(input)}],reasoning_effort:'high',max_tokens:12288,stream:true,stream_options:{include_usage:true},tools:[],tool_choice:'none'};
 const response=await fetchImpl('https://www.codebuddy.cn/v2/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'AurumGoldResearch/5.2.0 (+https://github.com/yusheng266186-beep/yusheng266186-beep.github.io)',Authorization:'Bearer '+key},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});
 if(!response.ok){const detail=(await response.text()).split(key).join('[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,200);throw Object.assign(Error('MODEL_HTTP_'+response.status),{detail});}
 const payload=await readResearchTransport(response),choice=payload.choices?.[0];if(transportAudit(payload))throw Error('MODEL_TOOL_POLICY_VIOLATION');if(choice?.finish_reason!=='stop'||typeof choice.message?.content!=='string')throw Error('MODEL_INCOMPLETE');
 if(payload.model&&!/^deepseek[-_. ]?v?4[._-]?1[-_. ]?flash(?:[-_. ].*)?$/i.test(payload.model))throw Error('MODEL_IDENTITY_MISMATCH');
 return finalizeResearch(desk,input,body,choice.message.content,{model:MODEL,returnedModel:String(payload.model||MODEL).slice(0,80)},
  {input:payload.usage?.prompt_tokens,output:payload.usage?.completion_tokens});
}
function finalizeResearch(desk,input,body,raw,metadata,usage){
 const completedAt=Date.now(),content=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''),value=validateResearch(JSON.parse(content),input,desk,completedAt,metadata.model);
 const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 return {...value,status:value.warnings.length?'partial':'ready',protocol:VERSION,inputKey:desk.inputKey,anchor:desk.price.origin,
  inputAsOf:input.asOf,generatedAt:new Date(completedAt).toISOString(),...metadata,toolsRegistered:0,requestHash:digest(body),inputHash:digest(input),
  reviewedCount:Object.keys(value.reviews).length,submittedCount:input.evidence.filter(f=>f.type==='event').length,
  usage:{input:usage?.input||0,output:usage?.output||0,...(usage?.thinking?{thinking:usage.thinking}:{})}};
}
export function updateCases(previous,desk,narration,history,now=Date.now()){
 const rows=Array.isArray(previous)?previous.slice(0,200):[],keys=new Set(rows.map(r=>r.caseKey));
 for(const h of narration?.hypotheses||[]){const level=desk.levels.find(l=>l.id===h.levelId),caseKey=Intelligence.fingerprint({id:desk.price.origin+'|'+level.id+'|'+h.steps,label:[...h.evidenceIds,...h.counterEvidenceIds].sort().join('|'),summary:desk.price.close+'|'+level.threshold+'|'+level.invalidation});if(keys.has(caseKey))continue;
  const refs=[...h.evidenceIds,...h.counterEvidenceIds],item=Notes.snapshot({title:h.title,anchor:desk.price,inputKey:desk.inputKey,direction:level.direction,threshold:level.threshold,invalidation:level.invalidation,steps:h.steps,note:h.mechanism+' 相反条件：'+h.invalidation,facts:desk.facts.filter(f=>refs.includes(f.id)),interpretation:h.mechanism},now,'AI-'+caseKey);
  rows.unshift({...item,caseKey,model:narration.model||MODEL,protocol:VERSION,evidenceIds:h.evidenceIds,counterEvidenceIds:h.counterEvidenceIds});keys.add(caseKey);
 }
 return rows.slice(0,200).map(r=>{if(r.outcome)return {...r,current:Notes.auditOutcome(r,history,now)};const current=Notes.evaluate(r,history,now);return {...r,current,...(current.terminal?{outcome:current}:{})};});
}
