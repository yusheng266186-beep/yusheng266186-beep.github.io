/* Shared, deterministic gates for the fixed-model research workflow. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./analysis-engine.js'));else root.AurumResearchIntelligence=factory(root.AurumAnalysis);})(typeof globalThis==='object'?globalThis:this,function(Analysis){
 'use strict';
 const version='research-agent-2',MODEL='deepseek-v4.1-flash';
 const fingerprint=f=>Analysis.hash([f.id,f.label,f.summary||'',f.value??null,f.change??null,f.direction,f.publishedAt,f.kind==='price'?null:f.knownAt,f.url]);
 const articleKey=f=>Analysis.hash([f.id,f.label,f.summary,f.publishedAt,f.url]);
 const eventId=item=>'N-'+Analysis.hash(String(item.title||'').slice(0,240).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')+String(item.publishedAt).slice(0,10));
 function validReview(f,r,now=Date.now()){return !!(r&&r.model===MODEL&&r.version===version&&r.fingerprint===fingerprint(f)&&Number.isFinite(Date.parse(r.reviewedAt))&&Date.parse(r.reviewedAt)<=now&&Date.parse(r.reviewedAt)>=Date.parse(f.knownAt));}
 function current(desk,intelligence,now=Date.now()){
  const cache=intelligence?.version===version?intelligence.reviews||{}:{},reviews={};
  for(const f of desk.events||[])if(validReview(f,cache[f.id],now))reviews[f.id]=cache[f.id];
  const relations=(intelligence?.relations||[]).filter(r=>r.model===MODEL&&Date.parse(r.reviewedAt)<=now&&r.evidenceIds?.length===2&&r.evidenceIds.every(id=>reviews[id]&&r.fingerprints?.[id]===reviews[id].fingerprint));
  const parent=new Map((desk.events||[]).map(f=>[f.id,f.id])),find=id=>{let n=id;while(parent.get(n)!==n)n=parent.get(n);return n;};
  for(const r of relations)if(r.type==='same_event'){const [a,b]=r.evidenceIds.map(find);if(a!==b)parent.set(b,a);}
  const visible=(desk.events||[]).filter(f=>reviews[f.id]?.relevance!=='unrelated'),groups=new Map();
  for(const f of visible){const key=find(f.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(f.id);}
  return {reviews,relations,groups:[...groups.values()],stats:{total:(desk.events||[]).length,reviewed:Object.keys(reviews).length,excluded:Object.values(reviews).filter(r=>r.relevance==='unrelated').length,merged:visible.length-groups.size,pending:(desk.events||[]).length-Object.keys(reviews).length,uncertain:Object.values(reviews).filter(r=>r.relevance==='uncertain').length}};
 }
 function overlay(desk,intelligence,now=Date.now()){
  if(!desk.ready)return desk;const view=current(desk,intelligence,now),representatives=new Set(view.groups.map(ids=>ids[0]));
  const facts=desk.facts.map(f=>{const r=view.reviews[f.id];if(!r)return f.kind==='event'?{...f,direction:0,note:'尚未完成语义审阅，不按标题关键词计入方向线索。'}:f;return {...f,aiReview:r,group:r.dimensionLabel||f.group,direction:r.relevance==='unrelated'||r.status!=='reported'?0:r.effect==='support'?1:r.effect==='pressure'?-1:0,conditional:f.conditional||r.status!=='reported'};});
  const active=facts.filter(f=>f.kind!=='event'||representatives.has(f.id)),supportive=active.filter(f=>f.direction>0).map(f=>f.id),opposing=active.filter(f=>f.direction<0).map(f=>f.id);
  return {...desk,facts,events:facts.filter(f=>f.kind==='event'),intelligenceView:view,reading:{...desk.reading,supportive,opposing,unclear:active.filter(f=>f.kind==='event'&&!f.direction).map(f=>f.id),tension:supportive.length&&opposing.length?'输入存在相反线索':'方向证据仍需补充'}};
 }
 function compatible(desk,narration){
  if(narration?.protocol!==version)return narration?.inputKey===desk.inputKey;
  if(narration.model!==MODEL||narration.anchor!==desk.price?.origin||!narration.basis)return false;
  const facts=new Map(desk.facts.map(f=>[f.id,f]));
  return Object.entries(narration.basis).every(([id,key])=>facts.has(id)&&fingerprint(facts.get(id))===key);
 }
 function feed(items,desk,intelligence,{all=false,now=Date.now()}={}){
  if(!desk?.ready)return items.map(x=>({...x}));const view=current(desk,intelligence,now);if(all)return items.map(x=>({...x,aiReview:view.reviews[eventId(x)]||null}));const groupById=new Map();for(const ids of view.groups)for(const id of ids)groupById.set(id,ids[0]);const seen=new Map(),output=[];
  for(const item of items){const id=eventId(item),review=view.reviews[id];if(review?.relevance==='unrelated')continue;const group=groupById.get(id)||id;if(seen.has(group)){seen.get(group).relatedSources.push({source:item.publisher||item.source,url:item.url});continue;}
   const row={...item,aiReview:review||null,relatedSources:[]};seen.set(group,row);output.push(row);}
  return output;
 }
 return {version,MODEL,fingerprint,articleKey,eventId,validReview,current,overlay,compatible,feed};
});
